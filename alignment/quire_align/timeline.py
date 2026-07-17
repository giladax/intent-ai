"""Intent timeline: replayable history of how checks (PR analyses)
affected the understood intent state.

Every analysis is already persisted with a timestamp, per-obligation impacts,
and a pinned contract snapshot — so the intent state at any past event is a
pure fold over the event stream:

    state[obligation] = last non-unrelated relation observed at or before T

Contract-snapshot changes between consecutive events are surfaced as
"intent revised" markers, and unresolved drift/ungoverned verdicts up to T
form the open intent-inbox at that moment.
"""

from __future__ import annotations

from quire_align.models import Classification, ImpactRelation, PRAnalysis

UNOBSERVED = "unobserved"

_FINDING_VERDICTS = {Classification.POSSIBLE_DRIFT, Classification.UNGOVERNED}


def build_timeline(adapter, analyses: list[PRAnalysis]) -> dict:
    obligations = adapter.obligations()
    control_points = {cp.control_point_id: cp for cp in adapter.control_points()}
    bindings = adapter.bindings()

    ordered = sorted(analyses, key=lambda a: a.created_at)
    state: dict[str, dict] = {
        o.obligation_id: {"status": UNOBSERVED, "since": None, "confidence": None}
        for o in obligations
    }
    events: list[dict] = []
    open_findings: list[dict] = []
    prev_contract: str | None = None

    for analysis in ordered:
        # The PR may no longer be resolvable (fixture dir gone, commit
        # rebased away, network/API failure) — the timeline still renders,
        # just without a title. RequestException subclasses OSError, so the
        # GitHub adapter is covered too.
        title = ""
        try:
            title = adapter.get_pr(analysis.pr_number).title
        except (FileNotFoundError, KeyError, RuntimeError, OSError):
            pass

        changes = []
        for impact in analysis.obligation_impacts:
            if impact.relation == ImpactRelation.UNRELATED:
                continue
            entry = state.setdefault(
                impact.obligation_id,
                {"status": UNOBSERVED, "since": None, "confidence": None},
            )
            if entry["status"] != impact.relation.value:
                changes.append(
                    {
                        "obligation_id": impact.obligation_id,
                        "from": entry["status"],
                        "to": impact.relation.value,
                        "reasoning": impact.reasoning[:240],
                    }
                )
            entry.update(
                status=impact.relation.value,
                since=analysis.pr_number,
                confidence=impact.confidence,
            )

        # A re-check of the same PR supersedes its earlier finding.
        open_findings = [f for f in open_findings if f["pr_number"] != analysis.pr_number]
        if analysis.classification in _FINDING_VERDICTS:
            open_findings.append(
                {
                    "pr_number": analysis.pr_number,
                    "title": title,
                    "verdict": analysis.classification.value,
                    "summary": (
                        analysis.behavioral_delta.summary[:200]
                        if analysis.behavioral_delta
                        else ""
                    ),
                    "resolved": analysis.review_state.value in ("approved", "rejected"),
                }
            )

        events.append(
            {
                "analysis_id": analysis.analysis_id,
                "ts": analysis.created_at.isoformat(),
                "pr_number": analysis.pr_number,
                "title": title,
                "head_sha": analysis.head_sha[:10],
                "verdict": analysis.classification.value,
                "review_required": analysis.human_review_required,
                "review_state": analysis.review_state.value,
                "contract_id": analysis.contract_snapshot_id,
                "contract_changed": (
                    prev_contract is not None
                    and analysis.contract_snapshot_id != prev_contract
                ),
                "changes": changes,
                "missing_evidence": len(analysis.missing_evidence),
                "state_after": {
                    ob_id: dict(entry) for ob_id, entry in state.items()
                },
                "open_findings": [dict(f) for f in open_findings if not f["resolved"]],
            }
        )
        prev_contract = analysis.contract_snapshot_id

    manifest = adapter.manifest()
    return {
        "workflow_id": manifest.workflow_id,
        "repository": adapter.repository(),
        "contract_versions": _distinct([e["contract_id"] for e in events]),
        "obligations": [
            {
                "obligation_id": o.obligation_id,
                "kind": o.kind.value,
                "statement": o.statement,
                "source_reference": o.source_reference,
                "source_section": o.source_section,
                "revision": o.revision,
                "control_points": [
                    {
                        "path": control_points[b.control_point_id].path,
                        "role": control_points[b.control_point_id].role.value,
                        "relation": b.relation.value,
                    }
                    for b in bindings
                    if b.obligation_id == o.obligation_id
                    and b.control_point_id in control_points
                ],
            }
            for o in obligations
        ],
        "events": events,
    }


def _distinct(values: list[str]) -> list[str]:
    seen: list[str] = []
    for value in values:
        if value not in seen:
            seen.append(value)
    return seen
