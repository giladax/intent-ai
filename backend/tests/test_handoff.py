"""O4.5 handoff tests — offline (canned LLM, SQLite), topology-discipline.

Covers: grounding assembly, citation validation (fabrication never
persists — the slice's EDD case), node+edge persistence, the signing act,
honest closure tiers, closure candidacy (auto-close only when unambiguous),
Needs-you items, export rendering, and the router contract.
"""
from __future__ import annotations

import datetime as dt

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session as SASession

import quire.db.task_models  # noqa: F401 — register tables
from quire.db.engine import make_test_engine
from quire.db.models import Base, Feature, FeatureFile, Project
from quire.db.task_models import Task, TaskLink, ensure_task_tables
from quire.handoff import (
    CandidateTask,
    Grounding,
    TaskCards,
    TaskStore,
    assemble_grounding,
    draft_handoff,
    export_handoff,
    record_closure_candidates,
    render_grounding_packet,
    render_handoff_markdown,
    validate_cards,
    _MAX_PACKET_CHARS,
)

_NOW = dt.datetime.now(dt.timezone.utc)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def engine(tmp_path):
    eng = make_test_engine(url=f"sqlite:///{tmp_path}/handoff.db")
    ensure_task_tables(eng)
    yield eng
    Base.metadata.drop_all(eng)


@pytest.fixture
def store(engine):
    return TaskStore(engine=engine)


@pytest.fixture
def journal_engine(tmp_path):
    """A journal engine seeded with one real-shaped feature + files."""
    eng = make_test_engine(url=f"sqlite:///{tmp_path}/journal.db")
    Base.metadata.create_all(eng)
    with SASession(eng) as s:
        s.add(Project(id="p1", name="Quire", path="/tmp/quire", created_at=_NOW))
        s.add(Feature(
            id="feat-1",
            project_id="p1",
            name="Refund Policy Engine",
            description="Automatic refunds under policy limits",
            current_understanding="Caps refunds; premium tier raised to $100.",
            constraints=["guard must match policy cap"],
            known_unknowns=[],
            created_at=_NOW,
        ))
        s.add(FeatureFile(
            id="ff-1", feature_id="feat-1",
            file_path="src/policy.py", glob=None, created_at=_NOW,
        ))
        s.commit()
    yield eng
    Base.metadata.drop_all(eng)


class StubAdapter:
    """Workspace adapter stub: two signed promises + one binding."""

    class _Ob:
        def __init__(self, oid, statement, ref):
            self.obligation_id = oid
            self.statement = statement
            self.kind = type("K", (), {"value": "hard_rule"})()
            self.provenance_quote = f"“{statement}”"
            self.source_quote = self.provenance_quote
            self.source_reference = ref

    class _Cp:
        def __init__(self, path):
            self.path = path

    def obligations(self):
        return [
            self._Ob("OB-001", "Refunds above the cap always need a human.", "prd.md"),
            self._Ob("OB-002", "Premium low-risk refunds up to $100 are automatic.", "prd.md"),
        ]

    def control_points(self):
        return [self._Cp("src/guard.py")]


@pytest.fixture
def grounding(journal_engine, monkeypatch):
    import quire.workspace as ws_mod
    monkeypatch.setattr(ws_mod, "build_adapter", lambda ws: StubAdapter())
    return assemble_grounding("refund-agent", engine=journal_engine)


class FakeHandoffLLM:
    """Canned proposer: two good cards + one unknown-promise card + one
    fabricated builds_on entry (the EDD case: fabrication never persists)."""

    def propose_tasks(self, packet: str) -> TaskCards:
        assert "OB-001" in packet and "Refund Policy Engine" in packet
        return TaskCards(tasks=[
            CandidateTask(
                department="dev",
                statement="Raise the guard cap to match the $100 policy.",
                serves_obligation_id="OB-002",
                builds_on=["Refund Policy Engine", "src/guard.py"],
                why="The policy moved; the guard still blocks at $50.",
            ),
            CandidateTask(
                department="qa",
                statement="Test a premium low-risk refund at exactly $100.",
                serves_obligation_id="OB-002",
                builds_on=["Totally Invented Feature"],  # fabricated → dropped
                why="The boundary is the risky edge.",
            ),
            CandidateTask(
                department="product",
                statement="Document the new $100 refund tier in the policy guide.",
                serves_obligation_id="OB-002",
                builds_on=[],
                why="Clarity for support and legal.",
            ),
            CandidateTask(
                department="bi",
                statement="Measure refund auto-approval rate after the change.",
                serves_obligation_id="OB-999",  # unknown promise → card dropped
                builds_on=[],
                gap="nothing measures refunds today",
                why="We need to see adoption.",
            ),
        ])


# ---------------------------------------------------------------------------
# Grounding + validation
# ---------------------------------------------------------------------------

def test_grounding_carries_promises_features_and_paths(grounding):
    assert grounding.obligation_ids() == {"OB-001", "OB-002"}
    assert grounding.feature_names() == {"refund policy engine"}
    assert "src/guard.py" in grounding.known_paths()
    assert "src/policy.py" in grounding.known_paths()


def test_grounding_survives_journal_outage(monkeypatch):
    import quire.workspace as ws_mod
    monkeypatch.setattr(ws_mod, "build_adapter", lambda ws: StubAdapter())

    class DeadEngine:  # any use raises
        def connect(self):
            raise RuntimeError("db down")

    g = assemble_grounding("refund-agent", engine=DeadEngine())
    assert g.obligation_ids() == {"OB-001", "OB-002"}
    assert g.features == []
    assert any("features unavailable" in n for n in g.notes)


def test_packet_renders_within_budget(grounding):
    packet = render_grounding_packet(grounding)
    assert "OB-002" in packet and "src/guard.py" in packet
    assert len(packet) <= _MAX_PACKET_CHARS


def test_validation_drops_unknown_promise_card(grounding):
    kept, notes = validate_cards(FakeHandoffLLM().propose_tasks(
        render_grounding_packet(grounding)), grounding)
    assert len(kept) == 3  # bi card dropped; dev, qa, product kept
    assert all(k["serves_obligation_id"] == "OB-002" for k in kept)
    assert any("OB-999" in n for n in notes)


def test_validation_drops_fabricated_citation_keeps_card(grounding):
    kept, notes = validate_cards(FakeHandoffLLM().propose_tasks(
        render_grounding_packet(grounding)), grounding)
    qa = next(k for k in kept if k["department"] == "qa")
    assert qa["links"] == []  # fabricated entry dropped, card survives
    assert any("Totally Invented Feature" in n for n in notes)


def test_validation_resolves_feature_and_path(grounding):
    kept, _ = validate_cards(FakeHandoffLLM().propose_tasks(
        render_grounding_packet(grounding)), grounding)
    dev = next(k for k in kept if k["department"] == "dev")
    kinds = {(l["kind"], l["target_ref"]) for l in dev["links"]}
    assert ("builds_on_feature", "feat-1") in kinds
    assert ("touches_file", "src/guard.py") in kinds


# ---------------------------------------------------------------------------
# Draft → nodes + edges (topology discipline)
# ---------------------------------------------------------------------------

def test_draft_persists_nodes_and_evidenced_edges(store, grounding, monkeypatch, journal_engine):
    import quire.workspace as ws_mod
    monkeypatch.setattr(ws_mod, "build_adapter", lambda ws: StubAdapter())
    result = draft_handoff("refund-agent", store=store,
                           llm=FakeHandoffLLM(), engine=journal_engine)
    assert result["handoff_id"]
    tasks = result["tasks"]
    assert len(tasks) == 3 and all(t["status"] == "proposed" for t in tasks)
    dev = next(t for t in tasks if t["department"] == "dev")
    # The node carries content only; every coupling is an edge with evidence.
    serves = [l for l in dev["links"] if l["kind"] == "serves_promise"]
    assert len(serves) == 1 and serves[0]["target_ref"] == "OB-002"
    assert "“" in serves[0]["evidence"]  # the promise's verbatim quote
    assert dev["closure_tier"] == "check_evidence"
    qa = next(t for t in tasks if t["department"] == "qa")
    assert qa["closure_tier"] == "test_inspection"
    product = next(t for t in tasks if t["department"] == "product")
    assert product["closure_tier"] == "manual_note"


def test_draft_refuses_without_signed_promises(store, monkeypatch):
    import quire.workspace as ws_mod

    class Empty(StubAdapter):
        def obligations(self):
            return []

    monkeypatch.setattr(ws_mod, "build_adapter", lambda ws: Empty())
    result = draft_handoff("refund-agent", store=store, llm=FakeHandoffLLM())
    assert result["handoff_id"] is None
    assert any("sign the contract first" in n for n in result["notes"])


def test_edge_unique_constraint_is_idempotent(store, engine):
    with SASession(engine) as s:
        s.add(Task(id="TSK-x", workspace="w", handoff_id="H", department="dev",
                   statement="s", closure_tier="check_evidence", created_at=_NOW))
        s.add(TaskLink(id="TLK-1", task_id="TSK-x", kind="serves_promise",
                       target_ref="OB-1", evidence="q", created_at=_NOW))
        s.commit()
    with SASession(engine) as s:
        s.add(TaskLink(id="TLK-2", task_id="TSK-x", kind="serves_promise",
                       target_ref="OB-1", evidence="q", created_at=_NOW))
        with pytest.raises(Exception):
            s.commit()


# ---------------------------------------------------------------------------
# The signing act
# ---------------------------------------------------------------------------

def _seed_handoff(store, grounding, monkeypatch, journal_engine):
    import quire.workspace as ws_mod
    monkeypatch.setattr(ws_mod, "build_adapter", lambda ws: StubAdapter())
    return draft_handoff("refund-agent", store=store,
                         llm=FakeHandoffLLM(), engine=journal_engine)


def test_approve_is_per_card_and_explicit(store, grounding, monkeypatch, journal_engine):
    r = _seed_handoff(store, grounding, monkeypatch, journal_engine)
    tasks = r["tasks"]
    dev = next(t for t in tasks if t["department"] == "dev")
    qa = next(t for t in tasks if t["department"] == "qa")
    result = store.approve(r["handoff_id"], [
        {"task_id": dev["task_id"], "accept": True,
         "statement": "Raise the guard cap to $100 (edited)."},
        {"task_id": qa["task_id"], "accept": False},
    ], approved_by="Gilad Koch")
    assert result == {"signed": 1, "rejected": 1}
    after = {t["task_id"]: t for t in store.tasks_for_handoff(r["handoff_id"])}
    assert after[dev["task_id"]]["status"] == "open"
    assert after[dev["task_id"]]["statement"].endswith("(edited).")
    assert after[dev["task_id"]]["signed_by"] == "Gilad Koch"
    assert after[qa["task_id"]]["status"] == "rejected"


def test_undecided_cards_stay_proposed(store, grounding, monkeypatch, journal_engine):
    r = _seed_handoff(store, grounding, monkeypatch, journal_engine)
    dev = next(t for t in r["tasks"] if t["department"] == "dev")
    store.approve(r["handoff_id"], [{"task_id": dev["task_id"], "accept": True}],
                  approved_by="G")
    after = {t["department"]: t for t in store.tasks_for_handoff(r["handoff_id"])}
    assert after["qa"]["status"] == "proposed"  # no decision → still proposed


# ---------------------------------------------------------------------------
# Closure — evidence-tiered, honest
# ---------------------------------------------------------------------------

class _FakeImpact:
    def __init__(self, oid, relation, reasoning="guard now matches policy"):
        self.obligation_id = oid
        self.relation = type("R", (), {"value": relation})()
        self.reasoning = reasoning


class _FakeAnalysis:
    def __init__(self, impacts):
        self.analysis_id = "AN-123"
        self.obligation_impacts = impacts


def _open_dev_task(store, grounding, monkeypatch, journal_engine):
    r = _seed_handoff(store, grounding, monkeypatch, journal_engine)
    dev = next(t for t in r["tasks"] if t["department"] == "dev")
    store.approve(r["handoff_id"], [{"task_id": dev["task_id"], "accept": True}],
                  approved_by="G")
    return dev["task_id"]


def test_unambiguous_satisfies_auto_closes_dev_task(store, grounding, monkeypatch, journal_engine):
    tid = _open_dev_task(store, grounding, monkeypatch, journal_engine)
    out = record_closure_candidates(
        "refund-agent", _FakeAnalysis([_FakeImpact("OB-002", "satisfies")]), store)
    assert out == {"closed": 1, "candidates": 0}
    t = {x["task_id"]: x for x in store.tasks_for_workspace("refund-agent")}[tid]
    assert t["status"] == "closed"
    closed_edges = [l for l in t["links"] if l["kind"] == "closed_by_check"]
    assert len(closed_edges) == 1 and closed_edges[0]["target_ref"] == "AN-123"


def test_ambiguous_matches_become_candidates_not_closures(store, grounding, monkeypatch, journal_engine):
    # Two open dev tasks serving the same promise → candidates, human decides.
    r = _seed_handoff(store, grounding, monkeypatch, journal_engine)
    r2 = _seed_handoff(store, grounding, monkeypatch, journal_engine)
    for r_ in (r, r2):
        dev = next(t for t in r_["tasks"] if t["department"] == "dev")
        store.approve(r_["handoff_id"], [{"task_id": dev["task_id"], "accept": True}],
                      approved_by="G")
    out = record_closure_candidates(
        "refund-agent", _FakeAnalysis([_FakeImpact("OB-002", "satisfies")]), store)
    assert out == {"closed": 0, "candidates": 2}
    items = store.needs_you_items()
    kinds = [i["kind"] for i in items]
    assert kinds.count("closure_evidence_arrived") == 2


def test_non_satisfies_relations_do_nothing(store, grounding, monkeypatch, journal_engine):
    _open_dev_task(store, grounding, monkeypatch, journal_engine)
    out = record_closure_candidates(
        "refund-agent",
        _FakeAnalysis([_FakeImpact("OB-002", "contradicts"),
                       _FakeImpact("OB-002", "partially_satisfies")]),
        store)
    assert out == {"closed": 0, "candidates": 0}


def test_manual_close_carries_honest_label(store, grounding, monkeypatch, journal_engine):
    r = _seed_handoff(store, grounding, monkeypatch, journal_engine)
    product = next(t for t in r["tasks"] if t["department"] == "product")
    store.approve(r["handoff_id"], [{"task_id": product["task_id"], "accept": True}],
                  approved_by="G")
    assert store.close_manual(product["task_id"], "verified by hand", "Gilad")
    t = {x["task_id"]: x for x in store.tasks_for_workspace("refund-agent")}[product["task_id"]]
    assert "evidence detection coming" in t["closure_note"]


def test_needs_you_lists_unsigned_handoffs(store, grounding, monkeypatch, journal_engine):
    _seed_handoff(store, grounding, monkeypatch, journal_engine)
    items = store.needs_you_items()
    hand = [i for i in items if i["kind"] == "handoff_awaiting_signature"]
    assert len(hand) == 1 and "awaits your signature" in hand[0]["label"]


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def test_export_renders_sentences_receipts_and_footnotes(
        store, grounding, monkeypatch, journal_engine, tmp_path):
    r = _seed_handoff(store, grounding, monkeypatch, journal_engine)
    dev = next(t for t in r["tasks"] if t["department"] == "dev")
    store.approve(r["handoff_id"], [{"task_id": dev["task_id"], "accept": True}],
                  approved_by="G")
    md = render_handoff_markdown(
        "refund-agent", store.tasks_for_handoff(r["handoff_id"]), grounding,
        r["handoff_id"])
    assert "Development — what to build" in md
    assert "[^OB-002]" in md          # ids as footnotes
    assert "Builds on: extends Refund Policy Engine" in md
    assert "Nobody wrote a ticket." in md
    # Honest labels ride along
    assert "unsigned" in md           # the qa card stayed proposed
    # No jargon
    assert "epic" not in md.lower() and "story" not in md.lower()



def test_export_qa_task_shows_test_inspection_label(store, grounding, monkeypatch, journal_engine):
    """QA tasks render honest closure label: test_inspection tier."""
    r = _seed_handoff(store, grounding, monkeypatch, journal_engine)
    qa = next(t for t in r["tasks"] if t["department"] == "qa")
    store.approve(r["handoff_id"], [{"task_id": qa["task_id"], "accept": True}],
                  approved_by="G")
    md = render_handoff_markdown(
        "refund-agent", store.tasks_for_handoff(r["handoff_id"]), grounding,
        r["handoff_id"])
    # QA task shows test_inspection closure label
    assert "wired for dev, coming for QA" in md


def test_export_writes_file(store, grounding, monkeypatch, journal_engine, tmp_path):
    r = _seed_handoff(store, grounding, monkeypatch, journal_engine)
    out = tmp_path / "handoff.md"
    monkeypatch.setattr("quire.handoff.assemble_grounding",
                        lambda *a, **k: grounding)
    md, path = export_handoff("refund-agent", store,
                              handoff_id=r["handoff_id"], out_path=out)
    assert path == out and out.read_text() == md


# ---------------------------------------------------------------------------
# Router contract
# ---------------------------------------------------------------------------

@pytest.fixture
def client(store, tmp_path):
    from quire.org_router import create_org_router
    from quire.store import Store
    app = FastAPI()
    app.include_router(create_org_router(None, Store(url=f"sqlite:///{tmp_path}/a.db"),
                                         task_store=store))
    return TestClient(app)


def test_router_approve_requires_a_named_signature(client):
    resp = client.post("/api/org/handoffs/HND-x/approve",
                       json={"tasks": [{"task_id": "t", "accept": True}]})
    assert resp.status_code == 400
    assert "signature has a name" in resp.json()["detail"]


def test_router_approve_requires_decisions(client):
    resp = client.post("/api/org/handoffs/HND-x/approve",
                       json={"approved_by": "G"})
    assert resp.status_code == 400


def test_router_close_requires_note_and_name(client):
    resp = client.post("/api/org/tasks/TSK-x/close", json={"note": ""})
    assert resp.status_code == 400


def test_router_tasks_endpoint_returns_contract_shape(
        client, store, grounding, monkeypatch, journal_engine):
    r = _seed_handoff(store, grounding, monkeypatch, journal_engine)
    resp = client.get("/api/org/repos/refund-agent/tasks")
    assert resp.status_code == 200
    body = resp.json()
    assert body["workspace"] == "refund-agent"
    t = body["tasks"][0]
    for key in ("task_id", "department", "statement", "why", "status",
                "closure_tier", "links"):
        assert key in t
    resp2 = client.get(f"/api/org/handoffs/{r['handoff_id']}")
    assert resp2.status_code == 200


def test_router_503_when_task_store_absent(tmp_path):
    from quire.org_router import create_org_router
    from quire.store import Store
    app = FastAPI()
    app.include_router(create_org_router(None, Store(url=f"sqlite:///{tmp_path}/a.db"),
                                         task_store=None))
    c = TestClient(app)
    assert c.get("/api/org/repos/x/tasks").status_code == 503


# ---------------------------------------------------------------------------
# Guard discipline
# ---------------------------------------------------------------------------

def test_engine_less_task_store_raises_in_tests():
    from quire.handoff import TaskStore as Guarded
    with pytest.raises(RuntimeError, match="production Postgres"):
        Guarded()
