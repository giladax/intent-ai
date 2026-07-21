"""Deterministic control-point matching against a PR's changed files.

No LLM involvement here: control points are known, registered locations;
matching is by path. Enforcement-removal detection is structural (file or
symbol or call-site gone), not semantic.
"""

from __future__ import annotations

import fnmatch
import re

from quire.models import ControlPoint, ControlPointRole, PullRequest


def match_control_points(
    changed_files: list[str], control_points: list[ControlPoint]
) -> list[ControlPoint]:
    changed = set(changed_files)
    return [cp for cp in control_points if cp.path in changed]


def match_eval_paths(paths: list[str], globs: list[str]) -> list[str]:
    """Which of `paths` fall under the manifest's eval-source globs."""
    matched = set()
    for pattern in globs:
        # fnmatch has no `**`; our eval globs are `<dir>/**` so match by prefix.
        prefix = pattern[:-3] if pattern.endswith("/**") else None
        for path in paths:
            if prefix is not None and path.startswith(prefix + "/"):
                matched.add(path)
            elif prefix is None and fnmatch.fnmatch(path, pattern):
                matched.add(path)
    return sorted(matched)


def _symbol_present(content: str, symbol: str) -> bool:
    """Structural check that a bound symbol still exists in a file.

    Symbols are `Class.method` or bare function/class names; we check for
    the `def`/`class` declaration of each component with word boundaries —
    a plain substring check would let `def check_all` satisfy `check`.
    """
    for part in symbol.split("."):
        if not re.search(rf"\b(?:def|class)\s+{re.escape(part)}\b", content):
            return False
    return True


def detect_removed_enforcement(
    pr: PullRequest,
    adapter,
    control_points: list[ControlPoint],
    changed_files: list[str],
    diff: str,
) -> list[str]:
    """Enforcement control points whose protection this PR structurally removed.

    A point counts as removed when its file was deleted, its bound symbol no
    longer exists at head, or a call to it was dropped from a changed file
    without a replacement.
    """
    removed: list[str] = []
    changed = set(changed_files)
    # Scan the diff once; per control point we only look through these.
    diff_lines = diff.splitlines()
    removed_lines = [
        line for line in diff_lines if line.startswith("-") and not line.startswith("---")
    ]
    added_lines = [
        line for line in diff_lines if line.startswith("+") and not line.startswith("+++")
    ]
    for cp in control_points:
        if cp.role != ControlPointRole.ENFORCEMENT:
            continue
        if cp.path in pr.deleted_files:
            removed.append(cp.control_point_id)
            continue
        if cp.path in changed and cp.symbol:
            head = adapter.file_content(pr, cp.path, "head")
            base = adapter.file_content(pr, cp.path, "base")
            if base and _symbol_present(base, cp.symbol) and (
                head is None or not _symbol_present(head, cp.symbol)
            ):
                removed.append(cp.control_point_id)
                continue
        if cp.symbol:
            call = cp.symbol.split(".")[-1] + "("
            dropped = any(call in line for line in removed_lines)
            readded = any(call in line for line in added_lines)
            if dropped and not readded:
                removed.append(cp.control_point_id)
    return removed
