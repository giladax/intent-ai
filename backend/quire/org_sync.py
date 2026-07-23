"""quire.org_sync — continuous PR review for governed repos (O2).

Every active GitHub-provider workspace in the org has its open PRs polled
and analyzed without human action.  The architecture is a PrEventSource seam:

    poll_events(repo, since) -> list[PrEvent]

The GitHub poller is the concrete source today; O6's webhook endpoint will
map GitHub payloads to the same PrEvent dataclass → the same handler, zero
rework at swap time.

## Rate-limit discipline

GitHub tokenless: 60 requests/hour.  Tokened: 5 000/hour.
Per sync pass (per repo):
  - 1 list_prs call (≤2 pages × 100 items = ≤200 PRs scanned)
  - 1 get_pr + several files/diff/tree calls per *newly seen* PR head SHA
    (idempotency cache skips repeats → each distinct head SHA costs ~3–5 calls)

`max_prs_per_pass` (default 5) caps how many new PRs are analyzed per pass;
a first-time sync of a 200-PR repo won't burn the budget.

## Publishing guard (HARD RULE)

Publishing GitHub comments is an externally visible action.  The rule:
  - Publishing defaults OFF for every workspace.
  - Only orgs owning the repo (github remote owner == "giladax") MAY publish.
  - Any other owner (psf, pallets, …) MUST NOT receive comments from this
    system — they are real upstream repos.
  - The workspace publish flag (`publish_enabled` in sync_meta.yaml) must
    ALSO be true before any comment is posted.

Even with both flags on, only LOUD verdicts are posted (PARTIAL, OFF_INTENT,
POSSIBLE_DRIFT, UNKNOWN) — same policy as the `--publish` CLI flag.

## Activity event (check:analyzed)

Every completed analysis emits one `check:analyzed` activity_events row:
  actor: "org-sync"
  category: "check:analyzed"
  summary: plain-language sentence e.g.
      "PR #7592 on psf/requests: Keeps its promises"
  metadata: {pr_number, head_sha, verdict, workspace, repository, publish_url}

Emission is failure-safe — a DB error never fails the analysis itself.

## Trailer links

Trailer link extraction mirrors first_results: base→head range over the
mirror, injected via an explicit LinkStore.  Shallow-history misses silently
no-op (debug log only).

## CLI

    python3 -m quire.cli org sync [--loop --interval 300]

One pass analyzes all active github-provider repos' new/updated PRs.
`--loop` polls on the given interval (default 300 s).
"""
from __future__ import annotations

import dataclasses
import logging
import os
import pathlib
import re
from typing import Any

import yaml

# Module-level imports of things that tests need to patch at 'quire.org_sync.*'.
# These are the real functions; when tests patch 'quire.org_sync.run_analysis'
# the patched name shadows the local binding used in handle_pr_event.
from quire.analysis.graph import run_analysis  # noqa: F401 — patched in tests
from quire.db.engine import get_session  # noqa: F401 — patched in tests
from quire.journal.emit_events import emit_activity_events  # noqa: F401 — patched in tests
from quire.adapters.github import GitHubWorkspace  # noqa: F401 — patched in tests

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# PrEvent — the seam dataclass
# ---------------------------------------------------------------------------

@dataclasses.dataclass(frozen=True)
class PrEvent:
    """A single PR event: new head SHA seen.

    Minimal but sufficient: enough for the handler to decide whether to
    analyze, publish, and extract trailers.  O6's webhook endpoint will
    construct PrEvent from GitHub payload fields — same names, same types.
    """
    pr_number: int
    head_sha: str
    base_sha: str
    title: str
    author: str
    state: str          # "open" | "closed"
    updated_at: str     # ISO-8601 string from GitHub


# ---------------------------------------------------------------------------
# PrEventSource — the abstract seam
# ---------------------------------------------------------------------------

class PrEventSource:
    """Abstract base: produce PrEvents for a repository.

    poll_events(repo, since) -> list[PrEvent]

    Concrete implementations:
      GitHubPollEventSource  — wraps list_prs (this file)
      WebhookEventSource     — O6, maps GitHub payloads to PrEvent
    """

    def poll_events(self, repo: str, since: str | None) -> list[PrEvent]:  # noqa: ARG002
        """Return PR events updated since `since` (ISO-8601, or None = all).

        Implementors MUST return each PR as a PrEvent for every distinct
        head_sha not yet seen.  The handler is idempotent (sha256 identity
        cache), so over-returning is safe; under-returning misses PRs.
        """
        raise NotImplementedError


# ---------------------------------------------------------------------------
# GitHubPollEventSource
# ---------------------------------------------------------------------------

class GitHubPollEventSource(PrEventSource):
    """Polls the GitHub REST API for new/updated PRs.

    Wraps GitHubWorkspace.list_prs().  The adapter is instantiated per-call
    (the workspace path is passed in) so token / session construction stays
    inside the adapter layer.

    Rate-limit: 1–2 list_prs pages (≤ 200 PRs) per call regardless of repo
    size.  `max_pages=2` is the default cap; callers may override.
    """

    def __init__(
        self,
        ws_path: pathlib.Path,
        repository: str,
        token: str | None = None,
        max_pages: int = 2,
    ) -> None:
        self._ws_path = ws_path
        self._repository = repository
        self._token = token or os.environ.get("GITHUB_TOKEN")
        self._max_pages = max_pages

    def poll_events(self, repo: str, since: str | None) -> list[PrEvent]:  # noqa: ARG002
        """List open PRs for the repository as PrEvents.

        `since` is advisory: GitHub REST sort is created/updated desc but
        the sort direction for `updated` requires an explicit parameter
        (sort=updated, direction=desc) which isn't in the current list_prs
        signature.  We fetch the first page(s) and rely on the idempotency
        cache to skip already-analyzed SHAs — cheap: analysis is skipped
        before the expensive GitHub PR-detail calls.

        The `repo` arg is kept for interface symmetry with the seam; the
        actual repository is already baked into the adapter.
        """
        adapter = GitHubWorkspace(
            str(self._ws_path),
            repository=self._repository,
            token=self._token,
        )
        raw = adapter.list_prs(state="open", max_pages=self._max_pages)

        events: list[PrEvent] = []
        for pr in raw:
            events.append(PrEvent(
                pr_number=pr["number"],
                head_sha=pr.get("head_sha", ""),
                base_sha=pr.get("base_sha", ""),
                title=pr.get("title", ""),
                author=pr.get("author", ""),
                state=pr.get("state", "open"),
                updated_at=pr.get("updated_at", pr.get("created_at", "")),
            ))
        return events


# ---------------------------------------------------------------------------
# Sync-state helpers (prs.yaml + sync_meta.yaml)
# ---------------------------------------------------------------------------

_SYNC_META_FILE = "sync_meta.yaml"


def _load_sync_meta(ws_path: pathlib.Path) -> dict[str, Any]:
    """Load sync metadata from workspace sync_meta.yaml (or empty dict)."""
    meta_file = ws_path / _SYNC_META_FILE
    try:
        raw = yaml.safe_load(meta_file.read_text()) or {}
        return raw if isinstance(raw, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception as exc:
        logger.warning("_load_sync_meta: could not read %s: %s", meta_file, exc)
        return {}


def _save_sync_meta(ws_path: pathlib.Path, meta: dict[str, Any]) -> None:
    """Write sync metadata to workspace sync_meta.yaml (failure-safe)."""
    meta_file = ws_path / _SYNC_META_FILE
    try:
        meta_file.write_text(yaml.safe_dump(meta, sort_keys=False))
    except Exception as exc:
        logger.warning("_save_sync_meta: could not write %s: %s", meta_file, exc)


def _load_seen_shas(ws_path: pathlib.Path) -> set[str]:
    """Return the set of head_sha values already analyzed in this workspace.

    Reads the `analyzed_head_shas` list from sync_meta.yaml (the analysis
    store's sha256 identity cache is the other idempotency layer; this local
    marker lets offline tests dedup without a DB).
    """
    meta = _load_sync_meta(ws_path)
    return set(meta.get("analyzed_head_shas", []))


def _mark_sha_seen(ws_path: pathlib.Path, head_sha: str) -> None:
    """Record a head_sha as analyzed in sync_meta.yaml."""
    meta = _load_sync_meta(ws_path)
    seen = set(meta.get("analyzed_head_shas", []))
    seen.add(head_sha)
    meta["analyzed_head_shas"] = sorted(seen)
    _save_sync_meta(ws_path, meta)


def _get_last_seen_updated_at(ws_path: pathlib.Path) -> str | None:
    """Return the last `updated_at` we successfully polled, for delta queries."""
    meta = _load_sync_meta(ws_path)
    return meta.get("last_seen_updated_at")


def _set_last_seen_updated_at(ws_path: pathlib.Path, ts: str) -> None:
    meta = _load_sync_meta(ws_path)
    meta["last_seen_updated_at"] = ts
    _save_sync_meta(ws_path, meta)


# ---------------------------------------------------------------------------
# Publishing guard
# ---------------------------------------------------------------------------

_GILADAX_RE = re.compile(r"github\.com/giladax/", re.IGNORECASE)


def _publishing_allowed(github_remote: str | None, ws_path: pathlib.Path) -> bool:
    """Return True only when BOTH conditions hold:

    1. The github_remote is owned by "giladax" (never publish to third-party
       repos like psf/requests or pallets/itsdangerous).
    2. The workspace's sync_meta.yaml has `publish_enabled: true`.

    Default: OFF.  The demo surfaces the org view — no live comments needed.
    """
    if not github_remote:
        return False
    if not _GILADAX_RE.search(github_remote):
        logger.debug("_publishing_allowed: non-giladax remote %s → OFF", github_remote)
        return False
    meta = _load_sync_meta(ws_path)
    return bool(meta.get("publish_enabled", False))


# ---------------------------------------------------------------------------
# check:analyzed activity event
# ---------------------------------------------------------------------------

def _emit_check_analyzed(
    *,
    pr_number: int,
    head_sha: str,
    verdict: str | None,
    workspace: str,
    repository: str,
    publish_url: str | None,
    repo: str | None,
    branch: str | None,
) -> None:
    """Emit a check:analyzed activity_events row (failure-safe).

    Never raises — a DB error must not break the analysis loop.

    `branch` is None by design for sync-originated events: org-sync polls at
    repository scope, and the PR's head branch is not carried by PrEvent (the
    GitHub list_prs payload holds it under head.ref, which the adapter does
    not surface today).  If branch attribution becomes useful for event
    filtering, extend PrEvent with a head_ref field and pass it through here.
    """
    from quire import vocab

    v = vocab.verdict(verdict)
    label = v["label"]
    summary = f"PR #{pr_number} on {repository}: {label}"

    event: dict[str, Any] = {
        "timestamp": None,          # emit_activity_events fills now()
        "category": "check:analyzed",
        "tags": [verdict or "unknown", v["severity"]],
        "actor": "org-sync",
        "summary": summary,
        "metadata": {
            "pr_number": pr_number,
            "head_sha": head_sha,
            "verdict": verdict,
            "verdict_label": label,
            "workspace": workspace,
            "repository": repository,
            "publish_url": publish_url,
        },
        "source_type": "check",
        "source_id": f"{workspace}:{pr_number}:{head_sha[:12]}",
        "session_id": None,
        "repo": repo or repository,
        "branch": branch,
        "worktree": None,
        "topic_ids": [],
        "files": [],
    }

    try:
        from datetime import datetime, timezone

        event["timestamp"] = datetime.now(tz=timezone.utc)
        with get_session() as db_session:
            emit_activity_events([event], db_session=db_session, is_pg=True)
            db_session.commit()
        logger.debug(
            "_emit_check_analyzed: PR #%d %s → %s emitted",
            pr_number, head_sha[:12], verdict,
        )
    except Exception as exc:
        logger.warning(
            "_emit_check_analyzed: emission failed (analysis unaffected): %s", exc
        )


# ---------------------------------------------------------------------------
# Single-event handler
# ---------------------------------------------------------------------------

def handle_pr_event(
    event: PrEvent,
    *,
    workspace: str,
    ws_path: pathlib.Path,
    owner: str,
    name: str,
    github_remote: str | None,
    alignment_store,
    link_store=None,
    task_store=None,
    token: str | None = None,
) -> dict[str, Any]:
    """Analyze one PrEvent and record the result.

    Idempotent: if the head_sha has already been analyzed (tracked in
    sync_meta.yaml OR by the analysis store's sha256 identity cache), the
    analysis call short-circuits and we return the cached result without
    re-publishing or re-emitting.

    Returns a dict: {pr_number, head_sha, verdict, skipped, publish_url, error}.
    """
    from quire.analysis.render import LOUD_CLASSIFICATIONS, MARKER
    from quire.org_onboard import mirror_path
    from quire import vocab

    mirror = mirror_path(owner, name)
    repository = f"{owner}/{name}"

    # A PR with no head sha can't be identified or de-duplicated. Skip it so an
    # empty "" never enters the analyzed-sha seen-set — otherwise every later
    # sha-less PR would look already-analyzed and be silently dropped.
    if not event.head_sha:
        return {"pr_number": event.pr_number, "head_sha": "",
                "verdict": None, "skipped": True, "error": "no head sha"}

    # -- Trailer link extraction (before analysis; failure-safe) ──────────
    if (
        link_store is not None
        and event.base_sha
        and event.head_sha
        and (mirror / ".git").exists()
    ):
        try:
            from quire.links import extract_trailer_links

            links = extract_trailer_links(
                base_sha=event.base_sha,
                head_sha=event.head_sha,
                git_dir=str(mirror),
                workspace=workspace,
                pr_number=event.pr_number,
            )
            link_store.upsert_many(links)
            logger.debug(
                "handle_pr_event: PR #%d → %d trailer link(s) extracted",
                event.pr_number, len(links),
            )
        except Exception as exc:
            logger.debug(
                "handle_pr_event: trailer extraction for PR #%d skipped: %s",
                event.pr_number, exc,
            )

    # -- Build adapter ────────────────────────────────────────────────────
    adapter = GitHubWorkspace(
        str(ws_path),
        repository=repository,
        token=token or os.environ.get("GITHUB_TOKEN"),
    )

    # -- Run analysis (idempotency via sha256 cache in run_analysis) ──────
    try:
        result = run_analysis(adapter, event.pr_number, store=alignment_store)
    except Exception as exc:
        logger.warning(
            "handle_pr_event: analysis failed for PR #%d on %s: %s",
            event.pr_number, repository, exc,
        )
        return {
            "pr_number": event.pr_number,
            "head_sha": event.head_sha,
            "verdict": None,
            "skipped": False,
            "publish_url": None,
            "error": str(exc),
        }

    verdict_value = result.classification.value if result else None
    skipped = getattr(result, "from_cache", False)

    # -- Publish comment (guarded) ────────────────────────────────────────
    publish_url: str | None = None
    if not skipped and _publishing_allowed(github_remote, ws_path):
        try:
            classification = result.classification
            if classification in LOUD_CLASSIFICATIONS:
                pr = adapter.get_pr(event.pr_number)
                publish_url = adapter.publish_comment(
                    pr, result.comment_markdown, MARKER
                )
                logger.info(
                    "handle_pr_event: published comment for PR #%d → %s",
                    event.pr_number, publish_url,
                )
        except Exception as exc:
            logger.warning(
                "handle_pr_event: publish failed for PR #%d: %s",
                event.pr_number, exc,
            )

    # -- Emit check:analyzed activity event (fresh analyses only) ─────────
    # A cache hit means the event for this head_sha was already emitted on
    # the pass that produced the analysis — re-emitting would duplicate it.
    if not skipped:
        _emit_check_analyzed(
            pr_number=event.pr_number,
            head_sha=event.head_sha,
            verdict=verdict_value,
            workspace=workspace,
            repository=repository,
            publish_url=publish_url,
            repo=f"{owner}/{name}",
            branch=None,
        )

    # -- Closure candidacy (O4.5): a fresh check's SATISFIES impacts feed
    # task closure — auto-close only when unambiguous, else Needs-you.
    # Failure-safe: the task layer must never fail the sync.
    if not skipped and task_store is not None and result is not None:
        try:
            from quire.handoff import record_closure_candidates

            closure = record_closure_candidates(workspace, result, task_store)
            if closure["closed"] or closure["candidates"]:
                logger.info(
                    "handle_pr_event: PR #%d closure — %d closed on evidence, "
                    "%d candidate(s) to Needs-you",
                    event.pr_number, closure["closed"], closure["candidates"],
                )
        except Exception as exc:
            logger.warning(
                "handle_pr_event: closure candidacy skipped for PR #%d: %s",
                event.pr_number, exc,
            )

    # -- Record the sha as seen ───────────────────────────────────────────
    if not skipped:
        _mark_sha_seen(ws_path, event.head_sha)

    return {
        "pr_number": event.pr_number,
        "head_sha": event.head_sha,
        "verdict": verdict_value,
        "skipped": skipped,
        "publish_url": publish_url,
        "error": None,
    }


# ---------------------------------------------------------------------------
# prs.yaml update
# ---------------------------------------------------------------------------

def _update_prs_yaml_from_events(ws_path: pathlib.Path, events: list[PrEvent]) -> None:
    """Merge polled PrEvents into prs.yaml (non-destructive).

    Same merge semantics as org_onboard._update_prs_yaml: new PR numbers are
    added; existing entries are never overwritten so human edits survive.
    """
    prs_file = ws_path / "prs.yaml"
    try:
        existing = yaml.safe_load(prs_file.read_text()) or {}
    except FileNotFoundError:
        existing = {}

    changed = False
    for ev in events:
        n = ev.pr_number
        if n not in existing:
            existing[n] = {
                "base": ev.base_sha,
                "head": ev.head_sha,
                "title": ev.title,
                "state": ev.state,
                "author": ev.author,
                "updated_at": ev.updated_at,
            }
            changed = True
        else:
            # Update head SHA if the PR advanced (new commit pushed).
            entry = existing[n]
            if isinstance(entry, dict) and entry.get("head") != ev.head_sha:
                entry["head"] = ev.head_sha
                entry["updated_at"] = ev.updated_at
                entry["state"] = ev.state
                changed = True

    if changed:
        try:
            prs_file.write_text(
                "# PRs: sweep-commit range (int keys) + GitHub PRs (int keys = PR number).\n"
                + yaml.safe_dump(existing, sort_keys=False)
            )
        except Exception as exc:
            logger.warning("_update_prs_yaml_from_events: write failed: %s", exc)


# ---------------------------------------------------------------------------
# sync_org — the top-level pass
# ---------------------------------------------------------------------------

def sync_org(
    org_store,
    alignment_store,
    *,
    workspaces_root: pathlib.Path | None = None,
    max_prs_per_repo: int = 5,
    link_store=None,
    task_store=None,
    token: str | None = None,
) -> list[dict[str, Any]]:
    """One sync pass: analyze new/updated PRs across all active GitHub repos.

    Iterates org_repos with status="active" and a non-null github_remote.
    For each:
      1. Build a GitHubPollEventSource and poll open PRs.
      2. Filter to head_shas not yet in the seen set (sync_meta.yaml).
      3. Analyze up to `max_prs_per_repo` new ones.
      4. Update prs.yaml + sync_meta.yaml.

    `max_prs_per_repo` caps per-pass budget: a first sync of a 200-PR repo
    won't burn the token budget — only new PRs since last pass are analyzed,
    and even then, at most `max_prs_per_repo` per pass.  Subsequent passes
    pick up the rest as they fall into the "new" window.

    Returns a list of per-repo result dicts with:
        {workspace, repository, events_polled, analyzed, results}
    """
    if workspaces_root is None:
        workspaces_root = pathlib.Path(__file__).parent.parent / "workspaces"

    token = token or os.environ.get("GITHUB_TOKEN")

    # Resolve link store failure-safely (same pattern as first_results):
    # trailer extraction is best-effort; a missing/unreachable Postgres never
    # blocks the sync pass. Tests always inject an explicit store (conftest
    # guard: engine-less LinkStore raises during tests).
    if link_store is None:
        try:
            from quire.links import LinkStore
            link_store = LinkStore()
        except Exception as exc:
            logger.warning("sync_org: could not construct LinkStore: %s", exc)
            link_store = None

    # Task store for closure candidacy (O4.5) — same failure-safe pattern.
    if task_store is None:
        try:
            from quire.handoff import TaskStore
            task_store = TaskStore()
        except Exception as exc:
            logger.warning("sync_org: could not construct TaskStore: %s", exc)
            task_store = None

    repos = org_store.list_repos()
    all_results: list[dict[str, Any]] = []

    for repo in repos:
        if repo.get("status") != "active":
            continue
        github_remote = repo.get("github_remote")
        if not github_remote:
            continue
        workspace = repo.get("workspace")
        if not workspace:
            continue  # a malformed row must not abort the whole sync pass
        ws_path = workspaces_root / workspace

        if not ws_path.is_dir():
            logger.debug("sync_org: workspace %s not found on disk — skip", workspace)
            continue

        # Extract owner/name from github_remote
        try:
            from quire.org_onboard import parse_github_url
            owner, name = parse_github_url(github_remote)
        except ValueError as exc:
            logger.warning("sync_org: bad github_remote %s: %s", github_remote, exc)
            continue

        repository = f"{owner}/{name}"
        logger.info("sync_org: polling %s (workspace: %s)", repository, workspace)

        # -- Poll events ──────────────────────────────────────────────────
        source = GitHubPollEventSource(
            ws_path=ws_path,
            repository=repository,
            token=token,
            max_pages=2,
        )
        since = _get_last_seen_updated_at(ws_path)
        try:
            events = source.poll_events(repository, since)
        except Exception as exc:
            logger.warning("sync_org: poll failed for %s: %s", repository, exc)
            all_results.append({
                "workspace": workspace,
                "repository": repository,
                "events_polled": 0,
                "analyzed": 0,
                "results": [],
                "error": str(exc),
            })
            continue

        # -- Update prs.yaml ──────────────────────────────────────────────
        _update_prs_yaml_from_events(ws_path, events)

        # -- Filter to unseen head_shas ───────────────────────────────────
        seen_shas = _load_seen_shas(ws_path)
        new_events = [ev for ev in events if ev.head_sha not in seen_shas]

        logger.info(
            "sync_org: %s → %d PRs polled, %d new/updated",
            repository, len(events), len(new_events),
        )

        # -- Analyze (capped) ─────────────────────────────────────────────
        to_analyze = new_events[:max_prs_per_repo]
        results: list[dict[str, Any]] = []
        for ev in to_analyze:
            r = handle_pr_event(
                ev,
                workspace=workspace,
                ws_path=ws_path,
                owner=owner,
                name=name,
                github_remote=github_remote,
                alignment_store=alignment_store,
                link_store=link_store,
                task_store=task_store,
                token=token,
            )
            results.append(r)
            logger.info(
                "sync_org: PR #%d %s → verdict=%s skipped=%s",
                r["pr_number"], repository,
                r.get("verdict"), r.get("skipped"),
            )

        # -- Update last_seen_updated_at ──────────────────────────────────
        if events:
            latest_ts = max(
                (ev.updated_at for ev in events if ev.updated_at), default=""
            )
            if latest_ts:
                _set_last_seen_updated_at(ws_path, latest_ts)

        all_results.append({
            "workspace": workspace,
            "repository": repository,
            "events_polled": len(events),
            "analyzed": len([r for r in results if not r.get("skipped")]),
            "results": results,
            "error": None,
        })

    return all_results
