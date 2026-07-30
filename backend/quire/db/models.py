"""SQLAlchemy declarative models for the journal's LIVE tables.

Read-only: no insert/update/delete paths here. Drizzle (journal/src) owns
all writes and all schema migrations. Adding columns here must mirror a
prior Drizzle migration — never the reverse.

Tables modelled (22 LIVE per CENSUS.md):
    activity_events, attention_state, chunks, feature_files,
    feature_sessions, features, feed_cache, moment_evidence,
    moment_relations, moments, narrative_arcs, narratives,
    normalized_events, outcome_files, outcome_moments, outcomes,
    projects, raw_events, sessions, sittings, transition_moments,
    transitions

DEAD tables (topic-era, 10 total) are intentionally omitted.

Type mapping from Drizzle → SQLAlchemy:
    uuid         → String (Postgres UUIDs come back as str; SQLite compat too)
    text         → String
    text[]       → JSON  (Postgres arrays; SQLite stores as JSON)
    integer      → Integer
    jsonb        → JSON
    timestamptz  → DateTime(timezone=True)
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import JSON


class Base(DeclarativeBase):
    """Shared declarative base for all journal models."""


# ── Projects ──────────────────────────────────────────────────────────

class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    path: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    features: Mapped[list["Feature"]] = relationship("Feature", back_populates="project")


# ── Features ──────────────────────────────────────────────────────────

class Feature(Base):
    __tablename__ = "features"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(String, ForeignKey("projects.id"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    current_understanding: Mapped[str | None] = mapped_column(Text)
    constraints: Mapped[Any] = mapped_column(JSON, nullable=False, default=list)
    known_unknowns: Mapped[Any] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    project: Mapped["Project"] = relationship("Project", back_populates="features")
    feature_files: Mapped[list["FeatureFile"]] = relationship("FeatureFile", back_populates="feature")


# ── Feature Files ──────────────────────────────────────────────────────

class FeatureFile(Base):
    __tablename__ = "feature_files"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    feature_id: Mapped[str] = mapped_column(String, ForeignKey("features.id"), nullable=False)
    glob: Mapped[str | None] = mapped_column(Text)
    file_path: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    feature: Mapped["Feature"] = relationship("Feature", back_populates="feature_files")


# ── Sessions ───────────────────────────────────────────────────────────

class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    source_type: Mapped[str] = mapped_column(Text, nullable=False)
    source_path: Mapped[str] = mapped_column(Text, nullable=False)
    session_shape: Mapped[str | None] = mapped_column(Text)
    source_hash: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


# ── Feature Sessions (join table) ─────────────────────────────────────

class FeatureSession(Base):
    __tablename__ = "feature_sessions"

    feature_id: Mapped[str] = mapped_column(String, ForeignKey("features.id"), primary_key=True)
    session_id: Mapped[str] = mapped_column(String, ForeignKey("sessions.id"), primary_key=True)
    role: Mapped[str] = mapped_column(Text, nullable=False)


# ── Raw Events ─────────────────────────────────────────────────────────

class RawEvent(Base):
    __tablename__ = "raw_events"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    session_id: Mapped[str] = mapped_column(String, ForeignKey("sessions.id"), nullable=False)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    type: Mapped[str] = mapped_column(Text, nullable=False)
    raw: Mapped[Any] = mapped_column(JSON, nullable=False)


# ── Normalized Events ──────────────────────────────────────────────────

class NormalizedEvent(Base):
    __tablename__ = "normalized_events"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    session_id: Mapped[str] = mapped_column(String, ForeignKey("sessions.id"), nullable=False)
    raw_event_id: Mapped[str | None] = mapped_column(String, ForeignKey("raw_events.id"))
    causal_order: Mapped[int] = mapped_column(Integer, nullable=False)
    category: Mapped[str] = mapped_column(Text, nullable=False)
    actor: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    detail: Mapped[str | None] = mapped_column(Text)
    files_affected: Mapped[Any] = mapped_column(JSON)  # text[]


# ── Chunks ─────────────────────────────────────────────────────────────

class Chunk(Base):
    __tablename__ = "chunks"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    session_id: Mapped[str] = mapped_column(String, ForeignKey("sessions.id"), nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    topic_hint: Mapped[str | None] = mapped_column(Text)
    files_in_scope: Mapped[Any] = mapped_column(JSON)  # text[]
    event_range_start: Mapped[int] = mapped_column(Integer, nullable=False)
    event_range_end: Mapped[int] = mapped_column(Integer, nullable=False)


# ── Sittings ───────────────────────────────────────────────────────────

class Sitting(Base):
    __tablename__ = "sittings"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    session_id: Mapped[str] = mapped_column(String, ForeignKey("sessions.id"), nullable=False)
    sitting_index: Mapped[int] = mapped_column(Integer, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    event_range_start: Mapped[int] = mapped_column(Integer, nullable=False)
    event_range_end: Mapped[int] = mapped_column(Integer, nullable=False)


# ── Moments ────────────────────────────────────────────────────────────

class Moment(Base):
    __tablename__ = "moments"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    session_id: Mapped[str] = mapped_column(String, ForeignKey("sessions.id"), nullable=False)
    chunk_id: Mapped[str | None] = mapped_column(String, ForeignKey("chunks.id"))
    type: Mapped[str] = mapped_column(Text, nullable=False)
    statement: Mapped[str] = mapped_column(Text, nullable=False)
    significance: Mapped[str | None] = mapped_column(Text)
    agency: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[str | None] = mapped_column(Text)
    topic_fingerprint: Mapped[str | None] = mapped_column(Text)
    arc_id: Mapped[str | None] = mapped_column(Text)
    arc_role: Mapped[str | None] = mapped_column(Text)
    occurred_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verification: Mapped[str | None] = mapped_column(Text)

    evidence: Mapped[list["MomentEvidence"]] = relationship(
        "MomentEvidence", back_populates="moment"
    )


# ── Moment Evidence ────────────────────────────────────────────────────

class MomentEvidence(Base):
    __tablename__ = "moment_evidence"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    moment_id: Mapped[str] = mapped_column(String, ForeignKey("moments.id"), nullable=False)
    quote: Mapped[str] = mapped_column(Text, nullable=False)
    source_event_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("normalized_events.id")
    )
    source_type: Mapped[str | None] = mapped_column(Text)
    quote_type: Mapped[str | None] = mapped_column(Text)

    moment: Mapped["Moment"] = relationship("Moment", back_populates="evidence")


# ── Moment Relations ───────────────────────────────────────────────────

class MomentRelation(Base):
    __tablename__ = "moment_relations"

    moment_id: Mapped[str] = mapped_column(
        String, ForeignKey("moments.id"), primary_key=True
    )
    related_moment_id: Mapped[str] = mapped_column(
        String, ForeignKey("moments.id"), primary_key=True
    )
    relation_type: Mapped[str] = mapped_column(Text, nullable=False)


# ── Transitions ────────────────────────────────────────────────────────

class Transition(Base):
    __tablename__ = "transitions"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    session_id: Mapped[str] = mapped_column(String, ForeignKey("sessions.id"), nullable=False)
    from_statement: Mapped[str] = mapped_column(Text, nullable=False)
    to_statement: Mapped[str] = mapped_column(Text, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    arc_id: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[str | None] = mapped_column(Text)


# ── Transition Moments (join table) ────────────────────────────────────

class TransitionMoment(Base):
    __tablename__ = "transition_moments"

    transition_id: Mapped[str] = mapped_column(
        String, ForeignKey("transitions.id"), primary_key=True
    )
    moment_id: Mapped[str] = mapped_column(
        String, ForeignKey("moments.id"), primary_key=True
    )


# ── Outcomes ───────────────────────────────────────────────────────────

class Outcome(Base):
    __tablename__ = "outcomes"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    session_id: Mapped[str] = mapped_column(String, ForeignKey("sessions.id"), nullable=False)
    statement: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[str | None] = mapped_column(Text)


# ── Outcome Moments (join table) ───────────────────────────────────────

class OutcomeMoment(Base):
    __tablename__ = "outcome_moments"

    outcome_id: Mapped[str] = mapped_column(
        String, ForeignKey("outcomes.id"), primary_key=True
    )
    moment_id: Mapped[str] = mapped_column(
        String, ForeignKey("moments.id"), primary_key=True
    )


# ── Outcome Files ──────────────────────────────────────────────────────

class OutcomeFile(Base):
    __tablename__ = "outcome_files"

    outcome_id: Mapped[str] = mapped_column(
        String, ForeignKey("outcomes.id"), primary_key=True
    )
    file_path: Mapped[str] = mapped_column(Text, primary_key=True)


# ── Narratives ─────────────────────────────────────────────────────────

class Narrative(Base):
    __tablename__ = "narratives"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    session_id: Mapped[str] = mapped_column(String, ForeignKey("sessions.id"), nullable=False)
    session_shape: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    progression: Mapped[Any] = mapped_column(JSON)   # text[]
    discoveries: Mapped[Any] = mapped_column(JSON)   # text[]
    stabilized_directions: Mapped[Any] = mapped_column(JSON)  # text[]
    abandoned_directions: Mapped[Any] = mapped_column(JSON)   # text[]

    arcs: Mapped[list["NarrativeArc"]] = relationship("NarrativeArc", back_populates="narrative")


# ── Narrative Arcs ─────────────────────────────────────────────────────

class NarrativeArc(Base):
    __tablename__ = "narrative_arcs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    narrative_id: Mapped[str] = mapped_column(
        String, ForeignKey("narratives.id"), nullable=False
    )
    arc_id: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text)
    resolution: Mapped[str | None] = mapped_column(Text)
    moment_ids: Mapped[Any] = mapped_column(JSON)  # text[]

    narrative: Mapped["Narrative"] = relationship("Narrative", back_populates="arcs")


# ── Activity Events ─────────────────────────────────────────────────────

class ActivityEvent(Base):
    __tablename__ = "activity_events"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    category: Mapped[str] = mapped_column(Text, nullable=False)
    tags: Mapped[Any] = mapped_column(JSON, default=list)          # text[]
    actor: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    event_metadata: Mapped[Any] = mapped_column("metadata", JSON, default=dict)  # jsonb; 'metadata' is reserved by SA

    source_type: Mapped[str | None] = mapped_column(Text)
    source_id: Mapped[str | None] = mapped_column(Text)

    session_id: Mapped[str | None] = mapped_column(Text)  # no FK — intentionally denormalized
    repo: Mapped[str | None] = mapped_column(Text)
    branch: Mapped[str | None] = mapped_column(Text)
    worktree: Mapped[str | None] = mapped_column(Text)

    feature_id: Mapped[str | None] = mapped_column(Text)  # no FK — intentionally denormalized
    review_status: Mapped[str | None] = mapped_column(Text, default="pending")

    topic_ids: Mapped[Any] = mapped_column(JSON, default=list)  # uuid[]
    files: Mapped[Any] = mapped_column(JSON, default=list)       # text[]

    embedding: Mapped[str | None] = mapped_column(Text)  # stored as text; cast to vector in queries

    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ── Feed Cache ─────────────────────────────────────────────────────────

class FeedCache(Base):
    __tablename__ = "feed_cache"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    payload: Mapped[Any] = mapped_column(JSON, nullable=False)
    composed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    event_count_at_compose: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


# ── Attention State ────────────────────────────────────────────────────

class AttentionState(Base):
    __tablename__ = "attention_state"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default="current")
    state: Mapped[Any] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
