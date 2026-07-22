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

    repository: the alignment store's repository key when it differs from the
      workspace name; None means workspace name is the key. For example,
      "refund-agent" workspace stores analyses under "company/refund-agent".
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
    repository: str | None = Column(Text, nullable=True, default=None)  # alignment store key


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

    # Pre-Alembic patch-forward: org_repos tables created earlier the same day
    # (before this column was added) won't have `repository`. Add it idempotently.
    # Both SQLite and Postgres accept this exact ALTER TABLE syntax.
    # Retired when Alembic is adopted (the migration will handle it instead).
    from sqlalchemy import text
    from sqlalchemy.exc import OperationalError, ProgrammingError
    try:
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE org_repos ADD COLUMN repository TEXT"))
            conn.commit()
    except (OperationalError, ProgrammingError):
        # Column already exists — that's fine, skip.
        pass
