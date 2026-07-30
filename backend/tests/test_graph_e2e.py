"""End-to-end graph runs over fixtures with canned LLM outputs.

The FakeAlignmentLLM supplies what the model would say; everything else —
ladder, matching, coverage, evidence validation, classification, rendering —
runs for real.
"""

from quire import ANALYZER_VERSION
from quire.analysis.graph import run_analysis
from quire.models import Classification, ReviewReason, ReviewState

from quire.canned import fake_for_pr


def test_demo_pr101_is_partial_with_review(refund_workspace):
    analysis = run_analysis(refund_workspace, 101, llm=fake_for_pr(101))

    assert analysis.classification == Classification.PARTIAL
    assert analysis.human_review_required
    assert analysis.review_state == ReviewState.PENDING
    assert ReviewReason.MISSING_DIRECT_EVIDENCE in analysis.review_reasons

    # missing evidence includes both the LLM's gap and the deterministic one
    assert any("premium/high-risk" in item for item in analysis.missing_evidence)
    assert any("no bound verification" in item for item in analysis.missing_evidence)

    # exact snapshot identity
    assert analysis.head_sha == "pr101head01"
    assert analysis.base_sha == "fixbase0001"
    assert analysis.contract_snapshot_id
    assert analysis.analyzer_version == ANALYZER_VERSION
    assert analysis.artifact_snapshot_ids

    # evidence citations were validated against real content
    ob101 = next(i for i in analysis.obligation_impacts if i.obligation_id == "OB-101")
    assert all(e.valid for e in ob101.evidence)

    # publishable comment
    assert "🟡 Partial" in analysis.comment_markdown
    assert "Human review required" in analysis.comment_markdown


def test_pr102_is_aligned_without_review(refund_workspace):
    analysis = run_analysis(refund_workspace, 102, llm=fake_for_pr(102))

    assert analysis.classification == Classification.ALIGNED
    assert not analysis.human_review_required
    assert analysis.review_state == ReviewState.NOT_REQUIRED
    assert analysis.missing_evidence == []
    assert "🟢 Aligned" in analysis.comment_markdown


def test_context_resolution_recorded_and_drafts_rejected(refund_workspace):
    analysis = run_analysis(refund_workspace, 101, llm=fake_for_pr(101))
    assert analysis.context.resolved_references[0] == "refund-policy-prd"
    assert analysis.context.resolution_path[0] == "explicit_link"
    assert not analysis.context.abstained


def test_analysis_id_is_idempotent_identity(refund_workspace):
    a = run_analysis(refund_workspace, 101, llm=fake_for_pr(101))
    b = run_analysis(refund_workspace, 101, llm=fake_for_pr(101))
    assert a.analysis_id == b.analysis_id
    c = run_analysis(refund_workspace, 102, llm=fake_for_pr(102))
    assert c.analysis_id != a.analysis_id
