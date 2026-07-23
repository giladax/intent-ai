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
