"""quire.org_onboard — URL → governed repo (O1 hero flow).

The four-act onboarding wizard applied to a GitHub URL:

1. REGISTER   — parse URL → owner/name, shallow-clone into backend/.repos/,
                write org_repos row (status="scanning"), resolve repository key.
2. SCAN       — run onboard.scan_intent_sources over the mirror, surface
                top candidates + recent commits.
3. DRAFT      — mine approved intent docs into candidate obligations via
                propose_contract (live LLM inference; authorized for O1).
4. APPROVE    — human reviews draft cards via the approve endpoint; this act
                is explicitly human: the flow PAUSES at draft-ready.
5. FIRST RESULTS — write the approved workspace (onboard.write_workspace),
                pull recent PRs via list_prs, replay last few through the
                analyzer so value is visible in the same sitting.

Failure-safety: no half-registered org_repos row on any failure — the
registration step writes a "scanning" row, and any subsequent failure during
scan/draft removes it (cleanup-on-fail). The approve step is atomic: if
workspace writing fails, no row update occurs.

Mirror cache:
    backend/.repos/<owner>__<name>/   — shallow clone (depth=10; deep enough
    to catch recent history for commits/trailers but cheap to clone; refresh
    via git fetch --depth=10 on subsequent calls).

    Depth 10 is intentional: onboarding scans docs (present on disk), drafts
    from HEAD, and replays recent PRs. A full clone is wasteful; depth 1 would
    miss the few recent commits the analyzer needs for context.

URL parsing accepts common GitHub URL shapes — structural regex (sanctioned):
    https://github.com/owner/name
    https://github.com/owner/name.git
    github.com/owner/name
    owner/name   (bare slug — assumed GitHub)

Single-writer invariant: OrgStore is the sole writer for org_repos.
Postgres conftest guard (conftest._no_implicit_production_org_store) applies.
"""
from __future__ import annotations

import logging
import pathlib
import re
import subprocess
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

# The mirror cache lives beside the backend/ directory (one level up from
# quire/), so it's always backend/.repos/<owner>__<name>/.
_BACKEND_DIR = pathlib.Path(__file__).parent.parent  # backend/
_MIRROR_ROOT = _BACKEND_DIR / ".repos"

# ---------------------------------------------------------------------------
# URL parsing — structural regex (sanctioned: URL structure is structural,
# not semantic).
# ---------------------------------------------------------------------------

_GITHUB_URL_RE = re.compile(
    r"(?:https?://)?github\.com/([A-Za-z0-9_.\-]+)/([A-Za-z0-9_.\-]+?)(?:\.git)?/?$"
)
_BARE_SLUG_RE = re.compile(
    r"^([A-Za-z0-9_.\-]+)/([A-Za-z0-9_.\-]+)$"
)


def parse_github_url(url: str) -> tuple[str, str]:
    """Parse a GitHub URL (or bare owner/name slug) into (owner, name).

    Raises ValueError for unrecognised shapes.
    """
    url = url.strip()
    m = _GITHUB_URL_RE.match(url) or _BARE_SLUG_RE.match(url)
    if m is None:
        raise ValueError(
            f"Cannot parse GitHub repository URL: {url!r}. "
            "Expected https://github.com/owner/name, github.com/owner/name, "
            "or a bare owner/name slug."
        )
    owner, name = m.group(1), m.group(2)
    return owner, name


def mirror_path(owner: str, name: str) -> pathlib.Path:
    """Return the local mirror path for a repo (may not exist yet)."""
    return _MIRROR_ROOT / f"{owner}__{name}"


# ---------------------------------------------------------------------------
# Mirror management
# ---------------------------------------------------------------------------

def ensure_mirror(owner: str, name: str, token: str | None = None) -> pathlib.Path:
    """Clone or refresh the shallow mirror for owner/name.

    Uses GITHUB_TOKEN from env if token is not supplied. Public repos work
    without a token; this function passes it as a credential in the URL for
    private-repo support (deferred to O6, but the mechanism is here).

    Returns the local mirror path.
    """
    _MIRROR_ROOT.mkdir(parents=True, exist_ok=True)
    dest = mirror_path(owner, name)
    remote = _remote_url(owner, name, token)

    if (dest / ".git").exists():
        logger.info("mirror refresh: git fetch %s/%s (depth=10)", owner, name)
        result = subprocess.run(
            ["git", "-C", str(dest), "fetch", "--depth=10", "--quiet", "origin"],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            logger.warning(
                "mirror refresh failed for %s/%s: %s",
                owner, name, _scrub(result.stderr.strip(), token),
            )
    else:
        logger.info("mirror clone: %s/%s → %s (depth=10)", owner, name, dest)
        result = subprocess.run(
            [
                "git", "clone",
                "--depth=10",
                "--quiet",
                remote,
                str(dest),
            ],
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode != 0:
            # Log the real reason server-side (token scrubbed); raise a plain
            # message so a tokened remote URL in stderr never reaches the client.
            logger.warning(
                "git clone failed for %s/%s: %s",
                owner, name, _scrub(result.stderr.strip(), token),
            )
            raise RuntimeError(
                f"could not download {owner}/{name} — check the URL and that the repo is reachable"
            )

    return dest


def _scrub(text: str, token: str | None) -> str:
    """Redact an auth token if it leaked into git output (e.g. a tokened URL)."""
    return text.replace(token, "***") if token else text


def _remote_url(owner: str, name: str, token: str | None) -> str:
    """Build the clone URL, embedding the token for auth when provided."""
    if token:
        return f"https://{token}@github.com/{owner}/{name}.git"
    return f"https://github.com/{owner}/{name}.git"


# ---------------------------------------------------------------------------
# Registration act (step 1)
# ---------------------------------------------------------------------------

def register_repo(
    url: str,
    org_store,
    org_id: str = "quire",
    token: str | None = None,
) -> dict[str, Any]:
    """Parse URL, clone mirror, write org_repos row with status="scanning".

    On any failure AFTER the row is written, the row is deleted (cleanup-on-
    fail) so no half-registered row persists. On clone failure (before the
    row is written), nothing is written.

    Returns a dict with: owner, name, workspace, mirror_path, status.
    """
    import os
    token = token or os.environ.get("GITHUB_TOKEN")

    owner, name = parse_github_url(url)
    workspace = f"{owner}-{name}"
    # Stable id — same as workspace for GitHub repos
    repo_id = workspace
    github_remote = f"https://github.com/{owner}/{name}"

    # Clone/refresh mirror FIRST — if it fails, nothing is written to Postgres.
    mirror = ensure_mirror(owner, name, token)

    # Write org_repos row with status="scanning".
    org_store.add_repo(
        org_id=org_id,
        repo_id=repo_id,
        workspace=workspace,
        display_name=f"{owner}/{name}",
        github_remote=github_remote,
        status="scanning",
        repository=f"{owner}/{name}",  # alignment store key = "owner/name"
    )

    return {
        "owner": owner,
        "name": name,
        "workspace": workspace,
        "repo_id": repo_id,
        "mirror_path": str(mirror),
        "status": "scanning",
    }


# ---------------------------------------------------------------------------
# Scan act (step 2)
# ---------------------------------------------------------------------------

def scan_repo(
    mirror: pathlib.Path,
    extra_skip_parts: set[str] | None = None,
    n_commits: int = 10,
) -> dict[str, Any]:
    """Run the onboard scanner over a local mirror.

    Returns: {sources, commits} — surfaces for the wizard UI.
    """
    from quire.onboard import recent_commits, scan_intent_sources

    sources = scan_intent_sources(mirror, extra_skip_parts=extra_skip_parts)
    commits = recent_commits(mirror, n=n_commits)
    return {"sources": sources, "commits": commits}


# ---------------------------------------------------------------------------
# Draft act (step 3) — live LLM inference authorized for O1
# ---------------------------------------------------------------------------

def draft_repo(
    mirror: pathlib.Path,
    workspace: str,
    sources: list[dict],
    llm=None,
) -> dict[str, Any]:
    """Mine the top sources into candidate obligations (live LLM inference).

    sources: list of source dicts from scan_repo (path, score, …).
    Up to 3 sources are drafted (the top-scored ones that exist on disk).

    Returns: {workspace, draft_dir, obligations, bindings, notes}
    """
    import tempfile

    from quire.propose import propose_contract

    # Draft output goes into a temp-stable directory under the mirror:
    # backend/.repos/<owner__name>/.draft/
    draft_dir = mirror / ".draft" / workspace
    draft_dir.mkdir(parents=True, exist_ok=True)

    all_obligations: list[dict] = []
    all_bindings: list[dict] = []
    all_notes: list[str] = []

    # Draft from the top 3 sources (bounded token spend).
    mirror_resolved = mirror.resolve()
    for source in sources[:3]:
        # `path` comes from the request body — confine it to the mirror so a
        # crafted "../../../etc/passwd" can't be read and fed to the LLM.
        doc_path = (mirror / source["path"]).resolve()
        if not doc_path.is_relative_to(mirror_resolved):
            all_notes.append(f"source {source['path']!r} is outside the repo — skipped")
            continue
        if not doc_path.is_file():
            all_notes.append(f"source {source['path']!r} not found — skipped")
            continue
        reference = source.get("reference") or source["path"]
        try:
            obs, bindings, notes = propose_contract(
                doc_path=doc_path,
                repo=mirror,
                out_dir=draft_dir,
                source_reference=reference,
                llm=llm,
            )
            # Each source's proposer mints ids from OB-001 — renumber across
            # sources so the merged draft has unique ids (write_workspace
            # refuses duplicates at approve time). Bindings follow their
            # source's remap.
            id_remap = {
                o.obligation_id: f"OB-{len(all_obligations) + i + 1:03d}"
                for i, o in enumerate(obs)
            }
            # Convert pydantic models to plain dicts for JSON serialization.
            all_obligations.extend(
                {
                    "obligation_id": id_remap[o.obligation_id],
                    "kind": o.kind,
                    "statement": o.statement,
                    "source_quote": o.source_quote,
                    "source_section": o.source_section,
                    "source_reference": reference,
                    "revision": "draft-1",
                    "provenance_quote": o.source_quote,
                }
                for o in obs
            )
            all_bindings.extend(
                {
                    "obligation_id": id_remap.get(b.obligation_id, b.obligation_id),
                    "path": b.path,
                    "symbol": b.symbol,
                    "role": b.role,
                    "relation": b.relation,
                    "why": b.why,
                }
                for b in bindings
            )
            all_notes.extend(notes)
        except Exception as exc:
            msg = f"draft failed for {source['path']!r}: {exc}"
            logger.warning(msg)
            all_notes.append(msg)

    return {
        "workspace": workspace,
        "draft_dir": str(draft_dir),
        "obligations": all_obligations,
        "bindings": all_bindings,
        "notes": all_notes,
    }


# ---------------------------------------------------------------------------
# Approve act (step 4) — human-gated; apply decisions passed to this fn
# ---------------------------------------------------------------------------

def approve_repo(
    workspace: str,
    owner: str,
    name: str,
    org_store,
    workspaces_root: pathlib.Path,
    sources: list[dict],
    obligations: list[dict],
    bindings: list[dict],
    sweep_commits: list[dict],
) -> dict[str, Any]:
    """Write the approved workspace and mark the org_repos row active.

    The obligations/bindings passed here are the HUMAN-APPROVED cards
    (the human may have edited/rejected/reordered them at the Approve step;
    the caller is responsible for passing exactly what the human approved).

    Failure-safety: if write_workspace raises, the org_repos row is NOT
    updated (we leave it as "scanning" so the operator knows it failed).

    Returns: {workspace_path, id_map, status}.
    """
    from quire.onboard import write_workspace

    # The wizard passes /scan-shaped sources ({path, score, …}) straight
    # through; write_workspace requires a "reference" — default it to the
    # path so the two endpoint contracts compose.
    sources = [
        {**s, "reference": s.get("reference") or s.get("path") or "intent-source"}
        for s in sources
    ]

    mirror = mirror_path(owner, name)
    ws_path, id_map = write_workspace(
        workspaces_root=workspaces_root,
        workflow_id=workspace,
        repo=mirror,
        sources=sources,
        obligations=obligations,
        control_points=_extract_control_points(bindings),
        bindings=_normalize_bindings(bindings),
        sweep_commits=sweep_commits,
        provider="github",
        repository=f"{owner}/{name}",  # GitHub API key; the slug 404s
    )

    # Only update the row after the workspace is successfully written.
    org_store.update_repo_status(workspace, "active")

    return {
        "workspace": workspace,
        "workspace_path": str(ws_path),
        "id_map": id_map,
        "status": "active",
    }


def _extract_control_points(bindings: list[dict]) -> list[dict]:
    """Extract unique control points from bindings (deduplicated by path)."""
    from quire.propose import mint_control_point_id

    seen: dict[str, dict] = {}
    for b in bindings:
        path = b.get("path", "")
        cp_id = mint_control_point_id(path)
        if cp_id not in seen:
            seen[cp_id] = {
                "control_point_id": cp_id,
                "role": b.get("role", "executor"),
                "path": path,
                **({"symbol": b["symbol"]} if b.get("symbol") else {}),
                "description": b.get("why", ""),
            }
    return list(seen.values())


def _normalize_bindings(bindings: list[dict]) -> list[dict]:
    """Convert raw binding dicts to the format write_workspace expects."""
    from quire.propose import mint_control_point_id

    return [
        {
            "obligation_id": b["obligation_id"],
            "control_point_id": mint_control_point_id(b.get("path", "")),
            "relation": b.get("relation", "enforces"),
        }
        for b in bindings
    ]


# ---------------------------------------------------------------------------
# First results act (step 5) — PR listing + replay
# ---------------------------------------------------------------------------

def first_results(
    workspace: str,
    owner: str,
    name: str,
    workspaces_root: pathlib.Path,
    alignment_store,
    n_prs: int = 3,
    token: str | None = None,
    link_store=None,
) -> dict[str, Any]:
    """Pull recent PRs and replay through the analyzer for first verdicts.

    list_prs is used (added to the adapter in O1) to fetch recent PRs.
    The last n_prs are run through the analyzer (live inference).
    Results are written to the alignment store (the normal code-review path).

    Trailer links are extracted over each PR's base→head range from the mirror
    and upserted via LinkStore (explicit store injection per U0 discipline).
    Shallow-history misses are a no-op (debug note only, never raised).

    prs.yaml in the workspace is updated with GitHub PR metadata.

    Returns: {prs_fetched, replayed, verdicts}
    """
    import os

    import yaml

    from quire.adapters.github import GitHubWorkspace

    token = token or os.environ.get("GITHUB_TOKEN")
    ws_path = workspaces_root / workspace
    mirror = mirror_path(owner, name)

    # Resolve link store (explicit injection per U0 discipline; production
    # path constructs the real store failure-safely, like digest_session does).
    _link_store = link_store
    if _link_store is None:
        try:
            from quire.links import LinkStore
            _link_store = LinkStore()
        except Exception as exc:
            logger.warning("first_results: could not construct LinkStore: %s", exc)
            _link_store = None

    # Build a GitHub adapter pointed at the newly-written workspace.
    adapter = GitHubWorkspace(
        ws_path,
        repository=f"{owner}/{name}",
        token=token,
    )

    # List recent PRs.
    prs = adapter.list_prs(state="all", max_pages=2)
    logger.info("first_results: %d PRs found for %s/%s", len(prs), owner, name)

    # Write/update prs.yaml with GitHub PR entries.
    _update_prs_yaml(ws_path, prs)

    # Replay the last n_prs through the analyzer.
    verdicts = []
    for pr_info in prs[:n_prs]:
        pr_number = pr_info["number"]
        base_sha = pr_info.get("base_sha", "")
        head_sha = pr_info.get("head_sha", "")

        # Extract trailer links from the mirror for this PR range.
        if _link_store is not None and base_sha and head_sha and (mirror / ".git").exists():
            try:
                from quire.links import extract_trailer_links
                links = extract_trailer_links(
                    base_sha=base_sha,
                    head_sha=head_sha,
                    git_dir=str(mirror),
                    workspace=workspace,
                    pr_number=pr_number,
                )
                _link_store.upsert_many(links)
                logger.debug(
                    "first_results: PR #%d → %d trailer link(s) extracted",
                    pr_number, len(links),
                )
            except Exception as exc:
                # Shallow-history miss (base_sha not in mirror depth) or any
                # other git error → no-op. Never fail the replay.
                logger.debug(
                    "first_results: trailer extraction for PR #%d skipped: %s",
                    pr_number, exc,
                )

        try:
            from quire.analysis.graph import run_analysis

            result = run_analysis(adapter, pr_number, store=alignment_store)
            verdicts.append({
                "pr_number": pr_number,
                "title": pr_info["title"],
                "verdict": result.classification.value if result else None,
                "analysis_id": getattr(result, "analysis_id", None),
            })
            logger.info(
                "first_results: PR #%d → %s",
                pr_number,
                result.classification.value if result else "unknown",
            )
        except Exception as exc:
            logger.warning("first_results: PR #%d replay failed: %s", pr_number, exc)
            verdicts.append({
                "pr_number": pr_number,
                "title": pr_info["title"],
                "verdict": None,
                "error": str(exc),
            })

    return {
        "prs_fetched": len(prs),
        "replayed": len(verdicts),
        "verdicts": verdicts,
    }


def _update_prs_yaml(ws_path: pathlib.Path, prs: list[dict]) -> None:
    """Merge the GitHub PR list into prs.yaml, keyed by the real PR number.

    For a new workspace (written by approve_repo) prs.yaml already exists with
    the sweep-commit range; we ADD GitHub PR entries. Existing keys are never
    overwritten — so if a sweep-commit pseudo-entry ever shared an int key with
    a real PR number, the real PR would be dropped. Fresh workspaces don't hit
    that today; namespace the keys if sweep and PR ranges can ever overlap.
    """
    import yaml

    prs_file = ws_path / "prs.yaml"
    try:
        existing = yaml.safe_load(prs_file.read_text()) or {}
    except FileNotFoundError:
        existing = {}

    for pr in prs:
        n = pr["number"]
        if n not in existing:
            existing[n] = {
                "base": pr["base_sha"],
                "head": pr["head_sha"],
                "title": pr["title"],
                "state": pr["state"],
                "html_url": pr["html_url"],
                "author": pr["author"],
                "created_at": pr["created_at"],
            }

    prs_file.write_text(
        "# PRs: sweep-commit range (int keys) + GitHub PRs (int keys = PR number).\n"
        + yaml.safe_dump(existing, sort_keys=False)
    )


# ---------------------------------------------------------------------------
# Cleanup helper — used by registration rollback
# ---------------------------------------------------------------------------

def cleanup_failed_registration(workspace: str, org_store) -> None:
    """Remove an org_repos row after a failed registration attempt.

    Called when any step after add_repo() fails. Logged, never re-raised —
    a cleanup failure should not mask the original error.
    """
    try:
        org_store.remove_repo(workspace)
        logger.info("cleanup: removed org_repos row for %s after failed registration", workspace)
    except Exception as exc:
        logger.error(
            "cleanup: could not remove org_repos row for %s: %s",
            workspace, exc,
        )
