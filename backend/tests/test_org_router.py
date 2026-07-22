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
    assert docket[0]["sentence"].startswith("Breaks a rule")
    assert "CONTRADICTS" not in docket[0]["sentence"]
    assert docket[0]["link"] == "/review/a-crit"


def test_docket_returns_503_when_org_store_none(alignment_store):
    from quire.org_router import create_org_router
    app = FastAPI()
    app.include_router(create_org_router(None, alignment_store))
    client = TestClient(app, raise_server_exceptions=False)
    assert client.get("/api/org/docket").status_code == 503
