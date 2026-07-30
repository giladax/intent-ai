"""Product-context resolution ladder.

Order (per spec):
  1. Explicit PR → issue → requirement links.
  2. Sources registered in the workflow manifest.
  3. Existing obligation-to-control-point bindings.
  4. Lexical retrieval within the workflow's configured scope.
  5. Abstain when authority or relevance remains ambiguous.

Two hard rules:
  - Similarity NEVER grants authority. Retrieval only surfaces candidates;
    authority always comes from the artifact's provider-asserted status.
  - Conflicting explicit authority is not silently resolved. If a work item
    links more than one approved requirement source, we abstain rather than
    let a default or a similarity score pick a side of contested intent.
"""

from __future__ import annotations

from quire.manifest import WorkflowManifest
from quire.text import tokenize
from quire.models import (
    ArtifactSnapshot,
    Authority,
    Binding,
    ContextResolution,
    ControlPoint,
    Issue,
    Obligation,
    PullRequest,
)

_RETRIEVAL_MIN_OVERLAP = 3


def _lexical_overlap(query: str, content: str) -> int:
    # keep_digits: "$50" / "24h" are real vocabulary in product requirements.
    query_terms = set(tokenize(query, min_len=4, keep_digits=True))
    content_terms = set(tokenize(content, min_len=4, keep_digits=True))
    return len(query_terms & content_terms)


def resolve_context(
    pr: PullRequest,
    issue: Issue | None,
    manifest: WorkflowManifest,
    artifacts: list[ArtifactSnapshot],
    obligations: list[Obligation],
    matched_control_points: list[ControlPoint],
    bindings: list[Binding],
    min_overlap: int = _RETRIEVAL_MIN_OVERLAP,
) -> ContextResolution:
    by_ref = {a.reference: a for a in artifacts}
    resolved: list[str] = []
    path: list[str] = []
    rejected: list[str] = []

    def admit(reference: str, rung: str) -> None:
        artifact = by_ref.get(reference)
        if artifact is None:
            return
        if artifact.authority != Authority.APPROVED:
            rejected.append(f"{reference} ({artifact.authority.value})")
            return
        if reference not in resolved:
            resolved.append(reference)
            path.append(rung)

    # Rung 1: explicit PR -> issue -> requirement links.
    if issue is not None and issue.requirements:
        approved_links = [
            ref
            for ref in issue.requirements
            if by_ref.get(ref) and by_ref[ref].authority == Authority.APPROVED
        ]
        if len(approved_links) > 1:
            for ref in issue.requirements:
                admit(ref, "explicit_link")
            return ContextResolution(
                resolved_references=[],
                resolution_path=["explicit_link"],
                rejected=rejected + [f"{r} (conflicting authority)" for r in approved_links],
                abstained=True,
                abstain_reason=(
                    f"work item {issue.key} links {len(approved_links)} approved "
                    "requirement sources that assert conflicting authority; "
                    "refusing to pick a side of contested intent"
                ),
            )
        for ref in issue.requirements:
            admit(ref, "explicit_link")

    # Rung 2: manifest-registered canonical source.
    admit(manifest.requirements.reference, "manifest")

    # Rung 3: obligations already bound to the touched control points.
    touched_ids = {cp.control_point_id for cp in matched_control_points}
    bound_obligation_ids = {
        b.obligation_id for b in bindings if b.control_point_id in touched_ids
    }
    for obligation in obligations:
        if obligation.obligation_id in bound_obligation_ids:
            admit(obligation.source_reference, "bindings")

    # Rung 4: lexical retrieval within configured scope — candidates only;
    # admit() still gates on approved authority.
    if not resolved:
        query = f"{pr.title}\n{pr.body}"
        scored = sorted(
            ((artifact, _lexical_overlap(query, artifact.content)) for artifact in artifacts),
            key=lambda pair: -pair[1],
        )
        for artifact, score in scored:
            if score >= min_overlap:
                admit(artifact.reference, "retrieval")

    # Rung 5: abstain.
    if not resolved:
        return ContextResolution(
            resolved_references=[],
            resolution_path=path,
            rejected=rejected,
            abstained=True,
            abstain_reason="no approved requirement source could be resolved for this change",
        )

    return ContextResolution(
        resolved_references=resolved,
        resolution_path=path,
        rejected=rejected,
        abstained=False,
    )
