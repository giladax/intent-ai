"""Plot atoms (deterministic narrative currency) and semantic resolution
(meaning over alias-dictionary maintenance)."""

import pathlib
import shutil

import pytest
from fastapi.testclient import TestClient

from quire_align.api import create_app
from quire_align.atoms import atoms_for
from quire_align.entity_graph import (
    Attach,
    CreateEntity,
    GraphDiff,
    append_proposals,
    decide,
)
from quire_align.relevance import node_documents, resolve_semantic
from quire_align.store import Store
from quire_align.teach import teach_alias

FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"
T0 = "2026-07-01T10:00:00+00:00"
T1 = "2026-07-01T11:00:00+00:00"


@pytest.fixture
def ws(tmp_path) -> pathlib.Path:
    dest = tmp_path / "refund-agent"
    shutil.copytree(FIXTURES / "refund-agent", dest)
    report = append_proposals(dest, [GraphDiff(
        diff_id="", question="Create Refunds?",
        operations=[
            CreateEntity(entity_id="ent-refunds", name="Refunds",
                         identity_sentence="How money goes back to customers."),
            Attach(entity_id="ent-refunds", kind="promise", ref="OB-101"),
            Attach(entity_id="ent-refunds", kind="promise", ref="OB-102"),
        ],
    ), GraphDiff(
        diff_id="", question="Create Risk?",
        operations=[
            CreateEntity(entity_id="ent-risk", name="Risk Review",
                         identity_sentence="Who must look before money moves."),
            Attach(entity_id="ent-risk", kind="promise", ref="OB-103"),
        ],
    )], T0)
    for diff_id in report["added"]:
        decide(dest, diff_id, "approved", by="gilad", now=T0)
    return dest


@pytest.fixture
def adapter(ws):
    from quire_align.adapters.fixture import FixtureWorkspace

    return FixtureWorkspace(ws)


@pytest.fixture
def store(tmp_path):
    return Store(url=f"sqlite:///{tmp_path}/t.db")


# -- atoms ----------------------------------------------------------------


def test_atoms_narrate_births_declines_and_returns(ws, adapter, store):
    rejected = append_proposals(ws, [GraphDiff(
        diff_id="", question="Call it Everything?",
        operations=[
            CreateEntity(entity_id="ent-x", name="Everything"),
            Attach(entity_id="ent-x", kind="promise", ref="OB-104"),
        ],
    )], T1)
    decide(ws, rejected["added"][0], "rejected", by="gilad", now=T1,
           reason_code="wrong_name", reason_text="names the whole product")
    append_proposals(ws, [GraphDiff(
        diff_id="", question="Call it Notifications?",
        operations=[
            CreateEntity(entity_id="ent-n", name="Notifications"),
            Attach(entity_id="ent-n", kind="promise", ref="OB-104"),
        ],
    )], T1)
    atoms = atoms_for(ws, adapter, store)
    kinds = [a["kind"] for a in atoms]
    assert kinds.count("born") == 2
    declined = next(a for a in atoms if a["kind"] == "declined")
    assert "wrong name" in declined["text"]
    assert "names the whole product" in declined["text"]
    returned = next(a for a in atoms if a["kind"] == "returned")
    assert "Notifications" in returned["text"]
    assert all(a["cites"] for a in atoms), "every atom is pre-cited"


def test_atoms_scope_to_an_entity(ws, adapter, store):
    scoped = atoms_for(ws, adapter, store, entity_id="ent-risk")
    assert scoped and all(
        a.get("entity_id") == "ent-risk" or a.get("promise") == "OB-103"
        for a in scoped
    )


def test_flip_atoms_from_checks(ws, store):
    from quire_align.adapters.fixture import FixtureWorkspace
    from quire_align.analysis.graph import run_analysis
    from quire_align.canned import fake_for_pr

    adapter = FixtureWorkspace(ws)
    run_analysis(adapter, 103, llm=fake_for_pr(103), store=store)
    atoms = atoms_for(ws, adapter, store)
    flips = [a for a in atoms if a["kind"] == "flip"]
    assert flips, "a check produced verdict states"
    assert all(
        {c["kind"] for c in a["cites"]} == {"check", "promise"} for a in flips
    )


# -- semantic resolution --------------------------------------------------


def test_meaning_resolves_without_a_taught_alias(ws, adapter, store):
    docs = node_documents(ws, adapter, store)
    hit = resolve_semantic("who reviews risky refund payouts", docs)
    assert hit and hit["entity_id"] == "ent-risk"
    assert hit["matched_terms"], "a match shows the wording that carried it"


def test_ambiguity_refuses_rather_than_guesses(ws, adapter, store):
    docs = node_documents(ws, adapter, store)
    assert resolve_semantic("zzz qqq nothing", docs) is None


def test_teaching_enriches_the_vector(ws, adapter, store):
    docs = node_documents(ws, adapter, store)
    assert resolve_semantic("cashback desk", docs) is None
    teach_alias(ws, "cashback desk", "ent-refunds", "dana", T1)
    enriched = node_documents(ws, adapter, store)
    hit = resolve_semantic("cashback desk", enriched)
    assert hit and hit["entity_id"] == "ent-refunds"


def test_ask_semantic_rung_over_http(ws, store):
    client = TestClient(create_app(store=store))
    r = client.get(f"/api/ask/{ws}", params={
        "q": "who reviews risky payouts", "llm": False,
    }).json()
    assert r["resolution"]["method"] == "semantic"
    assert r["entity"]["name"] == "Risk Review"
    assert r["resolution"]["matched_terms"]
