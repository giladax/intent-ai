"""Tests for deliver_alarms_for_org (O5).

Uses StubChannel + fixture workspaces + file-backed SQLite OrgStore.
Verifies: message format (plain sentence + deep link, no raw labels),
dedup prevention (second pass never re-sends), failure isolation
(bomb channel does not crash), purpose filtering (only alarms channels get taps).

All offline — no live Telegram, no live Postgres.
"""
from __future__ import annotations

import pathlib

import pytest

import quire.db.org_models  # noqa — register tables
from quire.db.engine import make_test_engine
from quire.db.models import Base
from quire.db.org_models import ensure_org_tables
from quire.org_store import OrgStore, seed_demo_org
from quire.channels import StubChannel

FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"
APP_HOST = "http://localhost:3456"

# Fixture workspaces that have alarm-producing events (from test_alarms.py)
_FIXTURE_WORKSPACES = ["acme-stream", "helios", "nomad", "vela"]


@pytest.fixture
def engine(tmp_path):
    eng = make_test_engine(url=f"sqlite:///{tmp_path}/test_deliver.db")
    ensure_org_tables(eng)
    yield eng
    Base.metadata.drop_all(eng)


@pytest.fixture
def store(engine):
    s = OrgStore(engine=engine)
    seed_demo_org(s)
    # Seed the four alarm-fixture workspaces so deliver_alarms_for_org finds them.
    # These rows let deliver_alarms_for_org iterate the fixture workspace dirs.
    for ws in _FIXTURE_WORKSPACES:
        s.add_repo(
            org_id="quire",
            repo_id=f"fixture-{ws}",
            workspace=ws,
            display_name=ws,
            status="active",
        )
    return s


def test_deliver_alarms_for_org_no_channels(store):
    """With no alarm channels configured, deliver_alarms_for_org returns [] silently."""
    from quire.deliver_alarms import deliver_alarms_for_org

    results = deliver_alarms_for_org(store, FIXTURES, app_host=APP_HOST)
    assert results == []


def test_deliver_alarms_for_org_stub_channel(store, monkeypatch):
    """With a StubChannel wired via monkeypatch, fixture workspaces produce alarms.

    The vela fixture has at least one silent-drift alarm (the ent-consent entity).
    """
    from quire.deliver_alarms import deliver_alarms_for_org

    stub = StubChannel()
    monkeypatch.setattr("quire.deliver_alarms.channel_from_config", lambda cfg: stub)

    store.add_channel("quire", "telegram", {"token": "t", "chat_id": "c"}, ["alarms"])

    results = deliver_alarms_for_org(store, FIXTURES, app_host=APP_HOST)

    # vela has at least 1 alarm (the consent silent-drift)
    assert len(stub.sent) >= 1
    assert len(results) >= 1
    assert all(r["ok"] for r in results)


def test_deliver_alarms_message_has_plain_headline_and_deep_link(store, monkeypatch):
    """The message body has the plain-language headline and a deep link. No raw labels."""
    from quire.deliver_alarms import deliver_alarms_for_org

    stub = StubChannel()
    monkeypatch.setattr("quire.deliver_alarms.channel_from_config", lambda cfg: stub)
    store.add_channel("quire", "telegram", {"token": "t", "chat_id": "c"}, ["alarms"])

    deliver_alarms_for_org(store, FIXTURES, app_host=APP_HOST)

    assert stub.sent, "expected at least one message from fixture alarms"
    for sent in stub.sent:
        text = sent["text"]
        # Must contain the app host deep link
        assert APP_HOST in text, f"deep link missing from: {text[:120]}"
        assert "/repo/" in text or "/review/" in text, "deep link path missing"
        # Must NOT contain raw classification labels or entity IDs
        assert "silent-drift" not in text.lower(), f"raw signal label leaked: {text[:120]}"
        assert "ent-" not in text, f"entity ID leaked: {text[:120]}"
        # Receipts are passed separately
        receipts = sent["receipts"]
        assert isinstance(receipts, list)


def test_deliver_alarms_deep_link_has_pr_number(store, monkeypatch):
    """The vela consent alarm has a breaking check (PR 342) → deep link has /review/342."""
    from quire.deliver_alarms import deliver_alarms_for_org

    stub = StubChannel()
    monkeypatch.setattr("quire.deliver_alarms.channel_from_config", lambda cfg: stub)
    store.add_channel("quire", "telegram", {"token": "t", "chat_id": "c"}, ["alarms"])

    deliver_alarms_for_org(store, FIXTURES, app_host=APP_HOST)

    # Find the vela consent message (contains "opt-in" or "342" in text or receipts)
    found_pr_link = any(
        "/review/" in sent["text"] for sent in stub.sent
    )
    assert found_pr_link, "expected at least one alarm with /review/<pr> deep link"


def test_deliver_alarms_dedup_prevents_re_tap(store, monkeypatch):
    """Same alarm delivered on pass 1 must NOT be re-delivered on pass 2."""
    from quire.deliver_alarms import deliver_alarms_for_org

    stub = StubChannel()
    monkeypatch.setattr("quire.deliver_alarms.channel_from_config", lambda cfg: stub)
    store.add_channel("quire", "telegram", {"token": "t", "chat_id": "c"}, ["alarms"])

    # First pass — delivers alarms
    deliver_alarms_for_org(store, FIXTURES, app_host=APP_HOST)
    first_count = len(stub.sent)
    assert first_count >= 1, "expected at least one alarm on first pass"

    # Second pass — same state, delivered keys now persisted → should send 0 new
    deliver_alarms_for_org(store, FIXTURES, app_host=APP_HOST)
    assert len(stub.sent) == first_count, (
        f"expected no re-delivery, got {len(stub.sent) - first_count} extra sends"
    )


def test_deliver_alarms_channel_failure_does_not_crash(store, monkeypatch):
    """A channel that raises on send does not crash deliver_alarms_for_org."""
    from quire.deliver_alarms import deliver_alarms_for_org

    class _BombChannel:
        def send(self, text, *, receipts):
            raise RuntimeError("network down")

    monkeypatch.setattr("quire.deliver_alarms.channel_from_config", lambda cfg: _BombChannel())
    store.add_channel("quire", "telegram", {"token": "t", "chat_id": "c"}, ["alarms"])

    # Must not raise; results contain error entries
    results = deliver_alarms_for_org(store, FIXTURES, app_host=APP_HOST)
    assert isinstance(results, list)
    # All results should have ok=False (the channel raised)
    assert all(not r["ok"] for r in results)


def test_deliver_alarms_purpose_filter(store, monkeypatch):
    """A channel with purposes=['digest'] (no 'alarms') never receives alarm taps."""
    from quire.deliver_alarms import deliver_alarms_for_org

    stub = StubChannel()
    monkeypatch.setattr("quire.deliver_alarms.channel_from_config", lambda cfg: stub)

    # Only a digest channel — not an alarms channel
    store.add_channel("quire", "telegram", {"token": "t", "chat_id": "c"}, ["digest"])

    results = deliver_alarms_for_org(store, FIXTURES, app_host=APP_HOST)
    assert results == []
    assert stub.sent == []


def test_deliver_alarms_result_shape(store, monkeypatch):
    """Each result dict has the documented keys."""
    from quire.deliver_alarms import deliver_alarms_for_org

    stub = StubChannel()
    monkeypatch.setattr("quire.deliver_alarms.channel_from_config", lambda cfg: stub)
    store.add_channel("quire", "telegram", {"token": "t", "chat_id": "c"}, ["alarms"])

    results = deliver_alarms_for_org(store, FIXTURES, app_host=APP_HOST)
    assert results  # at least one result
    for r in results:
        assert "workspace" in r
        assert "channel_id" in r
        assert "dedup_key" in r
        assert "ok" in r
        assert "message_id" in r
        assert "error" in r


def test_deliver_alarms_nonexistent_workspace_skipped(store, monkeypatch):
    """Workspaces listed in org_repos but not on disk are silently skipped."""
    from quire.deliver_alarms import deliver_alarms_for_org

    stub = StubChannel()
    monkeypatch.setattr("quire.deliver_alarms.channel_from_config", lambda cfg: stub)
    store.add_channel("quire", "telegram", {"token": "t", "chat_id": "c"}, ["alarms"])

    # Use an empty tmp dir as workspaces_root — no workspace dirs exist
    import tempfile
    with tempfile.TemporaryDirectory() as empty_dir:
        results = deliver_alarms_for_org(
            store, pathlib.Path(empty_dir), app_host=APP_HOST
        )
    assert results == []
    assert stub.sent == []


def test_deliver_alarms_app_host_env(store, monkeypatch):
    """QUIRE_APP_HOST env var overrides the default in deep links."""
    from quire.deliver_alarms import deliver_alarms_for_org

    monkeypatch.setenv("QUIRE_APP_HOST", "https://quire.example.com")
    stub = StubChannel()
    monkeypatch.setattr("quire.deliver_alarms.channel_from_config", lambda cfg: stub)
    store.add_channel("quire", "telegram", {"token": "t", "chat_id": "c"}, ["alarms"])

    deliver_alarms_for_org(store, FIXTURES)  # no app_host arg → uses env

    assert stub.sent
    assert all("https://quire.example.com" in s["text"] for s in stub.sent)


def test_store_backed_off_intent_fires_through_delivery(store, monkeypatch, tmp_path):
    """C1 revert-check: a workspace with NO checks.yaml + a store-backed OFF_INTENT
    analysis → the alarm fires through delivery to StubChannel.

    If the alignment store is not threaded into deliver_alarms_for_org (i.e. store
    param is None / not forwarded to alarms_for), events_for returns an empty check
    list, no collision is detected, and this test FAILS (0 sends).
    """
    import shutil
    from quire.store import Store
    from quire.models import (
        PRAnalysis, Classification, ObligationImpact, ImpactRelation, ReviewState
    )
    from quire.deliver_alarms import deliver_alarms_for_org

    # --- 1. Build a workspace dir with NO checks.yaml ---
    vela_src = pathlib.Path(__file__).parent.parent / "fixtures" / "vela"
    ws_root = tmp_path / "workspaces"
    ws_root.mkdir()
    ws_dir = ws_root / "vela"
    shutil.copytree(vela_src, ws_dir)
    (ws_dir / "checks.yaml").unlink(missing_ok=True)
    assert not (ws_dir / "checks.yaml").exists(), "checks.yaml must be absent for this test"

    # --- 2. Build a real alignment store and seed an OFF_INTENT analysis ---
    # adapter.repository() for the vela fixture returns "vela-messaging"
    # Use an obligation_id that the vela entity-graph holds as a "promise".
    # Read obligations.yaml to find a valid id.
    import yaml as _yaml
    obs = _yaml.safe_load((ws_dir / "obligations.yaml").read_text())
    ob_id = obs["obligations"][0]["obligation_id"]

    alignment_store = Store(url=f"sqlite:///{tmp_path}/align.db")
    analysis = PRAnalysis(
        analysis_id="test-store-alarm-001",
        workflow_id="vela-stream",
        repository="vela-messaging",
        pr_number=999,
        base_sha="base000",
        head_sha="head999",
        contract_snapshot_id="snap001",
        analyzer_version="test",
        classification=Classification.OFF_INTENT,
        obligation_impacts=[
            ObligationImpact(
                obligation_id=ob_id,
                relation=ImpactRelation.CONTRADICTS,
                confidence=0.95,
                reasoning="test contradicts intent",
            )
        ],
        review_state=ReviewState.NOT_REQUIRED,
    )
    alignment_store.save_analysis(analysis)

    # --- 3. The store fixture already has "vela" in org_repos (seeded by _FIXTURE_WORKSPACES).
    # We override workspaces_root to point at ws_root (our tmp copy without checks.yaml),
    # so delivery picks up the right directory.

    # --- 4. Wire StubChannel ---
    stub = StubChannel()
    monkeypatch.setattr("quire.deliver_alarms.channel_from_config", lambda cfg: stub)
    store.add_channel("quire", "telegram", {"token": "t", "chat_id": "c"}, ["alarms"])

    # --- 5. Deliver with the alignment store threaded in ---
    results = deliver_alarms_for_org(
        store, ws_root, store=alignment_store, app_host=APP_HOST
    )

    assert len(stub.sent) >= 1, (
        "expected at least one alarm from store-backed OFF_INTENT analysis; "
        "if 0 sends, the alignment store is not threaded into alarms_for"
    )
    assert any(r["ok"] for r in results), "expected at least one ok delivery result"


def test_delivered_keys_pruned_at_501(store):
    """501st unique key evicts the oldest; dedup still holds for recent keys.

    Bound: keep the most recent N=500 delivered keys per channel.
    Rationale: dedup only matters for active breaks (14-day window); a workspace
    producing >500 unique breaks is pathological. Pruning prevents unbounded
    growth of the _delivered_keys jsonb column.
    """
    ch_id = store.add_channel("quire", "telegram", {"token": "t", "chat_id": "c"}, ["alarms"])

    # Seed 500 keys
    initial = [f"key-{i:04d}" for i in range(500)]
    store.update_channel_delivery_state(ch_id, initial)

    channels = store.get_alarm_channels()
    ch = next(c for c in channels if c["id"] == ch_id)
    assert len(ch["delivered_keys"]) == 500, "expected 500 keys after initial seed"
    assert ch["delivered_keys"][0] == "key-0000", "oldest key should be first"

    # Add the 501st key — oldest must be evicted
    keys_with_new = initial + ["key-0500"]
    store.update_channel_delivery_state(ch_id, keys_with_new)

    channels = store.get_alarm_channels()
    ch = next(c for c in channels if c["id"] == ch_id)
    assert len(ch["delivered_keys"]) == 500, "expected pruning to 500 after 501st key"
    assert "key-0000" not in ch["delivered_keys"], "oldest key must be evicted"
    assert "key-0500" in ch["delivered_keys"], "newest key must be present"
    # Recent keys still deduplicate (not evicted)
    assert "key-0499" in ch["delivered_keys"], "second-to-last key must still be present"


def test_new_break_fires_after_prior_delivery(store, monkeypatch):
    """M1: same entity, new break_ref (new PR) → taps again after earlier delivery.

    Prior delivery of break_ref=PR-1 must NOT suppress break_ref=PR-2.
    The dedup key is (entity_id, signal, break_ref); a new PR is a new key.
    """
    from quire.deliver_alarms import deliver_alarms_for_org
    from quire.alarms import Alarm, Receipt

    stub = StubChannel()
    monkeypatch.setattr("quire.deliver_alarms.channel_from_config", lambda cfg: stub)
    store.add_channel("quire", "telegram", {"token": "t", "chat_id": "c"}, ["alarms"])

    # Add a repo entry so delivery has at least one workspace to iterate.
    store.add_repo(
        org_id="quire",
        repo_id="test-m1",
        workspace="m1-test-ws",
        display_name="m1 test ws",
        status="active",
    )

    def _alarm_factory(dedup_key: str) -> Alarm:
        return Alarm(
            entity_id="ent-consent",
            entity_name="Consent Gate",
            signal="silent-drift",
            severity="critical",
            audience=["stakeholder"],
            headline="Consent Gate broke 3 days ago — and no one is watching.",
            story="Test story.",
            receipts=[Receipt(kind="check", ref=dedup_key.split(":")[-1], note="test")],
            dedup_key=dedup_key,
            ts="2026-07-20T00:00:00Z",
        )

    # Pass 1: alarm with break_ref PR-1
    def _alarms_pass1(ws_path, adapter, store_arg, window_days=14, seen=None, **kw):
        key = "ent-consent:silent-drift:PR-1"
        if seen and key in seen:
            return []
        return [_alarm_factory(key)]

    monkeypatch.setattr("quire.deliver_alarms.alarms_for", _alarms_pass1)
    monkeypatch.setattr("quire.deliver_alarms._build_adapter", lambda p: object())  # non-None adapter

    deliver_alarms_for_org(store, FIXTURES, app_host=APP_HOST)
    assert len(stub.sent) == 1, "expected exactly 1 send on pass 1 (PR-1)"

    # Pass 2: NEW break — PR-2. Prior dedup key (PR-1) is in delivered_keys.
    def _alarms_pass2(ws_path, adapter, store_arg, window_days=14, seen=None, **kw):
        key = "ent-consent:silent-drift:PR-2"
        if seen and key in seen:
            return []
        return [_alarm_factory(key)]

    monkeypatch.setattr("quire.deliver_alarms.alarms_for", _alarms_pass2)
    deliver_alarms_for_org(store, FIXTURES, app_host=APP_HOST)
    assert len(stub.sent) == 2, (
        "expected exactly 2 sends total after pass 2 (new break PR-2 must fire)"
    )


def test_healthy_workspace_zero_sends(store, monkeypatch):
    """M2: alarms channel configured, no collisions → 0 sends.

    A workspace in a healthy state (all entities aligned) must not tap
    the channel even when alarm delivery runs. This guards against the
    alarm policy accidentally firing on benign states.
    """
    from quire.deliver_alarms import deliver_alarms_for_org

    stub = StubChannel()
    monkeypatch.setattr("quire.deliver_alarms.channel_from_config", lambda cfg: stub)
    store.add_channel("quire", "telegram", {"token": "t", "chat_id": "c"}, ["alarms"])
    store.add_repo(
        org_id="quire",
        repo_id="test-m2-healthy",
        workspace="m2-healthy-ws",
        display_name="m2 healthy ws",
        status="active",
    )

    # Patch alarms_for to return no alarms (healthy workspace)
    monkeypatch.setattr(
        "quire.deliver_alarms.alarms_for",
        lambda ws_path, adapter, store_arg, **kw: []
    )
    monkeypatch.setattr("quire.deliver_alarms._build_adapter", lambda p: object())

    results = deliver_alarms_for_org(store, FIXTURES, app_host=APP_HOST)

    assert len(stub.sent) == 0, (
        f"expected 0 sends for healthy workspace, got {len(stub.sent)}"
    )
    assert results == [], "expected empty results for healthy workspace (no alarms)"
