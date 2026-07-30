"""Engine and session factory for the journal Postgres.

Read-only by convention — this layer never issues INSERT/UPDATE/DELETE.
Drizzle (journal/src) owns all writes and migrations.

Usage:
    from quire.db.engine import get_session

    with get_session() as session:
        rows = session.execute(select(ActivityEvent)).scalars().all()

Environment:
    DATABASE_URL — postgresql://user:pass@host:port/db
    Loaded via workspace.load_env() which reads the repo-root .env.
"""

from __future__ import annotations

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

# Loaded lazily so tests that don't need Postgres can import without a URL.
_engine = None
_SessionFactory: sessionmaker | None = None


def _build_url() -> str:
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        raise RuntimeError(
            "DATABASE_URL not set — call workspace.load_env() before using quire.db"
        )
    # SQLAlchemy uses postgresql+psycopg:// for psycopg3; accept either form.
    if url.startswith("postgresql://") or url.startswith("postgres://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
        url = url.replace("postgres://", "postgresql+psycopg://", 1)
    return url


def get_engine():
    """Return (and lazily create) the shared SQLAlchemy engine."""
    global _engine
    if _engine is None:
        _engine = create_engine(
            _build_url(),
            pool_pre_ping=True,
            pool_size=2,
            max_overflow=4,
        )
    return _engine


def get_session() -> Session:
    """Return a new SQLAlchemy Session (caller owns the lifecycle).

    Prefer the context-manager form:
        with get_session() as s:
            ...
    """
    global _SessionFactory
    if _SessionFactory is None:
        _SessionFactory = sessionmaker(bind=get_engine(), expire_on_commit=False)
    return _SessionFactory()


def make_test_engine(url: str = "sqlite:///:memory:"):
    """Create an isolated SQLAlchemy engine for unit tests.

    Defaults to SQLite in-memory so tests run without Postgres.
    Call Base.metadata.create_all(engine) after this to build schema.
    The caller owns the engine's lifetime; for a file/URL engine call
    .dispose() when done (in-memory engines are reclaimed by GC at test end).
    """
    return create_engine(url, connect_args={"check_same_thread": False} if "sqlite" in url else {})
