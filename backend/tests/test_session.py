"""Session ingestion: a coding session as observed, reasoning-bearing
evidence — captured, not re-derived; propagating to graph, story, search."""

import json
import pathlib
import shutil

import pytest

from quire.entity_graph import (
    Attach,
    CreateEntity,
    GraphDiff,
    append_proposals,
    decide,
)
from quire.session import (
    Decision,
    FakeSessionDigester,
    SessionDigest,
    digest_session,
    find_session,
    read_transcript,
    sessions_for_entity,
)
from quire.store import Store

FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"
T0 = "2026-07-01T10:00:00+00:00"


def _write_transcript(path: pathlib.Path) -> None:
    """A real-shaped .jsonl: user turn, then assistant text (reasoning) +
    a tool_use editing a file."""
    lines = [
        {"sessionId": "abc123def", "timestamp": "2026-07-01T09:00:00Z",
         "message": {"role": "user", "content": "fix the guard"}},
        {"sessionId": "abc123def", "timestamp": "2026-07-01T09:01:00Z",
         "message": {"role": "assistant", "content": [
             {"type": "text", "text": "I'll raise the ceiling to $100 and keep the guard."},
             {"type": "tool_use", "name": "Edit",
              "input": {"file_path": "/Users/x/intent-ai/backend/repo/guard.py"}},
         ]}},
    ]
    path.write_text("\n".join(json.dumps(x) for x in lines))


@pytest.fixture
def ws(tmp_path) -> pathlib.Path:
    dest = tmp_path / "refund-agent"
    shutil.copytree(FIXTURES / "refund-agent", dest)
    report = append_proposals(dest, [GraphDiff(
        diff_id="", question="Create Refunds?",
        operations=[
            CreateEntity(entity_id="ent-refunds", name="Refunds"),
            Attach(entity_id="ent-refunds", kind="promise", ref="OB-101"),
            Attach(entity_id="ent-refunds", kind="code", ref="repo/guard.py"),
        ],
    )], T0)
    decide(dest, report["added"][0], "approved", by="gilad", now=T0)
    return dest


@pytest.fixture
def adapter(ws):
    from quire.adapters.fixture import FixtureWorkspace

    return FixtureWorkspace(ws)


@pytest.fixture
def store(tmp_path):
    return Store(url=f"sqlite:///{tmp_path}/t.db")


@pytest.fixture
def link_store():
    """LinkStore on an in-memory SQLite engine — never production.

    Any test that digests a session with a PR must pass this explicitly:
    the conftest guard makes an engine-less LinkStore() raise in tests, so
    an implicit production store can never be constructed again.
    """
    from quire.links import LinkStore

    return LinkStore(engine=_make_engine())


def _digester():
    return FakeSessionDigester(SessionDigest(
        title="Raise the refund ceiling",
        summary="Lifted the policy limit to $100 while keeping the guard.",
        decisions=[Decision(choice="keep the tool-side guard",
                            why="the policy alone can't enforce a ceiling",
                            rejected="removing the guard")],
        reasoning="The ceiling and the guard are two layers; I kept both.",
    ))


def test_reader_extracts_reasoning_and_touched_files(ws):
    t = ws / "s.jsonl"
    _write_transcript(t)
    raw = read_transcript(t)
    assert raw.session_id == "abc123def"
    assert raw.turns == 1
    assert any(p.endswith("repo/guard.py") for p in raw.touched_paths)  # abs → repo-relative
    assert "raise the ceiling" in raw.reasoning_text.lower()


def test_digest_stores_decisions_and_couples_to_pr(ws, link_store):
    t = ws / "s.jsonl"
    _write_transcript(t)
    record = digest_session(ws, t, _digester(), T0, pr=101, link_store=link_store)
    assert record["title"] == "Raise the refund ceiling"
    assert record["decisions"][0]["rejected"] == "removing the guard"
    assert record["pr"] == 101
    # idempotent on session id
    again = digest_session(ws, t, _digester(), T0, pr=101, link_store=link_store)
    from quire.session import load_sessions
    assert len([s for s in load_sessions(ws) if s["session_id"] == again["session_id"]]) == 1


def test_session_relates_to_entity_by_touched_path(ws, adapter, store, link_store):
    t = ws / "s.jsonl"
    _write_transcript(t)
    digest_session(ws, t, _digester(), T0, pr=101, link_store=link_store)
    from quire.entity_graph import graph_state, load_diffs
    entity = graph_state(load_diffs(ws))["entities"]["ent-refunds"]
    related = sessions_for_entity(ws, adapter, store, entity)
    assert related and related[0]["title"] == "Raise the refund ceiling"
    assert "touched its code" in related[0]["_via"]


def test_navigator_renders_the_session_walk(ws, store, link_store):
    from fastapi.testclient import TestClient

    from quire.api import create_app

    t = ws / "s.jsonl"
    _write_transcript(t)
    digest_session(ws, t, _digester(), T0, pr=101, link_store=link_store)
    client = TestClient(create_app(store=store))
    ref = find_session(ws, "session-abc123de")["session_id"]
    focus = client.get(f"/api/model/{ws}/around/session-{ref[:8]}").json()
    assert focus["node"]["kind"] == "session"
    assert focus["node"]["reasoning"]  # reasoning is first-class
    assert "Key decisions" in focus["node"]["body"]
    # from the session, an entity it touched is a walkable neighbor
    assert any(n["kind"] == "entity" and n["ref"] == "ent-refunds"
               for n in focus["neighbors"])
    # and the entity focus shows the session back
    ent = client.get(f"/api/model/{ws}/around/ent-refunds").json()
    assert any(n["kind"] == "session" for n in ent["neighbors"])


def test_session_is_a_citable_source_in_the_story(ws, adapter, store, link_store):
    t = ws / "s.jsonl"
    _write_transcript(t)
    digest_session(ws, t, _digester(), T0, pr=101, link_store=link_store)
    from quire.session import session_ref, load_sessions
    from quire.story import _universe, Citation, Sentence, Story, validate_story

    ref = session_ref(load_sessions(ws)[0])
    universe = _universe(ws, adapter, store)
    assert ref in universe["session"]
    story = Story(sentences=[Sentence(
        text="The ceiling was reasoned through in a session, keeping the guard because the policy can't enforce it.",
        cites=[Citation(kind="session", ref=ref)])])
    kept, dropped = validate_story(story, universe)
    # a session citation resolves AND licenses 'because' (reason-bearing)
    assert dropped == 0 and kept[0].cites[0].kind == "session"


# -- adversarial (blind review 2026-07-20) --------------------------------

def test_reader_survives_malformed_and_empty_jsonl(ws):
    t = ws / "bad.jsonl"
    t.write_text('not json\n{"broken\n\n{"message": {"role": "assistant", "content": "x"}}\n')
    raw = read_transcript(t)  # must not raise
    assert raw.turns >= 0


def test_ambiguous_session_prefix_refuses(ws):
    import yaml
    (ws / "sessions.yaml").write_text(yaml.safe_dump([
        {"session_id": "aaaabbbbcccc1", "title": "one", "touched_paths": []},
        {"session_id": "aaaabbbbcccc2", "title": "two", "touched_paths": []},
    ]))
    # a prefix shared by both must NOT silently return the first (B4)
    assert find_session(ws, "aaaabbbbcccc") is None
    # the exact id still resolves
    assert find_session(ws, "aaaabbbbcccc1")["title"] == "one"


def test_session_matches_entity_outside_this_repo(ws, adapter, store):
    """A transcript from a different absolute root still relates by
    basename/suffix (B3)."""
    import json
    t = ws / "elsewhere.jsonl"
    t.write_text("\n".join(json.dumps(x) for x in [
        {"sessionId": "zzz999", "message": {"role": "assistant", "content": [
            {"type": "text", "text": "editing the guard"},
            {"type": "tool_use", "name": "Write",
             "input": {"file_path": "/opt/someorg/service/repo/guard.py"}},
        ]}},
    ]))
    digest_session(ws, t, _digester(), T0, pr=None)
    from quire.entity_graph import graph_state, load_diffs
    entity = graph_state(load_diffs(ws))["entities"]["ent-refunds"]
    assert sessions_for_entity(ws, adapter, store, entity), "matched by basename"


# -- PR coupling → link table (Fix 2) ----------------------------------------

def _make_engine():
    """SQLite in-memory engine with session_checks bootstrapped."""
    from quire.db.engine import make_test_engine
    from quire.db.models import Base
    from quire.links import SessionCheck  # noqa: F401 — registers table

    eng = make_test_engine()
    Base.metadata.create_all(eng)
    return eng


def _write_minimal_transcript(path: pathlib.Path, session_id: str = "linktest001") -> None:
    import json
    lines = [
        {"sessionId": session_id, "timestamp": "2026-07-01T09:00:00Z",
         "message": {"role": "user", "content": "do work"}},
        {"sessionId": session_id, "timestamp": "2026-07-01T09:01:00Z",
         "message": {"role": "assistant", "content": [
             {"type": "text", "text": "done"},
         ]}},
    ]
    path.write_text("\n".join(json.dumps(x) for x in lines))


def test_digest_session_with_pr_creates_link_row(tmp_path, link_store):
    """When digest_session is called with pr=N, a kind='attached' link row
    lands in the session_checks table (SQLite in-memory), via the
    injectable link_store parameter."""
    t = tmp_path / "link_test.jsonl"
    _write_minimal_transcript(t, session_id="linktest001")

    record = digest_session(
        tmp_path, t, _digester(), T0, pr=42, link_store=link_store
    )

    assert record["pr"] == 42
    # The link must have landed in session_checks.
    links = link_store.links_for_session("linktest001")
    assert len(links) == 1
    lnk = links[0]
    assert lnk.pr_number == 42
    assert lnk.kind == "attached"
    assert lnk.confidence == 1.0
    assert lnk.evidence == "sessions.yaml:linktest001"


def test_digest_session_succeeds_when_link_store_raises(tmp_path):
    """The yaml-based digest must complete (yaml written, record returned)
    even when the link store raises — failure-safe, consistent with emit-events
    pattern."""
    import unittest.mock as mock
    import warnings

    t = tmp_path / "resilient.jsonl"
    _write_minimal_transcript(t, session_id="resilient001")

    # Make LinkStore construction raise a DB connection error by patching
    # the class in quire.links (where upsert_from_yaml_record imports it from).
    with mock.patch(
        "quire.links.LinkStore",
        side_effect=Exception("Postgres is down"),
    ):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            record = digest_session(tmp_path, t, _digester(), T0, pr=99)

    # Digest must have succeeded.
    assert record["pr"] == 99
    assert record["session_id"] == "resilient001"
    # The yaml file must exist.
    assert (tmp_path / "sessions.yaml").exists()
    # A warning (not an exception) must have been issued.
    assert any("link store write failed" in str(w.message) for w in caught), (
        f"Expected a link-store warning; got: {[str(w.message) for w in caught]}"
    )


def test_digest_session_default_store_cannot_reach_production(tmp_path):
    """Guard test for the leak class: digest_session with the DEFAULT
    link_store=None must be intercepted by the conftest guard (an
    engine-less LinkStore() raises in tests) and fall into the failure-safe
    warning path — never a production write.

    If this test fails with no guard-message warning, the conftest
    _no_implicit_production_link_store fixture is gone or broken and tests
    can silently write to the live session_checks table again (this
    happened once: sessions 'abc123def' and 'yaml-compat-sess' leaked)."""
    import warnings

    t = tmp_path / "guard.jsonl"
    _write_minimal_transcript(t, session_id="guardtest001")

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        record = digest_session(tmp_path, t, _digester(), T0, pr=7)

    # Digest still succeeds (failure-safe), but the link write must have
    # been blocked by the guard — its message names the engine-less construction.
    assert record["pr"] == 7
    guard_hits = [
        w for w in caught
        if "link store write failed" in str(w.message)
        and "with no engine" in str(w.message)
    ]
    assert guard_hits, (
        "digest_session constructed a real LinkStore — the conftest "
        "production-store guard is not active; tests can leak rows into "
        f"production session_checks. Warnings seen: {[str(w.message) for w in caught]}"
    )


def test_digest_session_pr_zero_never_constructs_a_store(tmp_path):
    """pr=0 is falsy — both digest_session and upsert_from_yaml_record gate
    on truthiness, so no store is constructed and no link row is written
    (guard asymmetry fix: previously session.py gated `pr is not None`,
    which constructed a production LinkStore for pr=0 then no-opped)."""
    import warnings

    t = tmp_path / "przero.jsonl"
    _write_minimal_transcript(t, session_id="przero001")

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        record = digest_session(tmp_path, t, _digester(), T0, pr=0)

    assert record["pr"] == 0  # yaml keeps the value as given
    # No store construction attempt at all: the guard would have fired a
    # "link store write failed" warning if LinkStore() had been called.
    assert not any("link store write failed" in str(w.message) for w in caught)
