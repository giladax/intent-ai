"""Tests for the fidelity scorers — fully offline, no Postgres.

Tests the pure-function scoring layer (scorers.py) and the harness
plumbing (loader.py + criteria.py) against synthetic fixture data.

All assertions are deterministic; no LLM calls.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session as SASession

from quire.db.engine import make_test_engine
from quire.db.models import (
    Base,
    Chunk,
    Moment,
    MomentEvidence,
    Narrative,
    Outcome,
    Session as JournalSession,
    Transition,
)
from evals.fidelity.scorers import (
    FABRICATED_DEFAULT,
    AgencyResult,
    CalibrationScore,
    ExpectedMoment,
    ForbiddenClaim,
    MomentFidelityRow,
    PrecisionResult,
    ProvenanceScore,
    RecallResult,
    TailScore,
    score_agency,
    score_calibration,
    score_precision,
    score_provenance,
    score_recall,
    score_tail,
)
from evals.fidelity.loader import (
    load_moment_rows,
    load_narrative_text,
    load_outcome_confidence_values,
    load_session_by_hash,
    load_transition_confidence_values,
    raw_last_event_at,
)
from evals.fidelity.criteria import FIDELITY_CRITERIA, SessionFidelityCriteria


NOW = datetime(2026, 7, 21, 12, 0, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def engine():
    eng = make_test_engine()
    Base.metadata.create_all(eng)
    yield eng
    Base.metadata.drop_all(eng)


@pytest.fixture
def db(engine):
    with SASession(engine) as s:
        yield s


def _uid() -> str:
    return str(uuid.uuid4())


def _session(db: SASession, source_hash: str = "abc123", ended_at: Optional[datetime] = None) -> JournalSession:
    s = JournalSession(
        id=_uid(),
        source_type="claude_code",
        source_path="/tmp/test.jsonl",
        source_hash=source_hash,
        ended_at=ended_at or NOW,
        created_at=NOW,
    )
    db.add(s)
    db.flush()
    return s


def _chunk(db: SASession, session_id: str, chunk_index: int = 0) -> Chunk:
    c = Chunk(
        id=_uid(),
        session_id=session_id,
        chunk_index=chunk_index,
        files_in_scope=[],
        event_range_start=0,
        event_range_end=10,
    )
    db.add(c)
    db.flush()
    return c


def _moment(
    db: SASession,
    session_id: str,
    statement: str = "Test statement",
    confidence: Optional[str] = "high",
    agency: Optional[str] = None,
    chunk_id: Optional[str] = None,
    occurred_at: Optional[datetime] = None,
) -> Moment:
    m = Moment(
        id=_uid(),
        session_id=session_id,
        chunk_id=chunk_id,
        type="decision",
        statement=statement,
        confidence=confidence,
        agency=agency,
        occurred_at=occurred_at,
    )
    db.add(m)
    db.flush()
    return m


def _evidence(db: SASession, moment_id: str, quote: str, source_event_id: Optional[str] = None) -> MomentEvidence:
    e = MomentEvidence(
        id=_uid(),
        moment_id=moment_id,
        quote=quote,
        source_event_id=source_event_id,
    )
    db.add(e)
    db.flush()
    return e


def _narrative(db: SASession, session_id: str, summary: str = "A summary", progression=None, discoveries=None) -> Narrative:
    n = Narrative(
        id=_uid(),
        session_id=session_id,
        summary=summary,
        progression=progression or [],
        discoveries=discoveries or [],
        stabilized_directions=[],
        abandoned_directions=[],
    )
    db.add(n)
    db.flush()
    return n


def _transition(db: SASession, session_id: str, confidence: Optional[str] = "high") -> Transition:
    t = Transition(
        id=_uid(),
        session_id=session_id,
        from_statement="A",
        to_statement="B",
        confidence=confidence,
    )
    db.add(t)
    db.flush()
    return t


def _outcome(db: SASession, session_id: str, confidence: Optional[str] = "medium") -> Outcome:
    o = Outcome(
        id=_uid(),
        session_id=session_id,
        statement="Done",
        confidence=confidence,
    )
    db.add(o)
    db.flush()
    return o


# ---------------------------------------------------------------------------
# score_provenance tests
# ---------------------------------------------------------------------------

class TestScoreProvenance:
    def test_empty_moments(self):
        result = score_provenance([])
        assert result.moment_count == 0
        assert result.evidence_real_pct == 0.0
        assert result.evidence_anchored_pct == 0.0
        assert result.distinct_chunks == 0
        assert result.chunk_spread_ok is True  # 0 <= 3, so ok
        assert result.occurred_time_span_ms is None

    def test_real_evidence_pct(self):
        moments = [
            MomentFidelityRow(
                statement="s1", type="decision", agency=None, confidence="high",
                chunk_index=0, occurred_at=None,
                evidence_quotes=["This is a real quote from the session"],
                anchored_evidence_count=0,
            ),
            MomentFidelityRow(
                statement="s2", type="decision", agency=None, confidence="low",
                chunk_index=0, occurred_at=None,
                evidence_quotes=[FABRICATED_DEFAULT],
                anchored_evidence_count=0,
            ),
        ]
        result = score_provenance(moments)
        assert result.evidence_real_pct == 50.0
        assert result.evidence_anchored_pct == 0.0

    def test_anchored_evidence_pct(self):
        moments = [
            MomentFidelityRow(
                statement="s1", type="decision", agency=None, confidence="high",
                chunk_index=0, occurred_at=None,
                evidence_quotes=["real quote here"],
                anchored_evidence_count=1,
            ),
            MomentFidelityRow(
                statement="s2", type="decision", agency=None, confidence="high",
                chunk_index=1, occurred_at=None,
                evidence_quotes=["another real quote"],
                anchored_evidence_count=0,
            ),
            MomentFidelityRow(
                statement="s3", type="decision", agency=None, confidence="high",
                chunk_index=2, occurred_at=None,
                evidence_quotes=["yet another quote"],
                anchored_evidence_count=1,
            ),
            MomentFidelityRow(
                statement="s4", type="decision", agency=None, confidence="high",
                chunk_index=3, occurred_at=None,
                evidence_quotes=["one more quote"],
                anchored_evidence_count=1,
            ),
        ]
        result = score_provenance(moments)
        assert result.evidence_anchored_pct == 75.0

    def test_chunk_spread_ok_when_few_moments(self):
        """3 or fewer moments — chunk spread is always ok."""
        moments = [
            MomentFidelityRow(
                statement="s", type="d", agency=None, confidence=None,
                chunk_index=0, occurred_at=None, evidence_quotes=[], anchored_evidence_count=0,
            )
            for _ in range(3)
        ]
        result = score_provenance(moments)
        assert result.chunk_spread_ok is True
        assert result.distinct_chunks == 1

    def test_chunk_spread_degenerate(self):
        """More than 3 moments all in the same chunk → DEGENERATE."""
        moments = [
            MomentFidelityRow(
                statement=f"s{i}", type="d", agency=None, confidence=None,
                chunk_index=0, occurred_at=None, evidence_quotes=[], anchored_evidence_count=0,
            )
            for i in range(4)
        ]
        result = score_provenance(moments)
        assert result.chunk_spread_ok is False
        assert result.distinct_chunks == 1

    def test_occurred_time_span_ms(self):
        t0 = datetime(2026, 7, 1, 0, 0, 0, tzinfo=timezone.utc)
        t1 = datetime(2026, 7, 1, 1, 0, 0, tzinfo=timezone.utc)  # 1 hour later
        moments = [
            MomentFidelityRow(
                statement="s1", type="d", agency=None, confidence=None,
                chunk_index=0, occurred_at=t0, evidence_quotes=[], anchored_evidence_count=0,
            ),
            MomentFidelityRow(
                statement="s2", type="d", agency=None, confidence=None,
                chunk_index=1, occurred_at=t1, evidence_quotes=[], anchored_evidence_count=0,
            ),
        ]
        result = score_provenance(moments)
        assert result.occurred_time_span_ms == 3_600_000  # 1 hour in ms

    def test_short_quote_not_real(self):
        """A quote under 10 chars is not 'real'."""
        moments = [
            MomentFidelityRow(
                statement="s", type="d", agency=None, confidence=None,
                chunk_index=0, occurred_at=None,
                evidence_quotes=["short"],  # 5 chars, < 10
                anchored_evidence_count=0,
            ),
        ]
        result = score_provenance(moments)
        assert result.evidence_real_pct == 0.0

    def test_pct_rounding(self):
        """75.3% matches the TS round((75/99) * 1000) / 10 formula."""
        # 75/100 = 75.0, 77/100 = 77.0, let's test 83/110 = 75.45... rounds to 75.5
        moments = []
        for i in range(110):
            quotes = ["real quote here for sure"] if i < 83 else []
            moments.append(MomentFidelityRow(
                statement=f"s{i}", type="d", agency=None, confidence=None,
                chunk_index=i % 10, occurred_at=None,
                evidence_quotes=quotes,
                anchored_evidence_count=0,
            ))
        result = score_provenance(moments)
        # round((83 / 110) * 1000) / 10 = round(754.545) / 10 = 755 / 10 = 75.5
        assert result.evidence_real_pct == 75.5


# ---------------------------------------------------------------------------
# score_calibration tests
# ---------------------------------------------------------------------------

class TestScoreCalibration:
    def test_empty(self):
        result = score_calibration([])
        assert result.distribution == {}
        assert result.dominant_share == 0.0
        assert result.informative is False

    def test_single_value(self):
        result = score_calibration(["high"])
        assert result.distribution == {"high": 1}
        assert result.dominant_share == 1.0
        assert result.informative is False  # only 1 distinct value

    def test_informative(self):
        result = score_calibration(["high", "low", "medium", "high"])
        assert result.distribution == {"high": 2, "low": 1, "medium": 1}
        assert result.dominant_share == 0.5
        assert result.informative is True

    def test_none_keyed_as_null(self):
        result = score_calibration([None, "high", None])
        assert result.distribution["null"] == 2
        assert result.distribution["high"] == 1

    def test_dominant_share_threshold(self):
        """90% dominant → NOT informative."""
        values = ["high"] * 9 + ["low"]
        result = score_calibration(values)
        assert result.dominant_share == 0.9
        assert result.informative is False  # exactly 0.9, NOT < 0.9

    def test_just_below_threshold(self):
        """89% dominant → informative."""
        values = ["high"] * 89 + ["low"] * 11
        result = score_calibration(values)
        assert result.dominant_share < 0.9
        assert result.informative is True


# ---------------------------------------------------------------------------
# score_tail tests
# ---------------------------------------------------------------------------

class TestScoreTail:
    def test_covered_when_within_60s(self):
        t0 = datetime(2026, 7, 1, 12, 0, 0, tzinfo=timezone.utc)
        t1 = datetime(2026, 7, 1, 12, 0, 59, tzinfo=timezone.utc)  # 59s later
        result = score_tail(t0, t1)
        assert result.lost_ms == 59_000
        assert result.covered is True

    def test_covered_at_exactly_60s(self):
        t0 = datetime(2026, 7, 1, 12, 0, 0, tzinfo=timezone.utc)
        t1 = datetime(2026, 7, 1, 12, 1, 0, tzinfo=timezone.utc)  # exactly 60s
        result = score_tail(t0, t1)
        assert result.lost_ms == 60_000
        assert result.covered is True

    def test_lost_when_beyond_60s(self):
        t0 = datetime(2026, 7, 1, 12, 0, 0, tzinfo=timezone.utc)
        t1 = datetime(2026, 7, 1, 12, 2, 0, tzinfo=timezone.utc)  # 2 min later
        result = score_tail(t0, t1)
        assert result.lost_ms == 120_000
        assert result.covered is False

    def test_no_loss_when_digest_after_raw(self):
        t0 = datetime(2026, 7, 1, 12, 2, 0, tzinfo=timezone.utc)  # digest AFTER
        t1 = datetime(2026, 7, 1, 12, 0, 0, tzinfo=timezone.utc)  # raw BEFORE
        result = score_tail(t0, t1)
        assert result.lost_ms == 0
        assert result.covered is True

    def test_none_inputs(self):
        result = score_tail(None, None)
        assert result.lost_ms == 0
        assert result.covered is True

    def test_null_digest(self):
        t1 = datetime(2026, 7, 1, 12, 0, 0, tzinfo=timezone.utc)
        result = score_tail(None, t1)
        assert result.lost_ms == 0
        assert result.covered is True

    def test_null_raw(self):
        t0 = datetime(2026, 7, 1, 12, 0, 0, tzinfo=timezone.utc)
        result = score_tail(t0, None)
        assert result.lost_ms == 0
        assert result.covered is True


# ---------------------------------------------------------------------------
# score_recall tests
# ---------------------------------------------------------------------------

class TestScoreRecall:
    def test_all_found_in_statements(self):
        expected = [
            ExpectedMoment(desc="disk full", keywords=["disk", "100%"]),
            ExpectedMoment(desc="port conflict", keywords=["5433"]),
        ]
        statements = ["disk is at 100% capacity", "port 5433 already in use"]
        result = score_recall(expected, statements, "")
        assert result.expected == 2
        assert result.matched == 2
        assert result.missed == []

    def test_found_in_narrative(self):
        expected = [
            ExpectedMoment(desc="river pivot", keywords=["journal", "river"]),
        ]
        result = score_recall(expected, [], "The journal becomes the river of truth")
        assert result.matched == 1
        assert result.missed == []

    def test_miss_recorded(self):
        expected = [
            ExpectedMoment(desc="emit-events chronology bug", keywords=["emit", "chronology"]),
        ]
        result = score_recall(expected, ["unrelated statement"], "unrelated narrative")
        assert result.matched == 0
        assert result.missed == ["emit-events chronology bug"]

    def test_case_insensitive(self):
        expected = [ExpectedMoment(desc="test", keywords=["Disk", "FULL"])]
        statements = ["the disk was full"]
        result = score_recall(expected, statements, "")
        assert result.matched == 1

    def test_keyword_must_all_match(self):
        expected = [ExpectedMoment(desc="test", keywords=["persist daemon events", "activity log"])]
        statements = ["persist daemon events somewhere", "check the activity log"]  # split across two
        result = score_recall(expected, statements, "")
        # Second statement matches both keywords? No: "persist daemon events" not in second
        # First has both? No: "activity log" not in first
        assert result.matched == 0

    def test_keyword_all_in_single_statement(self):
        expected = [ExpectedMoment(desc="test", keywords=["persist daemon events", "activity log"])]
        statements = ["we should persist daemon events in the activity log"]
        result = score_recall(expected, statements, "")
        assert result.matched == 1


# ---------------------------------------------------------------------------
# score_precision tests
# ---------------------------------------------------------------------------

class TestScorePrecision:
    def test_no_violations(self):
        forbidden = [ForbiddenClaim(desc="bad claim", keywords=["wrong", "location"])]
        result = score_precision(forbidden, ["correct statement"], "correct narrative")
        assert result.violations == []

    def test_violation_in_statements(self):
        forbidden = [ForbiddenClaim(desc="bad claim", keywords=["wrong", "location"])]
        result = score_precision(forbidden, ["edited in the wrong location"], "")
        assert "bad claim" in result.violations

    def test_violation_in_narrative(self):
        forbidden = [ForbiddenClaim(desc="bad claim", keywords=["all 5", "confirm"])]
        result = score_precision(forbidden, [], "we confirm all 5 tools were invoked")
        assert len(result.violations) == 1

    def test_empty_forbidden(self):
        result = score_precision([], ["any statement"], "any narrative")
        assert result.violations == []


# ---------------------------------------------------------------------------
# score_agency tests
# ---------------------------------------------------------------------------

class TestScoreAgency:
    def _make_moment(self, statement: str, agency: Optional[str]) -> MomentFidelityRow:
        return MomentFidelityRow(
            statement=statement, type="decision", agency=agency, confidence="high",
            chunk_index=0, occurred_at=None, evidence_quotes=[], anchored_evidence_count=0,
        )

    def test_no_agency_constraints(self):
        expected = [ExpectedMoment(desc="no agency", keywords=["test"])]
        moments = [self._make_moment("test statement", "ai")]
        result = score_agency(expected, moments)
        assert result.checked == 0
        assert result.correct == 0
        assert result.wrong == []

    def test_correct_agency(self):
        expected = [ExpectedMoment(desc="dev prompted", keywords=["redesign"], agency="developer")]
        moments = [self._make_moment("developer requested a redesign", "developer")]
        result = score_agency(expected, moments)
        assert result.checked == 1
        assert result.correct == 1
        assert result.wrong == []

    def test_wrong_agency(self):
        expected = [ExpectedMoment(desc="dev prompted", keywords=["redesign"], agency="developer")]
        moments = [self._make_moment("AI proposed a redesign", "ai")]
        result = score_agency(expected, moments)
        assert result.checked == 1
        assert result.correct == 0
        assert len(result.wrong) == 1
        assert "want developer" in result.wrong[0]

    def test_no_matching_moment_skips(self):
        expected = [ExpectedMoment(desc="dev prompted", keywords=["redesign"], agency="developer")]
        moments = [self._make_moment("unrelated statement", "developer")]
        result = score_agency(expected, moments)
        # Keyword doesn't match → checked is 0
        assert result.checked == 0


# ---------------------------------------------------------------------------
# Loader tests (SQLite in-memory)
# ---------------------------------------------------------------------------

class TestLoader:
    def test_load_session_by_hash(self, db):
        s = _session(db, source_hash="abc-123")
        db.commit()
        loaded = load_session_by_hash(db, "abc-123")
        assert loaded is not None
        assert loaded.id == s.id

    def test_load_session_not_found(self, db):
        result = load_session_by_hash(db, "nonexistent")
        assert result is None

    def test_load_session_returns_most_recent(self, db):
        s1 = _session(db, source_hash="hash-x")
        s2 = JournalSession(
            id=_uid(),
            source_type="claude_code",
            source_path="/tmp/t.jsonl",
            source_hash="hash-x",
            created_at=NOW + timedelta(hours=1),  # newer
        )
        db.add(s2)
        db.commit()
        loaded = load_session_by_hash(db, "hash-x")
        assert loaded.id == s2.id

    def test_load_moment_rows_with_evidence(self, db):
        s = _session(db)
        ch = _chunk(db, s.id, chunk_index=3)
        m = _moment(db, s.id, statement="Docker disk full at 100%", chunk_id=ch.id)
        _evidence(db, m.id, "disk is at 100%", source_event_id=None)
        _evidence(db, m.id, "real evidence here", source_event_id="ev-1")
        db.commit()

        rows = load_moment_rows(db, s.id)
        assert len(rows) == 1
        row = rows[0]
        assert row.statement == "Docker disk full at 100%"
        assert row.chunk_index == 3
        assert len(row.evidence_quotes) == 2
        assert row.anchored_evidence_count == 1

    def test_load_moment_rows_no_chunk(self, db):
        s = _session(db)
        _moment(db, s.id, statement="Standalone moment")
        db.commit()

        rows = load_moment_rows(db, s.id)
        assert len(rows) == 1
        assert rows[0].chunk_index is None

    def test_load_narrative_text(self, db):
        s = _session(db)
        _narrative(
            db, s.id,
            summary="Main summary",
            progression=["step one", "step two"],
            discoveries=["found a bug"],
        )
        db.commit()

        text = load_narrative_text(db, s.id)
        assert "Main summary" in text
        assert "step one" in text
        assert "found a bug" in text

    def test_load_narrative_text_not_found(self, db):
        s = _session(db)
        db.commit()
        assert load_narrative_text(db, s.id) == ""

    def test_load_transition_confidence_values(self, db):
        s = _session(db)
        _transition(db, s.id, confidence="high")
        _transition(db, s.id, confidence="low")
        _transition(db, s.id, confidence=None)
        db.commit()

        values = load_transition_confidence_values(db, s.id)
        assert len(values) == 3
        assert set(values) == {"high", "low", None}

    def test_load_outcome_confidence_values(self, db):
        s = _session(db)
        _outcome(db, s.id, confidence="medium")
        _outcome(db, s.id, confidence="high")
        db.commit()

        values = load_outcome_confidence_values(db, s.id)
        assert len(values) == 2
        assert "medium" in values
        assert "high" in values


# ---------------------------------------------------------------------------
# raw_last_event_at tests (uses temp files)
# ---------------------------------------------------------------------------

class TestRawLastEventAt:
    def test_reads_last_non_system_event(self, tmp_path):
        log = tmp_path / "session.jsonl"
        log.write_text(
            '{"timestamp": "2026-07-01T10:00:00.000Z", "type": "human_message"}\n'
            '{"timestamp": "2026-07-01T10:05:00.000Z", "type": "system"}\n'
        )
        result = raw_last_event_at(log)
        assert result is not None
        # Should pick the human_message (last non-system)
        assert result.hour == 10
        assert result.minute == 0

    def test_skips_trailing_system_events(self, tmp_path):
        log = tmp_path / "session.jsonl"
        log.write_text(
            '{"timestamp": "2026-07-01T09:00:00.000Z", "type": "assistant"}\n'
            '{"timestamp": "2026-07-01T10:00:00.000Z", "type": "system"}\n'
            '{"timestamp": "2026-07-01T11:00:00.000Z", "type": "system"}\n'
        )
        result = raw_last_event_at(log)
        assert result is not None
        assert result.hour == 9

    def test_missing_file_returns_none(self, tmp_path):
        result = raw_last_event_at(tmp_path / "nonexistent.jsonl")
        assert result is None

    def test_empty_file_returns_none(self, tmp_path):
        log = tmp_path / "empty.jsonl"
        log.write_text("")
        result = raw_last_event_at(log)
        assert result is None

    def test_invalid_json_lines_skipped(self, tmp_path):
        log = tmp_path / "session.jsonl"
        log.write_text(
            '{"timestamp": "2026-07-01T08:00:00.000Z", "type": "human_message"}\n'
            'this is not json\n'
            '{"timestamp": "2026-07-01T09:00:00.000Z", "type": "system"}\n'
        )
        result = raw_last_event_at(log)
        assert result is not None
        assert result.hour == 8


# ---------------------------------------------------------------------------
# Criteria structure tests
# ---------------------------------------------------------------------------

class TestCriteria:
    def test_four_sessions_defined(self):
        assert len(FIDELITY_CRITERIA) == 4

    def test_all_have_cc_session_ids(self):
        expected_ids = {
            "20f5efec-83cc-4a16-ac34-86728b07ccbf",
            "b9ab1a0c-1315-463d-85e7-3143c9e7fb59",
            "5b31a1bb-3f6b-4d03-b418-a6c0f0ab704c",
            "d73d5190-3683-4204-9e04-d325a7bb6527",
        }
        actual_ids = {c.cc_session_id for c in FIDELITY_CRITERIA}
        assert actual_ids == expected_ids

    def test_agency_constraints_present(self):
        """Session 3 and 4 have agency constraints defined."""
        agency_constrained = [
            c for c in FIDELITY_CRITERIA
            if any(m.agency for m in c.expected_moments)
        ]
        assert len(agency_constrained) == 2

    def test_session3_high_confidence_case(self):
        s3 = next(c for c in FIDELITY_CRITERIA if "17/17" in c.label)
        assert s3 is not None
        # Verify the redesign moment has agency=developer
        redesign = next(
            (m for m in s3.expected_moments if "redesign" in m.keywords), None
        )
        assert redesign is not None
        assert redesign.agency == "developer"

    def test_no_empty_keywords(self):
        for c in FIDELITY_CRITERIA:
            for m in c.expected_moments:
                assert len(m.keywords) > 0, f"{c.label}: {m.desc} has empty keywords"
            for f in c.forbidden_claims:
                assert len(f.keywords) > 0, f"{c.label}: {f.desc} has empty keywords"


# ---------------------------------------------------------------------------
# Integration: full scoring pipeline on synthetic data (offline, no Postgres)
# ---------------------------------------------------------------------------

class TestIntegrationScoringPipeline:
    """End-to-end test using SQLite fixtures — exercises the loader + scorers together."""

    def test_provenance_and_calibration_from_db(self, db):
        s = _session(db, source_hash="test-session-hash")
        ch0 = _chunk(db, s.id, chunk_index=0)
        ch1 = _chunk(db, s.id, chunk_index=1)

        t0 = datetime(2026, 7, 1, 10, 0, 0, tzinfo=timezone.utc)
        t1 = datetime(2026, 7, 1, 11, 0, 0, tzinfo=timezone.utc)

        m1 = _moment(db, s.id, "Docker disk full", confidence="high", chunk_id=ch0.id, occurred_at=t0)
        m2 = _moment(db, s.id, "Port 5433 in use", confidence="medium", chunk_id=ch1.id, occurred_at=t1)
        m3 = _moment(db, s.id, "Clean migration", confidence="high", chunk_id=ch1.id, occurred_at=t1)
        m4 = _moment(db, s.id, "Fabricated claim", confidence="low", chunk_id=ch0.id, occurred_at=None)

        _evidence(db, m1.id, "disk usage at 100%", source_event_id="ev-1")
        _evidence(db, m2.id, "port already in use", source_event_id=None)
        _evidence(db, m3.id, "clean slate migration", source_event_id="ev-2")
        _evidence(db, m4.id, FABRICATED_DEFAULT, source_event_id=None)

        _transition(db, s.id, confidence="high")
        _outcome(db, s.id, confidence="medium")

        db.commit()

        rows = load_moment_rows(db, s.id)
        assert len(rows) == 4

        prov = score_provenance(rows)
        assert prov.moment_count == 4
        assert prov.evidence_real_pct == 75.0  # 3/4 have real quotes
        assert prov.evidence_anchored_pct == 50.0  # m1, m3 are anchored
        assert prov.distinct_chunks == 2
        assert prov.chunk_spread_ok is True
        assert prov.occurred_time_span_ms == 3_600_000  # 1 hour

        cal = score_calibration([r.confidence for r in rows])
        assert cal.distribution == {"high": 2, "medium": 1, "low": 1}
        assert cal.informative is True

        t_conf = load_transition_confidence_values(db, s.id)
        o_conf = load_outcome_confidence_values(db, s.id)
        to_cal = score_calibration(t_conf + o_conf)
        assert to_cal.distribution == {"high": 1, "medium": 1}
        assert to_cal.informative is True

    def test_recall_and_precision_from_db(self, db):
        s = _session(db)
        _moment(db, s.id, "disk usage at 100% detected")
        _moment(db, s.id, "port 5433 was already in use")
        _narrative(db, s.id, summary="journal river model adopted", discoveries=["topic excised"])
        db.commit()

        rows = load_moment_rows(db, s.id)
        narrative = load_narrative_text(db, s.id)
        statements = [r.statement for r in rows]

        expected = [
            ExpectedMoment(desc="disk full", keywords=["disk", "100%"]),
            ExpectedMoment(desc="port conflict", keywords=["5433"]),
            ExpectedMoment(desc="river pivot", keywords=["journal", "river"]),
        ]
        forbidden = [ForbiddenClaim(desc="wrong location", keywords=["wrong location"])]

        recall = score_recall(expected, statements, narrative)
        assert recall.matched == 3
        assert recall.missed == []

        precision = score_precision(forbidden, statements, narrative)
        assert precision.violations == []

    def test_canned_harness_plumbing(self, db):
        """Smoke test: the full loop (load → score → report) runs without error."""
        s = _session(db, source_hash="smoke-test-hash")
        _moment(db, s.id, "test moment", confidence="high")
        _narrative(db, s.id, summary="smoke test narrative")
        _transition(db, s.id, confidence="medium")
        _outcome(db, s.id, confidence="high")
        db.commit()

        session = load_session_by_hash(db, "smoke-test-hash")
        assert session is not None

        rows = load_moment_rows(db, session.id)
        narrative_text = load_narrative_text(db, session.id)
        t_conf = load_transition_confidence_values(db, session.id)
        o_conf = load_outcome_confidence_values(db, session.id)

        prov = score_provenance(rows)
        moment_cal = score_calibration([r.confidence for r in rows])
        to_cal = score_calibration(t_conf + o_conf)
        tail = score_tail(session.ended_at, None)

        assert prov.moment_count == 1
        assert moment_cal.distribution == {"high": 1}
        assert not moment_cal.informative
        assert to_cal.distribution == {"medium": 1, "high": 1}
        assert to_cal.informative
        assert tail.covered is True
