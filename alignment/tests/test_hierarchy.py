"""The derived tree: the project is the root, levels are computed from
connections, and nothing renders as an orphan or a bare word."""

import pathlib
import shutil

import pytest

from quire_align.entity_graph import (
    Attach,
    CreateEntity,
    GraphDiff,
    Relate,
    append_proposals,
    decide,
)
from quire_align.hierarchy import derive_tree
from quire_align.store import Store

FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"
T0 = "2026-07-01T10:00:00+00:00"


@pytest.fixture
def ws(tmp_path) -> pathlib.Path:
    dest = tmp_path / "refund-agent"
    shutil.copytree(FIXTURES / "refund-agent", dest)
    report = append_proposals(dest, [GraphDiff(
        diff_id="", question="Create Payments?",
        operations=[
            CreateEntity(entity_id="ent-payments", name="Payments"),
            Attach(entity_id="ent-payments", kind="promise", ref="OB-101"),
            Attach(entity_id="ent-payments", kind="promise", ref="OB-102"),
            Attach(entity_id="ent-payments", kind="promise", ref="OB-103"),
        ],
    ), GraphDiff(
        diff_id="", question="Create Risk?",
        operations=[
            CreateEntity(entity_id="ent-risk", name="Risk Review"),
            # risk's world is contained in payments' world → should nest
            Attach(entity_id="ent-risk", kind="promise", ref="OB-102"),
            Attach(entity_id="ent-risk", kind="promise", ref="OB-103"),
        ],
    ), GraphDiff(
        diff_id="", question="Create Exports?",
        operations=[
            CreateEntity(entity_id="ent-exports", name="Exports"),
            Attach(entity_id="ent-exports", kind="promise", ref="OB-105"),
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


def test_project_is_the_root_and_levels_are_derived(ws, adapter, store):
    tree = derive_tree(ws, adapter, store)
    assert tree["kind"] == "project" and tree["name"] == "refund agent"
    top = {c["name"]: c for c in tree["children"] if c["kind"] == "entity"}
    # the big connector floats up; the contained world nests under it
    assert "Payments" in top and "Exports" in top
    assert "Risk Review" not in top
    payments = top["Payments"]
    nested = [c["name"] for c in payments["children"] if c["kind"] == "entity"]
    assert nested == ["Risk Review"]
    # coverage ranks top level: Payments (3 promises) before Exports (1)
    order = [c["name"] for c in tree["children"] if c["kind"] == "entity"]
    assert order.index("Payments") < order.index("Exports")


def test_no_bare_words_every_node_has_context(ws, adapter, store):
    tree = derive_tree(ws, adapter, store)

    def walk(node):
        if node["kind"] != "project":
            assert node["context"], f"{node['name']} rendered as a bare word"
        for child in node["children"]:
            walk(child)
    walk(tree)
    risk = tree["children"][0]["children"][-1]
    assert risk["context"] == "refund agent › Payments"


def test_no_orphans_unplaced_promises_are_a_visible_gap(ws, adapter, store):
    tree = derive_tree(ws, adapter, store)
    branches = {c["ref"]: c for c in tree["children"] if c["kind"] == "branch"}
    assert "not-yet-placed" in branches
    gap = branches["not-yet-placed"]
    assert gap["children"], "unhoused promises appear, related to the project"
    assert all(c["kind"] == "promise" for c in gap["children"])


def test_explicit_part_of_outranks_derivation(ws, adapter, store):
    report = append_proposals(ws, [GraphDiff(
        diff_id="", question="Nest exports?",
        operations=[Relate(entity_id="ent-exports", relation="part_of",
                           other_id="ent-payments")],
    )], T0)
    decide(ws, report["added"][0], "approved", by="gilad", now=T0)
    tree = derive_tree(ws, adapter, store)
    top_names = [c["name"] for c in tree["children"] if c["kind"] == "entity"]
    assert top_names == ["Payments"]
    payments = tree["children"][0]
    assert {c["name"] for c in payments["children"] if c["kind"] == "entity"} == {
        "Risk Review", "Exports",
    }


def test_thoughts_hang_where_they_think(ws, adapter, store):
    import yaml

    (ws / "mind.yaml").write_text(yaml.safe_dump({
        "nodes": [
            {"kind": "tension", "name": "Ceiling vs Tier", "gloss": "g",
             "salience": "important",
             "connects": [{"ref": "OB-101"}, {"ref": "OB-103"}]},
            {"kind": "question", "name": "Unanchored Thought", "gloss": "g",
             "connects": [{"ref": "GD-1"}]},
        ],
    }))
    tree = derive_tree(ws, adapter, store)
    payments = next(c for c in tree["children"] if c["name"] == "Payments")
    thoughts = [c for c in payments["children"] if c["kind"] == "thought"]
    assert [t["name"] for t in thoughts] == ["Ceiling vs Tier"]
    loose = next(c for c in tree["children"] if c["ref"] == "open-threads")
    assert [t["name"] for t in loose["children"]] == ["Unanchored Thought"]


def test_ring_grammar_constant_membership_dynamic(ws, adapter, store):
    from quire_align.hierarchy import derive_ring

    ring = derive_ring(ws, adapter, store)
    assert ring["project"] == "refund agent"
    ids = [b["id"] for b in ring["ring"]]
    # the shelves never move; gaps shelf present only because gaps exist
    assert ids == ["what-we-build", "what-we-promised", "whats-changing",
                   "what-needs-a-human", "what-the-mind-wonders",
                   "what-has-no-home", "who-and-where"]
    build = ring["ring"][0]
    assert [c["name"] for c in build["children"]][0] == "Payments"
    # branch 1 never double-shelves thoughts
    def no_thoughts(n):
        assert n["kind"] != "thought"
        for c in n.get("children", []):
            no_thoughts(c)
    for c in build["children"]:
        no_thoughts(c)
    promised = ring["ring"][1]
    assert promised["count"] == len(list(adapter.obligations()))
    assert promised["children"][0]["kind"] == "spec"
    dormant = ring["ring"][-1]
    assert dormant["dormant"] and dormant["empty"]
    assert ring["vitals"]["capabilities"] == 3


def test_ring_over_http(ws, tmp_path):
    from fastapi.testclient import TestClient

    from quire_align.api import create_app

    client = TestClient(create_app(store=Store(url=f"sqlite:///{tmp_path}/t.db")))
    r = client.get(f"/api/tree/{ws}")
    assert r.status_code == 200
    assert r.json()["ring"][0]["id"] == "what-we-build"
