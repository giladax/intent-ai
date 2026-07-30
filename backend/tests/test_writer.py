"""Unit tests for quire.db.writer — SQLite in-memory, no Postgres required.

All tests run offline. The writer uses SQLAlchemy (via get_session), so we
patch it with an in-memory SQLite engine before each test.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any
from unittest.mock import patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session as SASession

from quire.db.engine import make_test_engine
from quire.db.models import (
    Base,
    Chunk,
    NormalizedEvent,
    RawEvent,
    Session as JournalSession,
    Sitting as JournalSitting,
)
from quire.db.writer import StoreResult, _parse_iso, store_session_digest  # noqa: F401
from quire.ingest.models import (
    NormalizedContent,
    NormalizedDevEvent,
    RawDevEvent,
    SessionChunk,
    Sitting as IngestSitting,
)


# ── Fixtures ───────────────────────────────────────────────────────────────────

NOW = datetime(2026, 7, 21, 12, 0, 0, tzinfo=timezone.utc)
NOW_ISO = "2026-07-21T12:00:00Z"


@pytest.fixture
def engine():
    """Fresh SQLite in-memory engine with all LIVE tables and FK enforcement."""
    from sqlalchemy import event as sa_event

    eng = make_test_engine()

    @sa_event.listens_for(eng, "connect")
    def set_sqlite_fk(dbapi_conn, _conn_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(eng)
    yield eng
    Base.metadata.drop_all(eng)


@pytest.fixture
def patched_get_session(engine):
    """Patch quire.db.writer.get_session to return sessions from the test engine."""

    def _get_test_session():
        return SASession(engine)

    with patch("quire.db.writer.get_session", _get_test_session):
        yield engine


# ── Minimal data builders ──────────────────────────────────────────────────────

def _raw_event(idx: int = 0) -> RawDevEvent:
    return RawDevEvent(
        id=f"raw-{idx}",
        source="claude-code",
        timestamp=NOW_ISO,
        type="conversation_turn",
        raw={"text": f"raw event {idx}"},
    )


def _norm_event(idx: int = 0, raw_id: str | None = None) -> NormalizedDevEvent:
    return NormalizedDevEvent(
        id=f"norm-{idx}",
        sessionId="placeholder",
        timestamp=NOW_ISO,
        causalOrder=idx,
        category="intent",
        actor="user",
        content=NormalizedContent(summary=f"summary {idx}", detail=f"detail {idx}", filesAffected=["src/foo.ts"]),
        rawEventId=raw_id or f"raw-{idx}",
        turnId="turn-0",
        respondingTo=None,
    )


def _chunk(idx: int = 0) -> SessionChunk:
    return SessionChunk(
        id=f"chunk-{idx}",
        session_id="placeholder",
        chunk_index=idx,
        events=[],
        topic_hint=f"topic {idx}",
        files_in_scope=["src/foo.ts"],
        event_range=(0, 1),
    )


def _sitting(idx: int = 0) -> IngestSitting:
    return IngestSitting(
        sitting_index=idx,
        started_at=NOW_ISO,
        ended_at=NOW_ISO,
        event_range=(0, 1),
    )


# ── Tests ──────────────────────────────────────────────────────────────────────


def test_store_writes_session_row(patched_get_session):
    """A fresh digest creates one sessions row."""
    result = store_session_digest(
        source_path="/tmp/abc.jsonl",
        source_hash="abc",
        raw_events=[],
        normalized_events=[],
        chunks=[],
        sittings=[],
        started_at=NOW,
        ended_at=NOW,
    )
    assert result.stored is True
    assert len(result.session_id) == 36  # UUID

    with SASession(patched_get_session) as s:
        rows = s.execute(select(JournalSession)).scalars().all()
    assert len(rows) == 1
    assert rows[0].source_hash == "abc"
    assert rows[0].source_path == "/tmp/abc.jsonl"
    assert rows[0].source_type == "claude-code"
    assert rows[0].session_shape is None  # LLM field — null at deterministic stage


def test_store_writes_raw_events(patched_get_session):
    """Raw events are written (intentional improvement over TS, which skipped them)."""
    raw = [_raw_event(0), _raw_event(1)]
    result = store_session_digest(
        source_path="/tmp/raw-test.jsonl",
        source_hash="raw-test",
        raw_events=raw,
        normalized_events=[],
        chunks=[],
        sittings=[],
        started_at=None,
        ended_at=None,
    )
    assert result.stored

    with SASession(patched_get_session) as s:
        rows = s.execute(select(RawEvent)).scalars().all()
    assert len(rows) == 2
    sources = {r.source for r in rows}
    assert sources == {"claude-code"}
    types = {r.type for r in rows}
    assert types == {"conversation_turn"}


def test_store_writes_normalized_events(patched_get_session):
    """Normalized events are written with the correct FK to raw_events."""
    raw = [_raw_event(0)]
    norm = [_norm_event(0, raw_id="raw-0")]
    store_session_digest(
        source_path="/tmp/norm-test.jsonl",
        source_hash="norm-test",
        raw_events=raw,
        normalized_events=norm,
        chunks=[],
        sittings=[],
        started_at=None,
        ended_at=None,
    )

    with SASession(patched_get_session) as s:
        nrows = s.execute(select(NormalizedEvent)).scalars().all()
    assert len(nrows) == 1
    assert nrows[0].causal_order == 0
    assert nrows[0].category == "intent"
    assert nrows[0].summary == "summary 0"
    # FK should resolve: raw_event_id is not None
    assert nrows[0].raw_event_id is not None


def test_store_writes_chunks(patched_get_session):
    """Chunks are written with correct fields."""
    store_session_digest(
        source_path="/tmp/chunk-test.jsonl",
        source_hash="chunk-test",
        raw_events=[],
        normalized_events=[],
        chunks=[_chunk(0), _chunk(1)],
        sittings=[],
        started_at=None,
        ended_at=None,
    )

    with SASession(patched_get_session) as s:
        rows = s.execute(select(Chunk).order_by(Chunk.chunk_index)).scalars().all()
    assert len(rows) == 2
    assert rows[0].chunk_index == 0
    assert rows[1].chunk_index == 1
    assert rows[0].topic_hint == "topic 0"
    assert rows[0].files_in_scope == ["src/foo.ts"]


def test_store_writes_sittings(patched_get_session):
    """Sittings are written with correct index and event range."""
    store_session_digest(
        source_path="/tmp/sitting-test.jsonl",
        source_hash="sitting-test",
        raw_events=[],
        normalized_events=[],
        chunks=[],
        sittings=[_sitting(0)],
        started_at=None,
        ended_at=None,
    )

    with SASession(patched_get_session) as s:
        rows = s.execute(select(JournalSitting)).scalars().all()
    assert len(rows) == 1
    assert rows[0].sitting_index == 0
    assert rows[0].event_range_start == 0
    assert rows[0].event_range_end == 1


def test_idempotent_no_force_returns_not_stored(patched_get_session):
    """Re-digesting the same source_hash without --force returns stored=False."""
    store_session_digest(
        source_path="/tmp/idem.jsonl",
        source_hash="idem",
        raw_events=[],
        normalized_events=[],
        chunks=[],
        sittings=[],
        started_at=None,
        ended_at=None,
    )
    result2 = store_session_digest(
        source_path="/tmp/idem.jsonl",
        source_hash="idem",
        raw_events=[],
        normalized_events=[],
        chunks=[],
        sittings=[],
        started_at=None,
        ended_at=None,
    )
    assert result2.stored is False

    # Only one session row must exist
    with SASession(patched_get_session) as s:
        count = len(s.execute(select(JournalSession)).scalars().all())
    assert count == 1


def test_idempotent_force_replaces_rows(patched_get_session):
    """Re-digesting with force=True deletes old rows and inserts fresh ones."""
    result1 = store_session_digest(
        source_path="/tmp/force-test.jsonl",
        source_hash="force-hash",
        raw_events=[_raw_event(0)],
        normalized_events=[_norm_event(0)],
        chunks=[_chunk(0)],
        sittings=[],
        started_at=None,
        ended_at=None,
    )
    old_id = result1.session_id

    result2 = store_session_digest(
        source_path="/tmp/force-test.jsonl",
        source_hash="force-hash",
        raw_events=[_raw_event(0), _raw_event(1)],
        normalized_events=[],
        chunks=[],
        sittings=[],
        started_at=None,
        ended_at=None,
        force=True,
    )
    assert result2.stored is True
    assert result2.session_id != old_id  # new UUID

    with SASession(patched_get_session) as s:
        sessions = s.execute(select(JournalSession)).scalars().all()
        raw_rows = s.execute(select(RawEvent)).scalars().all()
        norm_rows = s.execute(select(NormalizedEvent)).scalars().all()
        chunk_rows = s.execute(select(Chunk)).scalars().all()

    # Exactly one session, with the new ID
    assert len(sessions) == 1
    assert sessions[0].id == result2.session_id
    # 2 raw events (the second digest's payload)
    assert len(raw_rows) == 2
    # 0 norm events (second digest passed none)
    assert len(norm_rows) == 0
    # 0 chunks
    assert len(chunk_rows) == 0


def test_session_shape_is_null(patched_get_session):
    """session_shape must be null at the deterministic stage (LLM field)."""
    store_session_digest(
        source_path="/tmp/shape-test.jsonl",
        source_hash="shape-test",
        raw_events=[],
        normalized_events=[],
        chunks=[],
        sittings=[],
        started_at=NOW,
        ended_at=NOW,
    )
    with SASession(patched_get_session) as s:
        row = s.execute(select(JournalSession)).scalars().one()
    assert row.session_shape is None


def test_timestamps_stored(patched_get_session):
    """started_at and ended_at are stored on the session row."""
    store_session_digest(
        source_path="/tmp/ts-test.jsonl",
        source_hash="ts-test",
        raw_events=[],
        normalized_events=[],
        chunks=[],
        sittings=[],
        started_at=NOW,
        ended_at=NOW,
    )
    with SASession(patched_get_session) as s:
        row = s.execute(select(JournalSession)).scalars().one()
    # SQLite drops tz; compare naive
    assert row.started_at.replace(tzinfo=None) == NOW.replace(tzinfo=None)


# ── _parse_iso unit tests ──────────────────────────────────────────────────────


def test_parse_iso_z_suffix():
    dt = _parse_iso("2026-07-21T12:00:00Z")
    assert dt is not None
    assert dt.tzinfo is not None
    assert dt.year == 2026


def test_parse_iso_offset():
    dt = _parse_iso("2026-07-21T12:00:00+00:00")
    assert dt is not None
    assert dt.hour == 12


def test_parse_iso_none():
    assert _parse_iso(None) is None


def test_parse_iso_empty():
    assert _parse_iso("") is None


def test_parse_iso_garbage():
    assert _parse_iso("not-a-date") is None


# ── Rollback-atomicity test ────────────────────────────────────────────────────


def test_rollback_atomicity_on_mid_write_failure(patched_get_session, monkeypatch):
    """A failure mid-write must leave NO partial rows for that session.

    Strategy: monkeypatch quire.db.writer._write_all so it writes the sessions
    row (via the real _write_all up through the raw_events flush), then raises
    before sittings/chunks finish — simulating a per-table helper failure.
    The transaction must roll back and leave all five tables empty for the
    target session_id.

    Revert-check (manual, reported): temporarily add ``sa_session.commit()``
    before the raise inside the patched _write_all; the test must FAIL because
    partial rows survive.  Verified and reverted before committing.
    """
    import quire.db.writer as writer_module

    real_write_all = writer_module._write_all

    def _write_all_fail_on_chunks(sa_session, **kwargs):
        # Call the real implementation up to — but not including — completion by
        # injecting a failure after the normalized_events flush.  We do this by
        # patching sa_session.flush at the right moment: the second flush() call
        # (after normalized_events) triggers the bomb.
        call_count = {"n": 0}
        original_flush = sa_session.flush

        def _counting_flush():
            call_count["n"] += 1
            original_flush()
            if call_count["n"] >= 2:
                # sessions and raw_events (+ their flushes) are already written
                # in the SQLAlchemy unit-of-work, but the transaction is not yet
                # committed — raising here exercises the rollback path.
                raise RuntimeError("Injected failure after normalized_events flush")

        sa_session.flush = _counting_flush
        real_write_all(sa_session, **kwargs)

    monkeypatch.setattr(writer_module, "_write_all", _write_all_fail_on_chunks)

    with pytest.raises(RuntimeError, match="Injected failure"):
        store_session_digest(
            source_path="/tmp/atomic-test.jsonl",
            source_hash="atomic-test",
            raw_events=[_raw_event(0)],
            normalized_events=[_norm_event(0)],
            chunks=[_chunk(0)],
            sittings=[_sitting(0)],
            started_at=NOW,
            ended_at=NOW,
        )

    # All five ingestion tables must be empty — no partial rows committed.
    with SASession(patched_get_session) as s:
        sessions = s.execute(select(JournalSession)).scalars().all()
        raw_rows = s.execute(select(RawEvent)).scalars().all()
        norm_rows = s.execute(select(NormalizedEvent)).scalars().all()
        chunk_rows = s.execute(select(Chunk)).scalars().all()
        sitting_rows = s.execute(select(JournalSitting)).scalars().all()

    assert len(sessions) == 0, f"Expected 0 session rows, got {len(sessions)}"
    assert len(raw_rows) == 0, f"Expected 0 raw_event rows, got {len(raw_rows)}"
    assert len(norm_rows) == 0, f"Expected 0 normalized_event rows, got {len(norm_rows)}"
    assert len(chunk_rows) == 0, f"Expected 0 chunk rows, got {len(chunk_rows)}"
    assert len(sitting_rows) == 0, f"Expected 0 sitting rows, got {len(sitting_rows)}"


def _seed_session_with_moments(patched_get_session, n=3):
    """Store a deterministic session, then inject n LLM-derived moment rows."""
    from sqlalchemy import text as sa_text

    result = store_session_digest(
        source_path="/tmp/guard-test.jsonl",
        source_hash="guard-hash",
        raw_events=[],
        normalized_events=[],
        chunks=[],
        sittings=[],
        started_at=None,
        ended_at=None,
    )
    assert result.stored is True
    session_id = result.session_id
    with SASession(patched_get_session) as s:
        for i in range(n):
            s.execute(
                sa_text(
                    "INSERT INTO moments (id, session_id, type, statement) "
                    "VALUES (:id, :sid, 'decision', :stmt)"
                ),
                {"id": f"moment-guard-{i}", "sid": session_id, "stmt": f"stmt {i}"},
            )
        s.commit()
    return session_id


def test_force_purge_with_moments_refuses_without_consent(patched_get_session):
    """Guard escalation (Slice 5b): force on a session with LLM-derived moments
    now REFUSES with LlmPurgeRefused unless allow_llm_purge=True."""
    from quire.db.writer import LlmPurgeRefused

    session_id = _seed_session_with_moments(patched_get_session)

    with pytest.raises(LlmPurgeRefused) as excinfo:
        store_session_digest(
            source_path="/tmp/guard-test.jsonl",
            source_hash="guard-hash",
            raw_events=[],
            normalized_events=[],
            chunks=[],
            sittings=[],
            started_at=None,
            ended_at=None,
            force=True,
        )
    assert "3" in str(excinfo.value)

    # Session and moments untouched — the refusal rolled nothing back.
    from sqlalchemy import text as sa_text

    with SASession(patched_get_session) as s:
        sessions = s.execute(select(JournalSession)).scalars().all()
        moment_count = s.execute(sa_text("SELECT COUNT(*) FROM moments")).scalar()
    assert len(sessions) == 1
    assert sessions[0].id == session_id
    assert moment_count == 3


def test_force_purge_with_consent_warns_and_proceeds(patched_get_session, capsys):
    """With allow_llm_purge=True, force warns on stderr and completes the purge."""
    from sqlalchemy import text as sa_text

    session_id = _seed_session_with_moments(patched_get_session)

    result2 = store_session_digest(
        source_path="/tmp/guard-test.jsonl",
        source_hash="guard-hash",
        raw_events=[],
        normalized_events=[],
        chunks=[],
        sittings=[],
        started_at=None,
        ended_at=None,
        force=True,
        allow_llm_purge=True,
    )

    captured = capsys.readouterr()
    assert "WARNING" in captured.err
    assert "3" in captured.err

    assert result2.stored is True
    assert result2.session_id != session_id

    with SASession(patched_get_session) as s:
        sessions = s.execute(select(JournalSession)).scalars().all()
        moment_count = s.execute(sa_text("SELECT COUNT(*) FROM moments")).scalar()
    assert len(sessions) == 1
    assert sessions[0].id == result2.session_id
    assert moment_count == 0
