"""Domain models.

Two families live here:

1. Durable domain objects — ArtifactSnapshot, Obligation, ControlPoint,
   Binding, ContractSnapshot, PRAnalysis. These are persisted and versioned.
2. Structured LLM outputs — DeclaredIntent, BehavioralDelta, ObligationImpact.
   These are produced by `analysis/llm.py` and validated by Pydantic before
   any downstream logic sees them.

Code never creates or modifies approved product intent: Obligations only
enter the system through an approved requirements source, and every analysis
pins the exact obligation revisions it used via ContractSnapshot.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


def sha256_hex(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class ArtifactKind(str, Enum):
    REQUIREMENT = "requirement"
    ISSUE = "issue"
    CODE_FILE = "code_file"
    DIFF = "diff"
    MANIFEST = "manifest"
    CONFIG = "config"


class Authority(str, Enum):
    """How much weight a product artifact carries as a source of intent."""

    APPROVED = "approved"
    DRAFT = "draft"
    STALE = "stale"
    UNKNOWN = "unknown"


class ObligationKind(str, Enum):
    PERMISSION = "permission"  # something the system MAY do under conditions
    HARD_RULE = "hard_rule"  # something that MUST always / never happen
    INVARIANT = "invariant"  # a property that must hold across changes


class ControlPointRole(str, Enum):
    DECISION = "decision"
    ENFORCEMENT = "enforcement"
    EXECUTOR = "executor"
    CONFIGURATION = "configuration"
    AUDIT = "audit"
    TEST_OR_EVAL = "test_or_eval"


class BindingRelation(str, Enum):
    DECIDES = "decides"
    ENFORCES = "enforces"
    EXECUTES = "executes"
    CONFIGURES = "configures"
    OBSERVES = "observes"
    VERIFIES = "verifies"


class Classification(str, Enum):
    NO_MATERIAL_IMPACT = "NO_MATERIAL_IMPACT"
    ALIGNED = "ALIGNED"
    PARTIAL = "PARTIAL"
    POSSIBLE_DRIFT = "POSSIBLE_DRIFT"
    OFF_INTENT = "OFF_INTENT"
    UNKNOWN = "UNKNOWN"
    # Behavior changed on a surface the contract doesn't cover at all.
    # Deliberately quiet: an onboarding prompt for the intent inbox, not an
    # alarm on the PR — POSSIBLE_DRIFT is reserved for changes that touch
    # governed territory without matching approved intent.
    UNGOVERNED = "UNGOVERNED"


class ImpactRelation(str, Enum):
    SATISFIES = "satisfies"
    PARTIALLY_SATISFIES = "partially_satisfies"
    CONTRADICTS = "contradicts"
    UNRELATED = "unrelated"


class EvidenceType(str, Enum):
    DIFF_HUNK = "diff_hunk"
    FILE_LINES = "file_lines"
    SYMBOL = "symbol"
    ARTIFACT_SECTION = "artifact_section"
    TEST = "test"


class ReviewReason(str, Enum):
    HARD_RULE_IMPACTED = "hard_rule_impacted"
    ENFORCEMENT_REMOVED = "enforcement_removed"
    UNDECLARED_BEHAVIOR = "undeclared_behavior"
    AMBIGUOUS_REQUIREMENTS = "ambiguous_requirements"
    CONFLICTING_EVIDENCE = "conflicting_evidence"
    MISSING_DIRECT_EVIDENCE = "missing_direct_evidence"
    NON_ALIGNED_CLASSIFICATION = "non_aligned_classification"


class ReviewState(str, Enum):
    NOT_REQUIRED = "not_required"
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


# ---------------------------------------------------------------------------
# Durable domain objects
# ---------------------------------------------------------------------------


class ArtifactSnapshot(BaseModel):
    """Immutable, versioned content captured from a source at analysis time."""

    snapshot_id: str = ""
    provider: str  # fixture | github | ...
    reference: str  # provider-scoped reference, e.g. "refund-policy-prd"
    kind: ArtifactKind
    uri: str = ""
    content: str
    content_hash: str = ""
    revision: str = ""  # provider revision (sha, doc version) when known
    authority: Authority = Authority.UNKNOWN
    retrieved_at: datetime = Field(default_factory=utc_now)

    def model_post_init(self, __context: object) -> None:
        if not self.content_hash:
            self.content_hash = sha256_hex(self.content)
        if not self.snapshot_id:
            self.snapshot_id = sha256_hex(
                f"{self.provider}:{self.reference}:{self.revision}:{self.content_hash}"
            )[:16]


class Obligation(BaseModel):
    """An approved atomic behavior or invariant. Only ever sourced from an
    approved product artifact — never inferred from code."""

    obligation_id: str
    workflow_id: str
    statement: str
    kind: ObligationKind
    source_reference: str  # artifact reference this was approved in
    source_section: str = ""  # heading / anchor inside the artifact
    source_content_hash: str = ""  # hash of the artifact revision it came from
    revision: str = "1"

    @property
    def pin(self) -> str:
        """Exact revision identity used in contract snapshots."""
        return f"{self.obligation_id}@{self.revision}:{sha256_hex(self.statement)[:12]}"


class ControlPoint(BaseModel):
    """Code or configuration that decides, enforces, executes, configures,
    or observes an obligation."""

    control_point_id: str
    workflow_id: str
    role: ControlPointRole
    path: str
    symbol: str = ""  # function/class name when applicable
    description: str = ""


class Binding(BaseModel):
    """Typed relation between an obligation and a control point."""

    obligation_id: str
    control_point_id: str
    relation: BindingRelation
    rationale: str = ""


class ContractSnapshot(BaseModel):
    """The exact obligation revisions an analysis ran against."""

    contract_snapshot_id: str = ""
    workflow_id: str
    obligation_pins: list[str]

    def model_post_init(self, __context: object) -> None:
        if not self.contract_snapshot_id:
            self.contract_snapshot_id = sha256_hex(
                self.workflow_id + "|" + "|".join(sorted(self.obligation_pins))
            )[:16]


def analysis_key(
    repository: str,
    pr_number: int,
    head_sha: str,
    contract_snapshot_id: str,
    analyzer_version: str,
) -> str:
    """Idempotency identity for an analysis."""
    return sha256_hex(
        f"{repository}#{pr_number}@{head_sha}/{contract_snapshot_id}/{analyzer_version}"
    )[:24]


# ---------------------------------------------------------------------------
# Provider-facing objects
# ---------------------------------------------------------------------------


class PullRequest(BaseModel):
    number: int
    title: str
    body: str = ""
    author: str = ""
    base_sha: str
    head_sha: str
    issue_key: str = ""
    deleted_files: list[str] = Field(default_factory=list)


class Issue(BaseModel):
    key: str
    title: str = ""
    body: str = ""
    requirements: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Evidence
# ---------------------------------------------------------------------------


class Evidence(BaseModel):
    """A citation backing a finding. Must resolve against a snapshot, the
    diff, or a product artifact — `validate_evidence` checks that."""

    type: EvidenceType
    reference: str  # file path or artifact reference
    symbol: str = ""
    start_line: int = 0
    end_line: int = 0
    excerpt: str = ""
    valid: Optional[bool] = None  # set by evidence validation


# ---------------------------------------------------------------------------
# Structured LLM outputs
# ---------------------------------------------------------------------------


class DeclaredIntent(BaseModel):
    """What the PR author says the change is supposed to do."""

    summary: str = Field(description="One-sentence summary of the declared intent")
    claims: list[str] = Field(
        default_factory=list,
        description="Individual behavioral claims declared in the PR/issue",
    )
    references_issue: bool = Field(
        default=False,
        description="Whether the PR text explicitly references the linked work item shown to you",
    )


class BehaviorChange(BaseModel):
    """One observable behavioral difference introduced by the diff."""

    description: str = Field(description="What behavior changes, stated observably")
    direction: str = Field(
        description="One of: added | removed | relaxed | tightened | reconfigured"
    )
    control_point_paths: list[str] = Field(
        default_factory=list, description="Files implementing this change"
    )
    declared: bool = Field(
        description="Whether this change is covered by the declared intent"
    )
    evidence: list[Evidence] = Field(default_factory=list)


class BehavioralDelta(BaseModel):
    """Structured output of the delta-inference node."""

    changes: list[BehaviorChange] = Field(default_factory=list)
    gaps: list[str] = Field(
        default_factory=list,
        description=(
            "Coupled control points this change left stale — code/config/tests "
            "that should have moved together with the change but did not. "
            "These are properties of the head state, NOT changes made by the PR."
        ),
    )
    summary: str = Field(default="", description="Overall behavioral summary")
    material: bool = Field(
        default=False,
        description="Whether any change is behaviorally observable (vs pure refactor)",
    )


class ObligationImpact(BaseModel):
    """Structured output of the obligation-comparison node, one per obligation."""

    obligation_id: str
    relation: ImpactRelation
    confidence: float = Field(ge=0.0, le=1.0, default=0.5)
    reasoning: str = ""
    evidence: list[Evidence] = Field(default_factory=list)
    missing_evidence: list[str] = Field(
        default_factory=list,
        description="Tests, evals, or guards that should exist but were not found",
    )


# ---------------------------------------------------------------------------
# Context resolution + coverage
# ---------------------------------------------------------------------------


class ContextResolution(BaseModel):
    """Result of the product-context resolution ladder."""

    resolved_references: list[str] = Field(default_factory=list)
    resolution_path: list[str] = Field(
        default_factory=list,
        description="Which ladder rungs fired, in order (explicit_link, manifest, bindings, retrieval)",
    )
    rejected: list[str] = Field(
        default_factory=list, description="Artifacts rejected (e.g. draft/stale)"
    )
    abstained: bool = False
    abstain_reason: str = ""


class CoverageFinding(BaseModel):
    """Deterministic test/eval/guard coverage check for one obligation."""

    obligation_id: str
    verifying_control_points: list[str] = Field(default_factory=list)
    verified_by_changed_tests: bool = False
    has_any_verification: bool = False
    gaps: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Analysis result
# ---------------------------------------------------------------------------


class PRAnalysis(BaseModel):
    """Evidence-backed result for a PR head SHA and contract snapshot."""

    analysis_id: str
    workflow_id: str
    repository: str
    pr_number: int
    base_sha: str
    head_sha: str
    contract_snapshot_id: str
    analyzer_version: str

    classification: Classification
    declared_intent: Optional[DeclaredIntent] = None
    behavioral_delta: Optional[BehavioralDelta] = None
    obligation_impacts: list[ObligationImpact] = Field(default_factory=list)
    coverage: list[CoverageFinding] = Field(default_factory=list)
    context: Optional[ContextResolution] = None
    matched_control_points: list[str] = Field(default_factory=list)
    missing_evidence: list[str] = Field(default_factory=list)
    evidence_valid: bool = True
    # Citations that failed verbatim validation and were removed before
    # rendering — an audit trail of how much the model fabricated.
    dropped_citations: int = 0

    human_review_required: bool = False
    review_reasons: list[ReviewReason] = Field(default_factory=list)
    review_state: ReviewState = ReviewState.NOT_REQUIRED
    reviewer: str = ""
    review_note: str = ""

    artifact_snapshot_ids: list[str] = Field(default_factory=list)
    comment_markdown: str = ""
    created_at: datetime = Field(default_factory=utc_now)
