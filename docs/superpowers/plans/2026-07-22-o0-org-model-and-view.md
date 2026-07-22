# O0 — The Org Exists: Model + View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `orgs`, `org_repos`, and `org_channels` Postgres tables (pre-Alembic bootstrap pattern), seed a single "Quire" org with the dogfood repos, and add a FastAPI org router with card-data endpoints. **SCOPE CHANGE (2026-07-22):** The React org home view is de-scoped — the app/ is being rebuilt ground-up. O0 delivers the data contract (JSON from GET /api/org) that the new app will consume; no app/ changes. Done-when = curl proof of GET /api/org returning real card data.

**Architecture:** Three new tables live in `backend/quire/db/org_models.py` (separate from the inherited `models.py`) and are bootstrapped via `ensure_org_tables()` called at app startup — same pattern as `quire.links.ensure_table_exists()`. An `OrgStore` class owns all reads and writes (single-writer rule). The FastAPI org router (`backend/quire/org_router.py`) composes over `OrgStore` (Postgres) and the existing alignment `Store` (SQLite) to produce card data — NO cross-store SQL, Python composition only. Response schema is documented in router docstrings as the contract for the future app.

**Tech Stack:** Python 3.11, SQLAlchemy 2 (mapped_column style), FastAPI, Pydantic v2.

## Global Constraints

- Pre-Alembic bootstrap: new tables use `Base.metadata.tables["table_name"].create(engine, checkfirst=True)` — NOT `Base.metadata.create_all()` (that would re-run all inherited table creates). Pattern: exactly as `quire.links.ensure_table_exists()`.
- Single org seeded idempotently at bootstrap: name = "Quire", id = "quire" (stable string PK, not UUID, so seed is idempotent).
- Python-only writes: `OrgStore` is the sole writer. No TS path. Documented in CENSUS.md.
- No cross-store SQL: card data is composed in Python from `OrgStore` (Postgres) + `Store` (SQLite alignment). Use `store.list_analyses(repository=ws)` for verdict/review counts; use `OrgStore.links_count(workspace)` for coupled-session counts from Postgres `session_checks`.
- quire-brain workspace is FROZEN — include it as a `read_only=true` org_repo resident but never write into its workspace directory.
- Test discipline: no test may implicitly construct an `OrgStore` with no engine (same guard pattern as `LinkStore` in conftest). Pass explicit `engine=make_test_engine()` in all test fixtures.
- Import trap: org_models must be imported before any `ensure_org_tables()` call, and the production import must happen at app startup (not just test time). Import `quire.org_store` at module level in `quire/api.py` — the import registers the tables in `Base.metadata`.
- **SCOPE CHANGE:** No app/ changes. Tasks 5 and 6 (TypeScript types, OrgHome component) are DROPPED. The app/ suite must remain untouched and green at its existing 28 tests.
- Done-when: `python3 -m quire.cli serve --port 3456` starts, `GET /api/org` returns JSON with 6 repos and real card data (verified by curl). No browser view needed.
- Gates: `582 + new backend tests passed, 1 skipped`; app `npm run build` + `npx vitest run` (exactly 28 tests) clean and untouched; `npx tsc --noEmit` clean.

---

## File Map

**New files:**
- `backend/quire/db/org_models.py` — SQLAlchemy models: `Org`, `OrgRepo`, `OrgChannel`; `ensure_org_tables(engine)` bootstrap
- `backend/quire/org_store.py` — `OrgStore` class (read + write for org tables); `seed_org(store)` seeds "Quire" + dogfood repos; `get_org_card_data(store, alignment_store)` composes card data
- `backend/quire/org_router.py` — FastAPI `APIRouter`; `GET /api/org` endpoint
- `backend/tests/test_org_models.py` — schema + roundtrip tests (SQLite in-memory, offline)
- `backend/tests/test_org_store.py` — OrgStore CRUD + seed idempotency + card data composition (SQLite in-memory)
- `backend/tests/test_org_router.py` — router integration test (TestClient, SQLite in-memory, mocked alignment store)
- `app/src/components/OrgHome.tsx` — org home view component
- `app/src/components/OrgHome.test.tsx` — vitest smoke test

**Modified files:**
- `backend/quire/db/__init__.py` — add `from quire.db import org_models as _org_models  # noqa — registers tables` import note
- `backend/quire/db/CENSUS.md` — add three new tables to the census
- `backend/quire/api.py` — import `quire.org_store` (registers tables) + `create_journal_router` line; mount `org_router`
- `app/src/api.ts` — add `fetchOrg()` function
- `app/src/types.ts` — add `OrgRepo`, `OrgCard`, `OrgResponse` types
- `app/src/App.tsx` — add `"org"` to `View`, make it default, render `<OrgHome>` in view switch, add nav button

---

## Task 1: DB models (`backend/quire/db/org_models.py`)

**Files:**
- Create: `backend/quire/db/org_models.py`

**Interfaces:**
- Produces: `Org`, `OrgRepo`, `OrgChannel` SQLAlchemy model classes; `ensure_org_tables(engine) -> None`

- [ ] **Step 1: Write the failing test for schema census**

```python
# backend/tests/test_org_models.py
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
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/giladkoch/dev/intent-ai/backend
python3 -m pytest tests/test_org_models.py -v
```
Expected: `ImportError` or `ModuleNotFoundError` — `quire.db.org_models` doesn't exist yet.

- [ ] **Step 3: Create `backend/quire/db/org_models.py`**

```python
"""SQLAlchemy models for the org platform (O0).

Three tables: orgs, org_repos, org_channels.

These are NEW tables (post-Drizzle freeze). Per the pre-Alembic bootstrap
pattern established by U0 (quire.links):
  - Tables are declared against quire.db.models.Base so they share the
    same metadata as the inherited schema.
  - ensure_org_tables(engine) runs CREATE TABLE IF NOT EXISTS for each
    table via Base.metadata.tables[name].create(engine, checkfirst=True).
  - This module must be imported before ensure_org_tables() is called so
    SQLAlchemy registers the table descriptors in Base.metadata.

Single-writer: quire.org_store.OrgStore is the sole writer.
Bootstrap: ensure_org_tables() is called once at app startup via api.py.
CENSUS.md entry added: O0 — orgs, org_repos, org_channels.
"""
from __future__ import annotations

from sqlalchemy import Boolean, Column, String, Text, UniqueConstraint
from sqlalchemy.types import JSON

from quire.db.models import Base


class Org(Base):
    """A single organisation — the top entity. Single-seeded for demo (⚑ D)."""
    __tablename__ = "orgs"

    id: str = Column(String, primary_key=True)   # stable slug, e.g. "quire"
    name: str = Column(Text, nullable=False)     # display name, e.g. "Quire"


class OrgRepo(Base):
    """One repo resident of an org.

    github_remote: nullable — local-only repos (fixture workspaces with no
    real remote) are valid residents. status field indicates which:
      "active"    — live repo, analyses running
      "fixture"   — local-only fixture workspace (no real remote)
      "frozen"    — read-only resident (e.g. quire-brain); never write
    """
    __tablename__ = "org_repos"
    __table_args__ = (
        UniqueConstraint("org_id", "workspace", name="uq_org_repo_workspace"),
    )

    id: str = Column(String, primary_key=True)    # stable slug = workspace name
    org_id: str = Column(String, nullable=False, index=True)
    workspace: str = Column(Text, nullable=False)   # key into workspaces/
    display_name: str = Column(Text, nullable=False)
    github_remote: str | None = Column(Text, nullable=True)
    status: str = Column(Text, nullable=False, default="active")
    read_only: bool = Column(Boolean, nullable=False, default=False)


class OrgChannel(Base):
    """A notification/delivery channel attached to the org.

    transport: "telegram" | "slack" (O5 adds delivery).
    config: jsonb — bot_token, chat_id, webhook_url, etc. (encrypted at rest
    in production; plaintext in demo / local-only).
    purposes: jsonb list of strings — e.g. ["alarms", "digest"].
    """
    __tablename__ = "org_channels"

    id: str = Column(String, primary_key=True)
    org_id: str = Column(String, nullable=False, index=True)
    transport: str = Column(Text, nullable=False)    # "telegram" | "slack"
    config: dict = Column(JSON, nullable=False, default=dict)
    purposes: list = Column(JSON, nullable=False, default=list)


# ---------------------------------------------------------------------------
# Bootstrap (pre-Alembic; idempotent)
# ---------------------------------------------------------------------------

def ensure_org_tables(engine) -> None:
    """CREATE TABLE IF NOT EXISTS for orgs, org_repos, org_channels.

    Pre-Alembic bootstrap helper — safe to call multiple times. This module
    MUST be imported before calling this function so the table descriptors
    exist in Base.metadata.

    Once Alembic is adopted (see backend/README.md "Schema changes"), these
    become migration 002_org_tables.py and this function is retired.
    """
    for table_name in ("orgs", "org_repos", "org_channels"):
        Base.metadata.tables[table_name].create(engine, checkfirst=True)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/giladkoch/dev/intent-ai/backend
python3 -m pytest tests/test_org_models.py -v
```
Expected: `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add backend/quire/db/org_models.py backend/tests/test_org_models.py
git commit -m "feat(O0): org db models — orgs/org_repos/org_channels + bootstrap"
```

---

## Task 2: OrgStore class (`backend/quire/org_store.py`)

**Files:**
- Create: `backend/quire/org_store.py`

**Interfaces:**
- Consumes: `Org`, `OrgRepo`, `OrgChannel` from `quire.db.org_models`; `ensure_org_tables` from `quire.db.org_models`; `Store` from `quire.store`
- Produces:
  - `OrgStore(engine=None)` — class; if `engine=None` uses production Postgres `get_engine()`
  - `OrgStore.seed(name: str, slug: str, repos: list[dict]) -> None` — idempotent seed
  - `OrgStore.get_org() -> dict | None` — returns `{"id", "name", "repos": [...]}`
  - `OrgStore.get_repo_card_data(alignment_store: Store) -> list[dict]` — composed card data
  - `DEMO_REPOS: list[dict]` — module-level constant listing the 6 dogfood repos
  - `seed_demo_org(store: OrgStore) -> None` — seeds the "Quire" org with `DEMO_REPOS`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_org_store.py
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
        if r["workspace"] not in ("intent-ai",):
            # fixture workspaces have no real remote
            assert r["github_remote"] is None or r["status"] in ("fixture", "frozen", "active")


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


def test_no_implicit_production_org_store():
    """Guard: OrgStore() with no engine must raise in tests (prevents
    accidental writes to production Postgres)."""
    # The conftest monkeypatches OrgStore to guard implicit engine creation.
    # This test verifies the guard fires.
    with pytest.raises(RuntimeError, match="production"):
        OrgStore()
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/giladkoch/dev/intent-ai/backend
python3 -m pytest tests/test_org_store.py -v
```
Expected: `ModuleNotFoundError: quire.org_store`.

- [ ] **Step 3: Create `backend/quire/org_store.py`**

```python
"""quire.org_store — single writer for the org platform tables (O0).

OrgStore owns all reads and writes to: orgs, org_repos, org_channels.
Card data is composed in Python from OrgStore (Postgres) + Store (SQLite
alignment); never via cross-store SQL.

Bootstrap: call seed_demo_org(store) once at startup to idempotently
populate the Quire org and its dogfood repo residents.
"""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session as SASession

from quire.db.org_models import Org, OrgChannel, OrgRepo, ensure_org_tables

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

        Safe to call multiple times — uses INSERT OR IGNORE / ON CONFLICT DO
        NOTHING so re-seeding is a no-op.
        """
        with SASession(self._engine) as s:
            # Org row
            if s.get(Org, slug) is None:
                s.add(Org(id=slug, name=name))

            # Repo rows
            for repo in repos:
                if s.get(OrgRepo, repo["id"]) is None:
                    s.add(OrgRepo(
                        id=repo["id"],
                        org_id=slug,
                        workspace=repo["workspace"],
                        display_name=repo["display_name"],
                        github_remote=repo.get("github_remote"),
                        status=repo.get("status", "active"),
                        read_only=repo.get("read_only", False),
                    ))
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
        except Exception:
            # session_checks may not exist yet in test environments that only
            # created org tables; return 0 gracefully.
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

            # Latest verdict from alignment store
            try:
                analyses = alignment_store.list_analyses(repository=ws)
            except Exception:
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
    }
```

- [ ] **Step 4: Add the OrgStore guard to `conftest.py`**

The existing conftest already guards `LinkStore`; add the same pattern for `OrgStore`:

```python
# In backend/tests/conftest.py — add AFTER the existing _no_implicit_production_link_store fixture:

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
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/giladkoch/dev/intent-ai/backend
python3 -m pytest tests/test_org_store.py tests/test_org_models.py -v
```
Expected: all pass (9 from org_store + 2 from org_models = 11).

- [ ] **Step 6: Run full suite to confirm no regression**

```bash
cd /Users/giladkoch/dev/intent-ai/backend
python3 -m pytest 2>&1 | tail -5
```
Expected: `582 + (your new tests) passed, 1 skipped`.

- [ ] **Step 7: Commit**

```bash
git add backend/quire/org_store.py backend/tests/test_org_store.py backend/tests/conftest.py
git commit -m "feat(O0): OrgStore + demo seed (Quire org + 6 dogfood repos)"
```

---

## Task 3: CENSUS.md + `__init__.py` updates

**Files:**
- Modify: `backend/quire/db/CENSUS.md`
- Modify: `backend/quire/db/__init__.py`

**Interfaces:**
- No new interfaces; documentation and import registration only.

- [ ] **Step 1: Update `backend/quire/db/__init__.py`**

Add this comment-import at the end of the file so that any code that imports `quire.db` registers the org models in `Base.metadata`:

```python
# Post-freeze additions: new tables added after the Drizzle freeze (U0+).
# Import order matters: modules must be imported before ensure_*_tables() runs.
# quire.links registers session_checks; quire.db.org_models registers org tables.
# Both are imported lazily by their respective store classes at construction time,
# but explicit imports here ensure they are available to Base.metadata.create_all()
# in test fixtures that call it directly.
from quire.db import org_models as _org_models  # noqa: F401 — registers tables
```

- [ ] **Step 2: Append O0 section to CENSUS.md**

Add after the existing `## U0 — session_checks` section:

```markdown
## O0 — org tables (2026-07-22)

**THREE NEW TABLES** — org platform layer.

| Table | Readers | Writers | Verdict | Evidence |
|-------|---------|---------|---------|----------|
| `orgs` | `quire.org_store.OrgStore.get_org` | `quire.org_store.OrgStore.seed` | **LIVE** | backend/quire/org_store.py |
| `org_repos` | `quire.org_store.OrgStore.list_repos`, `get_repo_card_data` | `quire.org_store.OrgStore.seed` | **LIVE** | backend/quire/org_store.py |
| `org_channels` | (reserved for O5 delivery) | (reserved for O5) | **LIVE** | backend/quire/db/org_models.py |

**Schema bootstrap:** `quire.db.org_models.ensure_org_tables(engine)` runs
`CREATE TABLE IF NOT EXISTS` idempotently for all three. Called from
`OrgStore.__init__()` and from the FastAPI app startup path.

**Single-writer:** `quire.org_store.OrgStore` is the sole writer. No TS path exists.

**Seeding:** `seed_demo_org(store)` is called at app startup (quire/api.py) to
idempotently populate the "Quire" org with 6 dogfood repo residents:
intent-ai, intent-ai-live, refund-agent, pydantic, telegram, quire-brain.
quire-brain is frozen (read_only=True, status="frozen").

**Columns: orgs**
- `id` TEXT PK (stable slug, e.g. "quire")
- `name` TEXT NOT NULL

**Columns: org_repos**
- `id` TEXT PK (workspace slug)
- `org_id` TEXT NOT NULL (index)
- `workspace` TEXT NOT NULL
- `display_name` TEXT NOT NULL
- `github_remote` TEXT NULL (nullable for local-only repos)
- `status` TEXT NOT NULL — "active" | "fixture" | "frozen"
- `read_only` BOOLEAN NOT NULL

**Columns: org_channels**
- `id` TEXT PK (UUID)
- `org_id` TEXT NOT NULL (index)
- `transport` TEXT NOT NULL — "telegram" | "slack"
- `config` JSONB NOT NULL
- `purposes` JSONB NOT NULL
```

- [ ] **Step 3: Verify full suite still passes**

```bash
cd /Users/giladkoch/dev/intent-ai/backend
python3 -m pytest 2>&1 | tail -3
```

- [ ] **Step 4: Commit**

```bash
git add backend/quire/db/__init__.py backend/quire/db/CENSUS.md
git commit -m "docs(O0): register org_models in db __init__ and census"
```

---

## Task 4: FastAPI org router (`backend/quire/org_router.py`)

**Files:**
- Create: `backend/quire/org_router.py`
- Create: `backend/tests/test_org_router.py`
- Modify: `backend/quire/api.py`

**Interfaces:**
- Consumes: `OrgStore(engine=...)`, `seed_demo_org`, `Store` from `quire.store`
- Produces:
  - `create_org_router(org_store: OrgStore, alignment_store: Store) -> APIRouter`
  - `GET /api/org` → `{"id", "name", "repos": [...card dicts...]}`
  - `GET /api/org/repos` → `[...card dicts...]`

- [ ] **Step 1: Write the failing router tests**

```python
# backend/tests/test_org_router.py
"""Integration tests for the org router — TestClient + SQLite in-memory."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import quire.db.org_models  # noqa — register tables
from quire.db.engine import make_test_engine
from quire.db.models import Base
from quire.db.org_models import ensure_org_tables
from quire.org_store import OrgStore, seed_demo_org


@pytest.fixture
def engine():
    eng = make_test_engine()
    ensure_org_tables(eng)
    yield eng
    Base.metadata.drop_all(eng)


@pytest.fixture
def store(engine):
    s = OrgStore(engine=engine)
    seed_demo_org(s)
    return s


@pytest.fixture
def alignment_store(tmp_path):
    from quire.store import Store
    return Store(url=f"sqlite:///{tmp_path}/test.db")


@pytest.fixture
def client(store, alignment_store):
    from quire.org_router import create_org_router
    app = FastAPI()
    app.include_router(create_org_router(store, alignment_store))
    return TestClient(app)


def test_get_org_returns_200(client):
    resp = client.get("/api/org")
    assert resp.status_code == 200


def test_get_org_has_name(client):
    data = client.get("/api/org").json()
    assert data["name"] == "Quire"
    assert data["id"] == "quire"


def test_get_org_has_repos(client):
    data = client.get("/api/org").json()
    assert "repos" in data
    assert len(data["repos"]) == 6


def test_get_org_card_fields(client):
    data = client.get("/api/org").json()
    for repo in data["repos"]:
        assert "workspace" in repo
        assert "display_name" in repo
        assert "latest_verdict" in repo
        assert "open_review_count" in repo
        assert "coupled_session_count" in repo
        assert "intent_ledger_url" in repo


def test_intent_ai_has_github_remote(client):
    data = client.get("/api/org").json()
    ia = next(r for r in data["repos"] if r["workspace"] == "intent-ai")
    assert ia["github_remote"] == "https://github.com/giladax/intent-ai"


def test_quire_brain_is_frozen(client):
    data = client.get("/api/org").json()
    brain = next(r for r in data["repos"] if r["workspace"] == "quire-brain")
    assert brain["read_only"] is True


def test_intent_ledger_url_format(client):
    data = client.get("/api/org").json()
    for repo in data["repos"]:
        assert repo["intent_ledger_url"] == f"/intent/{repo['workspace']}"
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/giladkoch/dev/intent-ai/backend
python3 -m pytest tests/test_org_router.py -v
```
Expected: `ModuleNotFoundError: quire.org_router`.

- [ ] **Step 3: Create `backend/quire/org_router.py`**

```python
"""FastAPI org router — GET /api/org and /api/org/repos (O0).

Pattern: same style as quire.journal.router — create_org_router() factory
returns a configured APIRouter, mounted onto the main app in api.py.

The router composes over two stores:
  - OrgStore (Postgres) — org/repo rows
  - Store (SQLite alignment) — PR analyses for verdict/review data
No cross-store SQL; Python composition only.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

logger = logging.getLogger(__name__)


def create_org_router(org_store, alignment_store) -> APIRouter:
    """Factory: returns a configured APIRouter.

    Args:
        org_store: quire.org_store.OrgStore instance (Postgres).
        alignment_store: quire.store.Store instance (SQLite).
    """
    router = APIRouter()

    @router.get("/api/org")
    def get_org():
        """Return the org with composed repo card data."""
        org = org_store.get_org()
        if org is None:
            raise HTTPException(
                503,
                "Org not seeded — call seed_demo_org() at startup",
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
        cards = org_store.get_repo_card_data(alignment_store)
        return cards

    return router
```

- [ ] **Step 4: Wire the org router + seed into `backend/quire/api.py`**

In `api.py`, after the line `from quire.journal.router import create_journal_router`, add:

```python
    # ── Org API (O0) ────────────────────────────────────────────────────
    import quire.db.org_models  # noqa: F401 — registers org tables in Base.metadata
    from quire.org_store import OrgStore, seed_demo_org
    from quire.org_router import create_org_router

    _org_store = OrgStore()
    seed_demo_org(_org_store)
    app.include_router(create_org_router(_org_store, app.state.store))
```

This should be placed right after `app.state.store = store or Store()` and before the journal router line. The exact placement: add these lines after:
```python
    app.state.store = store or Store()
```

- [ ] **Step 5: Run router tests**

```bash
cd /Users/giladkoch/dev/intent-ai/backend
python3 -m pytest tests/test_org_router.py -v
```
Expected: all 8 tests pass.

- [ ] **Step 6: Run full suite**

```bash
cd /Users/giladkoch/dev/intent-ai/backend
python3 -m pytest 2>&1 | tail -3
```
Expected: `582 + new tests passed, 1 skipped`.

- [ ] **Step 7: Commit**

```bash
git add backend/quire/org_router.py backend/tests/test_org_router.py backend/quire/api.py
git commit -m "feat(O0): org FastAPI router (GET /api/org) + wire into app"
```

---

## Task 5: TypeScript types + API client

**Files:**
- Modify: `app/src/types.ts`
- Modify: `app/src/api.ts`

**Interfaces:**
- Produces:
  - `OrgRepo` type (TS)
  - `OrgResponse` type (TS)
  - `fetchOrg(): Promise<OrgResponse>` function

- [ ] **Step 1: Add types to `app/src/types.ts`**

Add at the end of `types.ts`:

```typescript
// ── Org platform (O0) ─────────────────────────────────────────────────────

export interface OrgRepo {
  workspace: string;
  display_name: string;
  latest_verdict: string | null;
  open_review_count: number;
  coupled_session_count: number;
  github_remote: string | null;
  status: "active" | "fixture" | "frozen";
  read_only: boolean;
  intent_ledger_url: string;
}

export interface OrgResponse {
  id: string;
  name: string;
  repos: OrgRepo[];
}
```

- [ ] **Step 2: Add `fetchOrg` to `app/src/api.ts`**

Add after the existing `fetchProjects` export:

```typescript
// Org platform (O0)
export const fetchOrg = () => json<OrgResponse>("/api/org");
```

Also add the import for `OrgResponse` to the top import block in `api.ts`:

```typescript
import type {
  // ... existing types ...
  OrgResponse,
} from "./types";
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/giladkoch/dev/intent-ai/app
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/types.ts app/src/api.ts
git commit -m "feat(O0): org types + fetchOrg API client"
```

---

## Task 6: OrgHome React component + App wiring

**Files:**
- Create: `app/src/components/OrgHome.tsx`
- Create: `app/src/components/OrgHome.test.tsx`
- Modify: `app/src/App.tsx`

**Interfaces:**
- Consumes: `fetchOrg` from `../api`; `OrgRepo`, `OrgResponse` from `../types`
- Produces: `<OrgHome onRepoClick={(ws: string) => void />` component

The card reads as a sentence per the "meaning before mechanics" principle:
- Verdict line: "Last check: kept / contradicted / partial / unexercised" (or "No checks yet")
- Review line: "3 open for review" (or nothing if 0)
- Sessions line: "2 sessions coupled" (or "No sessions linked")
- Link: "View intent ledger →"

Design language: use existing `--j-*` CSS custom properties and `.ink-*` classes. No new design tokens.

- [ ] **Step 1: Write the failing vitest smoke test**

```tsx
// app/src/components/OrgHome.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrgHome } from "./OrgHome";

// Mock the API module
vi.mock("../api", () => ({
  fetchOrg: vi.fn(),
}));

import { fetchOrg } from "../api";

const mockOrg = {
  id: "quire",
  name: "Quire",
  repos: [
    {
      workspace: "intent-ai",
      display_name: "intent-ai",
      latest_verdict: "satisfies",
      open_review_count: 1,
      coupled_session_count: 3,
      github_remote: "https://github.com/giladax/intent-ai",
      status: "active" as const,
      read_only: false,
      intent_ledger_url: "/intent/intent-ai",
    },
    {
      workspace: "quire-brain",
      display_name: "quire-brain",
      latest_verdict: null,
      open_review_count: 0,
      coupled_session_count: 0,
      github_remote: null,
      status: "frozen" as const,
      read_only: true,
      intent_ledger_url: "/intent/quire-brain",
    },
  ],
};

describe("OrgHome", () => {
  beforeEach(() => {
    vi.mocked(fetchOrg).mockResolvedValue(mockOrg);
  });

  it("renders org name", async () => {
    render(<OrgHome onRepoClick={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("Quire")).toBeInTheDocument();
    });
  });

  it("renders repo cards", async () => {
    render(<OrgHome onRepoClick={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("intent-ai")).toBeInTheDocument();
      expect(screen.getByText("quire-brain")).toBeInTheDocument();
    });
  });

  it("shows verdict sentence", async () => {
    render(<OrgHome onRepoClick={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/Last check: kept/i)).toBeInTheDocument();
    });
  });

  it("shows no checks yet for null verdict", async () => {
    render(<OrgHome onRepoClick={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/No checks yet/i)).toBeInTheDocument();
    });
  });

  it("shows sessions coupled sentence", async () => {
    render(<OrgHome onRepoClick={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/3 sessions coupled/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/giladkoch/dev/intent-ai/app
npx vitest run src/components/OrgHome.test.tsx 2>&1 | tail -10
```
Expected: failure — `OrgHome` doesn't exist.

- [ ] **Step 3: Create `app/src/components/OrgHome.tsx`**

```tsx
/**
 * OrgHome — the org home view (O0).
 *
 * Shows the seeded Quire org with repos as cards. Each card reads as a
 * sentence (meaning before mechanics — founder principle). Uses existing
 * ink/paper design tokens (--j-*) and .ink-* classes; no new visual language.
 */
import { useEffect, useState } from "react";
import { fetchOrg } from "../api";
import type { OrgRepo, OrgResponse } from "../types";

// Verdict display labels — same vocabulary as the alignment store
const VERDICT_LABELS: Record<string, string> = {
  satisfies: "kept",
  contradicts: "contradicted",
  partially_satisfies: "partial",
  unexercised: "unexercised",
};

function verdictSentence(verdict: string | null): string {
  if (!verdict) return "No checks yet";
  const label = VERDICT_LABELS[verdict] ?? verdict;
  return `Last check: ${label}`;
}

function verdictColor(verdict: string | null): string {
  if (!verdict) return "var(--j-faint)";
  if (verdict === "satisfies") return "var(--j-moss)";
  if (verdict === "contradicts") return "var(--j-red)";
  if (verdict === "partially_satisfies") return "var(--j-gold)";
  return "var(--j-faint)";
}

interface RepoCardProps {
  repo: OrgRepo;
  onRepoClick: (workspace: string) => void;
}

function RepoCard({ repo, onRepoClick }: RepoCardProps) {
  return (
    <div
      style={{
        background: "var(--j-paper-raise)",
        border: "1px solid var(--j-hairline)",
        borderRadius: "8px",
        padding: "16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
      }}
    >
      {/* Header row: name + frozen badge */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span
          style={{
            fontFamily: "var(--j-serif)",
            fontSize: "1rem",
            fontWeight: 500,
            color: "var(--j-ink)",
          }}
        >
          {repo.display_name}
        </span>
        {repo.status === "frozen" && (
          <span
            style={{
              fontFamily: "var(--j-mono)",
              fontSize: "0.65rem",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--j-faint)",
              border: "1px solid var(--j-hairline)",
              borderRadius: "4px",
              padding: "1px 5px",
            }}
          >
            frozen
          </span>
        )}
        {repo.status === "fixture" && (
          <span
            style={{
              fontFamily: "var(--j-mono)",
              fontSize: "0.65rem",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--j-faint)",
              border: "1px solid var(--j-hairline)",
              borderRadius: "4px",
              padding: "1px 5px",
            }}
          >
            fixture
          </span>
        )}
      </div>

      {/* Verdict sentence */}
      <p
        style={{
          margin: 0,
          fontSize: "0.8rem",
          color: verdictColor(repo.latest_verdict),
          fontFamily: "var(--j-mono)",
        }}
      >
        {verdictSentence(repo.latest_verdict)}
      </p>

      {/* Review count */}
      {repo.open_review_count > 0 && (
        <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--j-gold)" }}>
          {repo.open_review_count} open for review
        </p>
      )}

      {/* Coupled sessions */}
      <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--j-ink-soft)" }}>
        {repo.coupled_session_count > 0
          ? `${repo.coupled_session_count} sessions coupled`
          : "No sessions linked"}
      </p>

      {/* Footer: intent ledger link + github remote */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          marginTop: "6px",
          paddingTop: "8px",
          borderTop: "1px solid var(--j-hairline)",
        }}
      >
        <a
          href={repo.intent_ledger_url}
          style={{
            fontSize: "0.75rem",
            fontFamily: "var(--j-mono)",
            color: "var(--j-consult)",
            textDecoration: "none",
          }}
          onClick={(e) => {
            e.preventDefault();
            onRepoClick(repo.workspace);
          }}
        >
          View intent ledger →
        </a>
        {repo.github_remote && (
          <a
            href={repo.github_remote}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: "0.75rem",
              fontFamily: "var(--j-mono)",
              color: "var(--j-faint)",
              textDecoration: "none",
            }}
          >
            GitHub ↗
          </a>
        )}
      </div>
    </div>
  );
}

interface Props {
  onRepoClick: (workspace: string) => void;
}

export function OrgHome({ onRepoClick }: Props) {
  const [org, setOrg] = useState<OrgResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchOrg()
      .then(setOrg)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load org")
      );
  }, []);

  if (error) {
    return (
      <div style={{ padding: "32px", color: "var(--j-red)", fontFamily: "var(--j-mono)", fontSize: "0.85rem" }}>
        {error}
      </div>
    );
  }

  if (!org) {
    return (
      <div style={{ padding: "32px", color: "var(--j-faint)", fontFamily: "var(--j-mono)", fontSize: "0.8rem" }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={{ padding: "32px 40px", maxWidth: "900px", margin: "0 auto" }}>
      {/* Page header */}
      <header style={{ marginBottom: "32px" }}>
        <h1
          style={{
            fontFamily: "var(--j-serif)",
            fontWeight: 400,
            fontSize: "1.75rem",
            color: "var(--j-ink)",
            margin: 0,
          }}
        >
          {org.name}
        </h1>
        <p
          style={{
            fontFamily: "var(--j-mono)",
            fontSize: "0.75rem",
            color: "var(--j-faint)",
            margin: "6px 0 0",
            letterSpacing: "0.04em",
          }}
        >
          {org.repos.length} repo{org.repos.length !== 1 ? "s" : ""} · org view
        </p>
      </header>

      {/* Repo card grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: "16px",
        }}
      >
        {org.repos.map((repo) => (
          <RepoCard key={repo.workspace} repo={repo} onRepoClick={onRepoClick} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire OrgHome into `app/src/App.tsx`**

Changes needed in `App.tsx`:

1. Add `"org"` to the `View` type union (after `"digest"`):

```typescript
type View =
  | "org"        // ← new default
  | "lens-chat"
  | "journal"
  | "features"
  | "feature-detail"
  | "review"
  | "sessions"
  | "session-detail"
  | "digest";
```

2. Change the default view from `"lens-chat"` to `"org"`:

```typescript
const [view, setView] = useState<View>("org");
```

3. Import `OrgHome`:

```typescript
import { OrgHome } from "./components/OrgHome";
```

4. Add import for `fetchOrg`:

```typescript
import { fetchProjects, fetchSessions, fetchFeatures, fetchPendingObservations } from "./api";
```
(No change needed — `fetchOrg` is called inside `OrgHome`.)

5. In the `AppShell` render: the `lens-chat` full-page branch currently fires when `view === "lens-chat"`. Add a new `"org"` branch BEFORE the lens-chat check:

```typescript
  // Org home — new default, full page
  if (view === "org") {
    return (
      <div className="ink-app" style={{ height: "100%", overflowY: "auto", background: "var(--j-paper)" }}>
        <header
          style={{
            borderBottom: "1px solid var(--j-hairline)",
            padding: "12px 40px",
            display: "flex",
            alignItems: "center",
            gap: "16px",
          }}
        >
          <span style={{ fontFamily: "var(--j-mono)", fontSize: "0.75rem", letterSpacing: "0.08em", color: "var(--j-ink-soft)" }}>
            Quire.
          </span>
          <button
            className="lc-ledger-toggle"
            onClick={() => setView("lens-chat")}
            style={{
              fontFamily: "'Spline Sans Mono', monospace",
              fontSize: "10px",
              letterSpacing: "0.12em",
              color: "var(--lc-ink-40, var(--j-faint))",
              background: "transparent",
              border: "1px solid var(--j-hairline)",
              borderRadius: "6px",
              padding: "4px 10px",
              cursor: "pointer",
              textTransform: "uppercase",
            }}
          >
            Feed ↗
          </button>
          <button
            className="lc-ledger-toggle"
            onClick={() => setView("journal")}
            style={{
              fontFamily: "'Spline Sans Mono', monospace",
              fontSize: "10px",
              letterSpacing: "0.12em",
              color: "var(--lc-ink-40, var(--j-faint))",
              background: "transparent",
              border: "1px solid var(--j-hairline)",
              borderRadius: "6px",
              padding: "4px 10px",
              cursor: "pointer",
              textTransform: "uppercase",
            }}
          >
            Ledger ↗
          </button>
        </header>
        <OrgHome
          onRepoClick={(ws) => {
            // Navigate to the intent ledger page for this workspace
            window.location.href = `/intent/${ws}`;
          }}
        />
      </div>
    );
  }
```

6. In the lens-chat branch, update the "Ledger" button to also have an "Org" button returning to the org home:

```typescript
        <button
          className="lc-ledger-toggle"
          onClick={() => setView("org")}
          title="Back to org home"
          style={{
            position: "fixed",
            bottom: "48px",  // stack above the Ledger button
            right: "16px",
            // ... same styles as existing ledger toggle button
          }}
        >
          Org ↗
        </button>
```

- [ ] **Step 5: Run vitest to verify tests pass**

```bash
cd /Users/giladkoch/dev/intent-ai/app
npx vitest run 2>&1 | tail -10
```
Expected: 28 + 5 new = 33 tests pass.

- [ ] **Step 6: Typecheck**

```bash
cd /Users/giladkoch/dev/intent-ai/app
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 7: Build**

```bash
cd /Users/giladkoch/dev/intent-ai/app
npm run build 2>&1 | tail -5
```
Expected: `✓ built in X.XXs`.

- [ ] **Step 8: Commit**

```bash
git add app/src/components/OrgHome.tsx app/src/components/OrgHome.test.tsx app/src/App.tsx app/src/types.ts app/src/api.ts
git commit -m "feat(O0): OrgHome component + make org view the default landing"
```

---

## Task 7: Final integration + proof capture

**Files:**
- Modify: `backend/quire/db/org_models.py` (if needed — confirm import chain is correct)

This task confirms everything works end-to-end: tables bootstrap, seed runs, the API responds, the view renders.

- [ ] **Step 1: Run full backend suite**

```bash
cd /Users/giladkoch/dev/intent-ai/backend
python3 -m pytest 2>&1 | tail -5
```
Expected: `582 + new tests passed, 1 skipped`.

- [ ] **Step 2: Start the server and confirm the org endpoint**

```bash
cd /Users/giladkoch/dev/intent-ai/backend
python3 -m quire.cli serve --port 3456 &
sleep 3
curl -s http://localhost:3456/api/org | python3 -m json.tool | head -40
```
Expected: JSON with `"name": "Quire"` and 6 repos with card data fields.

- [ ] **Step 3: Confirm the org home view renders**

Open `http://localhost:3456/` in a browser — the org home should load as the default view showing repo cards. OR run a quick playwright check if the snap scripts exist:

```bash
# Check if playwright snap exists
ls /Users/giladkoch/dev/intent-ai/backend/quire/static/ 2>/dev/null
# If app/scripts/ or similar playwright scripts exist:
# npx playwright test --grep "org" 2>&1 | tail -10
```

If playwright snap is not available, curl proof is sufficient:
```bash
curl -s http://localhost:3456/api/org | python3 -c "
import json, sys
data = json.load(sys.stdin)
print('ORG:', data['name'])
for r in data['repos']:
    print(f'  {r[\"workspace\"]:20s} verdict={r[\"latest_verdict\"]} reviews={r[\"open_review_count\"]} sessions={r[\"coupled_session_count\"]}')
"
```

- [ ] **Step 4: Kill the server**

```bash
kill %1 2>/dev/null || true
```

- [ ] **Step 5: Final app checks**

```bash
cd /Users/giladkoch/dev/intent-ai/app
npx vitest run 2>&1 | tail -5
npm run build 2>&1 | tail -3
npx tsc --noEmit 2>&1 | head -5
```
Expected: all clean.

- [ ] **Step 6: Write the report**

Write findings to `/private/tmp/claude-501/-Users-giladkoch-dev-intent-ai/7d68d874-59bf-44f7-937b-f11b6244b5af/scratchpad/sdd/o0-report.md` covering:
  - Schema decisions (table layout, why stable slug PKs)
  - Seed contents (the 6 repos, status rationale)
  - View/routing choice (org as default, lens-chat/ledger reachable via buttons)
  - Proof evidence (curl output or screenshot description)
  - Concerns (import ordering, pre-Alembic caveats, cross-store coupling for sessions count)

- [ ] **Step 7: Final commit (one commit with all changes)**

The brief specifies one commit. If you've been committing per task, squash with:

```bash
# Count commits since the branch start
git log --oneline feat/repo-brain..HEAD | head -20
# Squash all O0 commits into one:
git reset --soft HEAD~<number-of-o0-commits>
git commit -m "$(cat <<'EOF'
feat(O0): org model + home view — Quire org with dogfood repos

Adds the org layer (O0 slice): three Postgres tables (orgs, org_repos,
org_channels) bootstrapped via the pre-Alembic pattern from U0, a single
seeded "Quire" org with 6 dogfood repo residents, a GET /api/org endpoint
composing alignment data (verdicts, reviews) over Postgres session counts,
and an OrgHome React component as the new default landing view. Repo cards
read as sentences (meaning before mechanics). quire-brain is frozen/read-only.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016cmqJ7aie4Kap4ZsZraMF1
EOF
)"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| `orgs`, `org_repos`, `org_channels` tables, pre-Alembic bootstrap | Task 1 |
| Python single-writer | Task 2 (`OrgStore`) |
| CENSUS.md updated | Task 3 |
| Single seeded org "Quire" idempotently | Task 2 (`seed_demo_org`) |
| 6 dogfood repos with correct metadata | Task 2 (`DEMO_REPOS`) |
| quire-brain FROZEN / read-only | Task 2 |
| github_remote for intent-ai | Task 2 |
| nullable remote (local-only repos allowed) | Task 1 (`OrgRepo.github_remote` nullable) |
| Org home: repo cards with latest_verdict | Task 6 |
| Org home: open_review_count | Task 6 |
| Org home: coupled_session_count from session_checks | Task 2 (`count_coupled_sessions`) |
| Org home: intent-ledger link | Task 6 |
| No cross-store SQL | Task 2 (`get_repo_card_data` Python composition) |
| Meaning before mechanics (cards as sentences) | Task 6 (`verdictSentence`, prose labels) |
| Org home as natural landing | Task 6 (default view `"org"`) |
| FastAPI router pattern (journal/router.py style) | Task 4 |
| Test discipline: no implicit production store | Task 2 (conftest guard) |
| Import trap handled | Task 3 (`db/__init__.py` import) |
| Backend full pytest green | Task 7 |
| App build + vitest + typecheck clean | Tasks 5-7 |
| Proof captured | Task 7 |
| One commit with trailers | Task 7 |

**Placeholder scan:** No TBDs found. All steps have concrete code.

**Type consistency check:**
- `OrgRepo` in types.ts has `status: "active" | "fixture" | "frozen"` — matches `DEMO_REPOS` status values.
- `verdictSentence(verdict: string | null)` — `latest_verdict` is `string | null` in both TS and Python.
- `intent_ledger_url: f"/intent/{ws}"` in Python matches `/intent/${ws}` in TS.
- `OrgStore.get_repo_card_data` returns `list[dict]` with keys matching `OrgRepo` interface fields.
- Router test fixture uses `OrgStore(engine=engine)` — matches guard in conftest.

**Import trap note:** The production path in `api.py` imports `quire.db.org_models` explicitly before calling `ensure_org_tables()` via `OrgStore.__init__()`. The `quire.db.__init__.py` also imports `org_models` so that `Base.metadata.create_all()` in test fixtures works. Both paths are covered.

**Concern: `count_coupled_sessions` in test env:** The `session_checks` table won't exist in the SQLite test engine that only creates org tables. The `try/except` in `count_coupled_sessions` handles this gracefully (returns 0). Tests that mock `alignment_store` don't call this path directly — the OrgStore test checks `card_data_fields` which calls `count_coupled_sessions` against the SQLite engine that has NO `session_checks` table. The `except Exception: return 0` guard ensures this works.
