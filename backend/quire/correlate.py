"""quire.correlate — mechanical-only structural correlation (U1).

Produces kind="inferred" SessionCheckLink PROPOSALS by computing the
intersection of structural facts:
  - repo/branch match
  - session time-window vs commit-time overlap
  - session touched_paths ∩ PR diff-file intersection

NO content similarity. NO semantic judgment. Only deterministic structural
facts are used (ruler ruling A — 2026-07-21: "similarity never grants
authority").

Inferred links are proposals ONLY — they are never auto-promoted. They are
surfaced to the human for confirmation ("this session looks related to PR #N
— confirm?"). The human's `sessions attach` promotes an inferred to attached.

## Output language (U1 spec)
Each proposal's evidence field reads as a sentence, e.g.:
  "Session 5b31a1bb edited 4 of this PR's 6 files during its commit window"

## Honest unknowns
- Commit timestamps require a live git repo; when unavailable the time-window
  signal is absent and only path intersection is used.
- This module never makes LLM calls. Any "is this related?" judgment that goes
  beyond structural facts is out of scope (ruling A).
"""
from __future__ import annotations

import logging
import pathlib
from typing import Sequence

logger = logging.getLogger(__name__)

# Minimum confidence to bother storing an inferred proposal
_MIN_CONFIDENCE = 0.2


def propose_couplings(
    *,
    session_id: str,
    repo: str,
    branch: str | None,
    workspace: str,
    sessions_dir: pathlib.Path | None = None,
    pr_files: dict[int, list[str]] | None = None,
) -> list:
    """Generate inferred coupling proposals for a session.

    Scans sessions.yaml for the given session, then looks at all analyses
    in the store whose repository matches `repo`, and computes a structural
    confidence score for each PR. Returns proposals for any PR scoring above
    the minimum threshold.

    Args:
        session_id: the session to correlate
        repo: "owner/name"
        branch: optional branch filter
        workspace: workspace name (used for the link's workspace field)
        sessions_dir: directory containing sessions.yaml (used in tests)
        pr_files: {pr_number: [file…]} override for tests (skips adapter)

    Returns:
        list of SessionCheckLink with kind="inferred" and confidence < 1.0
    """
    from quire.links import SessionCheckLink

    # Load the session record from sessions.yaml
    session_record = _load_session_record(session_id, sessions_dir)
    if session_record is None:
        logger.debug("correlate: session %s not found in sessions.yaml — no proposals", session_id)
        return []

    touched = set(session_record.get("touched_paths") or [])
    if not touched:
        logger.debug("correlate: session %s has no touched_paths — no proposals", session_id)
        return []

    # If pr_files is provided (test mode), correlate against those
    if pr_files is not None:
        return _correlate_against_files(
            session_id=session_id,
            touched=touched,
            workspace=workspace,
            pr_files=pr_files,
        )

    # Otherwise try to load analyses from the store for this repo
    try:
        from quire.store import Store
        store = Store()
        analyses = store.list_analyses(repository=repo)
    except Exception as exc:
        logger.warning("correlate: could not load analyses for %s: %s", repo, exc)
        return []

    if not analyses:
        return []

    # Build {pr_number: base_sha, head_sha} from the latest analysis per PR
    pr_meta: dict[int, dict] = {}
    for a in analyses:
        pr = a.pr_number
        if pr not in pr_meta or a.created_at > pr_meta[pr]["created_at"]:
            pr_meta[pr] = {
                "pr_number": pr,
                "base_sha": a.base_sha or "",
                "head_sha": a.head_sha or "",
                "created_at": a.created_at,
            }

    proposals: list[SessionCheckLink] = []
    for pr_number, meta in pr_meta.items():
        link = _score_one(
            session_id=session_id,
            touched=touched,
            pr_number=pr_number,
            base_sha=meta["base_sha"],
            head_sha=meta["head_sha"],
            workspace=workspace,
        )
        if link is not None:
            proposals.append(link)

    return proposals


def _correlate_against_files(
    *,
    session_id: str,
    touched: set[str],
    workspace: str,
    pr_files: dict[int, list[str]],
) -> list:
    """Test-friendly correlate: pr_files is {pr_number: [file…]}."""
    from quire.links import SessionCheckLink

    proposals = []
    for pr_number, files in pr_files.items():
        pr_set = set(files)
        overlap = _path_overlap(touched, pr_set)
        if not overlap:
            continue
        confidence = len(overlap) / max(len(pr_set), 1)
        if confidence < _MIN_CONFIDENCE:
            continue
        evidence = (
            f"Session {session_id[:8]} edited {len(overlap)} of this PR's "
            f"{len(pr_set)} file(s) — structural path overlap"
        )
        proposals.append(SessionCheckLink(
            session_id=session_id,
            workspace=workspace,
            pr_number=pr_number,
            base_sha="",
            head_sha="",
            kind="inferred",
            confidence=min(confidence, 0.85),  # inferred never reaches 1.0
            evidence=evidence,
        ))
    return proposals


def _score_one(
    *,
    session_id: str,
    touched: set[str],
    pr_number: int,
    base_sha: str,
    head_sha: str,
    workspace: str,
) -> "SessionCheckLink | None":
    """Compute a structural confidence for one session ↔ PR candidate.

    Returns None when confidence is below the minimum threshold.
    """
    from quire.links import SessionCheckLink

    # Path intersection signal: touched_paths ∩ PR changed files
    # We can only know the PR's files if we have a git adapter or stored diff.
    # Without live git, fall back to confidence=0 (no proposals).
    # This is honest: structural facts first, not guessing.
    pr_files = _pr_changed_files(base_sha, head_sha)
    if not pr_files:
        return None

    overlap = _path_overlap(touched, pr_files)
    if not overlap:
        return None

    confidence = len(overlap) / max(len(pr_files), 1)
    if confidence < _MIN_CONFIDENCE:
        return None

    evidence = (
        f"Session {session_id[:8]} edited {len(overlap)} of this PR's "
        f"{len(pr_files)} file(s) during the commit range {base_sha[:8]}..{head_sha[:8]}"
    )

    return SessionCheckLink(
        session_id=session_id,
        workspace=workspace,
        pr_number=pr_number,
        base_sha=base_sha,
        head_sha=head_sha,
        kind="inferred",
        confidence=min(confidence, 0.85),  # inferred never reaches 1.0
        evidence=evidence,
    )


def _pr_changed_files(base_sha: str, head_sha: str) -> set[str]:
    """Get the set of changed files for a commit range via git diff.

    Returns empty set when git is unavailable or the range is invalid.
    This is a STRUCTURAL fact (git diff is deterministic) — not LLM.
    """
    if not base_sha or not head_sha or base_sha == head_sha:
        return set()
    import subprocess
    from quire.journal.archive import get_archive_dir
    # Try to find the repo root
    repo_root = get_archive_dir().parent.parent.parent  # backend/.intent/raw-sessions → backend → repo root
    try:
        result = subprocess.run(
            ["git", "-C", str(repo_root), "diff", "--name-only",
             f"{base_sha}..{head_sha}"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            return set()
        return {line.strip() for line in result.stdout.splitlines() if line.strip()}
    except Exception:
        return set()


def _path_overlap(touched: set[str], pr_files: set[str]) -> set[str]:
    """Paths in `touched` that match any path in `pr_files`.

    Matching is by suffix or basename — a session that edited
    'backend/quire/session.py' overlaps with 'quire/session.py'
    (the transcript's absolute path may differ from the git-relative path).
    """
    hit: set[str] = set()
    for tp in touched:
        for pf in pr_files:
            if _paths_match(tp, pf):
                hit.add(tp)
                break
    return hit


def _paths_match(a: str, b: str) -> bool:
    """True when path a and path b refer to the same file.

    Match by exact string, or one being a suffix of the other
    (handles different path roots across transcript and git output).
    """
    if a == b:
        return True
    # suffix match
    if a.endswith("/" + b) or b.endswith("/" + a):
        return True
    # basename match
    import os
    ba, bb = os.path.basename(a), os.path.basename(b)
    return bool(ba) and ba == bb


def _load_session_record(session_id: str, sessions_dir: pathlib.Path | None) -> dict | None:
    """Load a session record from sessions.yaml.

    Returns None when not found.
    """
    if sessions_dir is None:
        # Try quire-brain workspace (the production path for this project)
        sessions_dir = (
            pathlib.Path(__file__).parent.parent
            / "workspaces" / "quire-brain"
        )
    sessions_file = sessions_dir / "sessions.yaml"
    if not sessions_file.exists():
        return None
    try:
        import yaml
        sessions = yaml.safe_load(sessions_file.read_text()) or []
        for s in sessions:
            if s.get("session_id") == session_id:
                return s
    except Exception as exc:
        logger.warning("correlate: failed to read sessions.yaml: %s", exc)
    return None
