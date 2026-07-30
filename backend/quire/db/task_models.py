"""Task nodes + task_links edges — the handoff's graph citizens (O4.5).

Edges-carry-coupling conformant from birth (decision record
docs/decisions/2026-07-23-edges-carry-coupling.md):

- ``tasks`` is a NODE table: identity + content only. A task knows its own
  statement, department, status, and honest closure tier — never its
  neighbors. ``grounding_note`` is content (an honest statement about
  absence: "nothing covers this — new module"), not a relation.
- ``task_links`` is the EDGE table: every coupling a task has — the promise
  it serves, the feature/file it builds on, the check that closed it — is a
  separate evidenced row with provenance. Endpoint references are plain
  strings (obligation ids, feature ids, file paths, analysis ids) because
  endpoints live in different stores (yaml contracts, journal Postgres,
  alignment SQLite); the edge is the single place the coupling exists.

Departments are FIXED SCHEMA (ruling L, 2026-07-23): dev / qa / product /
bi. Org-level renames come later; never a free ontology.

Closure tiers are HONEST (ruling N): ``check_evidence`` (dev — closes on a
real check verdict), ``test_inspection`` (qa — partial), ``manual_note``
(product/bi — closes manually with a note, labeled "evidence detection
coming"). We never fake a closure signal we don't have.

Pre-Alembic bootstrap pattern (see backend/README.md "Schema changes").
"""

from __future__ import annotations

from sqlalchemy import Column, DateTime, Float, String, Text, UniqueConstraint

from quire.db.models import Base

DEPARTMENTS = ("dev", "qa", "product", "bi")

# Honest closure tier per department (ruling N).
CLOSURE_TIERS = {
    "dev": "check_evidence",
    "qa": "test_inspection",
    "product": "manual_note",
    "bi": "manual_note",
}

TASK_STATUSES = ("proposed", "open", "rejected", "closed")

# Edge kinds. Every kind's evidence field carries the receipt:
#   serves_promise    → the promise's verbatim provenance quote
#   builds_on_feature → why/how it builds on the feature ("extends X — files exist")
#   touches_file      → the resolved real path
#   closure_candidate → the analysis id + relation that MAY close the task
#   closed_by_check   → the analysis id + relation that DID close the task
LINK_KINDS = (
    "serves_promise",
    "builds_on_feature",
    "touches_file",
    "closure_candidate",
    "closed_by_check",
)


class Task(Base):
    """One unit of work, born from signed intent. Node: identity + content."""

    __tablename__ = "tasks"

    id: str = Column(String, primary_key=True)
    workspace: str = Column(Text, nullable=False, index=True)
    handoff_id: str = Column(Text, nullable=False, index=True)  # batch grouper string (no handoffs table, not a FK) — node stays relation-free
    department: str = Column(Text, nullable=False)
    statement: str = Column(Text, nullable=False)
    # Plain-language WHY (content — the receipts live on edges).
    why: str = Column(Text, nullable=False, default="")
    # Honest absence note when nothing in the org covers this task.
    grounding_note: str = Column(Text, nullable=False, default="")
    status: str = Column(Text, nullable=False, default="proposed", index=True)
    closure_tier: str = Column(Text, nullable=False)
    closure_note: str = Column(Text, nullable=False, default="")
    signed_by: str | None = Column(Text, nullable=True)
    signed_at = Column(DateTime(timezone=True), nullable=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False)


class TaskLink(Base):
    """One evidenced coupling between a task and another entity."""

    __tablename__ = "task_links"
    __table_args__ = (
        UniqueConstraint("task_id", "kind", "target_ref", name="uq_task_link"),
    )

    id: str = Column(String, primary_key=True)
    task_id: str = Column(Text, nullable=False, index=True)
    kind: str = Column(Text, nullable=False)
    # What the edge points at: an obligation id, a feature id, a file path,
    # or an analysis id — a plain string because endpoints span stores.
    target_ref: str = Column(Text, nullable=False)
    # Human-readable label for the target (feature name, promise fragment)
    # so surfaces can render sentences without cross-store joins.
    target_label: str = Column(Text, nullable=False, default="")
    evidence: str = Column(Text, nullable=False)
    confidence: float = Column(Float, nullable=False, default=1.0)
    created_at = Column(DateTime(timezone=True), nullable=False)


def ensure_task_tables(engine) -> None:
    """CREATE TABLE IF NOT EXISTS tasks, task_links.

    Pre-Alembic bootstrap helper — idempotent; retired when Alembic lands.
    """
    Base.metadata.tables["tasks"].create(engine, checkfirst=True)
    Base.metadata.tables["task_links"].create(engine, checkfirst=True)
