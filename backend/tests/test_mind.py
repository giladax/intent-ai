"""The working mind: free node creation, one discipline — not-lying."""

import pathlib
import shutil

import pytest
from fastapi.testclient import TestClient

from quire.api import create_app
from quire.entity_graph import (
    Attach,
    CreateEntity,
    GraphDiff,
    append_proposals,
    decide,
)
from quire.mind import (
    ConceptNode,
    Connection,
    FakeMind,
    Mind,
    get_mind,
    validate_mind,
)
from quire.store import Store

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
    from quire.adapters.fixture import FixtureWorkspace

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
    from quire.adapters.fixture import FixtureWorkspace

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


def test_evolution_feeds_previous_and_keeps_birthdays(ws, adapter, store):
    thinker = FakeMind(Mind(nodes=[
        ConceptNode(kind="tension", name="Speed vs Gate", gloss="g",
                    connects=[Connection(ref="OB-101")]),
    ]))
    first = get_mind(ws, adapter, store, thinker=thinker, now="2026-07-01T10:00:00+00:00")
    assert thinker.last_previous == ""  # first sweep starts cold
    birthday = first["nodes"][0]["first_seen"]
    # world changes → resweep receives its own prior nodes
    from quire.entity_graph import GraphDiff as GD

    r = append_proposals(ws, [GD(diff_id="", question="More?",
        operations=[CreateEntity(entity_id="ent-more", name="More")])], T0)
    decide(ws, r["added"][0], "approved", by="g", now=T0)
    second = get_mind(ws, adapter, store, thinker=thinker, now="2026-07-02T10:00:00+00:00")
    assert "Speed vs Gate" in thinker.last_previous
    assert second["nodes"][0]["first_seen"] == birthday  # continuity


def test_faded_thoughts_are_recorded_retired(ws, adapter, store):
    keep = ConceptNode(kind="theme", name="Stays", gloss="g",
                       connects=[Connection(ref="OB-101")])
    fades = ConceptNode(kind="smell", name="Fades", gloss="g",
                        connects=[Connection(ref="OB-101")])
    get_mind(ws, adapter, store, thinker=FakeMind(Mind(nodes=[keep, fades])),
             now="2026-07-01T10:00:00+00:00")
    from quire.entity_graph import GraphDiff as GD

    r = append_proposals(ws, [GD(diff_id="", question="More?",
        operations=[CreateEntity(entity_id="ent-m2", name="More2")])], T0)
    decide(ws, r["added"][0], "approved", by="g", now=T0)
    entry = get_mind(ws, adapter, store, thinker=FakeMind(Mind(nodes=[keep])),
                     now="2026-07-02T10:00:00+00:00")
    assert [r["name"] for r in entry["retired"]] == ["Fades"]
    assert "faded" in entry["retired"][0]["why"]


def test_dismissal_is_signed_and_stays_dead(ws, adapter, store):
    from quire.mind import dismiss_thought

    node = ConceptNode(kind="question", name="Noise?", gloss="g",
                       salience="probably-noise",
                       connects=[Connection(ref="OB-101")])
    get_mind(ws, adapter, store, thinker=FakeMind(Mind(nodes=[node])),
             now="2026-07-01T10:00:00+00:00")
    after = dismiss_thought(ws, "Noise?", by="gilad",
                            now="2026-07-01T11:00:00+00:00", why="not a thing")
    assert after["nodes"] == []
    assert after["dismissed"][0]["by"] == "gilad"
    # the next sweep is told about the dismissal
    from quire.entity_graph import GraphDiff as GD

    r = append_proposals(ws, [GD(diff_id="", question="More?",
        operations=[CreateEntity(entity_id="ent-m3", name="More3")])], T0)
    decide(ws, r["added"][0], "approved", by="g", now=T0)
    thinker = FakeMind(Mind(nodes=[node]))
    get_mind(ws, adapter, store, thinker=thinker, now="2026-07-02T10:00:00+00:00")
    assert "DISMISSED BY gilad" in thinker.last_previous
    assert "not a thing" in thinker.last_previous
