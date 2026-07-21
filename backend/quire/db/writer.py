"""quire.db.writer — Python writer for journal ingestion tables (Slice 4).

Single-writer rule: from this slice, Python owns writes to:
    raw_events, normalized_events, chunks, sittings, sessions

TS storeSessionDigest is demoted (CLI + scheduled digest print a deprecation
pointer and exit without writing).

Design notes:
- All five tables are written inside one transaction; failure rolls back the
  entire digest so the DB is never left in a partial state.
- Idempotency: re-digesting the same source_hash replaces all deterministic
  rows atomically (DELETE + INSERT in one transaction, matching TS orchestrator
  semantics for the --force path).
- raw_events: TS historically passed raw events in-memory only (the INSERT path
  was commented out). Python SHOULD write them — the table exists, the dashboard
  drill view LEFT JOINs it, and writing makes the join real. This is an
  intentional improvement over the TS implementation.
- sessions.session_shape / LLM-derived columns: left null/empty for the
  deterministic-only digest path. LLM fields arrive in Slice 5b/6.
- Raw SQL (text()) for inserts: Postgres stores UUIDs as native uuid type;
  SQLAlchemy's String-mapped columns need an explicit ::uuid cast. Using raw
  SQL with named params and ::uuid casts mirrors the TS queries.ts pattern
  exactly and avoids touching the read-only ORM model definitions.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session as SASession

from quire.db.engine import get_session
from quire.ingest.models import (
    NormalizedDevEvent,
    RawDevEvent,
    SessionChunk,
    Sitting as IngestSitting,
)


# ── Result type ───────────────────────────────────────────────────────────────


@dataclass
class StoreResult:
    stored: bool
    session_id: str


# ── Public API ────────────────────────────────────────────────────────────────


def store_session_digest(
    *,
    source_path: str,
    source_hash: str,
    raw_events: list[RawDevEvent],
    normalized_events: list[NormalizedDevEvent],
    chunks: list[SessionChunk],
    sittings: list[IngestSitting],
    started_at: Optional[datetime],
    ended_at: Optional[datetime],
    force: bool = False,
) -> StoreResult:
    """Write a deterministic-only session digest to the journal Postgres.

    Tables written (in dependency order):
        sessions → raw_events → normalized_events → chunks → sittings

    If a session with the same source_hash already exists:
    - Without force: return stored=False immediately (concurrent-safe).
    - With force: delete the existing session and all child rows, then
      re-insert from scratch, all in one transaction.

    LLM-derived columns (session_shape, narrative, moments, etc.) are NOT
    written here — they arrive in Slice 5b/6. The sessions row is written with
    nulls for those fields, which the dashboard handles gracefully (LEFT JOINs).
    """
    with get_session() as sa_session:
        existing_id = _find_by_source_hash(sa_session, source_hash)

        if existing_id and not force:
            return StoreResult(stored=False, session_id=existing_id)

        if existing_id and force:
            _delete_session(sa_session, existing_id)

        session_id = str(uuid.uuid4())
        _write_all(
            sa_session,
            session_id=session_id,
            source_path=source_path,
            source_hash=source_hash,
            raw_events=raw_events,
            normalized_events=normalized_events,
            chunks=chunks,
            sittings=sittings,
            started_at=started_at,
            ended_at=ended_at,
        )
        sa_session.commit()
        return StoreResult(stored=True, session_id=session_id)


# ── Internal helpers ──────────────────────────────────────────────────────────


def _find_by_source_hash(sa_session: SASession, source_hash: str) -> Optional[str]:
    """Return the existing session id for this source_hash, or None."""
    row = sa_session.execute(
        text("SELECT id FROM sessions WHERE source_hash = :h LIMIT 1"),
        {"h": source_hash},
    ).first()
    return str(row[0]) if row else None


def _delete_session(sa_session: SASession, session_id: str) -> None:
    """Delete a session and all its ingestion child rows.

    Deletion order respects FK constraints (innermost → outermost).
    Child tables use `session_id` FK; the sessions row itself uses `id`.

    Note: Postgres' ON DELETE CASCADE handles most of this in production, but we
    list child tables explicitly for SQLite test-engine compat (SQLite FK cascade
    requires PRAGMA foreign_keys=ON AND the FK DDL to carry ON DELETE CASCADE —
    the SQLAlchemy read-only model definitions omit that clause).
    LLM-side tables (moments, narratives, etc.) are included so --force
    works correctly even after a partial Slice 5b/6 write.
    """
    sid = {"sid": session_id}

    # Grandchild tables (FK → parent, not directly → sessions)
    # moment_evidence: FK moment_id → moments.id
    sa_session.execute(
        text("DELETE FROM moment_evidence WHERE moment_id IN "
             "(SELECT id FROM moments WHERE session_id = :sid)"), sid
    )
    # moment_relations: FK moment_id → moments.id
    sa_session.execute(
        text("DELETE FROM moment_relations WHERE moment_id IN "
             "(SELECT id FROM moments WHERE session_id = :sid)"), sid
    )
    # transition_moments: FK transition_id → transitions.id
    sa_session.execute(
        text("DELETE FROM transition_moments WHERE transition_id IN "
             "(SELECT id FROM transitions WHERE session_id = :sid)"), sid
    )
    # outcome_moments: FK outcome_id → outcomes.id
    sa_session.execute(
        text("DELETE FROM outcome_moments WHERE outcome_id IN "
             "(SELECT id FROM outcomes WHERE session_id = :sid)"), sid
    )
    # outcome_files: FK outcome_id → outcomes.id
    sa_session.execute(
        text("DELETE FROM outcome_files WHERE outcome_id IN "
             "(SELECT id FROM outcomes WHERE session_id = :sid)"), sid
    )
    # narrative_arcs: FK narrative_id → narratives.id
    sa_session.execute(
        text("DELETE FROM narrative_arcs WHERE narrative_id IN "
             "(SELECT id FROM narratives WHERE session_id = :sid)"), sid
    )

    # Direct children of sessions (session_id FK)
    for tbl in (
        "moments",
        "transitions",
        "outcomes",
        "narratives",
        "normalized_events",
        "sittings",
        "chunks",
        "raw_events",
        # activity_events has session_id as plain text (no FK) — still delete for hygiene
        "activity_events",
        # feature_sessions has FK to sessions without CASCADE — must delete before sessions
        "feature_sessions",
    ):
        sa_session.execute(text(f"DELETE FROM {tbl} WHERE session_id = :sid"), sid)

    # Finally, the session anchor row itself (id = session_id)
    sa_session.execute(
        text("DELETE FROM sessions WHERE id = :sid"), sid
    )


def _now_utc() -> datetime:
    return datetime.now(tz=timezone.utc)


def _write_all(
    sa_session: SASession,
    *,
    session_id: str,
    source_path: str,
    source_hash: str,
    raw_events: list[RawDevEvent],
    normalized_events: list[NormalizedDevEvent],
    chunks: list[SessionChunk],
    sittings: list[IngestSitting],
    started_at: Optional[datetime],
    ended_at: Optional[datetime],
) -> None:
    """Insert all ingestion rows for a single session.

    Uses raw SQL (text()) for portability. UUID columns receive Python
    uuid.UUID objects on Postgres (psycopg3 maps them natively) and string
    values on SQLite (test engines). The dialect is detected at call time.

    - Postgres: uuid.UUID → native uuid; list → array with explicit ::text[] cast;
      dict → explicit ::jsonb cast.
    - SQLite: all values as strings/primitives; no type casts in SQL.
    """
    # Detect dialect once (SQLAlchemy 2 canonical: get_bind() raises if unbound,
    # which is the correct failure — no silent default).
    dialect = sa_session.get_bind().dialect.name
    is_pg = dialect == "postgresql"

    now = _now_utc()

    def uid(s: str):
        """Return uuid.UUID for Postgres (psycopg3 native), str for SQLite."""
        return uuid.UUID(s) if is_pg else s

    def new_uid():
        u = uuid.uuid4()
        return u if is_pg else str(u)

    def arr(lst: Optional[list]) -> Optional[object]:
        """For SQLite, store arrays as JSON strings; Postgres gets native list."""
        if lst is None:
            return None
        if is_pg:
            return lst  # psycopg3 handles list → array with the ::text[] cast
        return json.dumps(lst)  # SQLite has no array type; JSON string

    # ── SQL templates (Postgres gets type casts; SQLite omits them) ──────────

    if is_pg:
        session_sql = text(
            "INSERT INTO sessions "
            "(id, source_type, source_path, source_hash, session_shape, "
            " started_at, ended_at, created_at) "
            "VALUES (:id, :source_type, :source_path, :source_hash, "
            "        :session_shape, :started_at, :ended_at, :created_at)"
        )
        raw_event_sql = text(
            "INSERT INTO raw_events (id, session_id, source, timestamp, type, raw) "
            "VALUES (:id, :session_id, :source, :timestamp, :type, CAST(:raw AS jsonb))"
        )
        norm_event_sql = text(
            "INSERT INTO normalized_events "
            "(id, session_id, raw_event_id, causal_order, category, "
            " actor, summary, detail, files_affected) "
            "VALUES (:id, :session_id, :raw_event_id, :causal_order, "
            "        :category, :actor, :summary, :detail, CAST(:files_affected AS text[]))"
        )
        chunk_sql = text(
            "INSERT INTO chunks "
            "(id, session_id, chunk_index, topic_hint, files_in_scope, "
            " event_range_start, event_range_end) "
            "VALUES (:id, :session_id, :chunk_index, :topic_hint, "
            "        CAST(:files_in_scope AS text[]), :event_range_start, :event_range_end)"
        )
        sitting_sql = text(
            "INSERT INTO sittings "
            "(id, session_id, sitting_index, started_at, ended_at, "
            " event_range_start, event_range_end) "
            "VALUES (:id, :session_id, :sitting_index, :started_at, :ended_at, "
            "        :event_range_start, :event_range_end)"
        )
    else:
        # SQLite: no type casts; arrays stored as JSON strings
        session_sql = text(
            "INSERT INTO sessions "
            "(id, source_type, source_path, source_hash, session_shape, "
            " started_at, ended_at, created_at) "
            "VALUES (:id, :source_type, :source_path, :source_hash, "
            "        :session_shape, :started_at, :ended_at, :created_at)"
        )
        raw_event_sql = text(
            "INSERT INTO raw_events (id, session_id, source, timestamp, type, raw) "
            "VALUES (:id, :session_id, :source, :timestamp, :type, :raw)"
        )
        norm_event_sql = text(
            "INSERT INTO normalized_events "
            "(id, session_id, raw_event_id, causal_order, category, "
            " actor, summary, detail, files_affected) "
            "VALUES (:id, :session_id, :raw_event_id, :causal_order, "
            "        :category, :actor, :summary, :detail, :files_affected)"
        )
        chunk_sql = text(
            "INSERT INTO chunks "
            "(id, session_id, chunk_index, topic_hint, files_in_scope, "
            " event_range_start, event_range_end) "
            "VALUES (:id, :session_id, :chunk_index, :topic_hint, "
            "        :files_in_scope, :event_range_start, :event_range_end)"
        )
        sitting_sql = text(
            "INSERT INTO sittings "
            "(id, session_id, sitting_index, started_at, ended_at, "
            " event_range_start, event_range_end) "
            "VALUES (:id, :session_id, :sitting_index, :started_at, :ended_at, "
            "        :event_range_start, :event_range_end)"
        )

    # ── 1. sessions ────────────────────────────────────────────────────────────

    sa_session.execute(
        session_sql,
        {
            "id": uid(session_id),
            "source_type": "claude-code",
            "source_path": source_path,
            "source_hash": source_hash,
            "session_shape": None,
            "started_at": started_at,
            "ended_at": ended_at,
            "created_at": now,
        },
    )
    sa_session.flush()

    # ── 2. raw_events ─────────────────────────────────────────────────────────
    # Intentional improvement over TS: TS passed raw events in-memory only
    # (the INSERT path was omitted). Python writes them so the dashboard
    # drill-view LEFT JOIN becomes a real join.

    raw_id_by_event_id: dict[str, object] = {}
    for rev in raw_events:
        raw_uuid = new_uid()
        raw_id_by_event_id[rev.id] = raw_uuid
        ts = _parse_iso(rev.timestamp)
        sa_session.execute(
            raw_event_sql,
            {
                "id": raw_uuid,
                "session_id": uid(session_id),
                "source": rev.source,
                "timestamp": ts,
                "type": rev.type,
                "raw": json.dumps(rev.raw),
            },
        )

    sa_session.flush()

    # ── 3. normalized_events ──────────────────────────────────────────────────

    for nev in normalized_events:
        raw_uuid = raw_id_by_event_id.get(nev.raw_event_id)
        sa_session.execute(
            norm_event_sql,
            {
                "id": new_uid(),
                "session_id": uid(session_id),
                "raw_event_id": raw_uuid,
                "causal_order": nev.causal_order,
                "category": nev.category,
                "actor": nev.actor,
                "summary": nev.content.summary,
                "detail": nev.content.detail,
                "files_affected": arr(nev.content.files_affected),
            },
        )

    # ── 4. chunks ─────────────────────────────────────────────────────────────

    for chunk in chunks:
        sa_session.execute(
            chunk_sql,
            {
                "id": new_uid(),
                "session_id": uid(session_id),
                "chunk_index": chunk.chunk_index,
                "topic_hint": chunk.topic_hint,
                "files_in_scope": arr(chunk.files_in_scope),
                "event_range_start": chunk.event_range[0],
                "event_range_end": chunk.event_range[1],
            },
        )

    # ── 5. sittings ───────────────────────────────────────────────────────────

    for sitting in sittings:
        started = _parse_iso(sitting.started_at) or now
        ended = _parse_iso(sitting.ended_at) or now
        sa_session.execute(
            sitting_sql,
            {
                "id": new_uid(),
                "session_id": uid(session_id),
                "sitting_index": sitting.sitting_index,
                "started_at": started,
                "ended_at": ended,
                "event_range_start": sitting.event_range[0],
                "event_range_end": sitting.event_range[1],
            },
        )


def _parse_iso(ts: Optional[str]) -> Optional[datetime]:
    """Parse an ISO 8601 timestamp string to an aware datetime, or return None."""
    if not ts:
        return None
    try:
        # Python 3.11+ handles Z suffix natively; fromisoformat does too in 3.11.
        # For 3.9/3.10 compat, replace Z with +00:00.
        ts_clean = ts.replace("Z", "+00:00")
        dt = datetime.fromisoformat(ts_clean)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, AttributeError):
        return None
