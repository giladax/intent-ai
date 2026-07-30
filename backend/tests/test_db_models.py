"""Unit tests for quire.db models — SQLite in-memory, no Postgres required.

All tests run offline. If DATABASE_URL points at a live Postgres the
engine module will happily use it, but nothing here depends on it.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

import quire.links  # noqa: F401 — registers SessionCheck in Base.metadata before create_all
from quire.db.engine import make_test_engine
from quire.db.models import (
    ActivityEvent,
    AttentionState,
    Base,
    Chunk,
    Feature,
    FeatureFile,
    FeatureSession,
    FeedCache,
    Moment,
    MomentEvidence,
    MomentRelation,
    Narrative,
    NarrativeArc,
    NormalizedEvent,
    Outcome,
    OutcomeFile,
    OutcomeMoment,
    Project,
    RawEvent,
    Session as JournalSession,
    Sitting,
    Transition,
    TransitionMoment,
)

NOW = datetime(2026, 7, 21, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
def engine():
    """SQLite in-memory engine with all LIVE tables created."""
    eng = make_test_engine()
    Base.metadata.create_all(eng)
    yield eng
    Base.metadata.drop_all(eng)


@pytest.fixture
def session(engine):
    """A transactional session that rolls back after each test."""
    with Session(engine) as s:
        yield s


# ── helpers ────────────────────────────────────────────────────────────

def _uid() -> str:
    return str(uuid.uuid4())


def _project(session: Session) -> Project:
    p = Project(id=_uid(), name="intent-ai", path="/dev/intent-ai", created_at=NOW)
    session.add(p)
    session.flush()
    return p


def _feature(session: Session, project: Project) -> Feature:
    f = Feature(
        id=_uid(),
        project_id=project.id,
        name="Repo Brain",
        description="brain MCP",
        constraints=[],
        known_unknowns=[],
        created_at=NOW,
    )
    session.add(f)
    session.flush()
    return f


def _journal_session(session: Session) -> JournalSession:
    s = JournalSession(
        id=_uid(),
        source_type="claude_code",
        source_path="/tmp/session.jsonl",
        started_at=NOW,
        ended_at=NOW,
        created_at=NOW,
    )
    session.add(s)
    session.flush()
    return s


# ── schema census ──────────────────────────────────────────────────────

def test_all_live_tables_exist_in_schema(engine):
    """All LIVE tables from the census are created by Base.metadata."""
    inspector = inspect(engine)
    existing = set(inspector.get_table_names())
    expected = {
        # Inherited schema (22 tables from Drizzle, frozen at ts-backend-final)
        "activity_events", "attention_state", "chunks", "feature_files",
        "feature_sessions", "features", "feed_cache", "moment_evidence",
        "moment_relations", "moments", "narrative_arcs", "narratives",
        "normalized_events", "outcome_files", "outcome_moments", "outcomes",
        "projects", "raw_events", "sessions", "sittings",
        "transition_moments", "transitions",
        # Post-freeze additions (U0+)
        "session_checks",
    }
    missing = expected - existing
    assert not missing, f"missing tables: {missing}"


def test_dead_tables_are_not_modelled(engine):
    """Topic-era DEAD tables must NOT appear in Base.metadata."""
    inspector = inspect(engine)
    existing = set(inspector.get_table_names())
    dead = {
        "topics", "insights", "insight_evidence",
        "brain_cards", "brain_versions",
        "topic_files", "topic_patterns", "topic_relations",
        "topic_sessions", "topic_skills",
    }
    present = dead & existing
    assert not present, f"DEAD tables should not be modelled: {present}"


# ── project + feature hierarchy ────────────────────────────────────────

def test_project_and_feature_roundtrip(session):
    p = _project(session)
    f = _feature(session, p)
    session.commit()

    loaded = session.execute(select(Feature).where(Feature.id == f.id)).scalar_one()
    assert loaded.name == "Repo Brain"
    assert loaded.project_id == p.id
    assert loaded.constraints == []


def test_feature_file_linked_to_feature(session):
    p = _project(session)
    f = _feature(session, p)
    ff = FeatureFile(id=_uid(), feature_id=f.id, glob="src/mcp/**/*.ts", created_at=NOW)
    session.add(ff)
    session.commit()

    loaded = session.execute(
        select(FeatureFile).where(FeatureFile.feature_id == f.id)
    ).scalars().all()
    assert len(loaded) == 1
    assert loaded[0].glob == "src/mcp/**/*.ts"


# ── session + normalized events ────────────────────────────────────────

def test_journal_session_roundtrip(session):
    js = _journal_session(session)
    session.commit()

    loaded = session.execute(
        select(JournalSession).where(JournalSession.id == js.id)
    ).scalar_one()
    assert loaded.source_type == "claude_code"
    # SQLite drops tz info on DateTime; compare naive-safe
    assert loaded.started_at.replace(tzinfo=None) == NOW.replace(tzinfo=None)


def test_normalized_event_linked_to_session(session):
    js = _journal_session(session)
    ne = NormalizedEvent(
        id=_uid(),
        session_id=js.id,
        causal_order=1,
        category="tool_use",
        actor="claude",
        summary="Read a file",
        files_affected=["src/foo.ts"],
    )
    session.add(ne)
    session.commit()

    loaded = session.execute(
        select(NormalizedEvent).where(NormalizedEvent.session_id == js.id)
    ).scalar_one()
    assert loaded.summary == "Read a file"
    assert loaded.files_affected == ["src/foo.ts"]


# ── activity events (primary LIVE table) ──────────────────────────────

def test_activity_event_roundtrip(session):
    ae = ActivityEvent(
        id=_uid(),
        timestamp=NOW,
        category="session:digest",
        tags=["pipeline", "test"],
        actor="pipeline",
        summary="digested session foo",
        event_metadata={"session_id": "abc"},  # mapped column is event_metadata (DB col "metadata")
        repo="intent-ai",
        branch="feat/repo-brain",
        created_at=NOW,
    )
    session.add(ae)
    session.commit()
    # Expunge so the next SELECT hits the DB, not the identity-map cache.
    session.expunge_all()

    loaded = session.execute(
        select(ActivityEvent).order_by(ActivityEvent.timestamp.desc())
    ).scalar_one()
    assert loaded.category == "session:digest"
    assert loaded.tags == ["pipeline", "test"]
    assert loaded.event_metadata == {"session_id": "abc"}
    assert loaded.repo == "intent-ai"


def test_activity_event_metadata_kwarg_does_not_populate_column(session):
    """Guard: passing metadata= (wrong kwarg) silently sets a plain Python attr.

    SQLAlchemy 2 declarative does NOT raise TypeError for undeclared kwargs;
    it just sets a bare instance attribute.  The DB column (event_metadata)
    gets its default ({}) instead of the intended value.  This test documents
    that trap so it can never silently regress.
    """
    ae = ActivityEvent(
        id=_uid(),
        timestamp=NOW,
        category="trap:check",
        tags=[],
        actor="test",
        summary="metadata= kwarg trap",
        metadata={"should_not_reach_db": True},  # WRONG kwarg — intentional
        created_at=NOW,
    )
    # The wrong kwarg becomes a plain attr, not the DB column.
    assert ae.event_metadata is None or ae.event_metadata == {}
    session.add(ae)
    session.commit()
    session.expunge_all()

    loaded = session.execute(
        select(ActivityEvent).where(ActivityEvent.category == "trap:check")
    ).scalar_one()
    # The DB column must NOT contain the value passed via the wrong kwarg.
    assert loaded.event_metadata != {"should_not_reach_db": True}


def test_activity_event_filter_by_category(session):
    for cat in ("session:digest", "observation:insight", "session:other"):
        session.add(ActivityEvent(
            id=_uid(), timestamp=NOW, category=cat, actor="pipeline",
            summary=f"event {cat}", tags=[], event_metadata={}, created_at=NOW,
        ))
    session.commit()

    stmt = select(ActivityEvent).where(ActivityEvent.category.like("session:%"))
    rows = session.execute(stmt).scalars().all()
    assert len(rows) == 2
    assert all(r.category.startswith("session:") for r in rows)


# ── moments + evidence chain ───────────────────────────────────────────

def test_moment_with_evidence(session):
    js = _journal_session(session)
    m = Moment(
        id=_uid(), session_id=js.id,
        type="decision", statement="Use SQLAlchemy for read path",
        confidence="high", verification="supported",
    )
    session.add(m)
    session.flush()

    ev = MomentEvidence(
        id=_uid(), moment_id=m.id,
        quote="SQLAlchemy is the right choice", source_type="human_message",
    )
    session.add(ev)
    session.commit()

    loaded_m = session.execute(
        select(Moment).where(Moment.id == m.id)
    ).scalar_one()
    assert loaded_m.confidence == "high"
    assert len(loaded_m.evidence) == 1
    assert loaded_m.evidence[0].quote.startswith("SQLAlchemy")


def test_moment_relation(session):
    js = _journal_session(session)
    m1 = Moment(id=_uid(), session_id=js.id, type="decision", statement="A")
    m2 = Moment(id=_uid(), session_id=js.id, type="decision", statement="B")
    session.add_all([m1, m2])
    session.flush()
    rel = MomentRelation(moment_id=m1.id, related_moment_id=m2.id, relation_type="evolved_into")
    session.add(rel)
    session.commit()

    loaded = session.execute(
        select(MomentRelation).where(MomentRelation.moment_id == m1.id)
    ).scalar_one()
    assert loaded.relation_type == "evolved_into"


# ── narrative + arcs ───────────────────────────────────────────────────

def test_narrative_with_arcs(session):
    js = _journal_session(session)
    n = Narrative(
        id=_uid(), session_id=js.id,
        summary="Implemented the DB layer",
        progression=["step 1", "step 2"],
        discoveries=["SQLAlchemy works"],
        stabilized_directions=["use psycopg3"],
        abandoned_directions=[],
    )
    session.add(n)
    session.flush()

    arc = NarrativeArc(
        id=_uid(), narrative_id=n.id,
        arc_id="arc-1", title="DB setup", summary="wrote models",
        moment_ids=["m1", "m2"],
    )
    session.add(arc)
    session.commit()

    loaded = session.execute(
        select(Narrative).where(Narrative.id == n.id)
    ).scalar_one()
    assert loaded.summary == "Implemented the DB layer"
    assert len(loaded.arcs) == 1
    assert loaded.arcs[0].title == "DB setup"


# ── feature session join ───────────────────────────────────────────────

def test_feature_session_join(session):
    p = _project(session)
    f = _feature(session, p)
    js = _journal_session(session)
    fs = FeatureSession(feature_id=f.id, session_id=js.id, role="primary")
    session.add(fs)
    session.commit()

    loaded = session.execute(
        select(FeatureSession).where(FeatureSession.feature_id == f.id)
    ).scalar_one()
    assert loaded.role == "primary"


# ── feed cache + attention state ───────────────────────────────────────

def test_feed_cache_roundtrip(session):
    fc = FeedCache(
        id="org",
        payload={"items": [{"id": "1", "summary": "test"}]},
        composed_at=NOW,
        event_count_at_compose=42,
    )
    session.add(fc)
    session.commit()

    loaded = session.execute(select(FeedCache).where(FeedCache.id == "org")).scalar_one()
    assert loaded.event_count_at_compose == 42
    assert loaded.payload["items"][0]["id"] == "1"


def test_attention_state_roundtrip(session):
    att = AttentionState(
        id="current",
        state={"featureId": "feat-1", "view": "journal"},
        updated_at=NOW,
    )
    session.add(att)
    session.commit()

    loaded = session.execute(
        select(AttentionState).where(AttentionState.id == "current")
    ).scalar_one()
    assert loaded.state["featureId"] == "feat-1"


# ── transitions ────────────────────────────────────────────────────────

def test_transition_and_join(session):
    js = _journal_session(session)
    t = Transition(
        id=_uid(), session_id=js.id,
        from_statement="plan A", to_statement="plan B",
        reason="plan A failed", confidence="high",
    )
    session.add(t)
    session.flush()
    m = Moment(id=_uid(), session_id=js.id, type="pivot", statement="switched")
    session.add(m)
    session.flush()
    tm = TransitionMoment(transition_id=t.id, moment_id=m.id)
    session.add(tm)
    session.commit()

    loaded_t = session.execute(
        select(Transition).where(Transition.id == t.id)
    ).scalar_one()
    assert loaded_t.from_statement == "plan A"


# ── outcomes ───────────────────────────────────────────────────────────

def test_outcome_with_files_and_moments(session):
    js = _journal_session(session)
    o = Outcome(id=_uid(), session_id=js.id, statement="shipped the DB layer", confidence="high")
    session.add(o)
    session.flush()
    of = OutcomeFile(outcome_id=o.id, file_path="backend/quire/db/models.py")
    m = Moment(id=_uid(), session_id=js.id, type="outcome", statement="done")
    session.add_all([of, m])
    session.flush()
    om = OutcomeMoment(outcome_id=o.id, moment_id=m.id)
    session.add(om)
    session.commit()

    loaded = session.execute(select(Outcome).where(Outcome.id == o.id)).scalar_one()
    assert loaded.confidence == "high"
