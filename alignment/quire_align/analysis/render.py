"""Concise GitHub-comment renderer for a PRAnalysis."""

from __future__ import annotations

from quire_align.models import Classification, ImpactRelation, PRAnalysis

_BADGES = {
    Classification.NO_MATERIAL_IMPACT: "⚪ No material impact",
    Classification.ALIGNED: "🟢 Aligned",
    Classification.PARTIAL: "🟡 Partial",
    Classification.POSSIBLE_DRIFT: "🟠 Possible drift",
    Classification.OFF_INTENT: "🔴 Off intent",
    Classification.UNKNOWN: "⚫ Unknown",
    Classification.UNGOVERNED: "🏳️ Ungoverned surface",
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


def render_comment(analysis: PRAnalysis) -> str:
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
        lines.append("| Obligation | Relation | Why |")
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
                f"| {impact.obligation_id} | {_RELATION_LABEL[impact.relation]} | {reason} |"
            )
        lines.append("")

    if analysis.context and analysis.context.abstained:
        lines.append(f"**Abstained:** {analysis.context.abstain_reason}")
        lines.append("")
    if analysis.context and analysis.context.rejected:
        rejected = ", ".join(analysis.context.rejected)
        lines.append(f"**Rejected sources:** {rejected}")
        lines.append("")

    if analysis.missing_evidence:
        lines.append("**Missing evidence:**")
        for item in analysis.missing_evidence:
            lines.append(f"- {item}")
        lines.append("")

    if analysis.human_review_required:
        reasons = ", ".join(r.value.replace("_", " ") for r in analysis.review_reasons)
        lines.append(f"> ⚠️ **Human review required** — {reasons}")
        lines.append("")

    lines.append(
        f"<sub>PR #{analysis.pr_number} @ `{analysis.head_sha[:12]}` · "
        f"contract `{analysis.contract_snapshot_id}` · "
        f"analyzer v{analysis.analyzer_version} · "
        f"analysis `{analysis.analysis_id}`</sub>"
    )
    return "\n".join(lines)
