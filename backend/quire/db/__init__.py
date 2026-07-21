"""SQLAlchemy foundation over the journal's Postgres.

LIVE tables (per CENSUS.md) are modelled in models.py.
Drizzle owns all schema migrations; this package never modifies schema.

Write access (Slice 4+): quire.db.writer owns INSERT/DELETE for the
ingestion tables: sessions, raw_events, normalized_events, chunks, sittings.
All other tables remain read-only from the Python side.
"""
