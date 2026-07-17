"""Rule-based alignment classification.

The LLM produces structured findings (behavioral delta, per-obligation
impacts); the final label is decided HERE, by ordered deterministic rules.
Prefer UNKNOWN over unsupported certainty.
"""

from __future__ import annotations

from quire_align.models import (
    BehavioralDelta,
    Binding,
    Classification,
    ContextResolution,
    ControlPoint,
    ControlPointRole,
    CoverageFinding,
    ImpactRelation,
    Obligation,
    ObligationImpact,
    ObligationKind,
    ReviewReason,
)

_LOW_CONFIDENCE = 0.4


def _uncovered_changes(
    delta: BehavioralDelta,
    impacts: list[ObligationImpact],
    bindings: list[Binding],
    control_points: list[ControlPoint],
) -> list[str]:
    """Material behavior changes not attributable to any impacted obligation."""
    related_ids = {
        i.obligation_id for i in impacts if i.relation != ImpactRelation.UNRELATED
    }
    cp_path_by_id = {cp.control_point_id: cp.path for cp in control_points}
    covered_paths = {
        cp_path_by_id[b.control_point_id]
        for b in bindings
        if b.obligation_id in related_ids and b.control_point_id in cp_path_by_id
    }
    uncovered = []
    for change in delta.changes:
        if not change.control_point_paths:
            uncovered.append(change.description)
        elif not any(path in covered_paths for path in change.control_point_paths):
            uncovered.append(change.description)
    return uncovered


def classify(
    *,
    context: ContextResolution,
    delta: BehavioralDelta | None,
    impacts: list[ObligationImpact],
    obligations: list[Obligation],
    bindings: list[Binding],
    control_points: list[ControlPoint],
    coverage: list[CoverageFinding],
    removed_enforcement: list[str],
    evidence_valid: bool,
    matched_control_points: list[ControlPoint] | None = None,
    low_confidence: float = _LOW_CONFIDENCE,
) -> tuple[Classification, list[ReviewReason], list[str]]:
    """Returns (classification, review_reasons, missing_evidence)."""
    kind_by_id = {o.obligation_id: o.kind for o in obligations}
    related = [i for i in impacts if i.relation != ImpactRelation.UNRELATED]
    contradictions = [i for i in impacts if i.relation == ImpactRelation.CONTRADICTS]
    partials = [i for i in impacts if i.relation == ImpactRelation.PARTIALLY_SATISFIES]
    satisfies = [i for i in impacts if i.relation == ImpactRelation.SATISFIES]
    material = delta is not None and delta.material and bool(delta.changes)
    coverage_gaps = [gap for finding in coverage for gap in finding.gaps]
    # LLM-suggested gaps count only for obligations this PR actually moved
    # AND whose bound verifications were NOT updated — when deterministic
    # coverage confirms the verification moved with the change, extra
    # test ideas are advice, not gaps. Then: at most 3 per obligation
    # (prompt asks for ranked output), exact-deduped, capped at 2 per
    # referenced file. Deterministic coverage gaps are never dropped.
    verified_ids = {f.obligation_id for f in coverage if f.verified_by_changed_tests}
    suggestions = [
        item
        for impact in impacts
        if impact.relation != ImpactRelation.UNRELATED
        and impact.obligation_id not in verified_ids
        for item in impact.missing_evidence[:3]
    ]
    # delta.gaps stay out of missing_evidence: they are context for the
    # obligation comparison, and gaps that matter surface again there as
    # impact-level missing evidence tied to an approved obligation.
    seen: set[str] = set()
    per_file: dict[str, int] = {}
    llm_missing: list[str] = []
    for item in suggestions:
        key = " ".join(item.lower().split())
        if key in seen:
            continue
        seen.add(key)
        head = item.split(":", 1)[0].strip()
        group = head if "/" in head else "(general)"
        per_file[group] = per_file.get(group, 0) + 1
        if per_file[group] <= 2:
            llm_missing.append(item)
    missing_evidence = sorted(set(llm_missing) | set(coverage_gaps))
    if not material:
        # Nothing behaviorally changed — there is no changed behavior for
        # evidence to be missing about.
        missing_evidence = []
    uncovered = (
        _uncovered_changes(delta, impacts, bindings, control_points)
        if material
        else []
    )

    # --- classification (ordered; first match wins) -------------------------
    if context.abstained:
        classification = Classification.UNKNOWN
    elif not material and not removed_enforcement:
        classification = Classification.NO_MATERIAL_IMPACT
    elif removed_enforcement or contradictions:
        # Any contradiction is OFF_INTENT (hard-rule contradictions are a
        # subset — the previous extra hard-rule clause was redundant).
        classification = Classification.OFF_INTENT
    elif not related or uncovered:
        # Loud drift only when the change touched governed territory — a
        # registered non-verification control point. A change entirely on
        # uncontracted surface is UNGOVERNED: an onboarding prompt, not an
        # alarm.
        governed_touched = any(
            cp.role != ControlPointRole.TEST_OR_EVAL
            for cp in (matched_control_points or [])
        )
        classification = (
            Classification.POSSIBLE_DRIFT
            if governed_touched or related
            else Classification.UNGOVERNED
        )
    elif partials or coverage_gaps:
        classification = Classification.PARTIAL
    elif satisfies and evidence_valid and all(
        i.confidence >= low_confidence for i in satisfies
    ):
        classification = Classification.ALIGNED
    else:
        classification = Classification.UNKNOWN

    # --- human-review triggers ----------------------------------------------
    reasons: list[ReviewReason] = []
    if any(
        kind_by_id.get(i.obligation_id) == ObligationKind.HARD_RULE for i in related
    ) and classification not in (Classification.ALIGNED, Classification.NO_MATERIAL_IMPACT):
        reasons.append(ReviewReason.HARD_RULE_IMPACTED)
    if removed_enforcement:
        reasons.append(ReviewReason.ENFORCEMENT_REMOVED)
    if material and any(not change.declared for change in delta.changes):
        reasons.append(ReviewReason.UNDECLARED_BEHAVIOR)
    if context.abstained:
        reasons.append(ReviewReason.AMBIGUOUS_REQUIREMENTS)
    if any(
        i.relation != ImpactRelation.UNRELATED and i.confidence < low_confidence
        for i in impacts
    ):
        reasons.append(ReviewReason.CONFLICTING_EVIDENCE)
    if not evidence_valid or (
        material and any(not i.evidence for i in related)
    ) or missing_evidence:
        reasons.append(ReviewReason.MISSING_DIRECT_EVIDENCE)
    if classification not in (
        Classification.ALIGNED,
        Classification.NO_MATERIAL_IMPACT,
        Classification.UNGOVERNED,
    ):
        reasons.append(ReviewReason.NON_ALIGNED_CLASSIFICATION)

    if classification == Classification.UNGOVERNED:
        # Quiet channel by design: routed to the intent inbox, never a
        # review demand on the PR author.
        reasons = []

    return classification, reasons, missing_evidence
