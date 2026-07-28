"""Proactive onboarding: the system leads, the human approves.

The customer doesn't need to know what counts as a "PRD". Point the wizard
at a repository and it:

1. SCANS — finds candidate intent sources itself (docs ranked by how many
   product promises they contain) and the recent commits worth replaying;
2. DRAFTS — mines the chosen sources into candidate obligations with
   verbatim provenance (via `propose.py`);
3. gets APPROVAL — the only human step: approve/edit/reject cards;
4. FIRST RESULTS — writes the approved workspace and replays recent commits
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
# Directories that never hold approved intent, in any repo.
_SKIP_PARTS_GENERIC = {
    "node_modules", ".git", "__pycache__", "dist", "build", ".venv", "venv",
    "archive", "fixtures", "tests", "test", "mockups",
}
# Extras for this monorepo's layout — the default when no override is given;
# pass `extra_skip_parts` to tailor the scan to another repo.
_SKIP_PARTS_EXTRA_DEFAULT = {
    "eval-runs", ".superpowers", "handoffs", ".claude", ".repo", "skills",
    "worktrees", "drizzle",
}
# Filenames that are never approved intent, regardless of content.
# Matched case-insensitively against the file stem (no suffix).
# LICENSE, COPYING, NOTICE, CODE_OF_CONDUCT are legal/boilerplate — they
# contain promise words ("shall", "must", "required") that inflate their score
# but carry no product intent.
_SKIP_STEM_PREFIXES = ("LICENSE", "COPYING", "NOTICE", "CODE_OF_CONDUCT")


def scan_intent_sources(
    repo: pathlib.Path,
    limit: int = 12,
    extra_skip_parts: set[str] | None = None,
) -> list[dict]:
    """Rank documents in the repo by how much approved-intent signal they
    carry: promise-word density plus filename hints. Proactive step one —
    the customer confirms, they don't have to hunt."""
    skip_parts = _SKIP_PARTS_GENERIC | (
        extra_skip_parts if extra_skip_parts is not None else _SKIP_PARTS_EXTRA_DEFAULT
    )
    candidates = []
    for path in repo.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in _DOC_SUFFIXES:
            continue
        rel = path.relative_to(repo)
        if any(part in skip_parts for part in rel.parts):
            continue
        if path.stem.upper().startswith(_SKIP_STEM_PREFIXES):
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
    provider: str = "git",
    repository: str | None = None,  # "owner/name" — the GitHub API key (slug 404s)
) -> pathlib.Path:
    # Refuse before writing anything — a refusal must not leave a
    # half-created workspace directory behind.
    incoming = [o["obligation_id"] for o in obligations]
    if len(set(incoming)) != len(incoming):
        dupes = sorted({i for i in incoming if incoming.count(i) > 1})
        raise ValueError(
            "duplicate draft obligation ids would collapse in the id map "
            f"and mis-house bindings: {', '.join(dupes)} — namespace draft "
            "ids per source document before approval"
        )

    out = workspaces_root / workflow_id
    out.mkdir(parents=True, exist_ok=True)
    (out / "issues").mkdir(exist_ok=True)
    issues_readme = out / "issues" / "README.md"
    if not issues_readme.exists():
        issues_readme.write_text(
            "# issues/\n\n"
            "Work-item YAML files (`<KEY>.yaml`) linking tickets to approved\n"
            "sources. PRs reference an issue by its key in their title/body;\n"
            "an empty directory is fine.\n"
        )

    # Draft ids never survive approval: mint stable, human-facing ids at the
    # moment the contract becomes approved. "OB-DRAFT-7" on a live ledger
    # means the approval step failed at its one job.
    prefix = "".join(c for c in workflow_id.upper() if c.isalnum())[:6] or "OB"
    id_map = {
        o["obligation_id"]: f"{prefix}-{i + 1:03d}"
        for i, o in enumerate(obligations)
    }
    obligations = [
        {**o, "obligation_id": id_map[o["obligation_id"]]} for o in obligations
    ]
    bindings = [
        {**b, "obligation_id": id_map.get(b["obligation_id"], b["obligation_id"])}
        for b in bindings
    ]

    rel_repo = _relative(out, repo)
    primary_ref = sources[0]["reference"] if sources else "intent-source"

    # The GitHub API keys off "owner/name"; the workflow slug (e.g.
    # "giladax-swiftrefunds") 404s on publish/fetch. Prefer the caller-supplied
    # owner/name; fall back to the slug only when none is given (local `git`
    # provider workspaces that never hit the GitHub API).
    repo_key = repository or workflow_id

    (out / "workflow.yaml").write_text(
        yaml.safe_dump(
            {
                "workflow_id": workflow_id,
                "requirements": {"provider": provider, "reference": primary_ref},
                "repositories": [
                    {"provider": provider, "repository": repo_key, "path": rel_repo}
                ],
                "eval_sources": [{"type": "repository", "paths": ["tests/**", "evals/**"]}],
            },
            sort_keys=False,
        )
    )

    # Materialize each approved source as requirements/<slug>.md — this is the
    # form the analyzer's adapter reads (FixtureWorkspace.requirement_artifacts
    # globs requirements/*.md and reads frontmatter status → Authority). Without
    # this file the context ladder finds no approved product-intent source and
    # every verdict abstains to UNKNOWN. `reference` in the frontmatter MUST
    # match the obligations' `source_reference` and the manifest reference so
    # the ladder can admit the artifact by reference.
    #
    # sources.yaml is retained as a human-facing manifest of what was approved;
    # requirements/*.md is the authoritative form the adapter reads.
    reqs_dir = out / "requirements"
    reqs_dir.mkdir(exist_ok=True)
    used_slugs: set[str] = set()
    for source in sources:
        reference = source["reference"]
        version = str(source.get("version", "onboard-1"))
        body = _read_source_content(repo, source.get("path", ""))
        slug = _requirement_slug(reference, used_slugs)
        used_slugs.add(slug)
        frontmatter = yaml.safe_dump(
            {"reference": reference, "version": version, "status": "approved"},
            sort_keys=False,
        )
        (reqs_dir / f"{slug}.md").write_text(f"---\n{frontmatter}---\n\n{body}")

    (out / "sources.yaml").write_text(
        "# Approved intent sources (human-facing manifest). The AUTHORITATIVE\n"
        "# form the analyzer reads is requirements/*.md — each source is\n"
        "# materialized there with `status: approved`. This file records what\n"
        "# was approved and where it came from in the repo checkout.\n"
        + yaml.safe_dump(
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
        "# Approved product promises (obligations). `revision` pins the exact\n"
        "# wording an analysis judged against — bump it whenever a statement\n"
        "# changes so history stays replayable.\n"
        + yaml.safe_dump({"obligations": obligations}, sort_keys=False, width=88)
    )
    (out / "bindings.yaml").write_text(
        "# Where each promise lives in code: control_points are the code\n"
        "# locations; bindings type the relation (decides/enforces/executes/\n"
        "# configures/observes/verifies) between a promise and a location.\n"
        + yaml.safe_dump(
            {"control_points": control_points, "bindings": bindings},
            sort_keys=False,
            width=88,
        )
    )
    prs = {
        i + 1: {"base": f"{c['sha']}^", "head": c["sha"], "title": c["subject"]}
        for i, c in enumerate(sweep_commits)
    }
    (out / "prs.yaml").write_text(
        "# Local commit ranges analyzed as PRs: number → {base, head, title}.\n"
        "# Add an entry and run `analyze <workspace> <number>` to check a commit.\n"
        + yaml.safe_dump(prs, sort_keys=False)
    )
    return out, id_map


def _relative(from_dir: pathlib.Path, to: pathlib.Path) -> str:
    import os

    return os.path.relpath(to.resolve(), from_dir.resolve())


def _read_source_content(repo: pathlib.Path, source_path: str) -> str:
    """Read an approved source's body from the repo checkout, confined to the
    repo (a crafted '../../etc/passwd' path must not escape into the workspace).
    A missing/unreadable source degrades to a placeholder note rather than
    failing the whole approve — the obligations still carry the verbatim
    provenance quotes, so the contract remains usable."""
    if not source_path:
        return "(no source path recorded)\n"
    repo_resolved = repo.resolve()
    doc = (repo / source_path).resolve()
    if not doc.is_relative_to(repo_resolved):
        return f"(source {source_path!r} is outside the repo — content omitted)\n"
    try:
        return doc.read_text()
    except (FileNotFoundError, UnicodeDecodeError, OSError):
        return f"(source {source_path!r} could not be read from the checkout)\n"


def _requirement_slug(reference: str, used: set[str]) -> str:
    """A filesystem-safe, unique stem for a requirements/*.md file, derived from
    the source reference. The frontmatter `reference` — not the filename —
    carries the authority join, so the slug only needs to be a stable,
    collision-free filename."""
    base = re.sub(r"[^A-Za-z0-9]+", "-", reference).strip("-").lower() or "source"
    slug = base
    n = 2
    while slug in used:
        slug = f"{base}-{n}"
        n += 1
    return slug
