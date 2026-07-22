"""FastAPI org router — GET /api/org and /api/org/repos (O0).

Pattern: same style as quire.journal.router — create_org_router() factory
returns a configured APIRouter, mounted onto the main app in api.py.

The router composes over two stores:
  - OrgStore (Postgres) — org/repo rows
  - Store (SQLite alignment) — PR analyses for verdict/review data
No cross-store SQL; Python composition only.

When org_store is None (Postgres unreachable at startup), both endpoints
degrade to HTTP 503 so the rest of the app stays healthy.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

logger = logging.getLogger(__name__)


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

    return router
