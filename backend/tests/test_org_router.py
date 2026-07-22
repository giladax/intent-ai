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
