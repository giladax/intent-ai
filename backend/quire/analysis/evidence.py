"""Deterministic validation of evidence citations.

Every material finding must cite something that actually resolves: a file
at base/head, a hunk present in the diff, or a section of a snapshotted
product artifact. Citations that don't resolve are marked invalid; findings
without any valid citation make the analysis fall back toward UNKNOWN.
"""

from __future__ import annotations

import html

from quire.models import (
    ArtifactSnapshot,
    Evidence,
    EvidenceType,
    ImpactRelation,
    ObligationImpact,
    PullRequest,
)


# An excerpt shorter than this, or made only of punctuation/operators,
# carries no evidentiary weight — a bare `+` or `def` "matches" almost
# any source. Citations for material findings must quote real substance
# (blind review 2026-07-20, B1: presence was not relevance).
_MIN_EXCERPT_CHARS = 12


def _normalize_line(text: str) -> str:
    """Whitespace/HTML-tolerant but PRESERVES line structure — a
    multi-line excerpt must appear as contiguous lines in the source, not
    be assembled from fragments scattered across the file (B1: the old
    normalizer flattened newlines, so scattered tokens matched)."""
    return "\n".join(
        " ".join(html.unescape(ln).split()) for ln in text.splitlines()
    ).strip()


def _substantive(excerpt: str) -> bool:
    stripped = _normalize_line(excerpt)
    return len(stripped) >= _MIN_EXCERPT_CHARS and any(c.isalnum() for c in stripped)


def _excerpt_in(excerpt: str, source: str) -> bool:
    return _normalize_line(excerpt) in _normalize_line(source)


def validate_evidence_item(
    item: Evidence,
    *,
    pr: PullRequest,
    adapter,
    diff: str,
    artifacts: list[ArtifactSnapshot],
) -> bool:
    if item.type == EvidenceType.DIFF_HUNK:
        return _substantive(item.excerpt) and _excerpt_in(item.excerpt, diff)

    if item.type == EvidenceType.ARTIFACT_SECTION:
        artifact = next((a for a in artifacts if a.reference == item.reference), None)
        if artifact is None:
            return False
        # An artifact citation with no substantive quote is not a citation
        # (no-quote-no-render) — empty excerpts no longer get a free pass.
        return _substantive(item.excerpt) and _excerpt_in(item.excerpt, artifact.content)

    # File-based evidence: FILE_LINES, SYMBOL, TEST.
    content = adapter.file_content(pr, item.reference, "head")
    if content is None:
        content = adapter.file_content(pr, item.reference, "base")
    if content is None:
        return False
    lines = content.splitlines()
    if item.end_line:
        if item.start_line < 1 or item.end_line < item.start_line:
            return False
        if item.start_line > len(lines):
            return False
    if item.excerpt:
        if not _substantive(item.excerpt):
            return False
        # The excerpt must appear AT the cited lines, not merely somewhere
        # in the file — a pointer to line 500 quoting line 10 is not
        # evidence. A small window tolerates off-by-a-few citations. Note
        # start/end_line are 1-based while `lines` is 0-based, so the window
        # is a few lines either side of the cite, not an exact slice.
        if item.end_line:
            lo, hi = max(0, item.start_line - 3), min(len(lines), item.end_line + 3)
            if not _excerpt_in(item.excerpt, "\n".join(lines[lo:hi])):
                return False
        elif not _excerpt_in(item.excerpt, content):
            return False
    elif not (item.symbol or item.end_line):
        return False  # neither excerpt, symbol, nor lines → nothing checkable
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
