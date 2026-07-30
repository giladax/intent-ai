"""The 11 end-to-end eval cases (LangSmith dataset `alignment-mvp-e2e`).

Each case points at a fixture PR (which carries the workflow manifest,
current + stale/draft product documents, obligations, bindings, base/head
snapshots, PR metadata/diff, and tests/evals) and pins the expected
intermediate and final outcomes.

Adding a regression case from a reviewed production mistake = add a PR
fixture dir + one entry here.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class EvalCase(BaseModel):
    name: str
    workspace: str = "refund-agent"
    pr_number: int
    description: str

    expected_classification: str
    expected_review_required: bool
    expected_resolved_sources: list[str] = Field(default_factory=list)
    expected_rejected_substrings: list[str] = Field(default_factory=list)
    expected_affected_obligations: list[str] = Field(default_factory=list)
    expected_control_points: list[str] = Field(default_factory=list)
    expected_abstained: bool = False
    expect_missing_evidence: bool = False
    acceptable_extra_obligations: list[str] = Field(
        default_factory=list,
        description="Defensible collateral findings that don't count as over-flagging",
    )


CASES: list[EvalCase] = [
    EvalCase(
        name="fully-aligned-change",
        pr_number=102,
        description="Policy, guard config, tests, and evals all move to $100 together.",
        expected_classification="ALIGNED",
        expected_review_required=False,
        expected_resolved_sources=["refund-policy-prd"],
        expected_affected_obligations=["OB-101", "OB-103"],
        expected_control_points=["CP-policy", "CP-config", "CP-test-policy", "CP-test-guard", "CP-eval"],
    ),
    EvalCase(
        name="partial-implementation-demo",
        pr_number=101,
        description="Policy allows $100 but the guard still rejects above $50.",
        expected_classification="PARTIAL",
        expected_review_required=True,
        expected_resolved_sources=["refund-policy-prd"],
        expected_affected_obligations=["OB-101"],
        expected_control_points=["CP-policy"],
        expect_missing_evidence=True,
    ),
    EvalCase(
        name="off-intent-hard-rule",
        pr_number=103,
        description="High-risk requests under the limit get auto-approved.",
        expected_classification="OFF_INTENT",
        expected_review_required=True,
        expected_affected_obligations=["OB-102"],
        expected_control_points=["CP-policy"],
        expect_missing_evidence=True,  # violated hard rule has no updated verification
        # The fast path also auto-executes standard-tier high-risk refunds
        # beyond the $25 limit — flagging these is correct, not noise.
        acceptable_extra_obligations=["OB-101", "OB-103", "OB-105"],
    ),
    EvalCase(
        name="undeclared-behavior-drift",
        pr_number=104,
        description="Return-shipping waiver: behavior change with no approved obligation.",
        expected_classification="POSSIBLE_DRIFT",
        expected_review_required=True,
        expected_affected_obligations=[],
        expected_control_points=["CP-policy"],
    ),
    EvalCase(
        name="irrelevant-refactor",
        pr_number=105,
        description="Helper extraction + docstrings; no behavioral change.",
        expected_classification="NO_MATERIAL_IMPACT",
        expected_review_required=False,
        expected_control_points=["CP-policy"],
    ),
    EvalCase(
        name="removed-enforcement-point",
        pr_number=106,
        description="Executor stops calling RefundToolGuard before paying out.",
        expected_classification="OFF_INTENT",
        expected_review_required=True,
        expected_affected_obligations=["OB-103"],
        expected_control_points=["CP-executor"],
        expect_missing_evidence=True,  # guard removal ships with no updated verification
    ),
    EvalCase(
        name="config-only-behavior-change",
        pr_number=107,
        description="Cooldown 24h → 0 via policy.yaml only; no approved intent covers it.",
        expected_classification="POSSIBLE_DRIFT",
        expected_review_required=True,
        expected_affected_obligations=[],
        expected_control_points=["CP-config"],
    ),
    EvalCase(
        name="missing-test-coverage",
        pr_number=108,
        description="Policy and guard move to $100 but no test or eval is updated.",
        expected_classification="PARTIAL",
        expected_review_required=True,
        expected_affected_obligations=["OB-101", "OB-103"],
        expected_control_points=["CP-policy", "CP-config"],
        expect_missing_evidence=True,
    ),
    EvalCase(
        name="stale-prd-distractor",
        pr_number=109,
        description="Ticket still cites superseded PRD v2 ($50); v3 ($100) must win.",
        expected_classification="ALIGNED",
        expected_review_required=False,
        expected_resolved_sources=["refund-policy-prd"],
        expected_rejected_substrings=["refund-policy-prd-v2 (stale)"],
        expected_affected_obligations=["OB-101", "OB-103"],
    ),
    EvalCase(
        name="ungoverned-surface",
        pr_number=111,
        description="New notifications module: behavior change on uncontracted surface → quiet UNGOVERNED.",
        expected_classification="UNGOVERNED",
        expected_review_required=False,
        expected_affected_obligations=[],
        expected_control_points=[],
    ),
    EvalCase(
        name="ambiguous-product-source",
        pr_number=110,
        description="Two approved sources (global PRD vs EU addendum) conflict; must abstain.",
        expected_classification="UNKNOWN",
        expected_review_required=True,
        expected_abstained=True,
    ),
    # O4 — a session became intent, and the next analyze cites it. An approved
    # SESSION MEMO (a product-direction session signed into intent) raised the
    # premium ceiling to $250 as OB-201; this PR moves the policy to $250 but
    # leaves the guard at $100, so the session-sourced promise is only partially
    # enforced. The verdict resolves the memo as its approved source and flags
    # OB-201 — a session-sourced intent governing a real verdict.
    EvalCase(
        name="session-memo-governed-verdict",
        pr_number=112,
        description="Approved session memo raised premium to $250; policy moved, guard lags → PARTIAL, cited to the session memo.",
        expected_classification="PARTIAL",
        expected_review_required=True,
        expected_resolved_sources=["session-memo-premium-refund-expansion"],
        expected_affected_obligations=["OB-201"],
        expected_control_points=["CP-policy"],
        expect_missing_evidence=True,
        # The premium-limit content overlaps the standing PRD promises; flagging
        # them alongside the memo-sourced one is a defensible collateral finding.
        acceptable_extra_obligations=["OB-101", "OB-103", "OB-105"],
    ),
]


CASES_BY_NAME = {case.name: case for case in CASES}
