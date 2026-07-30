"""SQLAlchemy foundation over the journal's Postgres.

LIVE tables (per CENSUS.md) are modelled in models.py.
Drizzle owns all schema migrations for the inherited schema; this package
never modifies the inherited schema.

Write access (Slice 4+): quire.db.writer owns INSERT/DELETE for the
ingestion tables: sessions, raw_events, normalized_events, chunks, sittings.
All other inherited tables remain read-only from the Python side.

New tables (post-Drizzle freeze, U0+): quire.links owns session_checks.
Bootstrap via ensure_table_exists(); Alembic will formalize these later.
"""

# Post-freeze additions: new tables added after the Drizzle freeze (U0+).
# Import order matters: modules must be imported before ensure_*_tables() runs.
# quire.links registers session_checks; quire.db.org_models registers org tables.
# Both are imported lazily by their respective store classes at construction time,
# but explicit imports here ensure they are available to Base.metadata.create_all()
# in test fixtures that call it directly.
from quire.db import org_models as _org_models  # noqa: F401 — registers tables
from quire.db import task_models as _task_models  # noqa: F401 — registers tasks + task_links (O4.5)
