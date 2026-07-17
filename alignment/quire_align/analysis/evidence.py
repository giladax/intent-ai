"""Deterministic validation of evidence citations.

Every material finding must cite something that actually resolves: a file
at base/head, a hunk present in the diff, or a section of a snapshotted
product artifact. Citations that don't resolve are marked invalid; findings
without any valid citation make the analysis fall back toward UNKNOWN.
"""

from __future__ import annotations

import html

from quire_align.models import (
    ArtifactSnapshot,
    Evidence,
    EvidenceType,
    ImpactRelation,
    ObligationImpact,
    PullRequest,
)


def _normalize(text: str) -> str:
    # Models occasionally HTML-escape code excerpts (`&gt;` for `>`); treat
    # that as the same citation rather than failing verbatim matching.
    return " ".join(html.unescape(text).split())


def validate_evidence_item(
    item: Evidence,
    *,
    pr: PullRequest,
    adapter,
    diff: str,
    artifacts: list[ArtifactSnapshot],
) -> bool:
    if item.type == EvidenceType.DIFF_HUNK:
        return bool(item.excerpt) and _normalize(item.excerpt) in _normalize(diff)

    if item.type == EvidenceType.ARTIFACT_SECTION:
        artifact = next((a for a in artifacts if a.reference == item.reference), None)
        if artifact is None:
            return False
        if item.excerpt:
            return _normalize(item.excerpt) in _normalize(artifact.content)
        return True

    # File-based evidence: FILE_LINES, SYMBOL, TEST.
    content = adapter.file_content(pr, item.reference, "head")
    if content is None:
        content = adapter.file_content(pr, item.reference, "base")
    if content is None:
        return False
    if item.excerpt and _normalize(item.excerpt) not in _normalize(content):
        return False
    if item.end_line:
        if item.start_line < 1 or item.end_line < item.start_line:
            return False
        if item.start_line > len(content.splitlines()):
            return False
    if item.symbol and item.symbol.split(".")[-1] not in content:
        return False
    return True


def validate_evidence(
    impacts: list[ObligationImpact],
    *,
    pr: PullRequest,
    adapter,
    diff: str,
    artifacts: list[ArtifactSnapshot],
) -> tuple[bool, int]:
    """Validates every citation and DROPS the ones that don't resolve —
    unverifiable pointers never ship. Returns (ok, dropped_count) where ok
    is False when a relation-asserting impact is left without any valid
    citation."""
    all_supported = True
    dropped = 0
    for impact in impacts:
        for item in impact.evidence:
            item.valid = validate_evidence_item(
                item, pr=pr, adapter=adapter, diff=diff, artifacts=artifacts
            )
        dropped += sum(1 for e in impact.evidence if not e.valid)
        impact.evidence = [e for e in impact.evidence if e.valid]
        if impact.relation != ImpactRelation.UNRELATED and not impact.evidence:
            all_supported = False
    return all_supported, dropped
