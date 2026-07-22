"""quire.links — session↔check link table and trailer parser (U0).

The coupling is DATA: a deterministic link layer that makes the relationship
between a coding session and the code it produced first-class, queryable, and
Postgres-backed. This is the substrate on which U1–U5 build.

## Design decisions (all ruled 2026-07-21 by founder):

- kind="trailer": commit-message trailers (Claude-Session:), evidence = the
  commit SHA that carried the trailer, confidence=1.0.
- kind="attached": explicit human attaches — yaml pr: field and CLI --pr flag.
  Evidence = a string identifying the attach act, e.g. "sessions.yaml:<session_id>".
  Confidence=1.0. Authority equivalent to trailers (U0+).
- kind="inferred": proposals only (U1+), never granted authority.
  Similarity never makes a link authoritative.
- sessions.yaml pr: field is read/written through this API so yaml remains
  consumable by existing alignment code; Postgres is the source of truth.

## Schema bootstrapping:

session_checks is a NEW table — the first schema addition after the Drizzle
schema freeze at git tag ts-backend-final. Per the project's decision (CENSUS.md,
"Drizzle/schema ownership Slice 9"), any schema change starts by adopting Alembic.

Pragmatic resolution for U0 (pre-Alembic bootstrap):
    `ensure_table_exists(engine)` runs `CREATE TABLE IF NOT EXISTS` idempotently.
    This function is a one-time bootstrap helper; Alembic adoption (tracked in
    backend/README.md) will formalize it as migration 001_session_checks.py.

DO NOT add this table to the frozen Drizzle schema docs. Record in CENSUS.md
with Python (quire.links) as the sole writer.
"""
from __future__ import annotations

import re
import subprocess
import uuid
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import (
    Column,
    Float,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Session as SASession

from quire.db.models import Base

# ---------------------------------------------------------------------------
# SQLAlchemy model
# ---------------------------------------------------------------------------

_KIND = Literal["trailer", "attached", "inferred"]


class SessionCheck(Base):
    """Postgres/SQLite row: one session↔check coupling edge.

    Unique on (session_id, workspace, evidence) so that re-ingesting the same
    commit range is idempotent — the same (session, commit) pair may not be
    inserted twice.
    """

    __tablename__ = "session_checks"
    __table_args__ = (
        UniqueConstraint("session_id", "workspace", "evidence", name="uq_session_check_evidence"),
    )

    id: str = Column(String, primary_key=True)
    session_id: str = Column(Text, nullable=False, index=True)
    workspace: str = Column(Text, nullable=False, index=True)
    pr_number: int | None = Column(Integer, nullable=True, index=True)
    base_sha: str = Column(Text, nullable=False)
    head_sha: str = Column(Text, nullable=False)
    kind: str = Column(Text, nullable=False, default="trailer")
    confidence: float = Column(Float, nullable=False, default=1.0)
    evidence: str = Column(Text, nullable=False)


# ---------------------------------------------------------------------------
# Domain value object
# ---------------------------------------------------------------------------

@dataclass
class SessionCheckLink:
    """Immutable value object: one session↔check coupling edge.

    Three kinds (all ruled 2026-07-21 by founder):

    - "trailer"  — commit-message Claude-Session: trailer. Evidence = the
                   full 40-char commit SHA that carried the trailer.
                   Confidence = 1.0. Authority: U0+.

    - "attached" — explicit human attach via yaml pr: field or CLI --pr flag.
                   Evidence = a string identifying the attach act, e.g.
                   "sessions.yaml:<session_id>". Confidence = 1.0.
                   Authority: U0+.

    - "inferred" — similarity-based proposals only (U1+). Never granted
                   authority; proposals only, never source of truth.
    """

    session_id: str
    workspace: str
    base_sha: str
    head_sha: str
    kind: _KIND
    confidence: float
    evidence: str
    pr_number: int | None = None

    def __post_init__(self) -> None:
        if self.kind not in ("trailer", "attached", "inferred"):
            raise ValueError(f"Invalid kind: {self.kind!r}")
        if not (0.0 <= self.confidence <= 1.0):
            raise ValueError(f"confidence must be in [0, 1]: {self.confidence}")


# ---------------------------------------------------------------------------
# Trailer parser
# ---------------------------------------------------------------------------

# Structural regex — sanctioned (trailer syntax is structural, not semantic).
# Matches: Claude-Session: https://claude.ai/code/session_<id>
# where <id> is one or more alphanumeric characters (URL-safe).
_TRAILER_RE = re.compile(
    r"^Claude-Session: https://claude\.ai/code/session_([A-Za-z0-9]+)\s*$",
    re.MULTILINE,
)

# Sentinel line that git log emits at the start of each commit block when
# using --format=---QUIRE-COMMIT---%n%H%n%B.  The sentinel is unique enough
# that a commit body line starting with "commit <hex>" can't misalign parsing.
_SENTINEL = "---QUIRE-COMMIT---"
_SENTINEL_RE = re.compile(rf"^{re.escape(_SENTINEL)}\n", re.MULTILINE)


def parse_trailers(git_log_text: str) -> list[tuple[str, str]]:
    """Extract (commit_sha, session_id) pairs from `git log` text.

    The git log text must be produced with
    ``--format=---QUIRE-COMMIT---%n%H%n%B`` so that each commit block starts
    with the sentinel line ``---QUIRE-COMMIT---`` followed by the full SHA on
    the next line, then the raw commit body.  The sentinel is unique enough
    that a body line starting with "commit <hex>" (e.g. in a revert message)
    cannot misalign block parsing.

    Only ``Claude-Session: https://claude.ai/code/session_<id>`` trailers are
    extracted. Any other format is silently ignored.

    Returns a list of (full_sha, session_id) tuples, one per trailer line.
    """
    result: list[tuple[str, str]] = []
    # Split on sentinel lines. Each block is: "<full_sha>\n<body>".
    blocks = _SENTINEL_RE.split(git_log_text)
    # blocks[0] is the empty string before the first sentinel (or junk); skip it.
    for block in blocks[1:]:
        # First line of each block is the full SHA; the rest is the body.
        first_nl = block.find("\n")
        if first_nl == -1:
            continue
        sha = block[:first_nl].strip()
        body = block[first_nl + 1:]
        for m in _TRAILER_RE.finditer(body):
            result.append((sha, m.group(1)))
    return result


# ---------------------------------------------------------------------------
# extract_trailer_links — run git log over a range and produce links
# ---------------------------------------------------------------------------

def extract_trailer_links(
    *,
    base_sha: str,
    head_sha: str,
    git_dir: str,
    workspace: str = "",
    pr_number: int | None = None,
) -> list[SessionCheckLink]:
    """Run `git log base..head` and extract SessionCheckLink objects.

    Each `Claude-Session:` trailer in the range produces one link with:
    - kind="trailer", confidence=1.0
    - evidence = the full 40-char commit SHA that carried the trailer

    Args:
        base_sha: Exclusive lower bound (not included in log, git log semantics).
        head_sha: Inclusive upper bound.
        git_dir: Path to the git repository (passed to git -C).
        workspace: Optional workspace label stored on the link.
        pr_number: Optional PR number; None when the range has no associated PR.

    Returns an empty list when base_sha == head_sha or the range is empty.
    """
    if base_sha == head_sha:
        return []

    # Use a unique sentinel header so that body lines beginning with "commit
    # <hex>" (e.g. revert messages) cannot misalign block parsing.
    # Format: ---QUIRE-COMMIT---\n<full SHA>\n<raw body incl. trailers>
    result = subprocess.run(
        [
            "git", "-C", git_dir,
            "log",
            f"{base_sha}..{head_sha}",
            "--format=---QUIRE-COMMIT---%n%H%n%B",
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"git log failed: {result.stderr.strip()}"
        )

    log_text = result.stdout
    if not log_text.strip():
        return []

    pairs = parse_trailers(log_text)
    links: list[SessionCheckLink] = []
    for full_sha, session_id in pairs:
        links.append(SessionCheckLink(
            session_id=session_id,
            workspace=workspace,
            pr_number=pr_number,
            base_sha=base_sha,
            head_sha=head_sha,
            kind="trailer",
            confidence=1.0,
            evidence=full_sha,
        ))
    return links


# ---------------------------------------------------------------------------
# LinkStore — the single writer for session_checks
# ---------------------------------------------------------------------------

class LinkStore:
    """Single writer for the session_checks table.

    Accepts an optional SQLAlchemy engine; if omitted, uses the shared
    production engine (get_engine()). Pass a test engine in unit tests.
    """

    def __init__(self, engine=None) -> None:
        if engine is None:
            from quire.db.engine import get_engine
            engine = get_engine()
        self._engine = engine
        # Ensure the table exists (pre-Alembic bootstrap; idempotent).
        ensure_table_exists(self._engine)

    def upsert(self, link: SessionCheckLink) -> None:
        """Insert a link, or do nothing if the same (session_id, workspace,
        evidence) triple already exists (idempotent)."""
        with SASession(self._engine) as s:
            _upsert_one(s, link)
            s.commit()

    def upsert_many(self, links: list[SessionCheckLink]) -> None:
        """Insert multiple links in one transaction; duplicates are skipped."""
        with SASession(self._engine) as s:
            for link in links:
                _upsert_one(s, link)
            s.commit()

    def links_for_check(
        self, workspace: str, pr_number: int | None
    ) -> list[SessionCheckLink]:
        """Return all links for a given workspace + pr_number."""
        from sqlalchemy import select

        with SASession(self._engine) as s:
            stmt = select(SessionCheck).where(
                SessionCheck.workspace == workspace,
                SessionCheck.pr_number == pr_number,
            )
            rows = s.execute(stmt).scalars().all()
        return [_row_to_link(r) for r in rows]

    def links_for_session(self, session_id: str) -> list[SessionCheckLink]:
        """Return all links for a given session_id."""
        from sqlalchemy import select

        with SASession(self._engine) as s:
            stmt = select(SessionCheck).where(
                SessionCheck.session_id == session_id
            )
            rows = s.execute(stmt).scalars().all()
        return [_row_to_link(r) for r in rows]


def _upsert_one(s: SASession, link: SessionCheckLink) -> None:
    """INSERT OR IGNORE (SQLite) / INSERT … ON CONFLICT DO NOTHING (Postgres)."""
    dialect = s.get_bind().dialect.name
    if dialect == "postgresql":
        from sqlalchemy import text

        s.execute(
            text(
                "INSERT INTO session_checks "
                "(id, session_id, workspace, pr_number, base_sha, head_sha, "
                " kind, confidence, evidence) "
                "VALUES (:id, :session_id, :workspace, :pr_number, :base_sha, "
                "        :head_sha, :kind, :confidence, :evidence) "
                "ON CONFLICT (session_id, workspace, evidence) DO NOTHING"
            ),
            {
                "id": str(uuid.uuid4()),
                "session_id": link.session_id,
                "workspace": link.workspace,
                "pr_number": link.pr_number,
                "base_sha": link.base_sha,
                "head_sha": link.head_sha,
                "kind": link.kind,
                "confidence": link.confidence,
                "evidence": link.evidence,
            },
        )
    else:
        # SQLite: INSERT OR IGNORE honours the unique constraint
        from sqlalchemy import text

        s.execute(
            text(
                "INSERT OR IGNORE INTO session_checks "
                "(id, session_id, workspace, pr_number, base_sha, head_sha, "
                " kind, confidence, evidence) "
                "VALUES (:id, :session_id, :workspace, :pr_number, :base_sha, "
                "        :head_sha, :kind, :confidence, :evidence)"
            ),
            {
                "id": str(uuid.uuid4()),
                "session_id": link.session_id,
                "workspace": link.workspace,
                "pr_number": link.pr_number,
                "base_sha": link.base_sha,
                "head_sha": link.head_sha,
                "kind": link.kind,
                "confidence": link.confidence,
                "evidence": link.evidence,
            },
        )


def _row_to_link(row: SessionCheck) -> SessionCheckLink:
    return SessionCheckLink(
        session_id=row.session_id,
        workspace=row.workspace,
        pr_number=row.pr_number,
        base_sha=row.base_sha,
        head_sha=row.head_sha,
        kind=row.kind,  # type: ignore[arg-type]
        confidence=row.confidence,
        evidence=row.evidence,
    )


# ---------------------------------------------------------------------------
# sessions.yaml projection helper
# ---------------------------------------------------------------------------

def upsert_from_yaml_record(
    record: dict,
    link_store: LinkStore | None = None,
) -> None:
    """Project a sessions.yaml record into the link table.

    Called whenever a session record with a `pr:` field is loaded from yaml
    (e.g. via `digest_session` with --pr, or yaml replay). This keeps the
    yaml consumable by existing alignment code while making Postgres the source
    of truth for link data.

    A record without a truthy `pr:` (None, missing, or 0 — real PR numbers
    are >= 1) produces no link and constructs no store — there is nothing to
    couple to yet. digest_session gates on the same truthiness check.

    The link is created with:
    - kind="attached"  — yaml/CLI-sourced pr: coupling is an explicit human
                         attach (the human passed --pr or wrote pr: in yaml),
                         not a commit-message trailer.
    - confidence=1.0
    - evidence = "sessions.yaml:<session_id>" — greppable string that
                 identifies the attach act (the yaml record is the provenance).
    - base_sha / head_sha = the record's values if present, else empty strings.
    """
    pr = record.get("pr")
    if not pr:
        return

    if link_store is None:
        link_store = LinkStore()

    session_id = record["session_id"]
    link_store.upsert(SessionCheckLink(
        session_id=session_id,
        workspace=record.get("workspace", ""),
        pr_number=int(pr),
        base_sha=record.get("base_sha") or "",
        head_sha=record.get("head_sha") or "",
        kind="attached",
        confidence=1.0,
        # Greppable provenance string: identifies the attach act.
        evidence=f"sessions.yaml:{session_id}",
    ))


# ---------------------------------------------------------------------------
# Schema bootstrap (pre-Alembic; idempotent)
# ---------------------------------------------------------------------------

def ensure_table_exists(engine) -> None:
    """CREATE TABLE IF NOT EXISTS session_checks.

    Pre-Alembic bootstrap helper — safe to call multiple times. Once Alembic
    is adopted (see backend/README.md "Schema changes"), this becomes migration
    001_session_checks.py and this function is retired.
    """
    Base.metadata.tables["session_checks"].create(engine, checkfirst=True)
