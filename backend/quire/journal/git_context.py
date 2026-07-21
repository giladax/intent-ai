"""Python port of journal/src/pipeline/orchestrator.ts::getGitContext.

Extracts repo name, branch, and worktree path from a CC log file's
directory using git commands. Returns all-None dict on any failure
(same silent-fallback semantics as the TS implementation).
"""
from __future__ import annotations

import os
import subprocess


def get_git_context(source_path: str) -> dict[str, str | None]:
    """Return {repo, branch, worktree} for the git repo containing source_path.

    All values may be None if source_path is not inside a git repo or git
    commands fail (e.g. ~/.claude/projects logs do not live in the repo).
    """
    cwd = os.path.dirname(source_path) or "."
    try:
        branch = _run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd)
        toplevel = _run_git(["rev-parse", "--show-toplevel"], cwd)
        repo = os.path.basename(toplevel) if toplevel else None

        worktree: str | None = None
        try:
            common_dir = _run_git(
                ["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd
            )
            if common_dir:
                # strip trailing /.git if present
                common_dir = common_dir.rstrip("/.git").rstrip("/")
                if common_dir != toplevel:
                    worktree = toplevel
        except Exception:
            pass  # not a worktree — benign

        return {"repo": repo, "branch": branch, "worktree": worktree}
    except Exception:
        return {"repo": None, "branch": None, "worktree": None}


def _run_git(args: list[str], cwd: str) -> str | None:
    result = subprocess.run(
        ["git"] + args,
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=5,
    )
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None
