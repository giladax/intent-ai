"""Concise GitHub-comment renderer for a PRAnalysis.

Display vocabulary lives here (badges + DISPLAY_LABELS) so the CLI and the
comment agree. Display strings only — Classification enum VALUES are
persisted and compared in evals, and never change here.
"""

from __future__ import annotations

from quire_align.models import Classification, ImpactRelation, PRAnalysis

_BADGES = {
    Classification.NO_MATERIAL_IMPACT: "⚪ No product impact",
    Classification.ALIGNED: "🟢 Aligned",
    Classification.PARTIAL: "🟡 Partial",
    Classification.POSSIBLE_DRIFT: "🟠 Possible drift",
    Classification.OFF_INTENT: "🔴 Contradicts intent",
    Classification.UNKNOWN: "⚫ Needs review",
    Classification.UNGOVERNED: "⚪ Not covered by the product contract",
}

# Human-facing labels for classification values (enum values stay stable).
DISPLAY_LABELS = {
    Classification.NO_MATERIAL_IMPACT: "NO PRODUCT IMPACT",
    Classification.ALIGNED: "ALIGNED",
    Classification.PARTIAL: "PARTIAL",
    Classification.POSSIBLE_DRIFT: "POSSIBLE DRIFT",
    Classification.OFF_INTENT: "CONTRADICTS INTENT",
    Classification.UNKNOWN: "NEEDS REVIEW",
    Classification.UNGOVERNED: "NOT COVERED",
}

# Verdicts that warrant a PR comment; the rest stay quiet (green check /
# intent-inbox channel).
LOUD_CLASSIFICATIONS = {
    Classification.PARTIAL,
    Classification.POSSIBLE_DRIFT,
    Classification.OFF_INTENT,
    Classification.UNKNOWN,
}

MARKER = "<!-- quire-align -->"

_RELATION_LABEL = {
    ImpactRelation.SATISFIES: "satisfies",
    ImpactRelation.PARTIALLY_SATISFIES: "partially satisfies",
    ImpactRelation.CONTRADICTS: "contradicts",
    ImpactRelation.UNRELATED: "unrelated",
}

_MAX_STATEMENT_CHARS = 90


def _promise_cell(obligation_id: str, statements_by_id: dict[str, str] | None) -> str:
    """Statement-first promise cell; the id rides along in parens."""
    statement = " ".join((statements_by_id or {}).get(obligation_id, "").split())
    if not statement:
        return obligation_id
    if len(statement) > _MAX_STATEMENT_CHARS:
        statement = statement[: _MAX_STATEMENT_CHARS - 1] + "…"
    statement = statement.replace("|", "\\|")
    return f"{statement} ({obligation_id})"


def render_comment(
    analysis: PRAnalysis, statements_by_id: dict[str, str] | None = None
) -> str:
    lines: list[str] = [MARKER]
    lines.append(f"## {_BADGES[analysis.classification]} — product alignment")
    if analysis.classification == Classification.UNGOVERNED:
        lines.append("")
        lines.append(
            "This change alters behavior on a surface not covered by the "
            "current product contract. Routed to the intent inbox — no "
            "action needed on this PR."
        )
    lines.append("")

    if analysis.behavioral_delta and analysis.behavioral_delta.summary:
        lines.append(f"**Behavioral change:** {analysis.behavioral_delta.summary}")
        lines.append("")

    related = [
        i
        for i in analysis.obligation_impacts
        if i.relation != ImpactRelation.UNRELATED
    ]
    if related:
        lines.append("| Promise | Effect | Why |")
        lines.append("|---|---|---|")
        for impact in related:
            evidence = "; ".join(
                f"`{e.reference}`" + (f":{e.start_line}" if e.start_line else "")
                for e in impact.evidence
                if e.valid
            )
            reason = " ".join(impact.reasoning.split()).replace("|", "\\|")
            if len(reason) > 320:
                reason = reason[:317] + "…"
            if evidence:
                reason = f"{reason} ({evidence})"
            lines.append(
                f"| {_promise_cell(impact.obligation_id, statements_by_id)} "
                f"| {_RELATION_LABEL[impact.relation]} | {reason} |"
            )
        lines.append("")

    if analysis.context and analysis.context.abstained:
        lines.append(f"**No verdict — needs a human:** {analysis.context.abstain_reason}")
        lines.append("")
    if analysis.context and analysis.context.rejected:
        rejected = ", ".join(analysis.context.rejected)
        lines.append(f"**Out-of-date sources ignored:** {rejected}")
        lines.append("")

    if analysis.missing_evidence:
        lines.append("**Claims not yet verified:**")
        for item in analysis.missing_evidence:
            lines.append(f"- {item}")
        lines.append("")

    if analysis.human_review_required:
        reasons = ", ".join(r.value.replace("_", " ") for r in analysis.review_reasons)
        lines.append(f"> ⚠️ **Human review required** — {reasons}")
        lines.append("")

    lines.append(
        f"<sub>PR #{analysis.pr_number} @ commit `{analysis.head_sha[:12]}` · "
        f"contract version `{analysis.contract_snapshot_id}` · "
        f"analyzer v{analysis.analyzer_version} · "
        f"analysis `{analysis.analysis_id}` "
        "(reply id — use it with the review command)</sub>"
    )
    return "\n".join(lines)
