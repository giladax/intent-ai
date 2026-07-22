"""Tests for org Postgres models — SQLite in-memory, offline."""
from __future__ import annotations

import pytest
from sqlalchemy import inspect

import quire.db.org_models  # noqa — register tables in Base.metadata
from quire.db.engine import make_test_engine
from quire.db.models import Base


@pytest.fixture
def engine():
    eng = make_test_engine()
    from quire.db.org_models import ensure_org_tables
    ensure_org_tables(eng)
    yield eng
    Base.metadata.drop_all(eng)


def test_org_tables_created(engine):
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    assert "orgs" in tables
    assert "org_repos" in tables
    assert "org_channels" in tables


def test_inherited_tables_not_disturbed(engine):
    """ensure_org_tables must not create or drop inherited tables."""
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    # The org tables are the ONLY ones ensure_org_tables creates;
    # inherited tables are NOT present in a fresh make_test_engine()
    # that only called ensure_org_tables (not Base.metadata.create_all).
    # This checks we didn't accidentally run create_all.
    assert "activity_events" not in tables, (
        "ensure_org_tables must not call Base.metadata.create_all()"
    )
