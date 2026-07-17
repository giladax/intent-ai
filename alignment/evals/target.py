"""Run function shared by run_eval.py and the local regression tests.

Takes dataset inputs {workspace, pr_number, offline?}, runs the analysis
graph, and flattens the PRAnalysis into the fields the evaluators score.
"""

from __future__ import annotations

import pathlib

from quire_align.adapters.fixture import FixtureWorkspace
from quire_align.analysis.config import get_variant
from quire_align.analysis.graph import run_analysis
from quire_align.models import ImpactRelation

FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"


def run_target(inputs: dict) -> dict:
    workspace = FixtureWorkspace(FIXTURES / inputs["workspace"])
    pr_number = int(inputs["pr_number"])
    offline = bool(inputs.get("offline", True))
    variant = inputs.get("variant", "linear-v1")

    if offline:
        from quire_align.canned import fake_for_pr

        llm = fake_for_pr(pr_number)
    else:
        from quire_align.analysis.llm import AnthropicAlignmentLLM

        llm = AnthropicAlignmentLLM()

    analysis = run_analysis(
        workspace, pr_number, llm=llm, store=None, config=get_variant(variant)
    )

    affected = [
        i.obligation_id
        for i in analysis.obligation_impacts
        if i.relation != ImpactRelation.UNRELATED
    ]
    related_without_valid_evidence = sum(
        1
        for impact in analysis.obligation_impacts
        if impact.relation != ImpactRelation.UNRELATED
        and not any(e.valid for e in impact.evidence)
    )
    return {
        "classification": analysis.classification.value,
        "review_required": analysis.human_review_required,
        "review_reasons": [r.value for r in analysis.review_reasons],
        "resolved_sources": analysis.context.resolved_references if analysis.context else [],
        "rejected_sources": analysis.context.rejected if analysis.context else [],
        "abstained": analysis.context.abstained if analysis.context else False,
        "affected_obligations": sorted(set(affected)),
        "matched_control_points": analysis.matched_control_points,
        "missing_evidence": analysis.missing_evidence,
        "evidence_ok": analysis.evidence_valid,
        "related_without_valid_evidence": related_without_valid_evidence,
        "comment": analysis.comment_markdown,
        "analysis_id": analysis.analysis_id,
    }
