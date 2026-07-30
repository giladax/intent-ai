import os
import pathlib

import pytest

from quire.adapters.fixture import FixtureWorkspace

FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"


@pytest.fixture
def refund_workspace() -> FixtureWorkspace:
    return FixtureWorkspace(FIXTURES / "refund-agent")


# ── requires_postgres autoskip ───────────────────────────────────────────
# Tests marked @pytest.mark.requires_postgres need a live Postgres at
# DATABASE_URL. When it is unreachable they must SKIP with a clear reason,
# not error — CI honesty: a dead DB is an environment condition, not a bug.

_POSTGRES_UP: bool | None = None  # cached once per test session


def _postgres_reachable() -> bool:
    try:
        import sqlalchemy

        from quire.db.engine import _build_url  # normalizes to +psycopg (v3)
        from quire.workspace import load_env

        # load_dotenv never overrides existing env vars, so an explicitly
        # set DATABASE_URL (e.g. CI pointing at a dead port) still wins.
        load_env()
        if not os.environ.get("DATABASE_URL", ""):
            return False
        engine = sqlalchemy.create_engine(
            _build_url(), pool_pre_ping=True, connect_args={"connect_timeout": 3}
        )
        try:
            with engine.connect():
                pass
        finally:
            engine.dispose()
        return True
    except Exception:
        return False


def _postgres_available() -> bool:
    global _POSTGRES_UP
    if _POSTGRES_UP is None:
        _POSTGRES_UP = _postgres_reachable()
    return _POSTGRES_UP


@pytest.fixture(autouse=True)
def skip_if_postgres_unavailable(request):
    """Auto-skip tests marked requires_postgres when Postgres is unreachable."""
    if request.node.get_closest_marker("requires_postgres"):
        if not _postgres_available():
            pytest.skip(
                "Postgres unreachable — set DATABASE_URL to a live Postgres instance"
            )


# ── production LinkStore guard ───────────────────────────────────────────
# The requires_postgres probe above calls load_env(), which sets DATABASE_URL
# process-wide for the entire test run. Any code path that constructs
# LinkStore() with no explicit engine would therefore write to PRODUCTION
# Postgres (this happened: tests calling digest_session(pr=N) leaked rows
# into the live session_checks table). Guard the whole class of leaks: during
# tests, an engine-less LinkStore raises. Tests that want a real store must
# pass an explicit test engine — LinkStore(engine=make_test_engine()).


@pytest.fixture(autouse=True)
def _no_implicit_production_link_store(monkeypatch):
    from quire import links as links_mod

    real_link_store = links_mod.LinkStore

    class GuardedLinkStore(real_link_store):
        def __init__(self, engine=None):
            if engine is None:
                raise RuntimeError(
                    "test constructed LinkStore() with no engine — this would "
                    "write to production Postgres. Pass an explicit test "
                    "engine: LinkStore(engine=make_test_engine())."
                )
            super().__init__(engine=engine)

    monkeypatch.setattr(links_mod, "LinkStore", GuardedLinkStore)


@pytest.fixture(autouse=True)
def _no_implicit_production_org_store(monkeypatch):
    from quire import org_store as org_store_mod

    real_org_store = org_store_mod.OrgStore

    class GuardedOrgStore(real_org_store):
        def __init__(self, engine=None):
            if engine is None:
                raise RuntimeError(
                    "test constructed OrgStore() with no engine — this would "
                    "write to production Postgres. Pass an explicit test "
                    "engine: OrgStore(engine=make_test_engine())."
                )
            super().__init__(engine=engine)

    monkeypatch.setattr(org_store_mod, "OrgStore", GuardedOrgStore)


@pytest.fixture(autouse=True)
def _no_implicit_production_task_store(monkeypatch):
    from quire import handoff as handoff_mod

    real_task_store = handoff_mod.TaskStore

    class GuardedTaskStore(real_task_store):
        def __init__(self, engine=None):
            if engine is None:
                raise RuntimeError(
                    "test constructed TaskStore() with no engine — this would "
                    "write to production Postgres. Pass an explicit test "
                    "engine: TaskStore(engine=make_test_engine())."
                )
            super().__init__(engine=engine)

    monkeypatch.setattr(handoff_mod, "TaskStore", GuardedTaskStore)


@pytest.fixture(autouse=True)
def _no_implicit_production_upload_store(monkeypatch):
    """Guard: UploadStore() with no engine raises in tests.

    Same guard pattern as LinkStore/OrgStore/TaskStore — prevents test code
    from accidentally writing to the production session_uploads table.
    Tests that need an UploadStore must pass an explicit test engine:
        UploadStore(engine=make_test_engine())
    """
    from quire import sessions_api as sessions_api_mod

    real_upload_store = sessions_api_mod.UploadStore

    class GuardedUploadStore(real_upload_store):
        def __init__(self, engine=None):
            if engine is None:
                raise RuntimeError(
                    "test constructed UploadStore() with no engine — this would "
                    "write to production Postgres. Pass an explicit test "
                    "engine: UploadStore(engine=make_test_engine())."
                )
            super().__init__(engine=engine)

    monkeypatch.setattr(sessions_api_mod, "UploadStore", GuardedUploadStore)
