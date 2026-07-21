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
import sys
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

# The understanding artifact is a duck-typed bundle (moments/transitions/
# outcomes/narrative). Imported for typing only; the writer never constructs it.
try:  # pragma: no cover - typing convenience
    from quire.understand.models import UnderstandResult as Understanding
except ImportError:  # pragma: no cover - narrow: don't mask real breakage in that module
    Understanding = object  # type: ignore


# ── Result type ───────────────────────────────────────────────────────────────


@dataclass
class StoreResult:
    stored: bool
    session_id: str


class LlmPurgeRefused(RuntimeError):
    """Raised when force would purge LLM-derived rows without explicit consent.

    Escalated from a warn-and-proceed in Slice 4 to a refuse-without-force here,
    now that the Python port can regenerate those rows (ledger requirement)."""


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
    understanding: "Optional[Understanding]" = None,
    session_shape: Optional[str] = None,
    allow_llm_purge: bool = False,
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
            moment_count = _count_moments(sa_session, existing_id)
            if moment_count > 0 and not allow_llm_purge:
                # Guard escalation (Slice 5b): the Python port can now regenerate
                # LLM-derived rows, so a silent purge is a real data-loss risk.
                # Refuse without explicit consent instead of warn-and-proceed.
                raise LlmPurgeRefused(
                    f"force would destroy {moment_count} LLM-derived moment(s) for "
                    f"session {existing_id[:8]}…. Pass allow_llm_purge=True "
                    f"(CLI: --force) to confirm you intend to regenerate them."
                )
            if moment_count > 0:
                print(
                    f"\nWARNING: force will destroy {moment_count} moment(s) for session "
                    f"{existing_id[:8]}… — regenerating them from the Python LLM pipeline.\n",
                    file=sys.stderr,
                )
            _delete_session(sa_session, existing_id)

        session_id = str(uuid.uuid4())
        maps = _write_all(
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
            session_shape=session_shape,
        )
        if understanding is not None:
            _write_understanding(sa_session, session_id, understanding, maps)
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


def _count_moments(sa_session: SASession, session_id: str) -> int:
    """Return the number of LLM-derived moments for a session."""
    row = sa_session.execute(
        text("SELECT COUNT(*) FROM moments WHERE session_id = :sid"),
        {"sid": session_id},
    ).first()
    return int(row[0]) if row else 0


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


def _is_pg(sa_session: SASession) -> bool:
    return sa_session.get_bind().dialect.name == "postgresql"


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
    session_shape: Optional[str] = None,
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
            "session_shape": session_shape,
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
    # Track causalOrder → normalized-event id so moment_evidence can resolve
    # source_event_id from an EvidenceAnchor's event_index (Slice 5b).

    norm_id_by_causal_order: dict[int, object] = {}
    for nev in normalized_events:
        raw_uuid = raw_id_by_event_id.get(nev.raw_event_id)
        norm_uuid = new_uid()
        norm_id_by_causal_order[nev.causal_order] = norm_uuid
        sa_session.execute(
            norm_event_sql,
            {
                "id": norm_uuid,
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
    # Track chunkIndex → chunk id so moments can set chunk_id (Slice 5b).

    chunk_id_by_index: dict[int, object] = {}
    for chunk in chunks:
        chunk_uuid = new_uid()
        chunk_id_by_index[chunk.chunk_index] = chunk_uuid
        sa_session.execute(
            chunk_sql,
            {
                "id": chunk_uuid,
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

    # Expose id maps for the LLM-derived writer (moments/evidence link back here).
    return {
        "norm_id_by_causal_order": norm_id_by_causal_order,
        "chunk_id_by_index": chunk_id_by_index,
        "uid": uid,
        "new_uid": new_uid,
        "arr": arr,
    }


def _write_understanding(
    sa_session: SASession,
    session_id: str,
    understanding,
    maps: dict,
) -> None:
    """Persist LLM-derived rows for a session (Slice 5b).

    Mirrors journal/src/storage/queries.ts::storeSessionDigest row semantics for:
        moments → moment_evidence → moment_relations
        transitions → transition_moments
        outcomes → outcome_moments → outcome_files
        narratives → narrative_arcs

    Domain moment ids (e.g. "moment-3") are mapped to fresh UUIDs; transitions,
    outcomes and narrative arcs reference them by those domain ids, resolved here.
    """
    is_pg = _is_pg(sa_session)
    uid = maps["uid"]
    new_uid = maps["new_uid"]
    arr = maps["arr"]
    norm_by_order = maps["norm_id_by_causal_order"]
    chunk_by_index = maps["chunk_id_by_index"]

    # SQL templates (PG casts vs SQLite plain).
    if is_pg:
        moment_sql = text(
            "INSERT INTO moments (id, session_id, chunk_id, type, statement, "
            " significance, agency, confidence, topic_fingerprint, arc_id, arc_role, "
            " occurred_at, verification) VALUES (:id, :session_id, :chunk_id, :type, "
            " :statement, :significance, :agency, :confidence, :topic_fingerprint, "
            " :arc_id, :arc_role, :occurred_at, :verification)"
        )
        evidence_sql = text(
            "INSERT INTO moment_evidence (id, moment_id, quote, source_event_id, "
            " source_type, quote_type) VALUES (:id, :moment_id, :quote, "
            " :source_event_id, :source_type, :quote_type)"
        )
        relation_sql = text(
            "INSERT INTO moment_relations (moment_id, related_moment_id, relation_type) "
            "VALUES (:moment_id, :related_moment_id, :relation_type) "
            "ON CONFLICT DO NOTHING"
        )
        transition_sql = text(
            "INSERT INTO transitions (id, session_id, from_statement, to_statement, "
            " reason, arc_id, confidence) VALUES (:id, :session_id, :from_statement, "
            " :to_statement, :reason, :arc_id, :confidence)"
        )
        transition_moment_sql = text(
            "INSERT INTO transition_moments (transition_id, moment_id) "
            "VALUES (:transition_id, :moment_id) ON CONFLICT DO NOTHING"
        )
        outcome_sql = text(
            "INSERT INTO outcomes (id, session_id, statement, confidence) "
            "VALUES (:id, :session_id, :statement, :confidence)"
        )
        outcome_moment_sql = text(
            "INSERT INTO outcome_moments (outcome_id, moment_id) "
            "VALUES (:outcome_id, :moment_id) ON CONFLICT DO NOTHING"
        )
        outcome_file_sql = text(
            "INSERT INTO outcome_files (outcome_id, file_path) "
            "VALUES (:outcome_id, :file_path) ON CONFLICT DO NOTHING"
        )
        narrative_sql = text(
            "INSERT INTO narratives (id, session_id, session_shape, summary, "
            " progression, discoveries, stabilized_directions, abandoned_directions) "
            "VALUES (:id, :session_id, :session_shape, :summary, "
            " CAST(:progression AS text[]), CAST(:discoveries AS text[]), "
            " CAST(:stabilized_directions AS text[]), CAST(:abandoned_directions AS text[]))"
        )
        narrative_arc_sql = text(
            "INSERT INTO narrative_arcs (id, narrative_id, arc_id, title, summary, "
            " resolution, moment_ids) VALUES (:id, :narrative_id, :arc_id, :title, "
            " :summary, :resolution, CAST(:moment_ids AS text[]))"
        )
    else:
        moment_sql = text(
            "INSERT INTO moments (id, session_id, chunk_id, type, statement, "
            " significance, agency, confidence, topic_fingerprint, arc_id, arc_role, "
            " occurred_at, verification) VALUES (:id, :session_id, :chunk_id, :type, "
            " :statement, :significance, :agency, :confidence, :topic_fingerprint, "
            " :arc_id, :arc_role, :occurred_at, :verification)"
        )
        evidence_sql = text(
            "INSERT INTO moment_evidence (id, moment_id, quote, source_event_id, "
            " source_type, quote_type) VALUES (:id, :moment_id, :quote, "
            " :source_event_id, :source_type, :quote_type)"
        )
        relation_sql = text(
            "INSERT OR IGNORE INTO moment_relations "
            "(moment_id, related_moment_id, relation_type) "
            "VALUES (:moment_id, :related_moment_id, :relation_type)"
        )
        transition_sql = text(
            "INSERT INTO transitions (id, session_id, from_statement, to_statement, "
            " reason, arc_id, confidence) VALUES (:id, :session_id, :from_statement, "
            " :to_statement, :reason, :arc_id, :confidence)"
        )
        transition_moment_sql = text(
            "INSERT OR IGNORE INTO transition_moments (transition_id, moment_id) "
            "VALUES (:transition_id, :moment_id)"
        )
        outcome_sql = text(
            "INSERT INTO outcomes (id, session_id, statement, confidence) "
            "VALUES (:id, :session_id, :statement, :confidence)"
        )
        outcome_moment_sql = text(
            "INSERT OR IGNORE INTO outcome_moments (outcome_id, moment_id) "
            "VALUES (:outcome_id, :moment_id)"
        )
        outcome_file_sql = text(
            "INSERT OR IGNORE INTO outcome_files (outcome_id, file_path) "
            "VALUES (:outcome_id, :file_path)"
        )
        narrative_sql = text(
            "INSERT INTO narratives (id, session_id, session_shape, summary, "
            " progression, discoveries, stabilized_directions, abandoned_directions) "
            "VALUES (:id, :session_id, :session_shape, :summary, :progression, "
            " :discoveries, :stabilized_directions, :abandoned_directions)"
        )
        narrative_arc_sql = text(
            "INSERT INTO narrative_arcs (id, narrative_id, arc_id, title, summary, "
            " resolution, moment_ids) VALUES (:id, :narrative_id, :arc_id, :title, "
            " :summary, :resolution, :moment_ids)"
        )

    sid = uid(session_id)

    # ── moments + evidence ──────────────────────────────────────────────────
    moment_id_map: dict[str, object] = {}  # domain "moment-N" → uuid
    for m in understanding.moments:
        moment_uuid = new_uid()
        moment_id_map[m.id] = moment_uuid
        # m.chunk_id is a Python chunk id string ("<sid>-chunk-<i>"); resolve to
        # the DB chunk uuid by index parsed from the id, falling back to None.
        chunk_uuid = _resolve_chunk_uuid(m.chunk_id, chunk_by_index)
        sa_session.execute(
            moment_sql,
            {
                "id": moment_uuid,
                "session_id": sid,
                "chunk_id": chunk_uuid,
                "type": m.type,
                "statement": m.statement,
                "significance": m.significance,
                "agency": m.agency,
                "confidence": m.confidence,
                "topic_fingerprint": m.topic_fingerprint,
                "arc_id": m.arc_id,
                "arc_role": m.arc_role,
                "occurred_at": _parse_iso(m.occurred_at),
                "verification": m.verification,
            },
        )
        for e in m.evidence:
            # Mirror TS resolveEvidenceSourceIds (queries.ts): resolve ONLY when
            # the validator anchored the quote AND the index maps to a stored
            # event; unanchored evidence keeps a NULL source_event_id so the
            # anchored% fidelity dimension reads the validator's decision,
            # never a fabricated join.
            source_event_id = None
            if e.anchored and e.event_index is not None:
                source_event_id = norm_by_order.get(e.event_index)
            sa_session.execute(
                evidence_sql,
                {
                    "id": new_uid(),
                    "moment_id": moment_uuid,
                    "quote": e.quote,
                    "source_event_id": source_event_id,
                    "source_type": e.source_type,
                    # TS passes quoteType through; EvidenceAnchor carries none,
                    # so NULL (the reader defaults to "verbatim" on read).
                    "quote_type": getattr(e, "quote_type", None),
                },
            )
    sa_session.flush()

    # ── moment_relations (relation_type hardcoded 'evolved_into', per TS) ────
    for m in understanding.moments:
        moment_uuid = moment_id_map[m.id]
        for related_id in m.related_moment_ids:
            related_uuid = moment_id_map.get(related_id)
            if related_uuid is None:
                continue
            sa_session.execute(
                relation_sql,
                {
                    "moment_id": moment_uuid,
                    "related_moment_id": related_uuid,
                    "relation_type": "evolved_into",
                },
            )

    # ── transitions + transition_moments ────────────────────────────────────
    for t in understanding.transitions:
        transition_uuid = new_uid()
        sa_session.execute(
            transition_sql,
            {
                "id": transition_uuid,
                "session_id": sid,
                "from_statement": t.from_statement,
                "to_statement": t.to_statement,
                "reason": t.reason,
                "arc_id": t.arc_id,
                "confidence": t.confidence,
            },
        )
        for mid in t.origin_moment_ids:
            moment_uuid = moment_id_map.get(mid)
            if moment_uuid is None:
                continue
            sa_session.execute(
                transition_moment_sql,
                {"transition_id": transition_uuid, "moment_id": moment_uuid},
            )

    # ── outcomes + outcome_moments + outcome_files ──────────────────────────
    for o in understanding.outcomes:
        outcome_uuid = new_uid()
        sa_session.execute(
            outcome_sql,
            {
                "id": outcome_uuid,
                "session_id": sid,
                "statement": o.statement,
                "confidence": o.confidence,
            },
        )
        for mid in o.supporting_moment_ids:
            moment_uuid = moment_id_map.get(mid)
            if moment_uuid is None:
                continue
            sa_session.execute(
                outcome_moment_sql,
                {"outcome_id": outcome_uuid, "moment_id": moment_uuid},
            )
        seen_files: set[str] = set()
        for fp in o.supporting_files:
            if fp in seen_files:
                continue
            seen_files.add(fp)
            sa_session.execute(
                outcome_file_sql, {"outcome_id": outcome_uuid, "file_path": fp}
            )

    # ── narrative + narrative_arcs ──────────────────────────────────────────
    narr = understanding.narrative
    narrative_uuid = new_uid()
    sa_session.execute(
        narrative_sql,
        {
            "id": narrative_uuid,
            "session_id": sid,
            "session_shape": narr.session_shape,
            "summary": narr.summary,
            "progression": arr(narr.progression),
            "discoveries": arr(narr.discoveries),
            "stabilized_directions": arr(narr.stabilized_directions),
            "abandoned_directions": arr(narr.abandoned_directions),
        },
    )
    for arc in narr.arcs:
        sa_session.execute(
            narrative_arc_sql,
            {
                "id": new_uid(),
                "narrative_id": narrative_uuid,
                "arc_id": arc.arc_id,
                "title": arc.title,
                "summary": arc.summary,
                "resolution": arc.resolution,
                # narrative_arcs.moment_ids stores domain ids ("moment-N") as
                # text[], matching TS storeSessionDigest.
                "moment_ids": arr(list(arc.moment_ids)),
            },
        )


def _resolve_chunk_uuid(chunk_id: Optional[str], chunk_by_index: dict):
    """Resolve a Python chunk id (\"<sid>-chunk-<i>\") to the DB chunk uuid."""
    if not chunk_id:
        return None
    idx = _chunk_index_of(chunk_id, chunk_by_index)
    if idx is None:
        return None
    return chunk_by_index.get(idx)


def _chunk_index_of(chunk_id: Optional[str], chunk_by_index: dict) -> Optional[int]:
    if not chunk_id:
        return None
    marker = "-chunk-"
    pos = chunk_id.rfind(marker)
    if pos == -1:
        return None
    try:
        return int(chunk_id[pos + len(marker):])
    except ValueError:
        return None


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
