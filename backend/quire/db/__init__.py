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
