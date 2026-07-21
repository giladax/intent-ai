"""SQLAlchemy read-only foundation over the journal's Postgres.

Only LIVE tables (per CENSUS.md) are modelled. Drizzle owns migrations;
this package never writes schema.
"""
