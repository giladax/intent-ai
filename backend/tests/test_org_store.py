"""Tests for OrgStore — SQLite in-memory, offline. No production Postgres."""
from __future__ import annotations

import pytest

import quire.db.org_models  # noqa — register tables
from quire.db.engine import make_test_engine
from quire.db.models import Base
from quire.db.org_models import ensure_org_tables
from quire.org_store import DEMO_REPOS, OrgStore, seed_demo_org


@pytest.fixture
def engine():
    eng = make_test_engine()
    ensure_org_tables(eng)
    yield eng
    Base.metadata.drop_all(eng)


@pytest.fixture
def store(engine):
    return OrgStore(engine=engine)


# ── seed idempotency ──────────────────────────────────────────────────────

def test_seed_creates_org(store):
    seed_demo_org(store)
    org = store.get_org()
    assert org is not None
    assert org["id"] == "quire"
    assert org["name"] == "Quire"


def test_seed_is_idempotent(store):
    seed_demo_org(store)
    seed_demo_org(store)  # second call must not raise or duplicate
    org = store.get_org()
    assert org is not None
    assert len(org["repos"]) == len(DEMO_REPOS)


def test_seed_creates_all_dogfood_repos(store):
    seed_demo_org(store)
    org = store.get_org()
    workspaces = {r["workspace"] for r in org["repos"]}
    expected = {"intent-ai", "intent-ai-live", "pydantic", "telegram",
                "quire-brain", "refund-agent"}
    assert workspaces == expected


def test_quire_brain_is_frozen(store):
    seed_demo_org(store)
    org = store.get_org()
    brain = next(r for r in org["repos"] if r["workspace"] == "quire-brain")
    assert brain["read_only"] is True
    assert brain["status"] == "frozen"


def test_intent_ai_has_github_remote(store):
    seed_demo_org(store)
    org = store.get_org()
    ia = next(r for r in org["repos"] if r["workspace"] == "intent-ai")
    assert ia["github_remote"] == "https://github.com/giladax/intent-ai"


def test_fixture_repos_have_no_remote(store):
    seed_demo_org(store)
    org = store.get_org()
    for r in org["repos"]:
        if r["workspace"] == "intent-ai":
            # intent-ai is the only repo with a real remote
            assert r["github_remote"] == "https://github.com/giladax/intent-ai"
        else:
            # all other seeded repos must have no remote
            assert r["github_remote"] is None


# ── card data composition ─────────────────────────────────────────────────

def test_card_data_returns_list(store):
    from unittest.mock import MagicMock
    seed_demo_org(store)
    mock_alignment = MagicMock()
    mock_alignment.list_analyses.return_value = []
    cards = store.get_repo_card_data(mock_alignment)
    assert isinstance(cards, list)
    assert len(cards) == len(DEMO_REPOS)


def test_card_data_fields(store):
    from unittest.mock import MagicMock
    seed_demo_org(store)
    mock_alignment = MagicMock()
    mock_alignment.list_analyses.return_value = []
    cards = store.get_repo_card_data(mock_alignment)
    for card in cards:
        assert "workspace" in card
        assert "display_name" in card
        assert "latest_verdict" in card      # str | None
        assert "open_review_count" in card   # int
        assert "coupled_session_count" in card  # int
        assert "github_remote" in card
        assert "status" in card
        assert "intent_ledger_url" in card   # "/intent/<workspace>"


def test_get_repo_card_data_uses_repository_key_for_alignment_store(store):
    """get_repo_card_data must call list_analyses with the repository key,
    not the workspace name, when the two differ (refund-agent case)."""
    from unittest.mock import MagicMock, call
    seed_demo_org(store)
    mock_alignment = MagicMock()
    mock_alignment.list_analyses.return_value = []
    store.get_repo_card_data(mock_alignment)

    # Build a mapping: workspace → actual repository kwarg used
    actual_calls = {
        c.kwargs["repository"]: c.kwargs["repository"]
        for c in mock_alignment.list_analyses.call_args_list
    }
    # All calls must have used keyword argument `repository`
    all_repo_args = [
        c.kwargs["repository"]
        for c in mock_alignment.list_analyses.call_args_list
    ]

    # refund-agent must be queried with its alignment store key
    assert "company/refund-agent" in all_repo_args, (
        "Expected list_analyses called with repository='company/refund-agent' for refund-agent"
    )
    # workspace name itself must NOT appear (alignment key overrides)
    assert "refund-agent" not in all_repo_args, (
        "list_analyses must not be called with bare workspace 'refund-agent'"
    )
    # intent-ai workspace == repository key, so must be called as-is
    assert "intent-ai" in all_repo_args, (
        "Expected list_analyses called with repository='intent-ai' for intent-ai"
    )


def test_seed_patch_forward_backfills_repository(store, engine):
    """seed() must backfill repository on rows seeded before the column existed."""
    from sqlalchemy.orm import Session as SASession
    from quire.db.org_models import OrgRepo

    # First seed — creates all rows normally.
    seed_demo_org(store)

    # Simulate legacy state: set refund-agent's repository to None
    # (as if it was seeded before the repository column was added).
    with SASession(engine) as s:
        row = s.get(OrgRepo, "refund-agent")
        row.repository = None
        s.commit()

    # Second seed — must patch-forward the NULL repository.
    seed_demo_org(store)

    # Assert the row now has the correct repository key.
    with SASession(engine) as s:
        row = s.get(OrgRepo, "refund-agent")
        assert row.repository == "company/refund-agent"


def test_no_implicit_production_org_store():
    """Guard: OrgStore() with no engine must raise in tests (prevents
    accidental writes to production Postgres)."""
    # The conftest monkeypatches org_store_mod.OrgStore to guard implicit
    # engine creation. Read through the module attribute (not the
    # module-level `from ... import OrgStore` binding) so the patch is seen.
    from quire import org_store as org_store_mod
    with pytest.raises(RuntimeError, match="production"):
        org_store_mod.OrgStore()
