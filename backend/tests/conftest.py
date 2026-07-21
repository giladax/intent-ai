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
