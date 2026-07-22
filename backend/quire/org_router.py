"""FastAPI org router — org management + onboarding endpoints (O0, O1).

Pattern: same style as quire.journal.router — create_org_router() factory
returns a configured APIRouter, mounted onto the main app in api.py.

The router composes over two stores:
  - OrgStore (Postgres) — org/repo rows
  - Store (SQLite alignment) — PR analyses for verdict/review data
No cross-store SQL; Python composition only.

When org_store is None (Postgres unreachable at startup), read endpoints
degrade to HTTP 503 so the rest of the app stays healthy.

O1 endpoints (hero flow):
  POST /api/org/repos/register   — parse URL, clone mirror, write scanning row
  POST /api/org/repos/{ws}/scan  — scan intent sources over the mirror
  POST /api/org/repos/{ws}/draft — mine top sources into draft obligations (live LLM)
  POST /api/org/repos/{ws}/approve — apply human decisions, write workspace
  POST /api/org/repos/{ws}/first-results — list PRs + replay through analyzer
"""
from __future__ import annotations

import logging
import os
import pathlib

from fastapi import APIRouter, Body, HTTPException

logger = logging.getLogger(__name__)

# Workspaces root — same as the rest of the backend (workspaces/ beside quire/).
_WORKSPACES_ROOT = pathlib.Path(__file__).parent.parent / "workspaces"


def create_org_router(org_store, alignment_store) -> APIRouter:
    """Factory: returns a configured APIRouter.

    Args:
        org_store: quire.org_store.OrgStore instance (Postgres), or None if
            the org layer was unavailable at startup (both endpoints → 503).
        alignment_store: quire.store.Store instance (SQLite).
    """
    router = APIRouter()

    @router.get("/api/org")
    def get_org():
        """Return the org with composed repo card data."""
        if org_store is None:
            raise HTTPException(
                503,
                "org layer unavailable — Postgres unreachable at startup",
            )
        org = org_store.get_org()
        if org is None:
            raise HTTPException(
                503,
                "Org not initialized — the org data has not been seeded yet",
            )
        cards = org_store.get_repo_card_data(alignment_store)
        return {
            "id": org["id"],
            "name": org["name"],
            "repos": cards,
        }

    @router.get("/api/org/repos")
    def get_org_repos():
        """Return only the repo card list (convenience endpoint for the UI)."""
        if org_store is None:
            raise HTTPException(
                503,
                "org layer unavailable — Postgres unreachable at startup",
            )
        cards = org_store.get_repo_card_data(alignment_store)
        return cards

    @router.get("/api/vocab")
    def get_vocab():
        """The verdict vocabulary — one public map from Classification enum to
        plain label, terse verb, ink (verdict colour), and severity. Both the
        app and any agent read verdict meaning from here, so no surface
        re-implements the translation (F2: one place). Never touches a store,
        so it answers even when Postgres is down."""
        from quire import vocab

        return vocab.as_vocab_payload()

    @router.get("/api/needs-you")
    def get_needs_you():
        """The "Needs you" list — the few decisions awaiting a human, ranked
        by stakes, enriched for the app's list AND detail pane from one
        contract (the promise touched, the receipt, why the author did it).
        Each promise carries: obligation_id, relation, reasoning, and
        statement (the plain-language sentence from the approved artifact;
        empty string when unresolvable — never raises).
        An empty list is a first-class quiet state."""
        if org_store is None:
            raise HTTPException(
                503,
                "org layer unavailable — Postgres unreachable at startup",
            )
        return org_store.get_needs_you(alignment_store)

    @router.get("/api/org/docket")
    def get_org_docket():
        """The Docket — decisions awaiting a human's signature, ranked by
        stakes, as sentences with links. An empty Docket is a first-class
        quiet state: nothing needs you right now."""
        if org_store is None:
            raise HTTPException(
                503,
                "org layer unavailable — Postgres unreachable at startup",
            )
        return org_store.get_docket(alignment_store)

    # ── O1: hero-flow endpoints ──────────────────────────────────────────

    @router.post("/api/org/repos/register")
    def register_repo(body: dict = Body(...)):
        """Parse a GitHub URL, clone the mirror, and create a scanning row.

        Body: {"url": "https://github.com/owner/name"}
        Returns: {owner, name, workspace, mirror_path, status}
        """
        if org_store is None:
            raise HTTPException(503, "org layer unavailable")
        url = (body.get("url") or "").strip()
        if not url:
            raise HTTPException(400, "body must include 'url'")
        from quire.org_onboard import cleanup_failed_registration, register_repo as _register
        try:
            result = _register(url=url, org_store=org_store)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(502, f"mirror clone failed: {exc}") from exc
        # Post-registration work goes here. If any of it fails after the row
        # was written by _register(), clean up so no orphaned row persists.
        workspace = result.get("workspace")
        try:
            # Currently no additional post-clone work; this block is the hook
            # where future steps (e.g., initial scan trigger) will be added.
            # Any exception here triggers cleanup below.
            pass
        except Exception as exc:
            if workspace:
                cleanup_failed_registration(workspace, org_store)
            raise HTTPException(500, f"post-registration step failed: {exc}") from exc
        return result

    @router.post("/api/org/repos/{workspace}/scan")
    def scan_repo(workspace: str, body: dict = Body(default={})):
        """Scan the mirror for intent sources and recent commits.

        Returns: {sources: [...], commits: [...]}
        """
        if org_store is None:
            raise HTTPException(503, "org layer unavailable")
        repos = org_store.list_repos()
        repo_row = next((r for r in repos if r["workspace"] == workspace), None)
        if repo_row is None:
            raise HTTPException(404, f"workspace {workspace!r} not found in org")
        # Derive owner/name from github_remote or workspace id
        owner, name = _parse_owner_name(repo_row, workspace)
        from quire.org_onboard import mirror_path, scan_repo as _scan
        mirror = mirror_path(owner, name)
        if not (mirror / ".git").exists():
            raise HTTPException(400, f"mirror not found for {workspace} — register first")
        extra_skip = set(body.get("extra_skip_parts") or [])
        return _scan(mirror, extra_skip_parts=extra_skip or None)

    @router.post("/api/org/repos/{workspace}/draft")
    def draft_repo(workspace: str, body: dict = Body(...)):
        """Mine top sources into draft obligations (live LLM).

        Body: {"sources": [...]}  (from /scan response)
        Returns: {obligations, bindings, notes}
        """
        if org_store is None:
            raise HTTPException(503, "org layer unavailable")
        repos = org_store.list_repos()
        repo_row = next((r for r in repos if r["workspace"] == workspace), None)
        if repo_row is None:
            raise HTTPException(404, f"workspace {workspace!r} not found")
        owner, name = _parse_owner_name(repo_row, workspace)
        sources = body.get("sources") or []
        if not sources:
            raise HTTPException(400, "body must include 'sources' list")
        from quire.org_onboard import draft_repo as _draft, mirror_path
        mirror = mirror_path(owner, name)
        return _draft(mirror=mirror, workspace=workspace, sources=sources)

    @router.post("/api/org/repos/{workspace}/approve")
    def approve_repo(workspace: str, body: dict = Body(...)):
        """Apply human approval decisions and write the workspace.

        Body: {sources, obligations, bindings, sweep_commits}
        Returns: {workspace_path, id_map, status}
        """
        if org_store is None:
            raise HTTPException(503, "org layer unavailable")
        repos = org_store.list_repos()
        repo_row = next((r for r in repos if r["workspace"] == workspace), None)
        if repo_row is None:
            raise HTTPException(404, f"workspace {workspace!r} not found")
        owner, name = _parse_owner_name(repo_row, workspace)
        sources = body.get("sources") or []
        obligations = body.get("obligations") or []
        bindings = body.get("bindings") or []
        sweep_commits = body.get("sweep_commits") or []
        if not obligations:
            raise HTTPException(400, "body must include non-empty 'obligations' list")
        from quire.org_onboard import approve_repo as _approve
        try:
            result = _approve(
                workspace=workspace,
                owner=owner,
                name=name,
                org_store=org_store,
                workspaces_root=_WORKSPACES_ROOT,
                sources=sources,
                obligations=obligations,
                bindings=bindings,
                sweep_commits=sweep_commits,
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        return result

    @router.post("/api/org/repos/{workspace}/first-results")
    def first_results(workspace: str, body: dict = Body(default={})):
        """List recent PRs and replay through the analyzer.

        Requires workspace status == "active" (the approve step must have run first).

        Body: {"n_prs": 3}  (optional)
        Returns: {prs_fetched, replayed, verdicts}
        """
        if org_store is None:
            raise HTTPException(503, "org layer unavailable")
        repos = org_store.list_repos()
        repo_row = next((r for r in repos if r["workspace"] == workspace), None)
        if repo_row is None:
            raise HTTPException(404, f"workspace {workspace!r} not found")
        # Approve must precede first-results: status must be "active".
        if repo_row.get("status") != "active":
            raise HTTPException(
                409,
                f"workspace {workspace!r} is not active (status={repo_row.get('status')!r}) "
                "— run approve before first-results",
            )
        owner, name = _parse_owner_name(repo_row, workspace)
        n_prs = int(body.get("n_prs") or 3)
        from quire.org_onboard import first_results as _first
        token = os.environ.get("GITHUB_TOKEN")
        return _first(
            workspace=workspace,
            owner=owner,
            name=name,
            workspaces_root=_WORKSPACES_ROOT,
            alignment_store=alignment_store,
            n_prs=n_prs,
            token=token,
        )

    return router


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _parse_owner_name(repo_row: dict, workspace: str) -> tuple[str, str]:
    """Extract (owner, name) from a repo row.

    Primary source: github_remote URL. Fallback: workspace name or
    repository key (split on '/').
    """
    from quire.org_onboard import parse_github_url

    remote = repo_row.get("github_remote") or ""
    if remote:
        try:
            return parse_github_url(remote)
        except ValueError:
            pass
    # Try the repository key
    repo_key = repo_row.get("repository") or ""
    if "/" in repo_key:
        parts = repo_key.split("/", 1)
        return parts[0], parts[1]
    # Last resort: split workspace on "-" (e.g. "owner-repo")
    if "-" in workspace:
        idx = workspace.index("-")
        return workspace[:idx], workspace[idx + 1:]
    return workspace, workspace
