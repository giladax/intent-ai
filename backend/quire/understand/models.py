"""Domain models for the understanding stage (moments → narrative).

Port of the LLM-derived halves of journal/src/adapters/types.ts. These sit
downstream of the deterministic ingest models (quire.ingest.models) and are
the shapes the extract → weave → verify → transitions → narrative steps produce
and that db.writer persists.

Pydantic leniency mirrors the TS Zod-lenient contracts (optional().default(),
passthrough): required structure lives in the schema, not in prompt wording.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


# ── Session shape ─────────────────────────────────────────────────────

SessionShape = Literal["narrative", "exploratory", "janitorial", "debugging", "review"]


# ── Evidence ──────────────────────────────────────────────────────────


class EvidenceAnchor(BaseModel):
    """Pipeline evidence: a quote anchored (or not) to a normalized event."""

    quote: str
    event_index: Optional[int] = None  # causalOrder
    anchored: bool = False
    source_type: Literal["user", "ai", "tool_output"] = "ai"


# ── Extracted / woven moment ──────────────────────────────────────────

MomentType = Literal[
    "proposal",
    "discovery",
    "pivot",
    "confirmation",
    "rejection",
    "commitment",
    "struggle",
    "breakthrough",
    "execution",
]


class ExtractedMoment(BaseModel):
    """Per-chunk moment after anchor validation (pre-weave)."""

    id: str  # deterministic: c{chunkIndex}-m{i}
    chunk_index: int
    type: MomentType
    statement: str
    significance: str = ""
    agency: Literal["developer", "ai", "collaborative"]
    confidence: Optional[Literal["high", "medium", "low"]] = None
    topic_fingerprint: str = "general"
    evidence: list[EvidenceAnchor] = Field(default_factory=list)
    occurred_at: Optional[str] = None  # ISO


class SessionMoment(BaseModel):
    """Final woven moment (after weave/verify/confidence)."""

    id: str
    chunk_id: str
    type: MomentType
    statement: str
    significance: str = ""
    agency: Literal["developer", "ai", "collaborative", "ambiguous"]
    confidence: Literal["high", "medium", "low"]
    topic_fingerprint: str = "general"
    related_moment_ids: list[str] = Field(default_factory=list)
    arc_id: Optional[str] = None
    arc_role: Optional[Literal["origin", "escalation", "turning_point", "resolution"]] = None
    evidence: list[EvidenceAnchor] = Field(default_factory=list)
    occurred_at: Optional[str] = None  # ISO
    verification: Optional[Literal["supported", "contradicted", "unverified"]] = None


# ── Transitions / outcomes ────────────────────────────────────────────


class IntentTransition(BaseModel):
    id: str
    session_id: str
    from_statement: str
    to_statement: str
    reason: str = ""
    origin_moment_ids: list[str] = Field(default_factory=list)
    arc_id: Optional[str] = None
    confidence: Optional[Literal["high", "medium", "low"]] = None


class AcceptedOutcome(BaseModel):
    id: str
    session_id: str
    statement: str
    supporting_moment_ids: list[str] = Field(default_factory=list)
    supporting_files: list[str] = Field(default_factory=list)
    confidence: Optional[Literal["high", "medium", "low"]] = None


# ── Narrative ─────────────────────────────────────────────────────────


class NarrativeArc(BaseModel):
    arc_id: str
    title: str
    summary: str = ""
    moment_ids: list[str] = Field(default_factory=list)
    resolution: Literal["resolved", "abandoned", "open"] = "open"


class SessionNarrative(BaseModel):
    session_id: str = ""
    session_shape: SessionShape = "narrative"
    summary: str = ""
    progression: list[str] = Field(default_factory=list)
    discoveries: list[str] = Field(default_factory=list)
    stabilized_directions: list[str] = Field(default_factory=list)
    abandoned_directions: list[str] = Field(default_factory=list)
    arcs: list[NarrativeArc] = Field(default_factory=list)


# ── Full understand result ────────────────────────────────────────────


class UnderstandResult(BaseModel):
    sittings: list = Field(default_factory=list)  # ingest.models.Sitting
    chunks: list = Field(default_factory=list)  # ingest.models.SessionChunk
    moments: list[SessionMoment] = Field(default_factory=list)
    transitions: list[IntentTransition] = Field(default_factory=list)
    outcomes: list[AcceptedOutcome] = Field(default_factory=list)
    narrative: SessionNarrative = Field(default_factory=SessionNarrative)

    model_config = {"arbitrary_types_allowed": True}
