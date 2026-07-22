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

# Verdict vocabulary (plain labels, verbs, ink, severity) lives in ONE place:
# quire.vocab. The Docket, the cards, and every human surface translate a
# Classification through it — never a private copy. (F2: one place.)
from quire import vocab

_DOCKET_RANK = vocab.SEVERITY_RANK


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

    def add_repo(
        self,
        org_id: str,
        repo_id: str,
        workspace: str,
        display_name: str,
        github_remote: str | None = None,
        status: str = "active",
        read_only: bool = False,
        repository: str | None = None,
    ) -> None:
        """Add a new repo resident to the org.

        Idempotent: if a row with the same id already exists, it is a no-op
        (same behaviour as seed()). Raises if org_id does not exist.

        Single-writer: only OrgStore writes org_repos.
        """
        with SASession(self._engine) as s:
            existing = s.get(OrgRepo, repo_id)
            if existing is None:
                s.add(OrgRepo(
                    id=repo_id,
                    org_id=org_id,
                    workspace=workspace,
                    display_name=display_name,
                    github_remote=github_remote,
                    status=status,
                    read_only=read_only,
                    repository=repository,
                ))
                s.commit()

    def update_repo_status(self, workspace: str, status: str) -> None:
        """Update the status field of a repo row by workspace name.

        Used by the onboarding flow: scanning → active after approval.
        Raises if no row is found for the workspace.
        """
        with SASession(self._engine) as s:
            row = s.execute(
                select(OrgRepo).where(OrgRepo.workspace == workspace)
            ).scalar_one_or_none()
            if row is None:
                raise ValueError(f"No org_repos row found for workspace: {workspace!r}")
            row.status = status
            s.commit()

    def remove_repo(self, workspace: str) -> None:
        """Remove an org_repos row by workspace name.

        Used by the cleanup-on-fail path in org_onboard.py. Silent no-op if
        the row does not exist (idempotent delete).
        """
        with SASession(self._engine) as s:
            row = s.execute(
                select(OrgRepo).where(OrgRepo.workspace == workspace)
            ).scalar_one_or_none()
            if row is not None:
                s.delete(row)
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

    def resolve_repository_key(self, workspace: str) -> str:
        """Return the alignment-store repository key for a workspace.

        The org_repos.repository column holds an override when the alignment
        store key differs from the workspace name (e.g. the refund-agent
        workspace stores analyses under "company/refund-agent"). When the
        column is NULL the workspace name IS the key.

        This is the single authoritative helper — callers must never inline
        the fallback logic (currently `repo["repository"] or ws`).
        """
        with SASession(self._engine) as s:
            row = s.execute(
                select(OrgRepo).where(OrgRepo.workspace == workspace)
            ).scalar_one_or_none()
        if row is None:
            # Unknown workspace — return the name itself; callers may find
            # nothing in the alignment store, which is an expected state for
            # newly registered repos before any analyses exist.
            return workspace
        return row.repository or workspace

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

            # Latest verdict from alignment store. resolve_repository_key is
            # the single authoritative fallback (workspace → alignment key).
            repo_key = self.resolve_repository_key(ws)

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
            verdict_enum = a.classification.value
            v = vocab.verdict(verdict_enum)
            severity = v["severity"]
            recency = a.created_at.timestamp() if a.created_at else 0.0
            item = {
                "id": a.analysis_id,
                "kind": "review",
                "severity": severity,
                # plain words, meaning first — the verdict, then which PR
                "sentence": f"{v['label']} — PR {a.pr_number} on {a.repository}",
                "link": f"/review/{a.analysis_id}",
                "repo": a.repository,
                "ts": a.created_at.isoformat() if a.created_at else "",
            }
            # sort key: loudest first (fallback 99 matches alarms._RANK), then newest
            rows.append((_DOCKET_RANK.get(severity, 99), -recency, item))

        rows.sort(key=lambda r: (r[0], r[1]))
        return [r[2] for r in rows]

    def get_needs_you(self, alignment_store) -> list[dict[str, Any]]:
        """The "Needs you" list, enriched for the app's list + detail pane
        from ONE contract (ruling 4: the same JSON an agent would call).

        Builds on the Docket ranking, then attaches the plain-language detail
        the mock's right pane shows: the verdict (enum + label + ink), the
        headline sentence, repo · PR, the promise it touched (title + the
        model's plain reasoning as the receipt), and "why the author did it"
        (the session's declared intent, when the PR carried one). Pure
        composition over the alignment store — no new store, no LLM.

        An empty list is a first-class quiet state: nothing needs you.
        """
        from quire.models import ReviewState

        try:
            analyses = alignment_store.list_analyses()
        except Exception as error:
            logger.warning(
                "needs-you: list_analyses failed (%s: %s) — list may be incomplete",
                type(error).__name__, error,
            )
            return []

        # Build obligation-statement index once per unique repository in the list.
        # Failure-safe: returns {} for any workspace that can't be resolved.
        try:
            org_repos = self.list_repos()
        except Exception:
            org_repos = []
        _ob_cache: dict[str, dict[str, str]] = {}  # repo → {obligation_id → statement}

        def _ob_index(repo: str) -> dict[str, str]:
            if repo not in _ob_cache:
                _ob_cache[repo] = _obligation_index_for(repo, org_repos)
            return _ob_cache[repo]

        rows = []
        for a in analyses:
            if a.review_state != ReviewState.PENDING:
                continue
            verdict_enum = a.classification.value
            v = vocab.verdict(verdict_enum)
            severity = v["severity"]
            recency = a.created_at.timestamp() if a.created_at else 0.0

            # The promise it touched: the most-impacted obligation, with the
            # model's plain reasoning as the receipt. Impacts that are merely
            # "unrelated" are skipped — we want the one that carries the story.
            promise = None
            impacts = getattr(a, "obligation_impacts", None) or []
            ranked = sorted(
                (i for i in impacts if getattr(i, "relation", "") != "unrelated"),
                key=lambda i: getattr(i, "confidence", 0.0) or 0.0,
                reverse=True,
            )
            src = ranked[0] if ranked else (impacts[0] if impacts else None)
            if src is not None:
                ob_id = getattr(src, "obligation_id", None)
                ob_statement = ""
                try:
                    ob_statement = _ob_index(a.repository).get(ob_id or "", "") or ""
                except Exception:
                    ob_statement = ""
                promise = {
                    "obligation_id": ob_id,
                    "relation": getattr(src, "relation", None),
                    "reasoning": getattr(src, "reasoning", None),
                    "statement": ob_statement,
                }

            # Why the author did it: the declared intent the PR shipped with.
            why = None
            di = getattr(a, "declared_intent", None)
            if di is not None:
                summary = getattr(di, "summary", None)
                if summary:
                    why = {"summary": summary}

            rows.append((
                _DOCKET_RANK.get(severity, 99),
                -recency,
                {
                    "id": a.analysis_id,
                    "kind": "review",
                    "verdict": verdict_enum,          # raw enum (agents translate via vocab)
                    "label": v["label"],              # plain label (app renders directly)
                    "ink": v["ink"],
                    "severity": severity,
                    "title": f"{v['label']} — PR {a.pr_number} on {a.repository}",
                    "repo": a.repository,
                    "pr_number": a.pr_number,
                    "link": f"/review/{a.analysis_id}",
                    "ts": a.created_at.isoformat() if a.created_at else "",
                    "promise": promise,
                    "why": why,
                },
            ))

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

def _obligation_index_for(analysis_repository: str, org_repos: list[dict]) -> dict[str, str]:
    """Return a {obligation_id → statement} map for a repository, or {} on any
    failure (missing fixture, bad YAML, FileNotFoundError). Failure-safe by design."""
    from quire import workspace as ws_mod

    # Find the workspace name that matches the repository key in the alignment store.
    # The alignment store key may be "refund-agent" while org row has repository
    # "company/refund-agent" — so we accept a match on EITHER the repository field
    # OR the workspace field to handle both spellings.
    workspace_name = None
    for repo in org_repos:
        if (
            analysis_repository == repo.get("repository")
            or analysis_repository == repo.get("workspace")
        ):
            workspace_name = repo.get("workspace")
            break
    if not workspace_name:
        return {}

    try:
        adapter = ws_mod.build_adapter(workspace_name)
        return {o.obligation_id: o.statement for o in adapter.obligations()}
    except Exception:
        return {}


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
