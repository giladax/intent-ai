"""Canned FakeAlignmentLLM outputs per fixture PR — shared by tests, the
offline demo, and offline eval runs.

These emulate what the real model returns for each scenario so everything
around the LLM (matching, ladder, coverage, evidence validation,
classification, persistence, rendering) is exercised deterministically.
"""

from quire_align.analysis.llm import FakeAlignmentLLM
from quire_align.models import (
    BehavioralDelta,
    BehaviorChange,
    DeclaredIntent,
    Evidence,
    EvidenceType,
    ImpactRelation,
    ObligationImpact,
)


def _diff_evidence(path: str, excerpt: str) -> Evidence:
    return Evidence(type=EvidenceType.DIFF_HUNK, reference=path, excerpt=excerpt)


def _file_evidence(path: str, excerpt: str) -> Evidence:
    return Evidence(type=EvidenceType.FILE_LINES, reference=path, excerpt=excerpt)


def fake_for_pr(pr_number: int) -> FakeAlignmentLLM:
    return _BUILDERS[pr_number]()


def _pr101_partial() -> FakeAlignmentLLM:
    """Demo: policy moved to $100, guard still at $50 -> PARTIAL."""
    return FakeAlignmentLLM(
        intent=DeclaredIntent(
            summary="Raise premium low-risk auto-refund limit to $100 per PRD v3",
            claims=["Premium, low-risk customers receive automatic refunds up to $100"],
            references_issue=True,
        ),
        delta=BehavioralDelta(
            material=True,
            summary=(
                "The decision policy now auto-approves premium low-risk refunds "
                "up to $100 (was $50); the tool-side guard ceiling is unchanged "
                "at $50, so refunds between $50 and $100 are approved by policy "
                "but rejected at the tool boundary."
            ),
            changes=[
                BehaviorChange(
                    description=(
                        "Premium low-risk auto-refund decision limit raised from "
                        "$50 to $100"
                    ),
                    direction="relaxed",
                    control_point_paths=["refund_agent/policy.py"],
                    declared=True,
                    evidence=[
                        _diff_evidence(
                            "refund_agent/policy.py",
                            "+    PREMIUM_MAX_AUTO_REFUND = 100.0",
                        )
                    ],
                )
            ],
        ),
        impacts={
            "OB-101": ObligationImpact(
                obligation_id="OB-101",
                relation=ImpactRelation.PARTIALLY_SATISFIES,
                confidence=0.9,
                reasoning=(
                    "RefundPolicy now permits $100 premium refunds, but "
                    "RefundToolGuard still rejects any refund above its $50 "
                    "ceiling, so the approved behavior is only delivered up to $50."
                ),
                evidence=[
                    _diff_evidence(
                        "refund_agent/policy.py",
                        "+    PREMIUM_MAX_AUTO_REFUND = 100.0",
                    ),
                    _file_evidence(
                        "refund_agent/guard.py", "request.amount > self.ceiling"
                    ),
                    _file_evidence("refund_agent/config/policy.yaml", "guard_ceiling: 50"),
                ],
                missing_evidence=[
                    "No test or eval covers the premium/high-risk interaction at the new $100 limit"
                ],
            ),
        },
    )


def _pr102_aligned() -> FakeAlignmentLLM:
    return FakeAlignmentLLM(
        intent=DeclaredIntent(
            summary="Raise premium auto-refund limit to $100 across policy, guard, and tests",
            claims=[
                "Premium, low-risk customers receive automatic refunds up to $100",
                "Guard ceiling moves together with the policy limit",
            ],
            references_issue=True,
        ),
        delta=BehavioralDelta(
            material=True,
            summary=(
                "Premium low-risk auto-refunds now execute up to $100 end to end: "
                "decision policy, guard ceiling configuration, tests, and evals all moved together."
            ),
            changes=[
                BehaviorChange(
                    description="Premium low-risk auto-refund limit raised from $50 to $100",
                    direction="relaxed",
                    control_point_paths=[
                        "refund_agent/policy.py",
                        "refund_agent/config/policy.yaml",
                    ],
                    declared=True,
                    evidence=[
                        _diff_evidence(
                            "refund_agent/policy.py",
                            "+    PREMIUM_MAX_AUTO_REFUND = 100.0",
                        ),
                        _diff_evidence("refund_agent/config/policy.yaml", "+guard_ceiling: 100"),
                    ],
                )
            ],
        ),
        impacts={
            "OB-101": ObligationImpact(
                obligation_id="OB-101",
                relation=ImpactRelation.SATISFIES,
                confidence=0.95,
                reasoning="Policy, guard ceiling, tests, and evals all move to $100 together.",
                evidence=[
                    _diff_evidence(
                        "refund_agent/policy.py", "+    PREMIUM_MAX_AUTO_REFUND = 100.0"
                    ),
                    _diff_evidence("refund_agent/config/policy.yaml", "+guard_ceiling: 100"),
                ],
            ),
            "OB-103": ObligationImpact(
                obligation_id="OB-103",
                relation=ImpactRelation.SATISFIES,
                confidence=0.9,
                reasoning="Guard still independently enforces the (new) approved ceiling.",
                evidence=[
                    _file_evidence("refund_agent/guard.py", "request.amount > self.ceiling"),
                    _diff_evidence("refund_agent/config/policy.yaml", "+guard_ceiling: 100"),
                ],
            ),
        },
    )


def _pr103_off_intent() -> FakeAlignmentLLM:
    """High-risk requests get auto-approved under the limit -> hard-rule violation."""
    return FakeAlignmentLLM(
        intent=DeclaredIntent(
            summary="Auto-approve low-value high-risk refunds to shrink the approval queue",
            claims=["High-risk refunds within the premium limit no longer require human approval"],
        ),
        delta=BehavioralDelta(
            material=True,
            summary=(
                "High-risk refund requests at or below the premium limit are now "
                "auto-approved and executed without human approval."
            ),
            changes=[
                BehaviorChange(
                    description="High-risk requests within the premium limit bypass human approval",
                    direction="relaxed",
                    control_point_paths=["refund_agent/policy.py"],
                    declared=True,
                    evidence=[
                        _diff_evidence(
                            "refund_agent/policy.py",
                            "+            if request.amount <= self.PREMIUM_MAX_AUTO_REFUND:",
                        )
                    ],
                )
            ],
        ),
        impacts={
            "OB-102": ObligationImpact(
                obligation_id="OB-102",
                relation=ImpactRelation.CONTRADICTS,
                confidence=0.95,
                reasoning=(
                    "The obligation requires human approval for ALL high-risk "
                    "requests; the new fast path auto-approves them below the limit."
                ),
                evidence=[
                    _diff_evidence(
                        "refund_agent/policy.py",
                        '+                    reason="auto-approved: low-value high-risk fast path",',
                    )
                ],
            ),
        },
    )


def _pr104_drift() -> FakeAlignmentLLM:
    """Return-shipping waiver: real behavior change, no approved obligation."""
    return FakeAlignmentLLM(
        intent=DeclaredIntent(
            summary="Waive return shipping for loyalty members on approved refunds",
            claims=["Loyalty members no longer pay return shipping"],
        ),
        delta=BehavioralDelta(
            material=True,
            summary=(
                "Approved refunds for loyalty members now also waive the return-"
                "shipping fee — a new customer-facing behavior."
            ),
            changes=[
                BehaviorChange(
                    description="Loyalty members get return shipping waived on approved refunds",
                    direction="added",
                    control_point_paths=["refund_agent/policy.py"],
                    declared=True,
                    evidence=[
                        _diff_evidence(
                            "refund_agent/policy.py",
                            "+    def waive_return_shipping(self, request: RefundRequest) -> bool:",
                        )
                    ],
                )
            ],
        ),
        impacts={},  # nothing in the approved contract covers this
    )


def _pr105_refactor() -> FakeAlignmentLLM:
    return FakeAlignmentLLM(
        intent=DeclaredIntent(
            summary="Internal refactor of the refund policy; no behavior change",
            claims=["No behavior change"],
        ),
        delta=BehavioralDelta(
            material=False,
            summary="Helper extraction and docstrings only; decision outcomes are unchanged.",
            changes=[],
        ),
        impacts={},
    )


def _pr106_enforcement_removed() -> FakeAlignmentLLM:
    return FakeAlignmentLLM(
        intent=DeclaredIntent(
            summary="Remove the tool-side guard check from the refund executor",
            claims=["Executor no longer re-checks limits before issuing refunds"],
        ),
        delta=BehavioralDelta(
            material=True,
            summary=(
                "Refunds now execute without the independent tool-side ceiling "
                "check; only the decision policy stands between a request and "
                "the payment API."
            ),
            changes=[
                BehaviorChange(
                    description="Tool-side guard ceiling no longer enforced at execution time",
                    direction="removed",
                    control_point_paths=["refund_agent/executor.py"],
                    declared=True,
                    evidence=[
                        _diff_evidence(
                            "refund_agent/executor.py",
                            "-        self.guard.check(request, decision)",
                        )
                    ],
                )
            ],
        ),
        impacts={
            "OB-103": ObligationImpact(
                obligation_id="OB-103",
                relation=ImpactRelation.CONTRADICTS,
                confidence=0.95,
                reasoning=(
                    "The obligation requires the guard to enforce the ceiling "
                    "independently of the decision policy; the executor no longer "
                    "invokes it."
                ),
                evidence=[
                    _diff_evidence(
                        "refund_agent/executor.py",
                        "-        self.guard.check(request, decision)",
                    )
                ],
            ),
        },
    )


def _pr107_config_drift() -> FakeAlignmentLLM:
    return FakeAlignmentLLM(
        intent=DeclaredIntent(
            summary="Remove the auto-refund cooldown so repeat refunds process immediately",
            claims=["Repeat refunds no longer wait 24 hours"],
        ),
        delta=BehavioralDelta(
            material=True,
            summary=(
                "Configuration-only change: the 24-hour per-customer auto-refund "
                "cooldown is now 0, so repeat automatic refunds execute back to back."
            ),
            changes=[
                BehaviorChange(
                    description="Per-customer auto-refund cooldown removed (24h → 0)",
                    direction="reconfigured",
                    control_point_paths=["refund_agent/config/policy.yaml"],
                    declared=True,
                    evidence=[
                        _diff_evidence(
                            "refund_agent/config/policy.yaml",
                            "+auto_refund_cooldown_hours: 0",
                        )
                    ],
                )
            ],
        ),
        impacts={},  # the cooldown is not part of the approved contract
    )


def _pr111_ungoverned() -> FakeAlignmentLLM:
    """New notifications surface — real behavior change, no contract coverage."""
    return FakeAlignmentLLM(
        intent=DeclaredIntent(
            summary="Send customers a status email on refund approval, escalation, or denial",
            claims=["Customers receive refund status emails"],
        ),
        delta=BehavioralDelta(
            material=True,
            summary=(
                "Customers now receive a status email for every refund "
                "decision outcome — a new customer-facing behavior in a new "
                "notifications module; decision logic is untouched."
            ),
            changes=[
                BehaviorChange(
                    description="Refund decisions now trigger a customer status email",
                    direction="added",
                    control_point_paths=["refund_agent/notifications.py"],
                    declared=True,
                    evidence=[
                        _diff_evidence(
                            "refund_agent/notifications.py",
                            "+def send_refund_status_email(client: EmailClient, customer_email: str, decision) -> None:",
                        )
                    ],
                )
            ],
        ),
        impacts={},
    )


def _pr108_missing_coverage() -> FakeAlignmentLLM:
    # Same substantive change as PR 102, but the PR ships no test/eval updates —
    # the deterministic coverage inspector supplies the gaps.
    return _pr102_aligned()


_BUILDERS = {
    101: _pr101_partial,
    102: _pr102_aligned,
    103: _pr103_off_intent,
    104: _pr104_drift,
    105: _pr105_refactor,
    106: _pr106_enforcement_removed,
    107: _pr107_config_drift,
    108: _pr108_missing_coverage,
    109: _pr102_aligned,  # same change set as 102; the stale ticket is the distractor
    110: FakeAlignmentLLM,  # context abstains before any LLM call is made
    111: _pr111_ungoverned,
}
