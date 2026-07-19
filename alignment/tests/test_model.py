"""The shared brain's read surface: any ref → focus + typed neighborhood
with reasoning on every edge. The navigator and the MCP surface both
consume this composition."""

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
from quire_align.mind import ConceptNode, Connection, FakeMind, Mind, get_mind
from quire_align.model import around
from quire_align.store import Store

FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"
T0 = "2026-07-01T10:00:00+00:00"


@pytest.fixture
def ws(tmp_path) -> pathlib.Path:
    dest = tmp_path / "refund-agent"
    shutil.copytree(FIXTURES / "refund-agent", dest)
    report = append_proposals(dest, [GraphDiff(
        diff_id="", question="Create Refunds?",
        reasoning="grouped by the money-back flow",
        operations=[
            CreateEntity(entity_id="ent-refunds", name="Refunds",
                         identity_sentence="How money goes back."),
            Attach(entity_id="ent-refunds", kind="promise", ref="OB-101"),
            Attach(entity_id="ent-refunds", kind="promise", ref="OB-102"),
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


@pytest.fixture
def checked(ws, adapter, store):
    """One real (canned) check so observed edges exist."""
    from quire_align.analysis.graph import run_analysis
    from quire_align.canned import fake_for_pr

    run_analysis(adapter, 103, llm=fake_for_pr(103), store=store)
    return store


@pytest.fixture
def minded(ws, adapter, store):
    get_mind(ws, adapter, store, thinker=FakeMind(Mind(nodes=[
        ConceptNode(kind="tension", name="Speed vs Gate",
                    gloss="fast refunds against human review",
                    reasoning="OB-101 automates what OB-102 gates",
                    salience="important",
                    connects=[Connection(ref="OB-101", why="the automated side")]),
    ])), now=T0)
    return ws


def test_entity_focus_walks_all_three_moods(ws, adapter, checked, minded):
    out = around(ws, adapter, checked, "ent-refunds")
    node = out["node"]
    assert node["mood"] == "signed"
    assert node["reasoning"] == "grouped by the money-back flow"
    assert "signed by gilad" in node["meta"]
    moods = {n["mood"] for n in out["neighbors"]}
    assert moods == {"signed", "observed", "thought"}
    promise = next(n for n in out["neighbors"] if n["kind"] == "promise")
    assert promise["label"].startswith("Premium-tier")  # statements, not ids
    thought = next(n for n in out["neighbors"] if n["mood"] == "thought")
    assert thought["why"] == "the automated side"
    assert out["authority"] == {"teach": "ent-refunds"}


def test_promise_focus_completes_the_chain_of_custody(ws, adapter, checked):
    # OB-102 carries a MATERIAL finding in check 103 (the filter
    # drops merely-looked "unrelated" findings by design)
    out = around(ws, adapter, checked, "OB-102")
    check = next(n for n in out["neighbors"] if n["kind"] == "check")
    assert check["ref"].isdigit()  # hop to the receipt
    assert check["why"], "the finding's reasoning rides the edge"
    code = [n for n in out["neighbors"] if n["kind"] == "code"]
    assert code, "bindings ground the promise in code"
    entity = next(n for n in out["neighbors"] if n["kind"] == "entity")
    assert entity["label"] == "Refunds"


def test_check_focus_bottoms_out_at_file_lines(ws, adapter, checked):
    out = around(ws, adapter, checked, "103")
    assert out["node"]["mood"] == "observed"
    finding = next(
        n for n in out["neighbors"]
        if n["kind"] == "promise" and ":" in n["meta"]
    )
    assert finding["why"], "reasoning connects evidence to claim"


def test_diff_and_thought_focus(ws, adapter, store, minded):
    diff = around(ws, adapter, store, "GD-1")
    assert diff["node"]["reasoning"] == "grouped by the money-back flow"
    assert "signed by gilad" in diff["node"]["meta"]
    thought = around(ws, adapter, store, "speed vs gate")  # case-insensitive
    assert thought["node"]["mood"] == "thought"
    assert thought["authority"] == {"dismiss": "Speed vs Gate"}
    assert any(n["ref"] == "OB-101" for n in thought["neighbors"])


def test_unknown_ref_404s_over_http(ws, store):
    client = TestClient(create_app(store=store))
    assert client.get(f"/api/model/{ws}/around/ent-refunds").status_code == 200
    r = client.get(f"/api/model/{ws}/around/nothing-here")
    assert r.status_code == 404
    assert "answers to" in r.json()["detail"]
