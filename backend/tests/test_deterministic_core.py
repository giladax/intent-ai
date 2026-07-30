"""Unit tests for the deterministic analysis core: matching, context ladder,
classification rules, evidence validation, and rendering."""

from quire.analysis.classify import classify
from quire.analysis.context import resolve_context
from quire.analysis.evidence import validate_evidence
from quire.analysis.matching import (
    detect_removed_enforcement,
    match_control_points,
    match_eval_paths,
)
from quire.analysis.render import render_comment
from quire.models import (
    BehavioralDelta,
    BehaviorChange,
    Classification,
    ContextResolution,
    CoverageFinding,
    Evidence,
    EvidenceType,
    ImpactRelation,
    ObligationImpact,
    PRAnalysis,
    ReviewReason,
)


def _impact(ob_id, relation, confidence=0.9, evidence=None, missing=None):
    return ObligationImpact(
        obligation_id=ob_id,
        relation=relation,
        confidence=confidence,
        reasoning="test",
        evidence=evidence or [],
        missing_evidence=missing or [],
    )


def _delta(changes, material=True):
    return BehavioralDelta(changes=changes, summary="test delta", material=material)


def _change(description="limit changed", paths=None, declared=True):
    return BehaviorChange(
        description=description,
        direction="relaxed",
        control_point_paths=paths or ["refund_agent/policy.py"],
        declared=declared,
    )


# ---------------------------------------------------------------------------
# matching
# ---------------------------------------------------------------------------


def test_match_control_points_by_path(refund_workspace):
    cps = refund_workspace.control_points()
    matched = match_control_points(["refund_agent/policy.py"], cps)
    assert [cp.control_point_id for cp in matched] == ["CP-policy"]


def test_match_eval_paths_globs():
    paths = [
        "tests/refunds/test_policy.py",
        "evals/refund_agent/eval_cases.yaml",
        "refund_agent/policy.py",
    ]
    matched = match_eval_paths(paths, ["tests/refunds/**", "evals/refund_agent/**"])
    assert matched == [
        "evals/refund_agent/eval_cases.yaml",
        "tests/refunds/test_policy.py",
    ]


def test_removed_enforcement_via_deleted_call_site(refund_workspace):
    pr = refund_workspace.get_pr(101)
    diff = "-        self.guard.check(request, decision)\n+        # guard removed\n"
    removed = detect_removed_enforcement(
        pr, refund_workspace, refund_workspace.control_points(),
        ["refund_agent/executor.py"], diff,
    )
    assert removed == ["CP-guard"]


def test_no_enforcement_removed_in_plain_pr(refund_workspace):
    pr = refund_workspace.get_pr(101)
    removed = detect_removed_enforcement(
        pr, refund_workspace, refund_workspace.control_points(),
        refund_workspace.changed_files(pr), refund_workspace.diff(pr),
    )
    assert removed == []


# ---------------------------------------------------------------------------
# context ladder
# ---------------------------------------------------------------------------


def _resolve(refund_workspace, pr_number=101, issue_key=None, matched=None):
    pr = refund_workspace.get_pr(pr_number)
    issue = refund_workspace.issue(issue_key or pr.issue_key)
    return resolve_context(
        pr,
        issue,
        refund_workspace.manifest(),
        refund_workspace.requirement_artifacts(),
        refund_workspace.obligations(),
        matched or [],
        refund_workspace.bindings(),
    )


def test_explicit_link_resolves_approved_prd(refund_workspace):
    ctx = _resolve(refund_workspace)
    assert ctx.resolved_references[0] == "refund-policy-prd"
    assert ctx.resolution_path[0] == "explicit_link"
    assert not ctx.abstained


def test_conflicting_approved_links_abstain(refund_workspace):
    ctx = _resolve(refund_workspace, issue_key="REF-77")
    assert ctx.abstained
    assert "contested" in ctx.abstain_reason


def test_manifest_rung_used_without_issue(refund_workspace):
    pr = refund_workspace.get_pr(101)
    pr = pr.model_copy(update={"issue_key": ""})
    ctx = resolve_context(
        pr, None, refund_workspace.manifest(),
        refund_workspace.requirement_artifacts(), refund_workspace.obligations(),
        [], refund_workspace.bindings(),
    )
    assert ctx.resolved_references == ["refund-policy-prd"]
    assert ctx.resolution_path == ["manifest"]


def test_draft_and_stale_never_admitted(refund_workspace):
    ctx = _resolve(refund_workspace)
    assert all("draft" not in ref for ref in ctx.resolved_references)
    assert all("v2" not in ref for ref in ctx.resolved_references)


# ---------------------------------------------------------------------------
# classification rules
# ---------------------------------------------------------------------------


def _classify(refund_workspace, **overrides):
    kwargs = dict(
        context=ContextResolution(resolved_references=["refund-policy-prd"]),
        delta=_delta([_change()]),
        impacts=[_impact("OB-101", ImpactRelation.SATISFIES)],
        obligations=refund_workspace.obligations(),
        bindings=refund_workspace.bindings(),
        control_points=refund_workspace.control_points(),
        coverage=[],
        removed_enforcement=[],
        evidence_valid=True,
    )
    kwargs.update(overrides)
    return classify(**kwargs)


def test_abstained_context_is_unknown(refund_workspace):
    cls, reasons, _ = _classify(
        refund_workspace,
        context=ContextResolution(abstained=True, abstain_reason="conflict"),
    )
    assert cls == Classification.UNKNOWN
    assert ReviewReason.AMBIGUOUS_REQUIREMENTS in reasons


def test_immaterial_delta_is_no_material_impact(refund_workspace):
    cls, reasons, _ = _classify(
        refund_workspace, delta=_delta([], material=False), impacts=[]
    )
    assert cls == Classification.NO_MATERIAL_IMPACT
    assert reasons == []


def test_removed_enforcement_is_off_intent(refund_workspace):
    cls, reasons, _ = _classify(refund_workspace, removed_enforcement=["CP-guard"])
    assert cls == Classification.OFF_INTENT
    assert ReviewReason.ENFORCEMENT_REMOVED in reasons


def test_hard_rule_contradiction_is_off_intent(refund_workspace):
    cls, reasons, _ = _classify(
        refund_workspace,
        impacts=[_impact("OB-102", ImpactRelation.CONTRADICTS)],
    )
    assert cls == Classification.OFF_INTENT
    assert ReviewReason.HARD_RULE_IMPACTED in reasons


def test_unrelated_material_change_on_governed_surface_is_possible_drift(refund_workspace):
    policy_cp = next(
        cp for cp in refund_workspace.control_points() if cp.control_point_id == "CP-policy"
    )
    cls, _, _ = _classify(
        refund_workspace,
        impacts=[_impact("OB-101", ImpactRelation.UNRELATED)],
        matched_control_points=[policy_cp],
    )
    assert cls == Classification.POSSIBLE_DRIFT


def test_unrelated_material_change_on_uncontracted_surface_is_ungoverned_and_quiet(
    refund_workspace,
):
    cls, reasons, _ = _classify(
        refund_workspace,
        impacts=[_impact("OB-101", ImpactRelation.UNRELATED)],
        matched_control_points=[],
    )
    assert cls == Classification.UNGOVERNED
    assert reasons == []  # quiet channel: no review demand on the PR author


def test_partially_satisfies_is_partial(refund_workspace):
    cls, reasons, _ = _classify(
        refund_workspace,
        impacts=[_impact("OB-101", ImpactRelation.PARTIALLY_SATISFIES)],
    )
    assert cls == Classification.PARTIAL
    assert ReviewReason.NON_ALIGNED_CLASSIFICATION in reasons


def test_satisfied_with_coverage_gap_is_partial(refund_workspace):
    cls, _, missing = _classify(
        refund_workspace,
        coverage=[
            CoverageFinding(
                obligation_id="OB-101",
                verifying_control_points=["CP-test-policy"],
                gaps=["OB-101 behavior changed but no bound verification was updated"],
            )
        ],
    )
    assert cls == Classification.PARTIAL
    assert missing


def test_clean_satisfies_is_aligned_without_review(refund_workspace):
    cls, reasons, missing = _classify(
        refund_workspace,
        impacts=[
            _impact(
                "OB-101",
                ImpactRelation.SATISFIES,
                evidence=[
                    Evidence(
                        type=EvidenceType.DIFF_HUNK,
                        reference="refund_agent/policy.py",
                        excerpt="+    PREMIUM_MAX_AUTO_REFUND = 100.0",
                        valid=True,
                    )
                ],
            )
        ],
    )
    assert cls == Classification.ALIGNED
    assert reasons == []
    assert missing == []


def test_undeclared_change_triggers_review(refund_workspace):
    _, reasons, _ = _classify(
        refund_workspace,
        delta=_delta([_change(declared=False)]),
    )
    assert ReviewReason.UNDECLARED_BEHAVIOR in reasons


# ---------------------------------------------------------------------------
# evidence validation
# ---------------------------------------------------------------------------


def test_evidence_validation_against_diff_and_files(refund_workspace):
    pr = refund_workspace.get_pr(101)
    diff = refund_workspace.diff(pr)
    artifacts = refund_workspace.requirement_artifacts()
    impacts = [
        _impact(
            "OB-101",
            ImpactRelation.SATISFIES,
            evidence=[
                Evidence(
                    type=EvidenceType.DIFF_HUNK,
                    reference="refund_agent/policy.py",
                    excerpt="+    PREMIUM_MAX_AUTO_REFUND = 100.0",
                ),
                Evidence(
                    type=EvidenceType.FILE_LINES,
                    reference="refund_agent/guard.py",
                    excerpt="request.amount > self.ceiling",
                ),
                Evidence(
                    type=EvidenceType.ARTIFACT_SECTION,
                    reference="refund-policy-prd",
                    excerpt="up to **$100**",
                ),
                Evidence(
                    type=EvidenceType.DIFF_HUNK,
                    reference="refund_agent/policy.py",
                    excerpt="this text is not in the diff",
                ),
            ],
        )
    ]
    ok, dropped = validate_evidence(
        impacts, pr=pr, adapter=refund_workspace, diff=diff, artifacts=artifacts
    )
    assert ok  # at least one valid citation backs the finding
    assert dropped == 1  # the fabricated diff excerpt was removed
    assert [e.valid for e in impacts[0].evidence] == [True, True, True]


def test_all_invalid_evidence_fails_validation(refund_workspace):
    pr = refund_workspace.get_pr(101)
    impacts = [
        _impact(
            "OB-101",
            ImpactRelation.SATISFIES,
            evidence=[
                Evidence(
                    type=EvidenceType.FILE_LINES,
                    reference="does/not/exist.py",
                    excerpt="nope",
                )
            ],
        )
    ]
    ok, dropped = validate_evidence(
        impacts, pr=pr, adapter=refund_workspace, diff="", artifacts=[]
    )
    assert not ok
    assert dropped == 1
    assert impacts[0].evidence == []


# ---------------------------------------------------------------------------
# renderer
# ---------------------------------------------------------------------------


def test_render_comment_contains_key_sections():
    analysis = PRAnalysis(
        analysis_id="abc123",
        workflow_id="refund-agent",
        repository="company/refund-agent",
        pr_number=101,
        base_sha="fixbase0001",
        head_sha="pr101head01",
        contract_snapshot_id="contract1",
        analyzer_version="0.1.0",
        classification=Classification.PARTIAL,
        behavioral_delta=_delta([_change()]),
        obligation_impacts=[
            _impact("OB-101", ImpactRelation.PARTIALLY_SATISFIES),
            _impact("OB-105", ImpactRelation.UNRELATED),
        ],
        missing_evidence=["No premium/high-risk interaction test or eval"],
        human_review_required=True,
        review_reasons=[ReviewReason.HARD_RULE_IMPACTED],
    )
    comment = render_comment(analysis)
    assert "🟡 Partial" in comment
    assert "OB-101" in comment and "partially satisfies" in comment
    assert "OB-105" not in comment  # unrelated rows are noise
    assert "No premium/high-risk interaction test or eval" in comment
    assert "Human review required" in comment
    assert "`pr101head01`"[1:-1] in comment
    assert "contract1" in comment
