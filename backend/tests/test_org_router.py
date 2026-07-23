"""Integration tests for the org router — TestClient + SQLite in-memory."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import quire.db.org_models  # noqa — register tables
from quire.db.engine import make_test_engine
from quire.db.models import Base
from quire.db.org_models import ensure_org_tables
from quire.org_store import OrgStore, seed_demo_org


@pytest.fixture
def engine(tmp_path):
    # Use a file-backed SQLite so the TestClient (which may run in a worker
    # thread) sees the same data as the fixture setup connection.
    eng = make_test_engine(url=f"sqlite:///{tmp_path}/test_org.db")
    ensure_org_tables(eng)
    yield eng
    Base.metadata.drop_all(eng)


@pytest.fixture
def store(engine):
    s = OrgStore(engine=engine)
    seed_demo_org(s)
    return s


@pytest.fixture
def alignment_store(tmp_path):
    from quire.store import Store
    return Store(url=f"sqlite:///{tmp_path}/test.db")


@pytest.fixture
def client(store, alignment_store):
    from quire.org_router import create_org_router
    app = FastAPI()
    app.include_router(create_org_router(store, alignment_store))
    return TestClient(app)


def test_get_org_returns_200(client):
    resp = client.get("/api/org")
    assert resp.status_code == 200


def test_get_org_has_name(client):
    data = client.get("/api/org").json()
    assert data["name"] == "Quire"
    assert data["id"] == "quire"


def test_get_org_has_repos(client):
    data = client.get("/api/org").json()
    assert "repos" in data
    assert len(data["repos"]) == 6


def test_get_org_card_fields(client):
    data = client.get("/api/org").json()
    for repo in data["repos"]:
        assert "workspace" in repo
        assert "display_name" in repo
        assert "latest_verdict" in repo
        assert "open_review_count" in repo
        assert "coupled_session_count" in repo
        assert "intent_ledger_url" in repo


def test_intent_ai_has_github_remote(client):
    data = client.get("/api/org").json()
    ia = next(r for r in data["repos"] if r["workspace"] == "intent-ai")
    assert ia["github_remote"] == "https://github.com/giladax/intent-ai"


def test_quire_brain_is_frozen(client):
    data = client.get("/api/org").json()
    brain = next(r for r in data["repos"] if r["workspace"] == "quire-brain")
    assert brain["read_only"] is True


def test_intent_ledger_url_format(client):
    data = client.get("/api/org").json()
    for repo in data["repos"]:
        assert repo["intent_ledger_url"] == f"/intent/{repo['workspace']}"


def test_get_org_returns_503_when_org_store_none(alignment_store):
    """When org_store is None (Postgres down at startup), /api/org → 503."""
    from quire.org_router import create_org_router
    app = FastAPI()
    app.include_router(create_org_router(None, alignment_store))
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/org")
    assert resp.status_code == 503


def test_get_repos_returns_200(client):
    resp = client.get("/api/org/repos")
    assert resp.status_code == 200


def test_get_repos_happy_path(client):
    data = client.get("/api/org/repos").json()
    assert isinstance(data, list)
    assert len(data) == 6
    for repo in data:
        assert "workspace" in repo
        assert "display_name" in repo
        assert "latest_verdict" in repo
        assert "open_review_count" in repo
        assert "coupled_session_count" in repo
        assert "intent_ledger_url" in repo


def test_get_repos_returns_503_when_org_store_none(alignment_store):
    """When org_store is None (Postgres down at startup), /api/org/repos → 503."""
    from quire.org_router import create_org_router
    app = FastAPI()
    app.include_router(create_org_router(None, alignment_store))
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/org/repos")
    assert resp.status_code == 503


# ── The Docket (slice 1) ────────────────────────────────────────────────

def _pending_review(analysis_id: str, repo: str, pr: int, classification):
    """A minimal PRAnalysis in the PENDING (awaiting-signature) state."""
    from quire.models import PRAnalysis, ReviewState
    return PRAnalysis(
        analysis_id=analysis_id, workflow_id="wf", repository=repo, pr_number=pr,
        base_sha="b" * 40, head_sha="h" * 40, contract_snapshot_id="cs",
        analyzer_version="v1", classification=classification,
        review_state=ReviewState.PENDING, human_review_required=True,
    )


def test_docket_empty_is_a_quiet_state(client):
    """Nothing pending → an empty list (not an error). Silence is first-class."""
    assert client.get("/api/org/docket").json() == []


def test_docket_ranks_pending_reviews_by_stakes(client, alignment_store):
    """Pending reviews surface as sentences, loudest verdict first; a settled
    review never appears."""
    from quire.models import Classification, ReviewState
    alignment_store.save_analysis(_pending_review("a-info", "intent-ai", 1, Classification.NO_MATERIAL_IMPACT))
    alignment_store.save_analysis(_pending_review("a-crit", "intent-ai", 2, Classification.OFF_INTENT))
    alignment_store.save_analysis(_pending_review("a-high", "intent-ai", 3, Classification.PARTIAL))
    settled = _pending_review("a-settled", "intent-ai", 4, Classification.OFF_INTENT)
    settled.review_state = ReviewState.APPROVED
    alignment_store.save_analysis(settled)

    docket = client.get("/api/org/docket").json()
    assert [d["id"] for d in docket] == ["a-crit", "a-high", "a-info"]  # ranked; settled excluded
    assert docket[0]["severity"] == "critical"
    assert docket[0]["kind"] == "review"
    # plain language, not the shouting CLI label ("CONTRADICTS INTENT")
    assert docket[0]["sentence"].startswith("Breaks a promise")
    assert "CONTRADICTS" not in docket[0]["sentence"]
    assert docket[0]["link"] == "/review/a-crit"


def test_docket_returns_503_when_org_store_none(alignment_store):
    from quire.org_router import create_org_router
    app = FastAPI()
    app.include_router(create_org_router(None, alignment_store))
    client = TestClient(app, raise_server_exceptions=False)
    assert client.get("/api/org/docket").status_code == 503


# ── The verdict vocabulary (A0 — F2: one place) ─────────────────────────

def test_vocab_answers_even_without_a_store(alignment_store):
    """/api/vocab never touches a store — it answers with org_store=None."""
    from quire.org_router import create_org_router
    app = FastAPI()
    app.include_router(create_org_router(None, alignment_store))
    client = TestClient(app)
    resp = client.get("/api/vocab")
    assert resp.status_code == 200
    body = resp.json()
    assert "verdicts" in body and "severityRank" in body


def test_vocab_maps_enums_to_plain_labels(client):
    """The ruled plain labels live here and nowhere else — jargon is banished.
    Pinned: any edit to vocab.py that reintroduces jargon breaks this test."""
    body = client.get("/api/vocab").json()
    verdicts = body["verdicts"]
    # All 7 verdicts present and pinned to their ruled plain-language strings
    assert verdicts["OFF_INTENT"]["label"] == "Breaks a promise"
    assert verdicts["OFF_INTENT"]["ink"] == "red"
    assert verdicts["PARTIAL"]["label"] == "Partly kept"
    assert verdicts["PARTIAL"]["ink"] == "amber"
    assert verdicts["POSSIBLE_DRIFT"]["label"] == "May be drifting"
    assert verdicts["POSSIBLE_DRIFT"]["ink"] == "amber"
    assert verdicts["UNGOVERNED"]["label"] == "No promise covers it"
    assert verdicts["UNGOVERNED"]["ink"] == "blue"
    assert verdicts["UNKNOWN"]["label"] == "Needs your review"
    assert verdicts["UNKNOWN"]["ink"] == "gray"   # uncertainty stays gray
    assert verdicts["NO_MATERIAL_IMPACT"]["label"] == "No product impact"
    assert verdicts["NO_MATERIAL_IMPACT"]["ink"] == "gray"
    assert verdicts["ALIGNED"]["label"] == "Keeps its promises"
    assert verdicts["ALIGNED"]["ink"] == "green"
    # no shouting enum jargon leaks into any human label
    for row in verdicts.values():
        assert "CONTRADICTS" not in row["label"]
        assert row["label"] and "_" not in row["label"]  # non-empty, no raw enum tokens


# ── Needs you (A0 — the enriched list + detail contract) ────────────────

def test_needs_you_empty_is_a_quiet_state(client):
    assert client.get("/api/needs-you").json() == []


def test_needs_you_ranks_and_enriches(client, alignment_store):
    """The list ranks by stakes and carries the detail pane's fields —
    verdict enum + plain label + ink, title, repo · PR, link."""
    from quire.models import Classification
    alignment_store.save_analysis(_pending_review("n-info", "intent-ai", 1, Classification.NO_MATERIAL_IMPACT))
    alignment_store.save_analysis(_pending_review("n-crit", "refund-agent", 101, Classification.OFF_INTENT))

    items = client.get("/api/needs-you").json()
    assert [i["id"] for i in items] == ["n-crit", "n-info"]  # loudest first
    top = items[0]
    assert top["verdict"] == "OFF_INTENT"       # raw enum for agents
    assert top["label"] == "Breaks a promise"   # plain label for the app
    assert top["ink"] == "red"
    assert top["repo"] == "refund-agent"
    assert top["pr_number"] == 101
    assert top["link"] == "/review/n-crit"
    assert "promise" in top and "why" in top     # detail-pane keys always present
    # promise carries statement (empty string when obligation unresolvable — never missing)
    assert top["promise"] is None or "statement" in top["promise"]


def test_needs_you_returns_503_when_org_store_none(alignment_store):
    from quire.org_router import create_org_router
    app = FastAPI()
    app.include_router(create_org_router(None, alignment_store))
    client = TestClient(app, raise_server_exceptions=False)
    assert client.get("/api/needs-you").status_code == 503


def test_needs_you_promise_carries_statement(client, alignment_store):
    """When a promise is present, statement is always a key (str, possibly empty)."""
    from quire.models import Classification, ObligationImpact
    analysis = _pending_review("n-stmt", "refund-agent", 200, Classification.OFF_INTENT)
    impact = ObligationImpact(
        obligation_id="OB-101",
        relation="contradicts",
        confidence=0.9,
        reasoning="The guard blocks at $50 but the policy allows $100.",
    )
    analysis.obligation_impacts = [impact]
    alignment_store.save_analysis(analysis)

    items = client.get("/api/needs-you").json()
    item = next(i for i in items if i["id"] == "n-stmt")
    assert item["promise"] is not None
    assert "statement" in item["promise"]
    assert isinstance(item["promise"]["statement"], str)
    # refund-agent fixture has OB-101 → a real statement must be resolved
    assert item["promise"]["statement"] != ""


# ── Intent save endpoint (path-traversal guard) ─────────────────────────

def test_intent_save_path_traversal_blocked(client):
    """POST /api/org/repos/intent/../backend/intent/save rejects path traversal.

    FastAPI normalizes path parameters, so `intent/../backend` becomes
    `backend` in the workspace param. The handler's resolve() check rejects
    workspaces outside the workspaces root, preventing directory traversal.
    """
    resp = client.post(
        "/api/org/repos/intent/../backend/intent/save",
        json={"content": "# Traversal attempt", "title": "Exploit"}
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "No such workspace"
