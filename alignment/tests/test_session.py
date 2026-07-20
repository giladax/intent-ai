"""Session ingestion: a coding session as observed, reasoning-bearing
evidence — captured, not re-derived; propagating to graph, story, search."""

import json
import pathlib
import shutil

import pytest

from quire_align.entity_graph import (
    Attach,
    CreateEntity,
    GraphDiff,
    append_proposals,
    decide,
)
from quire_align.session import (
    Decision,
    FakeSessionDigester,
    SessionDigest,
    digest_session,
    find_session,
    read_transcript,
    sessions_for_entity,
)
from quire_align.store import Store

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
              "input": {"file_path": "/Users/x/intent-ai/alignment/repo/guard.py"}},
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
    from quire_align.adapters.fixture import FixtureWorkspace

    return FixtureWorkspace(ws)


@pytest.fixture
def store(tmp_path):
    return Store(url=f"sqlite:///{tmp_path}/t.db")


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


def test_digest_stores_decisions_and_couples_to_pr(ws):
    t = ws / "s.jsonl"
    _write_transcript(t)
    record = digest_session(ws, t, _digester(), T0, pr=101)
    assert record["title"] == "Raise the refund ceiling"
    assert record["decisions"][0]["rejected"] == "removing the guard"
    assert record["pr"] == 101
    # idempotent on session id
    again = digest_session(ws, t, _digester(), T0, pr=101)
    from quire_align.session import load_sessions
    assert len([s for s in load_sessions(ws) if s["session_id"] == again["session_id"]]) == 1


def test_session_relates_to_entity_by_touched_path(ws, adapter, store):
    t = ws / "s.jsonl"
    _write_transcript(t)
    digest_session(ws, t, _digester(), T0, pr=101)
    from quire_align.entity_graph import graph_state, load_diffs
    entity = graph_state(load_diffs(ws))["entities"]["ent-refunds"]
    related = sessions_for_entity(ws, adapter, store, entity)
    assert related and related[0]["title"] == "Raise the refund ceiling"
    assert "touched its code" in related[0]["_via"]


def test_navigator_renders_the_session_walk(ws, store):
    from fastapi.testclient import TestClient

    from quire_align.api import create_app

    t = ws / "s.jsonl"
    _write_transcript(t)
    digest_session(ws, t, _digester(), T0, pr=101)
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


def test_session_is_a_citable_source_in_the_story(ws, adapter, store):
    t = ws / "s.jsonl"
    _write_transcript(t)
    digest_session(ws, t, _digester(), T0, pr=101)
    from quire_align.session import session_ref, load_sessions
    from quire_align.story import _universe, Citation, Sentence, Story, validate_story

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
    from quire_align.entity_graph import graph_state, load_diffs
    entity = graph_state(load_diffs(ws))["entities"]["ent-refunds"]
    assert sessions_for_entity(ws, adapter, store, entity), "matched by basename"
