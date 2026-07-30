"""Python polling watcher — periodically scans ~/.claude/projects for new CC
sessions (a plain poll loop; no watchdog/Observer library, so nothing to reap).

Replaces journal/src/daemon/index.ts (TS daemon demoted in Slice 6).

Quiescence heuristic (mirrors TS EventQueue quietMs pattern):
    A session file is ready to digest when its mtime has not changed
    for QUIET_SECONDS (default 120 s). This matches the spirit of the TS
    daemon's quietMs=3000 ms (their batch flush) but is calibrated for
    full-session digest rather than live streaming.

Resumed-session handling (stateless, DB-backed):
    A session may go quiet mid-way through (e.g. the user pauses for >120 s),
    get digested, then resume. The DB idempotency guard (source_hash match →
    stored=False) would normally skip it on the next quiet window, meaning the
    resumed tail is never captured.

    Fix: after the quiet window elapses and the session is already in the DB,
    compare the file's current mtime against the stored session's created_at.
    If mtime > created_at the file grew after we digested it — re-digest with
    force=True, allow_llm_purge=True (the sanctioned use: replacing an
    incomplete digest with the complete one). This is logged clearly so the
    operator can confirm the re-digest.

    Residual edge cases (documented honestly):
    - Clock skew: if the watcher host and DB host clocks differ by more than
      QUIET_SECONDS the comparison may produce a false positive or false negative.
      Mitigation: both clocks are usually the same machine in dev/CI.
    - Sub-second mtime resolution: if a resumed session writes within the same
      mtime second as the prior digest's created_at, the comparison may miss it.
      This is a one-second window; in practice CC sessions resume with many new
      writes spanning multiple seconds.
    - Mid-digest resume window: created_at is stamped when the DB write
      COMPLETES (after the multi-minute LLM understanding run), but the digest's
      content reflects the file as it was at parse START. A session that resumes
      AND re-quiets entirely within that parse-to-write window reads
      mtime < created_at and its tail is permanently lost — the check self-heals
      only if any later activity touches the file again. Future fix: stamp a
      parse-time digested_at (capture mtime/now at parse start and persist that
      instead of relying on the row's created_at).

Design:
    - No hook server, no NDJSON sink, no prompt suggester (TS internals
      that do NOT need porting — the quiescence-and-digest flow is the
      only piece needed here).
    - Stateless between restarts: all state is in Postgres (sessions.created_at
      and sessions.source_hash). No in-memory bookkeeping that could be lost.
    - Idempotent for truly-done sessions: if mtime <= created_at the session
      did not grow after digest; skip it silently.
    - Git context: resolves from the *log file path* (always ~/.claude/projects/
      ...) which is NOT inside the git repo — returns all-None. This is correct
      and matches TS behaviour. The activity_events will have null repo/branch
      until a richer signal is available (e.g. we could read the CC session
      metadata for projectDir in a future slice).
    - Failure-safe: a digest failure for one file is logged and skipped;
      the watcher continues watching other files.

Entry point:
    python3 -m quire.cli journal watch-sessions
"""
from __future__ import annotations

import logging
import os
import pathlib
import sys
import time
from typing import Callable

log = logging.getLogger(__name__)

CLAUDE_PROJECTS_DIR = pathlib.Path.home() / ".claude" / "projects"
QUIET_SECONDS = 120          # file must be quiet for 2 min before digest
SCAN_INTERVAL_SECONDS = 30   # how often to scan for eligible files


# ── Pure helpers (testable without the DB) ──────────────────────────────────

def is_session_quiet(mtime: float, *, quiet_seconds: float, now: float) -> bool:
    """Return True iff the file has been quiet for more than quiet_seconds.

    Strictly greater than (not >=) so the boundary is NOT eligible.
    """
    return (now - mtime) > quiet_seconds


def discover_jsonl_files(projects_dir: pathlib.Path) -> list[pathlib.Path]:
    """Return all .jsonl files that are top-level within project subdirs.

    Structure:
        projects_dir/
            <project-slug>/       ← project dir
                <session>.jsonl   ← COLLECT
                <subagent-dir>/   ← skip (nested)
                    sub.jsonl     ← DO NOT COLLECT

    Also collects .jsonl files directly in projects_dir (unlikely but safe).
    """
    found: list[pathlib.Path] = []
    try:
        for entry in projects_dir.iterdir():
            if entry.is_file() and entry.suffix == ".jsonl":
                found.append(entry)
            elif entry.is_dir():
                # Top-level within the project dir only (no recursion)
                for sub in entry.iterdir():
                    if sub.is_file() and sub.suffix == ".jsonl":
                        found.append(sub)
    except OSError as err:
        log.warning("Could not scan %s: %s", projects_dir, err)
    return found


# ── DB helpers (lazy-import so tests can import this module without DB) ───────

def _get_session_created_at(source_hash: str) -> float | None:
    """Return the stored session's created_at as a POSIX timestamp, or None.

    Queries Postgres for the session with this source_hash. Returns None if:
    - the session is not yet in the DB (never digested)
    - the DB is not reachable (import or connection failure — treated as unknown)
    """
    try:
        from sqlalchemy import text as _text
        from quire.db.engine import get_session as _get_db_session

        with _get_db_session() as db:
            row = db.execute(
                _text(
                    "SELECT created_at FROM sessions "
                    "WHERE source_hash = :h LIMIT 1"
                ),
                {"h": source_hash},
            ).first()
            if row is None:
                return None
            # created_at is a timezone-aware datetime from Postgres
            created_at_dt = row[0]
            return created_at_dt.timestamp()
    except Exception as err:
        log.warning("[watcher] Could not query digested_at for %s: %s", source_hash[:8], err)
        return None


# ── Digest trigger ───────────────────────────────────────────────────────────

def _digest_one(log_path: pathlib.Path, force: bool = False) -> bool:
    """Digest a single session file. Returns True if stored, False if skipped.

    `force` is positional-or-keyword on purpose: _scan_once invokes the
    _digest_fn seam positionally (`self._digest_fn(cand, force)`), matching
    the Callable[[pathlib.Path, bool], bool] hint. Do NOT make it keyword-only
    — the resulting TypeError would be swallowed by _scan_once's retry guard
    and the watcher would silently digest nothing (guarded by
    test_scan_once_invokes_real_digest_one_seam).

    When force=True the existing digest is replaced (used for resumed sessions
    where the file grew after the initial digest). Pass allow_llm_purge=True
    implicitly when force=True — the watcher's usage of force is always the
    sanctioned "replace incomplete digest with complete one" case.

    Imports lazily so the watcher module can be imported in tests without
    triggering full pipeline imports.
    """
    import pathlib as _pathlib
    from datetime import datetime, timezone

    from quire.ingest import (
        chunk_session,
        detect_sittings,
        normalize,
        parse_transcript,
    )
    from quire.ingest.sittings import _parse_ts
    from quire.understand import (
        AnthropicUnderstandLLM,
        analyze_interactions_live,
        classify_session,
        detect_topic_shifts,
        understand,
    )
    from quire.db.writer import LlmPurgeRefused, store_session_digest
    from quire.journal.archive import archive_raw_session
    from quire.journal.emit_events import build_session_events, emit_activity_events
    from quire.journal.git_context import get_git_context
    from quire.db.engine import get_session as db_get_session

    path = _pathlib.Path(log_path)
    source_hash = path.stem

    # Archive the raw log unconditionally — including on the re-digest path,
    # so a resumed session's grown log keeps refreshing the archive (mirrors
    # orchestrator.ts::runPipeline step 0). Failure-safe: never fails the digest.
    archived = archive_raw_session(
        path,
        warn=lambda msg: log.warning(
            "[watcher] raw-session archive failed (digest unaffected): %s", msg
        ),
    )
    if archived is not None:
        log.info("[watcher] Archived raw session → %s", archived)

    if force:
        log.info(
            "[watcher] session resumed after digest — re-digesting %s (source_hash=%s)",
            path.name, source_hash[:8],
        )
        print(f"[watcher] session resumed after digest — re-digesting {path.name} …", flush=True)
    else:
        log.info("[watcher] Digesting %s (source_hash=%s)", path.name, source_hash[:8])
        print(f"[watcher] Digesting {path.name} …", flush=True)

    raw_events = parse_transcript(path)
    session_id = source_hash
    normalized_events = normalize(raw_events, session_id)
    chunks = chunk_session(normalized_events, session_id)
    sittings = detect_sittings(normalized_events)

    # Timestamps
    timestamps = [e.timestamp for e in raw_events if e.timestamp]
    started_dt: datetime | None = None
    ended_dt: datetime | None = None
    if timestamps:
        ms_vals = [_parse_ts(t, None) for t in timestamps]
        ms_vals = [m for m in ms_vals if m is not None]
        if ms_vals:
            started_dt = datetime.fromtimestamp(min(ms_vals) / 1000, tz=timezone.utc)
            ended_dt = datetime.fromtimestamp(max(ms_vals) / 1000, tz=timezone.utc)

    llm = AnthropicUnderstandLLM()
    session_shape = classify_session(llm, normalized_events)
    topic_shift_ids = detect_topic_shifts(llm, normalized_events)
    live_directives = analyze_interactions_live(llm, normalized_events)
    result_u = understand(llm, normalized_events, session_id, session_shape, live_directives, topic_shift_ids)

    try:
        result = store_session_digest(
            source_path=str(path),
            source_hash=source_hash,
            raw_events=raw_events,
            normalized_events=normalized_events,
            chunks=result_u.chunks,
            sittings=sittings,
            started_at=started_dt,
            ended_at=ended_dt,
            understanding=result_u,
            session_shape=session_shape,
            force=force,
            allow_llm_purge=force,  # sanctioned: replacing incomplete with complete
        )
    except LlmPurgeRefused:
        log.info("[watcher] Session %s already digested — skipping", source_hash[:8])
        return False

    if not result.stored:
        log.info("[watcher] Session %s already stored — skipping", source_hash[:8])
        return False

    # ── Emit activity events (failure-safe) ───────────────────────────────────
    try:
        git_ctx = get_git_context(str(path))
        act_events = build_session_events(
            session_id=result.session_id,
            moments=result_u.moments,
            transitions=result_u.transitions,
            outcomes=result_u.outcomes,
            narrative=result_u.narrative,
            repo=git_ctx.get("repo"),
            branch=git_ctx.get("branch"),
            worktree=git_ctx.get("worktree"),
            session_ended_at=ended_dt,
        )
        with db_get_session() as ae_session:
            emit_activity_events(act_events, db_session=ae_session)
            ae_session.commit()
        log.info("[watcher] Emitted %d activity events for %s", len(act_events), source_hash[:8])
        print(f"[watcher] Emitted {len(act_events)} activity events for {source_hash[:8]}", flush=True)
    except Exception as ae_err:
        log.warning("[watcher] Activity event emission failed (digest saved): %s", ae_err)
        print(f"[watcher] Warning: activity event emission failed: {ae_err}", flush=True)

    log.info("[watcher] Stored session %s (%d moments)", result.session_id[:8], len(result_u.moments))
    print(f"[watcher] Stored session {result.session_id[:8]} ({len(result_u.moments)} moments)", flush=True)
    return True


# ── Main watcher loop ────────────────────────────────────────────────────────

class SessionWatcher:
    """Watches ~/.claude/projects for quiet sessions and digests them.

    Resume detection is stateless (DB-backed): for each quiet file already in
    the DB, we compare the file's mtime against the stored session's created_at.
    If mtime > created_at the session resumed after the prior digest and we
    re-digest with force=True/allow_llm_purge=True. This check survives watcher
    restarts because all state lives in Postgres.

    The _skipped set is a within-scan-cycle optimisation: it records paths that
    were confirmed up-to-date (mtime <= created_at) so we don't re-query the DB
    on every single scan tick. It is cleared whenever a digest triggers (so a
    resumed session is never permanently cached as "done").
    """

    def __init__(
        self,
        projects_dir: pathlib.Path | None = None,
        quiet_seconds: float = QUIET_SECONDS,
        scan_interval: float = SCAN_INTERVAL_SECONDS,
        digest_fn: Callable[[pathlib.Path, bool], bool] | None = None,
        get_created_at_fn: Callable[[str], float | None] | None = None,
    ) -> None:
        self._projects_dir = projects_dir or CLAUDE_PROJECTS_DIR
        self._quiet_seconds = quiet_seconds
        self._scan_interval = scan_interval
        self._digest_fn = digest_fn or _digest_one
        self._get_created_at_fn = get_created_at_fn or _get_session_created_at
        self._running = False
        # Per-scan cache: paths confirmed current (mtime <= stored created_at).
        # NOT a permanent skip-list — cleared after any re-digest so a resumed
        # session is always re-evaluated.
        self._skipped: set[str] = set()

    def start(self) -> None:
        """Start the polling loop (blocking)."""
        self._running = True
        log.info("[watcher] Watching %s (quiet=%ds, scan=%ds)",
                 self._projects_dir, self._quiet_seconds, self._scan_interval)
        print(f"[watcher] Watching {self._projects_dir} for sessions going quiet "
              f"(quiet_threshold={self._quiet_seconds}s, scan_interval={self._scan_interval}s)",
              flush=True)
        try:
            while self._running:
                self._scan_once()
                time.sleep(self._scan_interval)
        except KeyboardInterrupt:
            print("\n[watcher] Interrupted — stopping.", flush=True)
            self._running = False

    def stop(self) -> None:
        self._running = False

    def _scan_once(self) -> list[pathlib.Path]:
        """One scan pass. Returns list of newly-digested paths (for testing)."""
        now = time.time()
        candidates = discover_jsonl_files(self._projects_dir)
        newly_digested: list[pathlib.Path] = []

        for cand in candidates:
            try:
                mtime = cand.stat().st_mtime
            except OSError:
                continue

            if not is_session_quiet(mtime, quiet_seconds=self._quiet_seconds, now=now):
                continue

            path_key = str(cand)

            # Fast-skip: confirmed up-to-date in a previous scan tick
            if path_key in self._skipped:
                continue

            source_hash = cand.stem

            # Check whether the session is already in the DB
            created_at_ts = self._get_created_at_fn(source_hash)

            if created_at_ts is not None:
                if mtime <= created_at_ts:
                    # File has not changed since the last digest — truly done
                    self._skipped.add(path_key)
                    log.debug("[watcher] Already current: %s", cand.name)
                    continue
                # File grew after the stored digest — resumed session
                force = True
                log.info(
                    "[watcher] %s grew after digest (mtime=%.0f > created_at=%.0f) — forcing re-digest",
                    cand.name, mtime, created_at_ts,
                )
            else:
                # Session not yet in DB — first digest
                force = False

            # Eligible — attempt digest (first-time or resumed)
            try:
                stored = self._digest_fn(cand, force)
                if stored:
                    # Clear the skipped cache so any future resume is re-checked
                    self._skipped.discard(path_key)
                    newly_digested.append(cand)
                    print(f"[watcher] Digested: {cand.name}", flush=True)
                else:
                    log.debug("[watcher] Skipped (writer returned stored=False): %s", cand.name)
            except Exception as err:
                log.warning("[watcher] Digest failed for %s: %s — will retry next scan", cand.name, err)

        return newly_digested


def watch_sessions(
    quiet_seconds: float = QUIET_SECONDS,
    projects_dir: pathlib.Path | None = None,
) -> None:
    """Entry point for `python3 -m quire.cli journal watch-sessions`."""
    from quire import workspace as workspace_mod
    workspace_mod.load_env()

    watcher = SessionWatcher(
        projects_dir=projects_dir,
        quiet_seconds=quiet_seconds,
    )
    watcher.start()
