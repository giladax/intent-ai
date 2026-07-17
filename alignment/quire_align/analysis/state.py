"""Typed LangGraph state for one PR analysis."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

from quire_align.models import (
    ArtifactSnapshot,
    BehavioralDelta,
    Binding,
    Classification,
    ContextResolution,
    ContractSnapshot,
    ControlPoint,
    CoverageFinding,
    DeclaredIntent,
    Issue,
    Obligation,
    ObligationImpact,
    PRAnalysis,
    PullRequest,
    ReviewReason,
)


class AnalysisState(BaseModel):
    # --- inputs -----------------------------------------------------------
    pr_number: int
    force: bool = False

    # --- loaded material -----------------------------------------------------
    pr: Optional[PullRequest] = None
    issue: Optional[Issue] = None
    changed_files: list[str] = Field(default_factory=list)
    artifacts: list[ArtifactSnapshot] = Field(default_factory=list)
    obligations: list[Obligation] = Field(default_factory=list)
    control_points: list[ControlPoint] = Field(default_factory=list)
    bindings: list[Binding] = Field(default_factory=list)
    contract: Optional[ContractSnapshot] = None

    # --- derived (deterministic) ------------------------------------------------
    context: Optional[ContextResolution] = None
    diff: str = ""
    matched_control_points: list[ControlPoint] = Field(default_factory=list)
    removed_enforcement: list[str] = Field(default_factory=list)
    code_context: dict[str, str] = Field(default_factory=dict)
    candidate_obligations: list[Obligation] = Field(default_factory=list)
    coverage: list[CoverageFinding] = Field(default_factory=list)
    evidence_valid: bool = True
    dropped_citations: int = 0

    # --- inferred (LLM, structured) ----------------------------------------------
    declared: Optional[DeclaredIntent] = None
    delta: Optional[BehavioralDelta] = None
    impacts: list[ObligationImpact] = Field(default_factory=list)

    # --- outcome --------------------------------------------------------------
    classification: Optional[Classification] = None
    review_reasons: list[ReviewReason] = Field(default_factory=list)
    missing_evidence: list[str] = Field(default_factory=list)
    analysis: Optional[PRAnalysis] = None
    cached: bool = False
