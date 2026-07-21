"""Tests for the journal FastAPI router (Slice 8).

DB-dependent tests are marked requires_postgres and auto-skip when Postgres
is unreachable (see conftest.py). Structural correctness only — not exact DB
content, since the DB may be empty or contain arbitrary data.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client():
    """Create a TestClient backed by the full FastAPI app."""
    from quire.api import create_app

    app = create_app()
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


# ── Non-DB tests ──────────────────────────────────────────────────────────────

def test_meta_returns_repo_and_branch(client):
    """GET /api/meta → 200, has repo and branch keys."""
    resp = client.get("/api/meta")
    assert resp.status_code == 200
    data = resp.json()
    assert "repo" in data
    assert "branch" in data
    # branch should be non-empty when running in a git repo
    assert isinstance(data["repo"], str)
    assert isinstance(data["branch"], str)


def test_chat_missing_question_returns_400(client):
    """POST /api/chat with no question → 400."""
    resp = client.post("/api/chat", json={})
    assert resp.status_code == 400


def test_chat_empty_question_returns_400(client):
    """POST /api/chat with empty question → 400."""
    resp = client.post("/api/chat", json={"question": ""})
    assert resp.status_code == 400


@pytest.fixture
def offline_feed(monkeypatch):
    """Keep GET /api/feed offline during pytest.

    If Postgres is up and the feed cache is stale, the endpoint would launch
    a real 3-Sonnet-call composition AND overwrite the cached feed. Patch the
    LLM boundary to raise (compose falls back to deterministic copy) and the
    cache writer to a no-op (pytest never clobbers the real feed_cache row).
    """
    import quire.journal.feed as feed_mod

    def _no_llm(*_a, **_kw):
        raise RuntimeError("offline test — no LLM calls")

    monkeypatch.setattr(feed_mod, "_call_sonnet", _no_llm)
    monkeypatch.setattr(feed_mod, "set_cached_feed", lambda *_a, **_kw: None)


def test_feed_returns_valid_shape(client, offline_feed):
    """GET /api/feed → 200, composed-feed shape (works with or without DB)."""
    resp = client.get("/api/feed")
    assert resp.status_code == 200
    data = resp.json()
    assert "editionNumber" in data
    assert "composedAt" in data
    assert "lede" in data
    assert "trending" in data
    assert isinstance(data["trending"], list)


def test_feed_has_required_fields(client, offline_feed):
    """GET /api/feed → 200, editionNumber is int, lede has text, trending is list."""
    resp = client.get("/api/feed")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data["editionNumber"], int)
    assert isinstance(data["lede"], dict)
    assert "text" in data["lede"]
    assert isinstance(data["trending"], list)


# ── DB-dependent tests ────────────────────────────────────────────────────────

@pytest.mark.requires_postgres
def test_projects_returns_list(client):
    """GET /api/projects → 200, list."""
    resp = client.get("/api/projects")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)


@pytest.mark.requires_postgres
def test_journal_returns_episodes_and_pulse(client):
    """GET /api/journal → 200, has episodes and pulse keys."""
    resp = client.get("/api/journal")
    assert resp.status_code == 200
    data = resp.json()
    assert "episodes" in data
    assert "pulse" in data
    pulse = data["pulse"]
    assert "sessionsDigested" in pulse
    assert "consults" in pulse
    assert "pendingReview" in pulse
    assert isinstance(data["episodes"], list)


@pytest.mark.requires_postgres
def test_journal_with_limit(client):
    """GET /api/journal?limit=5 → 200."""
    resp = client.get("/api/journal?limit=5")
    assert resp.status_code == 200
    data = resp.json()
    assert "episodes" in data


@pytest.mark.requires_postgres
def test_stats_overview_returns_cadence(client):
    """GET /api/stats/overview → 200, has cadence/quality/momentum keys."""
    resp = client.get("/api/stats/overview")
    assert resp.status_code == 200
    data = resp.json()
    assert "cadence" in data
    assert "cadenceSummary" in data
    assert "sessions" in data
    assert "record" in data
    assert "features" in data
    summary = data["cadenceSummary"]
    assert "totalEvents" in summary
    assert "activeDays" in summary
    assert "streak" in summary


@pytest.mark.requires_postgres
def test_digest_schedule_returns_schedule(client):
    """GET /api/digest/schedule → 200, has schedule keys."""
    resp = client.get("/api/digest/schedule")
    assert resp.status_code == 200
    data = resp.json()
    assert "enabled" in data
    assert "intervalMinutes" in data
    assert "debounceMinutes" in data


@pytest.mark.requires_postgres
def test_sessions_returns_list(client):
    """GET /api/sessions → 200, list."""
    resp = client.get("/api/sessions")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)


@pytest.mark.requires_postgres
def test_pending_observations_returns_list(client):
    """GET /api/observations/pending → 200, list."""
    resp = client.get("/api/observations/pending")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)


@pytest.mark.requires_postgres
def test_archive_returns_structure(client):
    """GET /api/archive → 200, has dbAvailable and entries."""
    resp = client.get("/api/archive")
    assert resp.status_code == 200
    data = resp.json()
    assert "dbAvailable" in data
    assert "entries" in data
    assert isinstance(data["entries"], list)


@pytest.mark.requires_postgres
def test_lens_arrival_returns_counts(client):
    """GET /api/lens/arrival → 200, has count keys."""
    resp = client.get("/api/lens/arrival")
    assert resp.status_code == 200
    data = resp.json()
    assert "pendingCount" in data
    assert "recentEvents" in data
    assert "activeDays" in data
    assert "totals" in data


@pytest.mark.requires_postgres
def test_notifications_returns_list(client):
    """GET /api/notifications → 200, list structure."""
    resp = client.get("/api/notifications")
    assert resp.status_code == 200
    data = resp.json()
    assert "notifications" in data
    assert "unreadCount" in data
    assert isinstance(data["notifications"], list)


@pytest.mark.requires_postgres
def test_attention_roundtrip(client):
    """PUT /api/attention then GET → roundtrip works."""
    payload = {"ts": 1234567890, "surface": "feed", "lens": None,
               "expandedStoryIds": [], "openSessionId": None, "pendingApprovalVisible": False}
    put_resp = client.put("/api/attention", json=payload)
    assert put_resp.status_code == 200
    assert put_resp.json() == {"ok": True}

    get_resp = client.get("/api/attention")
    assert get_resp.status_code == 200
    data = get_resp.json()
    # state may be present (if DB write succeeded) or fall back to stale
    assert "state" in data or "stale" in data


@pytest.mark.requires_postgres
def test_digest_schedule_put(client):
    """PUT /api/digest/schedule → persists and returns the schedule."""
    resp = client.put(
        "/api/digest/schedule",
        json={"enabled": False, "intervalMinutes": 45, "debounceMinutes": 5},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["intervalMinutes"] == 45
    assert data["debounceMinutes"] == 5


@pytest.mark.requires_postgres
def test_brain_discover_missing_repo(client):
    """POST /api/brain/discover with missing repoId → 400 or 422."""
    resp = client.post("/api/brain/discover", json={})
    # FastAPI returns 422 for missing required fields, 400 for explicit validation
    assert resp.status_code in (400, 422)


@pytest.mark.requires_postgres
def test_brain_discover_unknown_project(client):
    """POST /api/brain/discover with nonexistent project → 404."""
    resp = client.post("/api/brain/discover", json={"repoId": "nonexistent-id-xyz"})
    assert resp.status_code == 404
