"""Seed proposer: LLM candidates → mechanically validated GraphDiff
proposals. The LLM reasons; only validated output reaches the inbox."""

import pathlib
import shutil

import pytest
from fastapi.testclient import TestClient

from quire_align.api import create_app
from quire_align.entity_graph import graph_state, load_diffs
from quire_align.entity_propose import (
    EntityCandidate,
    EntityCandidates,
    EntityQuote,
    FakeEntityProposer,
    seed_proposals,
)
from quire_align.store import Store

FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"
T0 = "2026-07-18T10:00:00+00:00"


@pytest.fixture
def ws(tmp_path) -> pathlib.Path:
    """A writable copy of the refund fixture — proposals write graph/."""
    dest = tmp_path / "refund-agent"
    shutil.copytree(FIXTURES / "refund-agent", dest)
    return dest


@pytest.fixture
def adapter(ws):
    from quire_align.adapters.fixture import FixtureWorkspace

    return FixtureWorkspace(ws)


def candidates() -> EntityCandidates:
    return EntityCandidates(entities=[
        EntityCandidate(
            name="Refunds",
            identity_sentence="How money goes back to customers, and who may send it.",
            aliases=["refund flow"],
            member_obligation_ids=["OB-101", "OB-102"],
            quotes=[EntityQuote(
                obligation_id="OB-102",
                quote="always require human approval",
            )],
        ),
        EntityCandidate(
            name="Hallucinated",
            identity_sentence="An entity no promise supports.",
            member_obligation_ids=["OB-101"],
            quotes=[EntityQuote(
                obligation_id="OB-101",
                quote="this sentence appears in no promise",
            )],
        ),
    ])


def test_seed_validates_quotes_and_builds_proposals(ws, adapter):
    report = seed_proposals(ws, adapter, FakeEntityProposer(candidates()), T0)
    assert report["added"] == ["GD-1"]  # Hallucinated dropped: no valid quote
    assert any("Hallucinated" in n and "no quote, no render" in n
               for n in report["notes"])
    diff = load_diffs(ws)[0]
    assert diff.status == "open"
    assert "call it Refunds?" in diff.question
    ops = {(op.op, getattr(op, "ref", getattr(op, "name", ""))) for op in diff.operations}
    assert ("create_entity", "Refunds") in ops
    assert ("attach", "OB-101") in ops and ("attach", "OB-102") in ops
    # bound code paths ride along as code holdings
    assert any(op.op == "attach" and op.kind == "code" for op in diff.operations)
    # evidence quotes carry their source promise
    assert diff.evidence[0].source.startswith("OB-102")


def test_seed_skips_names_already_on_the_map(ws, adapter):
    seed_proposals(ws, adapter, FakeEntityProposer(candidates()), T0)
    from quire_align.entity_graph import decide

    decide(ws, "GD-1", "approved", by="gilad", now=T0)
    again = seed_proposals(ws, adapter, FakeEntityProposer(candidates()), T0)
    assert again["added"] == []
    assert any("already answers to this name" in n for n in again["notes"])


def test_inbox_flow_over_http(ws, tmp_path):
    app = create_app(store=Store(url=f"sqlite:///{tmp_path}/test.db"))
    client = TestClient(app)

    seed_report = seed_proposals(
        ws,
        __import__("quire_align.adapters.fixture", fromlist=["FixtureWorkspace"]).FixtureWorkspace(ws),
        FakeEntityProposer(candidates()),
        T0,
    )
    diff_id = seed_report["added"][0]

    listing = client.get(f"/api/graph/{ws}/proposals").json()
    assert [p["diff_id"] for p in listing["open"]] == [diff_id]
    assert listing["open"][0]["stakes_label"] in ("low", "medium", "high")

    # rejection without a structured reason is refused (rule 6)
    refused = client.post(
        f"/api/graph/{ws}/proposals/{diff_id}/decision",
        json={"action": "rejected", "by": "gilad"},
    )
    assert refused.status_code == 409

    approved = client.post(
        f"/api/graph/{ws}/proposals/{diff_id}/decision",
        json={"action": "approved", "by": "gilad"},
    )
    assert approved.status_code == 200

    entities = client.get(f"/api/graph/{ws}").json()["entities"]
    assert [e["name"] for e in entities] == ["Refunds"]

    # decisions are final — the second attempt is a conflict, not a rewrite
    again = client.post(
        f"/api/graph/{ws}/proposals/{diff_id}/decision",
        json={"action": "approved", "by": "gilad"},
    )
    assert again.status_code == 409

    page = client.get(f"/inbox/{ws}")
    assert page.status_code == 200
    assert "The map wants to change" in page.text


def test_docs_classified_as_doc_kind_and_counted_separately():
    from quire_align.entity_propose import _is_doc_path, _question

    assert _is_doc_path("docs/plans/design.md")
    assert _is_doc_path(".repo/brain.md")
    assert not _is_doc_path("src/mcp/feature.ts")
    q = _question("Payments", 2, 3, 1)
    assert q == (
        "These 2 promises, 3 code locations and 1 document describe one "
        "thing — call it Payments?"
    )


def test_attachments_carry_binding_provenance(ws, adapter):
    seed_proposals(ws, adapter, FakeEntityProposer(candidates()), T0)
    diff = load_diffs(ws)[0]
    binds = [op for op in diff.operations if op.op == "attach" and op.kind != "promise"]
    assert binds, "expected bound paths on the card"
    assert all(op.note.startswith("bound to OB-") for op in binds)


def test_evidence_source_includes_org_address(ws, adapter):
    seed_proposals(ws, adapter, FakeEntityProposer(candidates()), T0)
    source = load_diffs(ws)[0].evidence[0].source
    assert source.startswith("OB-102 · ")
    assert "refund-policy-prd" in source and "#high-risk" in source


def test_proposals_api_reports_coverage_and_already_held(ws, tmp_path):
    from quire_align.adapters.fixture import FixtureWorkspace
    from quire_align.entity_graph import decide

    app = create_app(store=Store(url=f"sqlite:///{tmp_path}/t.db"))
    client = TestClient(app)
    seed_proposals(ws, FixtureWorkspace(ws), FakeEntityProposer(candidates()), T0)
    data = client.get(f"/api/graph/{ws}/proposals").json()
    cov = data["coverage"]
    # refund fixture has promises beyond the two proposed — named, not implied
    assert cov["proposed"] == ["OB-101", "OB-102"]
    assert cov["housed"] == []
    assert set(cov["homeless"]) == set(o for o in cov["homeless"])  # present
    assert len(cov["homeless"]) == cov["total"] - 2

    decide(ws, data["open"][0]["diff_id"], "approved", by="gilad", now=T0)
    after = client.get(f"/api/graph/{ws}/proposals").json()
    assert after["coverage"]["housed"] == ["OB-101", "OB-102"]

    # a fresh proposal wanting an already-housed promise is disclosed
    from quire_align.entity_graph import Attach, CreateEntity, GraphDiff, append_proposals

    append_proposals(ws, [GraphDiff(diff_id="", question="Second home?",
        operations=[CreateEntity(entity_id="ent-x", name="X"),
                    Attach(entity_id="ent-x", kind="promise", ref="OB-102")])], T0)
    disclosed = client.get(f"/api/graph/{ws}/proposals").json()
    assert disclosed["open"][0]["already_held"] == {"OB-102": ["Refunds"]}


def test_inbox_page_rejects_junk_workspace_and_encodes_real_one(ws, tmp_path):
    app = create_app(store=Store(url=f"sqlite:///{tmp_path}/t.db"))
    client = TestClient(app)
    hostile = 'x";document.title="PWNED";//'
    reflected = client.get(f"/inbox/{hostile}")
    assert reflected.status_code == 400
    # the hostile string may echo in the JSON error detail (safely
    # escaped); what must never happen is reflection into the page's JS
    assert "const WS" not in reflected.text
    assert reflected.headers["content-type"].startswith("application/json")
    page = client.get(f"/inbox/{ws}")
    assert page.status_code == 200
    assert "__WORKSPACE_JSON__" not in page.text
    assert f'const WS = "{ws}"' in page.text


def test_decision_api_rejects_unknown_action(ws, tmp_path):
    app = create_app(store=Store(url=f"sqlite:///{tmp_path}/t.db"))
    client = TestClient(app)
    from quire_align.adapters.fixture import FixtureWorkspace

    seed_proposals(ws, FixtureWorkspace(ws), FakeEntityProposer(candidates()), T0)
    res = client.post(
        f"/api/graph/{ws}/proposals/GD-1/decision",
        json={"action": "approv", "by": "gilad"},
    )
    assert res.status_code == 422  # refused at the edge by the Literal type


def test_graph_state_survives_yaml_round_trip(ws, adapter):
    seed_proposals(ws, adapter, FakeEntityProposer(candidates()), T0)
    from quire_align.entity_graph import decide

    decide(ws, "GD-1", "approved", by="gilad", now=T0)
    reloaded = graph_state(load_diffs(ws))
    assert reloaded["entities"]["ent-refunds"]["aliases"] == ["refund flow"]


def test_wrong_scale_is_the_corpus_share_rule():
    """Recalibrated on the pydantic scale run: a name whose words touch
    >= 0.6 of ALL promises names the corpus and dies, regardless of how
    many members it claims; under the line the guard stays out of the
    human's call (the old 2x-membership ratio discarded 'Strict Mode'
    five rounds running)."""
    from quire_align.entity_propose import _wrong_scale

    statements = {
        f"OB-{i}": text
        for i, text in enumerate(
            ["the brain stores organizational facts"] * 6
            + ["refunds always require human approval"] * 4
        )
    }
    # 6/10 footprint — names the corpus
    error = _wrong_scale("Brain", statements, "acme-app")
    assert error is not None and "names most of the corpus" in error
    # 4/10 footprint — a broad capability, but a human's call, not the guard's
    assert _wrong_scale("Refunds", statements, "acme-app") is None
    # the workspace's own name still dies outright
    assert "workspace itself" in _wrong_scale("Acme App", statements, "acme-app")
