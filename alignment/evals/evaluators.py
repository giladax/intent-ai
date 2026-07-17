"""Evaluators for the alignment analyzer.

Deterministic evaluators are primary — they check every intermediate stage
(artifact selection, obligation identification, control-point matching,
evidence validity, abstention, review flag) plus the final classification.
The optional LLM judge only grades explanation quality and never decides
correctness.

Each evaluator returns one metric: {"score": 0|1, "comment": ...}.
"""

from __future__ import annotations


def _outputs(run):
    return run.outputs if hasattr(run, "outputs") else run.get("outputs", {}) or {}


def _expected(example):
    return example.outputs if hasattr(example, "outputs") else example.get("outputs", {}) or {}


def classification_correct(run, example):
    got = _outputs(run).get("classification")
    want = _expected(example).get("expected_classification")
    return {"score": int(got == want), "comment": f"expected {want}, got {got}"}


def review_flag_correct(run, example):
    got = _outputs(run).get("review_required")
    want = _expected(example).get("expected_review_required")
    return {"score": int(got == want), "comment": f"expected review={want}, got {got}"}


def product_artifact_selected(run, example):
    """Correct product artifact(s) resolved as authoritative."""
    got = set(_outputs(run).get("resolved_sources") or [])
    want = set(_expected(example).get("expected_resolved_sources") or [])
    ok = want <= got
    return {"score": int(ok), "comment": f"expected ⊇ {sorted(want)}, got {sorted(got)}"}


def stale_or_draft_rejected(run, example):
    """Non-approved artifacts encountered along the way must be rejected."""
    rejected = _outputs(run).get("rejected_sources") or []
    want = _expected(example).get("expected_rejected_substrings") or []
    missing = [w for w in want if not any(w in r for r in rejected)]
    # Never resolve a draft/stale source, in every case.
    resolved = _outputs(run).get("resolved_sources") or []
    leaked = [r for r in resolved if "draft" in r or "-v2" in r]
    ok = not missing and not leaked
    return {
        "score": int(ok),
        "comment": f"missing rejections: {missing}; non-approved resolved: {leaked}",
    }


def obligations_identified(run, example):
    """Expected obligations must all be found; extras only pass when the
    case marks them as defensible collateral findings."""
    got = set(_outputs(run).get("affected_obligations") or [])
    want = set(_expected(example).get("expected_affected_obligations") or [])
    tolerated = set(_expected(example).get("acceptable_extra_obligations") or [])
    ok = want <= got and got <= (want | tolerated)
    return {"score": int(ok), "comment": f"expected {sorted(want)} (+{sorted(tolerated)} tolerated), got {sorted(got)}"}


def control_points_inspected(run, example):
    got = set(_outputs(run).get("matched_control_points") or [])
    want = set(_expected(example).get("expected_control_points") or [])
    ok = want <= got
    return {"score": int(ok), "comment": f"expected ⊇ {sorted(want)}, got {sorted(got)}"}


def evidence_pointers_valid(run, example):
    """Unverifiable citations are dropped upstream; the guarantee scored
    here is that every relation-asserting finding retains at least one
    citation that resolved against real content."""
    outputs = _outputs(run)
    unsupported = outputs.get("related_without_valid_evidence", 0)
    ok = bool(outputs.get("evidence_ok", False)) and unsupported == 0
    return {"score": int(ok), "comment": f"related findings without valid evidence: {unsupported}"}


def abstention_appropriate(run, example):
    got = bool(_outputs(run).get("abstained"))
    want = bool(_expected(example).get("expected_abstained"))
    return {"score": int(got == want), "comment": f"expected abstained={want}, got {got}"}


def missing_evidence_detected(run, example):
    got = bool(_outputs(run).get("missing_evidence"))
    want = bool(_expected(example).get("expect_missing_evidence"))
    return {"score": int(got == want), "comment": f"expected missing-evidence={want}, got {got}"}


DETERMINISTIC_EVALUATORS = [
    classification_correct,
    review_flag_correct,
    product_artifact_selected,
    stale_or_draft_rejected,
    obligations_identified,
    control_points_inspected,
    evidence_pointers_valid,
    abstention_appropriate,
    missing_evidence_detected,
]


def explanation_quality_judge(run, example):
    """LLM judge for the rendered comment's explanation quality.

    Secondary by design: it grades readability/citation quality of the
    comment, not correctness — correctness is owned by the deterministic
    evaluators above.
    """
    from langchain_anthropic import ChatAnthropic
    from pydantic import BaseModel, Field

    class Grade(BaseModel):
        reasoning: str = Field(description="Why this grade")
        clear_and_actionable: bool = Field(
            description="Comment states what changed, which obligations, and what to do next"
        )

    comment = _outputs(run).get("comment", "")
    judge = ChatAnthropic(
        model="claude-haiku-4-5", temperature=0, max_tokens=512
    ).with_structured_output(Grade)
    grade = judge.invoke(
        "Grade this PR alignment comment for explanation quality only "
        "(clarity, specificity, actionable next step). Do NOT grade whether "
        f"the verdict is correct.\n\n{comment}"
    )
    return {"score": int(grade.clear_and_actionable), "comment": grade.reasoning}
