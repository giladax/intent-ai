"""The working mind: free node creation, one discipline — not-lying."""

import pathlib
import shutil

import pytest
from fastapi.testclient import TestClient

from quire_align.api import create_app
from quire_align.entity_graph import (
    Attach,
    CreateEntity,
    GraphDiff,
    append_proposals,
    decide,
)
from quire_align.mind import (
    ConceptNode,
    Connection,
    FakeMind,
    Mind,
    get_mind,
    validate_mind,
)
from quire_align.store import Store

FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"
T0 = "2026-07-01T10:00:00+00:00"


@pytest.fixture
def ws(tmp_path) -> pathlib.Path:
    dest = tmp_path / "refund-agent"
    shutil.copytree(FIXTURES / "refund-agent", dest)
    report = append_proposals(dest, [GraphDiff(
        diff_id="", question="Create Refunds?",
        operations=[
            CreateEntity(entity_id="ent-refunds", name="Refunds"),
            Attach(entity_id="ent-refunds", kind="promise", ref="OB-101"),
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


def test_any_kind_no_cap_but_never_lying():
    mind = Mind(nodes=[
        ConceptNode(kind="tension", name="Speed vs approval", gloss="g",
                    connects=[Connection(ref="OB-101"), Connection(ref="ghost-9")]),
        ConceptNode(kind="a totally novel kind", name="Kept", gloss="g",
                    connects=[Connection(ref="ent-refunds")]),
        ConceptNode(kind="question", name="About nothing", gloss="g",
                    connects=[Connection(ref="nope")]),
    ])
    kept, dropped = validate_mind(mind, {"OB-101", "ent-refunds"})
    assert [n.name for n in kept] == ["Speed vs approval", "Kept"]
    assert kept[1].kind == "a totally novel kind"  # kinds are free
    assert dropped == 2  # ghost connections dropped; the empty node with them


def test_mind_caches_and_resweeps_on_change(ws, adapter, store):
    thinker = FakeMind(Mind(nodes=[
        ConceptNode(kind="concept", name="Money-back", gloss="g",
                    connects=[Connection(ref="OB-101", why="the promise")]),
    ]))
    first = get_mind(ws, adapter, store, thinker=thinker, now=T0)
    assert first["nodes"][0]["name"] == "Money-back"
    cached = get_mind(ws, adapter, store, thinker=None, now=T0)
    assert cached["input_hash"] == first["input_hash"]


def test_mind_endpoint_serves_cache_offline(ws, store):
    client = TestClient(create_app(store=store))
    r = client.get(f"/api/mind/{ws}", params={"llm": False})
    assert r.status_code == 200 and r.json()["mind"] is None
    from quire_align.adapters.fixture import FixtureWorkspace

    get_mind(ws, FixtureWorkspace(ws), store,
             thinker=FakeMind(Mind(nodes=[
                 ConceptNode(kind="theme", name="T", gloss="g",
                             connects=[Connection(ref="OB-101")])])), now=T0)
    r = client.get(f"/api/mind/{ws}", params={"llm": False})
    assert r.json()["mind"]["nodes"][0]["kind"] == "theme"


def test_reasoning_survives_on_mind_nodes(ws, adapter, store):
    thinker = FakeMind(Mind(nodes=[
        ConceptNode(kind="tension", name="T", gloss="g",
                    reasoning="I noticed the ceiling and the tier rule pull apart.",
                    connects=[Connection(ref="OB-101")]),
    ]))
    entry = get_mind(ws, adapter, store, thinker=thinker, now=T0)
    assert entry["nodes"][0]["reasoning"].startswith("I noticed")
