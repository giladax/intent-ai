"""Deterministic test/eval/guard coverage inspection.

For each obligation the PR impacts, check its `verifies`-bound control
points: do they exist, and did the PR touch them? A material behavior
change that leaves every bound verification untouched is a coverage gap.

When an obligation has no `verifies` binding at all, the manifest's
`eval_sources` globs act as fallback verification: a PR that changes files
under those globs is credited with updating verification even though no
binding names them.
"""

from __future__ import annotations

from quire_align.analysis.matching import match_eval_paths
from quire_align.models import (
    Binding,
    BindingRelation,
    ControlPoint,
    CoverageFinding,
    ImpactRelation,
    ObligationImpact,
    PullRequest,
)


def inspect_coverage(
    pr: PullRequest,
    adapter,
    impacts: list[ObligationImpact],
    bindings: list[Binding],
    control_points: list[ControlPoint],
    changed_files: list[str],
    eval_globs: list[str] | None = None,
) -> list[CoverageFinding]:
    cp_by_id = {cp.control_point_id: cp for cp in control_points}
    head_paths = set(adapter.list_paths(pr, "head"))
    changed = set(changed_files)
    changed_eval_paths = match_eval_paths(sorted(changed), eval_globs or [])

    findings: list[CoverageFinding] = []
    for impact in impacts:
        if impact.relation == ImpactRelation.UNRELATED:
            continue
        verifying = [
            cp_by_id[b.control_point_id]
            for b in bindings
            if b.obligation_id == impact.obligation_id
            and b.relation == BindingRelation.VERIFIES
            and b.control_point_id in cp_by_id
        ]
        existing = [cp for cp in verifying if cp.path in head_paths]
        touched = [cp for cp in existing if cp.path in changed]
        gaps: list[str] = []
        if not verifying:
            if changed_eval_paths:
                # Fallback: no binding names a verification, but the PR did
                # change files under the manifest's eval_sources globs —
                # credit that instead of flagging a gap.
                findings.append(
                    CoverageFinding(
                        obligation_id=impact.obligation_id,
                        verifying_control_points=[],
                        verified_by_changed_tests=True,
                        has_any_verification=False,
                        gaps=[],
                    )
                )
                continue
            gaps.append(
                f"{impact.obligation_id} has no test or eval bound to verify it"
            )
        elif not touched:
            paths = ", ".join(cp.path for cp in verifying)
            gaps.append(
                f"{impact.obligation_id} behavior changed but no bound "
                f"verification was updated ({paths})"
            )
        findings.append(
            CoverageFinding(
                obligation_id=impact.obligation_id,
                verifying_control_points=[cp.control_point_id for cp in verifying],
                verified_by_changed_tests=bool(touched),
                has_any_verification=bool(existing),
                gaps=gaps,
            )
        )
    return findings
