"""Proactive onboarding: the system leads, the human approves.

The customer doesn't need to know what counts as a "PRD". Point the wizard
at a repository and it:

1. SCANS — finds candidate intent sources itself (docs ranked by promise
   density) and the recent commits worth a retroactive sweep;
2. DRAFTS — mines the chosen sources into candidate obligations with
   verbatim provenance (via `propose.py`);
3. gets APPROVAL — the only human step: approve/edit/reject cards;
4. FIRST LIGHT — writes the approved workspace and replays recent commits
   against the brand-new contract, so value is visible in the same session.

Everything written here is the *approved* contract — the approval act is
the wizard session itself. Draft artifacts never reach the analyzer.
"""

from __future__ import annotations

import pathlib
import re
import subprocess

import yaml

_PROMISE_WORDS = re.compile(
    r"\b(must|never|always|shall|required?|may not|enforce[sd]?|guarantee[sd]?|"
    r"approved?|forbidden|policy|limit|constraint)\b",
    re.IGNORECASE,
)
_NAME_HINTS = ("prd", "spec", "requirement", "policy", "design", "adr", "decision", "contract", "readme", "claude")
_DOC_SUFFIXES = (".md", ".txt", ".rst")
_SKIP_PARTS = {
    "node_modules", ".git", "__pycache__", "dist", "build", ".venv", "venv",
    "archive", "fixtures", "tests", "test", "mockups", "eval-runs",
    ".superpowers", "handoffs", ".claude", ".repo", "skills", "worktrees",
    "drizzle",
}


def scan_intent_sources(repo: pathlib.Path, limit: int = 12) -> list[dict]:
    """Rank documents in the repo by how much approved-intent signal they
    carry: promise-word density plus filename hints. Proactive step one —
    the customer confirms, they don't have to hunt."""
    candidates = []
    for path in repo.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in _DOC_SUFFIXES:
            continue
        rel = path.relative_to(repo)
        if any(part in _SKIP_PARTS for part in rel.parts):
            continue
        try:
            text = path.read_text()
        except (UnicodeDecodeError, OSError):
            continue
        words = max(len(text.split()), 1)
        if words < 40:
            continue
        promises = len(_PROMISE_WORDS.findall(text))
        density = promises / words
        name_bonus = sum(0.4 for hint in _NAME_HINTS if hint in path.name.lower())
        score = round(density * 100 + name_bonus, 2)
        candidates.append(
            {
                "path": str(rel),
                "words": words,
                "promise_hits": promises,
                "score": score,
                "preview": " ".join(text.split()[:36]),
            }
        )
    candidates.sort(key=lambda c: -c["score"])
    return candidates[:limit]


def recent_commits(repo: pathlib.Path, n: int = 10) -> list[dict]:
    """Recent history worth replaying against the new contract."""
    result = subprocess.run(
        ["git", "-C", str(repo), "log", f"-{n}", "--format=%H%x09%s"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return []
    commits = []
    for line in result.stdout.splitlines():
        sha, _, subject = line.partition("\t")
        commits.append({"sha": sha, "subject": subject})
    return commits


def write_workspace(
    workspaces_root: pathlib.Path,
    workflow_id: str,
    repo: pathlib.Path,
    sources: list[dict],  # [{path, reference?, version?}] — approved by the wizard
    obligations: list[dict],  # approved cards (possibly edited)
    control_points: list[dict],
    bindings: list[dict],
    sweep_commits: list[dict],  # [{sha, subject}]
) -> pathlib.Path:
    out = workspaces_root / workflow_id
    out.mkdir(parents=True, exist_ok=True)
    (out / "issues").mkdir(exist_ok=True)

    rel_repo = _relative(out, repo)
    primary_ref = sources[0]["reference"] if sources else "intent-source"

    (out / "workflow.yaml").write_text(
        yaml.safe_dump(
            {
                "workflow_id": workflow_id,
                "requirements": {"provider": "git", "reference": primary_ref},
                "repositories": [
                    {"provider": "git", "repository": workflow_id, "path": rel_repo}
                ],
                "eval_sources": [{"type": "repository", "paths": ["tests/**", "evals/**"]}],
            },
            sort_keys=False,
        )
    )
    (out / "requirements_index.yaml").write_text(
        yaml.safe_dump(
            [
                {
                    "reference": s["reference"],
                    "path": s["path"],
                    "status": "approved",  # the wizard session IS the approval act
                    "version": s.get("version", "onboard-1"),
                }
                for s in sources
            ],
            sort_keys=False,
        )
    )
    (out / "obligations.yaml").write_text(
        yaml.safe_dump({"obligations": obligations}, sort_keys=False, width=88)
    )
    (out / "bindings.yaml").write_text(
        yaml.safe_dump(
            {"control_points": control_points, "bindings": bindings},
            sort_keys=False,
            width=88,
        )
    )
    prs = {
        i + 1: {"base": f"{c['sha']}^", "head": c["sha"], "title": c["subject"]}
        for i, c in enumerate(sweep_commits)
    }
    (out / "prs.yaml").write_text(yaml.safe_dump(prs, sort_keys=False))
    return out


def _relative(from_dir: pathlib.Path, to: pathlib.Path) -> str:
    import os

    return os.path.relpath(to.resolve(), from_dir.resolve())
