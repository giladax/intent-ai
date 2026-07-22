"""quire.org_store — single writer for the org platform tables (O0).

OrgStore owns all reads and writes to: orgs, org_repos, org_channels.
Card data is composed in Python from OrgStore (Postgres) + Store (SQLite
alignment); never via cross-store SQL.

Bootstrap: call seed_demo_org(store) once at startup to idempotently
populate the Quire org and its dogfood repo residents.
"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import Session as SASession

from quire.db.org_models import Org, OrgRepo, ensure_org_tables

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Demo seed data (O0 — 6 dogfood repos)
# ---------------------------------------------------------------------------

DEMO_REPOS: list[dict[str, Any]] = [
    {
        "id": "intent-ai",
        "workspace": "intent-ai",
        "display_name": "intent-ai",
        "github_remote": "https://github.com/giladax/intent-ai",
        "status": "active",
        "read_only": False,
    },
    {
        "id": "intent-ai-live",
        "workspace": "intent-ai-live",
        "display_name": "intent-ai-live",
        "github_remote": None,
        "status": "active",
        "read_only": False,
    },
    {
        "id": "refund-agent",
        "workspace": "refund-agent",
        "display_name": "refund-agent",
        "github_remote": None,
        "status": "fixture",
        "read_only": False,
        "repository": "company/refund-agent",  # alignment store key differs from workspace name
    },
    {
        "id": "pydantic",
        "workspace": "pydantic",
        "display_name": "pydantic",
        "github_remote": None,
        "status": "fixture",
        "read_only": False,
    },
    {
        "id": "telegram",
        "workspace": "telegram",
        "display_name": "telegram",
        "github_remote": None,
        "status": "fixture",
        "read_only": False,
    },
    {
        "id": "quire-brain",
        "workspace": "quire-brain",
        "display_name": "quire-brain",
        "github_remote": None,
        "status": "frozen",
        "read_only": True,
    },
]


# ---------------------------------------------------------------------------
# The Docket — decisions awaiting a human, ranked on one severity scale so the
# Front Page, the daily "anything waiting?" tap, and the phone all agree on
# order. Mirrors the alarm policy's severity rank (alarms._RANK).
# ---------------------------------------------------------------------------

_DOCKET_RANK = {"critical": 0, "high": 1, "medium": 2, "info": 3}

# A pending review's stakes, read from its verdict — how loudly it wants you.
_VERDICT_SEVERITY = {
    "OFF_INTENT": "critical",       # contradicts intent
    "PARTIAL": "high",
    "POSSIBLE_DRIFT": "high",
    "UNKNOWN": "medium",            # needs review
    "UNGOVERNED": "medium",         # not covered
    "NO_MATERIAL_IMPACT": "info",
    "ALIGNED": "info",
}

# Plain-language verdict phrase for the Docket sentence — NOT the CLI/GitHub
# DISPLAY_LABELS (which SHOUT in caps: "CONTRADICTS INTENT"). The Front Page
# reads in plain words a non-native speaker gets: "Breaks a rule", not jargon.
# Exhaustive over Classification; a new enum value should get a deliberate
# phrase here rather than silently falling back.
_DOCKET_VERDICT_PHRASE = {
    "OFF_INTENT": "Breaks a rule",
    "PARTIAL": "Partly kept",
    "POSSIBLE_DRIFT": "May be drifting from a rule",
    "UNKNOWN": "Needs your review",
    "UNGOVERNED": "No rule yet",
    "NO_MATERIAL_IMPACT": "No product impact",
    "ALIGNED": "Follows the rules",
}


# ---------------------------------------------------------------------------
# OrgStore
# ---------------------------------------------------------------------------

class OrgStore:
    """Single writer for orgs, org_repos, org_channels.

    Accepts an optional SQLAlchemy engine; if omitted, uses the shared
    production engine (get_engine()). Pass a test engine in unit tests.
    """

    def __init__(self, engine=None) -> None:
        if engine is None:
            from quire.db.engine import get_engine
            engine = get_engine()
        self._engine = engine
        # Ensure org tables exist (pre-Alembic bootstrap; idempotent).
        # This imports org_models (registering tables in Base.metadata) and
        # then calls CREATE TABLE IF NOT EXISTS for each.
        ensure_org_tables(self._engine)

    def seed(self, name: str, slug: str, repos: list[dict[str, Any]]) -> None:
        """Idempotently create the org and its repo residents.

        Safe to call multiple times — uses read-before-insert (s.get()) so
        re-seeding is a no-op. Designed for a single-writer seed path; not
        intended for concurrent writers.
        """
        with SASession(self._engine) as s:
            # Org row
            if s.get(Org, slug) is None:
                s.add(Org(id=slug, name=name))

            # Repo rows
            for repo in repos:
                existing = s.get(OrgRepo, repo["id"])
                if existing is None:
                    s.add(OrgRepo(
                        id=repo["id"],
                        org_id=slug,
                        workspace=repo["workspace"],
                        display_name=repo["display_name"],
                        github_remote=repo.get("github_remote"),
                        status=repo.get("status", "active"),
                        read_only=repo.get("read_only", False),
                        repository=repo.get("repository"),
                    ))
                elif existing.repository is None and repo.get("repository"):
                    # Patch-forward: rows seeded before the repository column
                    # existed (same-day pre-Alembic evolution) get the key
                    # backfilled; user-edited values are never overwritten.
                    existing.repository = repo["repository"]
            s.commit()

    def get_org(self) -> dict[str, Any] | None:
        """Return the single org with its repos, or None if not seeded."""
        with SASession(self._engine) as s:
            org = s.execute(select(Org)).scalar_one_or_none()
            if org is None:
                return None
            repos = s.execute(
                select(OrgRepo).where(OrgRepo.org_id == org.id)
            ).scalars().all()
            return {
                "id": org.id,
                "name": org.name,
                "repos": [_repo_to_dict(r) for r in repos],
            }

    def list_repos(self, org_id: str = "quire") -> list[dict[str, Any]]:
        """Return all repo residents for the org."""
        with SASession(self._engine) as s:
            repos = s.execute(
                select(OrgRepo).where(OrgRepo.org_id == org_id)
            ).scalars().all()
            return [_repo_to_dict(r) for r in repos]

    def count_coupled_sessions(self, workspace: str) -> int:
        """Count session_checks rows for a workspace — coupled-session count."""
        from sqlalchemy import text
        try:
            with SASession(self._engine) as s:
                result = s.execute(
                    text("SELECT COUNT(*) FROM session_checks WHERE workspace = :ws"),
                    {"ws": workspace},
                )
                return result.scalar_one() or 0
        except (OperationalError, ProgrammingError) as error:
            # session_checks may not exist yet in test/first-boot environments
            # that only created org tables; return 0 gracefully. Logged so a
            # real DB fault (locked/unreachable) isn't mistaken for "0 coupled".
            logger.debug("count_coupled_sessions(%s) → 0: %s", workspace, error)
            return 0

    def get_repo_card_data(self, alignment_store) -> list[dict[str, Any]]:
        """Compose repo card data from OrgStore + alignment Store.

        Each card: workspace, display_name, latest_verdict, open_review_count,
        coupled_session_count, github_remote, status, intent_ledger_url.

        alignment_store: quire.store.Store instance (SQLite). Called via
        alignment_store.list_analyses(repository=workspace) — no cross-store
        SQL, Python composition only.
        """
        repos = self.list_repos()
        cards = []
        for repo in repos:
            ws = repo["workspace"]

            # Latest verdict from alignment store.
            # Use repo["repository"] when the alignment store key differs from
            # the workspace name (e.g. refund-agent → "company/refund-agent").
            repo_key = repo.get("repository") or ws

            try:
                analyses = alignment_store.list_analyses(repository=repo_key)
            except Exception as error:
                logger.warning(
                    "alignment store list_analyses failed for %s (%s: %s) — card shows no verdict",
                    ws, type(error).__name__, error,
                )
                analyses = []

            latest_verdict: str | None = None
            open_review_count = 0
            if analyses:
                # list_analyses returns newest-first (ORDER BY created_at DESC)
                latest = analyses[0]
                latest_verdict = latest.classification.value
                open_review_count = sum(
                    1 for a in analyses
                    if a.review_state.value == "pending"
                )

            # Coupled-session count from session_checks (Postgres)
            coupled_session_count = self.count_coupled_sessions(ws)

            cards.append({
                "workspace": ws,
                "display_name": repo["display_name"],
                "latest_verdict": latest_verdict,
                "open_review_count": open_review_count,
                "coupled_session_count": coupled_session_count,
                "github_remote": repo["github_remote"],
                "status": repo["status"],
                "read_only": repo["read_only"],
                "intent_ledger_url": f"/intent/{ws}",
            })
        return cards

    def get_docket(self, alignment_store) -> list[dict[str, Any]]:
        """The Docket: the decisions awaiting a human's signature, ranked by
        stakes, as sentences with links. Pure composition over existing
        evidence — no new store; an empty Docket is a first-class quiet state
        (nothing needs you).

        Today's source is pending PR reviews (the alignment store). Repo
        drafts, `watched` residents, and intent cards join the same ranked
        list as later slices add them — the ranking scale is shared so every
        surface (page, tap, phone) agrees on what matters most.
        """
        from quire.models import ReviewState

        try:
            analyses = alignment_store.list_analyses()
        except Exception as error:
            logger.warning(
                "docket: list_analyses failed (%s: %s) — Docket may be incomplete",
                type(error).__name__, error,
            )
            return []

        rows = []
        for a in analyses:
            if a.review_state != ReviewState.PENDING:
                continue  # only what a human still has to review
            verdict = a.classification.value
            phrase = _DOCKET_VERDICT_PHRASE.get(verdict, "Needs your review")
            severity = _VERDICT_SEVERITY.get(verdict, "medium")
            recency = a.created_at.timestamp() if a.created_at else 0.0
            item = {
                "id": a.analysis_id,
                "kind": "review",
                "severity": severity,
                # plain words, meaning first — the verdict, then which PR
                "sentence": f"{phrase} — PR {a.pr_number} on {a.repository}",
                "link": f"/review/{a.analysis_id}",
                "repo": a.repository,
                "ts": a.created_at.isoformat() if a.created_at else "",
            }
            # sort key: loudest first (fallback 99 matches alarms._RANK), then newest
            rows.append((_DOCKET_RANK.get(severity, 99), -recency, item))

        rows.sort(key=lambda r: (r[0], r[1]))
        return [r[2] for r in rows]


# ---------------------------------------------------------------------------
# Seed helper
# ---------------------------------------------------------------------------

def seed_demo_org(store: OrgStore) -> None:
    """Seed the Quire org with the 6 dogfood repo residents (idempotent)."""
    store.seed("Quire", "quire", DEMO_REPOS)


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _repo_to_dict(r: OrgRepo) -> dict[str, Any]:
    return {
        "id": r.id,
        "org_id": r.org_id,
        "workspace": r.workspace,
        "display_name": r.display_name,
        "github_remote": r.github_remote,
        "status": r.status,
        "read_only": r.read_only,
        "repository": r.repository,
    }
