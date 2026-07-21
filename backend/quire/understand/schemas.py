"""Structured-output schemas for the understanding LLM steps.

One Pydantic model per LLM call's `.with_structured_output` target. These
mirror the Zod schemas in journal/src/llm/prompts/** exactly, including the
lenient defaults (optional().default()) and the transform/alias-union
behaviour (reproduced with validators). The domain shapes live in models.py;
these are strictly the on-the-wire LLM outputs.
"""

from __future__ import annotations

from typing import Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# ── classify: SessionShapeSchema ──────────────────────────────────────


class SessionShapeOutput(BaseModel):
    shape: Literal["narrative", "exploratory", "janitorial", "debugging", "review"]


# ── topic shifts (chunk.ts TopicShiftSchema) ──────────────────────────


class TopicShiftEntry(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)  # .passthrough()
    event_id: str = Field(alias="eventId")
    is_topic_shift: bool = Field(default=False, alias="isTopicShift")


class TopicShiftOutput(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)
    shifts: list[TopicShiftEntry] = Field(default_factory=list)


# ── classify-exchanges (ClassificationSchema) ─────────────────────────

_VALID_CANDIDATE_TYPES = {
    "proposal",
    "discovery",
    "pivot",
    "confirmation",
    "rejection",
    "commitment",
    "struggle",
    "breakthrough",
    "execution",
}


class ExchangeClassification(BaseModel):
    engagement: Literal["passive", "active", "challenging"]
    intent: Literal[
        "acceptance", "rejection", "question", "delegation", "refinement", "challenge"
    ]
    agency: Literal["developer", "ai", "collaborative", "ambiguous"]
    candidate_type: Optional[str] = Field(default=None, alias="candidateType")

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("candidate_type", mode="before")
    @classmethod
    def _coerce_candidate_type(cls, v: object) -> Optional[str]:
        # Zod: nullable().optional().default(null).transform(valid ? v : null)
        if isinstance(v, str) and v in _VALID_CANDIDATE_TYPES:
            return v
        return None


class BatchClassificationOutput(BaseModel):
    classifications: list[ExchangeClassification] = Field(default_factory=list)


# ── extract (ExtractOutputSchema) ─────────────────────────────────────


class ExtractEvidence(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    quote: str
    # number | string | null → parsed to int|None in validateAnchors; keep raw
    event_index: Union[int, str, None] = Field(default=None, alias="eventIndex")
    source_type: Literal["user", "ai", "tool_output"] = Field(
        default="ai", alias="sourceType"
    )

    @field_validator("event_index", mode="before")
    @classmethod
    def _keep_raw(cls, v: object) -> Union[int, str, None]:
        return v  # normalization to int happens in validate_anchors


class ExtractMoment(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    type: Literal[
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
    statement: str
    significance: str = ""
    agency: Literal["developer", "ai", "collaborative"]
    confidence: Optional[Literal["high", "medium", "low"]] = None
    topic_fingerprint: str = Field(default="general", alias="topicFingerprint")
    evidence: list[ExtractEvidence] = Field(min_length=1)


class ExtractOutput(BaseModel):
    moments: list[ExtractMoment] = Field(default_factory=list)


# ── weave (WeaveOutputSchema) ─────────────────────────────────────────


class WeaveDecision(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    action: Literal["keep", "merge", "drop"]
    moment_ids: list[str] = Field(alias="momentIds", min_length=1)
    arc_id: str = Field(default="general", alias="arcId")
    arc_role: Literal["origin", "development", "turning_point", "resolution"] = Field(
        default="development", alias="arcRole"
    )
    related_to: list[str] = Field(default_factory=list, alias="relatedTo")
    statement: Optional[str] = None
    reason: Optional[str] = None


class WeaveOutput(BaseModel):
    decisions: list[WeaveDecision] = Field(default_factory=list)


# ── verify (VerifyOutputSchema) ───────────────────────────────────────


class VerifyVerdict(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    moment_id: str = Field(alias="momentId")
    verdict: Literal["supported", "contradicted", "unverified"]
    note: str = ""


class VerifyOutput(BaseModel):
    verdicts: list[VerifyVerdict] = Field(default_factory=list)


# ── transitions (TransitionsOutputSchema) ─────────────────────────────


class TransitionEntry(BaseModel):
    """IntentTransitionSchema: alias-union + transform reproduced in a
    model_validator so from/to and *MomentIndices variants collapse."""

    model_config = ConfigDict(populate_by_name=True, extra="allow")
    from_statement: str = ""
    to_statement: str = ""
    reason: str = ""
    triggering_moment_indices: list[int] = Field(default_factory=list)
    arc_id: str = "general"
    confidence: Optional[Literal["high", "medium", "low"]] = None

    @model_validator(mode="before")
    @classmethod
    def _collapse(cls, data: object) -> object:
        if not isinstance(data, dict):
            return data
        d = dict(data)
        from_s = d.get("fromStatement") or d.get("from_statement") or d.get("from") or ""
        to_s = d.get("toStatement") or d.get("to_statement") or d.get("to") or ""
        trig = d.get("triggeringMomentIndices")
        if trig is None:
            trig = d.get("triggering_moment_indices")
        if not trig:
            trig = d.get("momentIndices") or d.get("moment_indices") or []
        return {
            "from_statement": from_s,
            "to_statement": to_s,
            "reason": d.get("reason", "") or "",
            "triggering_moment_indices": trig or [],
            "arc_id": d.get("arcId") or d.get("arc_id") or "general",
            "confidence": d.get("confidence"),
        }


class OutcomeEntry(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")
    statement: str = ""
    supporting_moment_indices: list[int] = Field(default_factory=list)
    files_affected: list[str] = Field(default_factory=list)
    confidence: Optional[Literal["high", "medium", "low"]] = None

    @model_validator(mode="before")
    @classmethod
    def _collapse(cls, data: object) -> object:
        if not isinstance(data, dict):
            return data
        d = dict(data)
        sup = d.get("supportingMomentIndices")
        if sup is None:
            sup = d.get("supporting_moment_indices")
        if not sup:
            sup = d.get("momentIndices") or d.get("moment_indices") or []
        files = d.get("filesAffected")
        if files is None:
            files = d.get("files_affected")
        if not files:
            files = d.get("files") or []
        return {
            "statement": d.get("statement", "") or "",
            "supporting_moment_indices": sup or [],
            "files_affected": files or [],
            "confidence": d.get("confidence"),
        }


class TransitionsOutput(BaseModel):
    transitions: list[TransitionEntry] = Field(default_factory=list)
    outcomes: list[OutcomeEntry] = Field(default_factory=list)


# ── narrative (SessionNarrativeSchema) ────────────────────────────────


class NarrativeArcOutput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    arc_id: str = Field(alias="arcId")
    title: str
    summary: str
    resolution: Literal["completed", "abandoned", "ongoing", "merged"]
    moment_ids: list[int] = Field(default_factory=list, alias="momentIds")


class SessionNarrativeOutput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    session_shape: str = Field(default="", alias="sessionShape")
    summary: str = ""
    arcs: list[NarrativeArcOutput] = Field(default_factory=list)
    progression: list[str] = Field(default_factory=list)
    discoveries: list[str] = Field(default_factory=list)
    stabilized_directions: list[str] = Field(
        default_factory=list, alias="stabilizedDirections"
    )
    abandoned_directions: list[str] = Field(
        default_factory=list, alias="abandonedDirections"
    )
