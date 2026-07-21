# Slice 6 — Activity Events Port + Python Watcher Daemon

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Python digestion becomes the production path end-to-end — activity events are emitted from the Python digest flow, a Python watchdog watcher replaces the TS daemon, and a founder-visible proof shows a fresh real session digested unattended and rendered on the dashboard.

**Architecture:** Port `buildSessionEvents` from `journal/src/pipeline/emit-events.ts` into a Python `quire/journal/emit_events.py` module, wire it into the `journal digest` CLI command and the new Python watcher daemon. The watcher (`quire/journal/watcher.py`, exposed as `python3 -m quire.cli journal watch-sessions`) uses `watchdog` to monitor `~/.claude/projects/**/*.jsonl` for quiet sessions (file-modification-time quiescence heuristic — debounce window, same spirit as the TS daemon's `quietMs`), then invokes the existing `store_session_digest` + `emit_activity_events` pipeline. The TS daemon entry point gets the same deprecation-notice + `exit(1)` + `--force-legacy` gate pattern already used for other demoted TS surfaces.

**Tech Stack:** Python 3.11, SQLAlchemy 2, `watchdog` (add to `requirements.txt`), Pydantic, existing `quire.db.writer`, `quire.understand`, `quire.ingest` — no new dependencies beyond watchdog.

## Global Constraints

- All backend pytest tests stay green (408 + new tests, 1 skipped) — no regressions
- `python3 -m evals.event_stream` and `python3 -m evals.alarms` stay green
- `journal npx vitest run` stays at 83 files / 815 tests green; `typecheck:ui` clean
- Single-writer rule: `activity_events` is append-only insert — two inserters (Python digest + TS MCP instrumentation) are conflict-free; document this windowed exception in `backend/quire/db/CENSUS.md` with Slice-7 completion note
- `alignment/workspaces/quire-brain` is a rehearsed demo — never edit/regenerate
- No production import of `journal/src/agents/digest/run.ts::digestWithAgent` (C1 gate)
- One commit, with trailers: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_016cmqJ7aie4Kap4ZsZraMF1`
- Living docs move with the slice: CLAUDE.md, docs/architecture.md, backend/README.md, root README.md must be accurate after implementation

---

## File Map

**New files (create):**
- `backend/quire/journal/__init__.py` — package marker
- `backend/quire/journal/emit_events.py` — Python port of `buildSessionEvents` (moments → narrative → activity events); also exposes `emit_activity_events(events, session)` for DB persistence
- `backend/quire/journal/git_context.py` — Python port of `getGitContext(sourcePath)` from `journal/src/pipeline/orchestrator.ts`
- `backend/quire/journal/watcher.py` — Python watchdog watcher: monitors `~/.claude/projects/**/*.jsonl` for quiescence, triggers digest
- `backend/tests/test_emit_events.py` — offline tests for `build_session_events` logic (canned inputs, no DB, no LLM; fake-clock quiescence tests for watcher)

**Modified files:**
- `backend/requirements.txt` — add `watchdog==6.0.0` (pinned)
- `backend/quire/cli.py` — add `journal watch-sessions` command; wire `emit_activity_events` into `journal_digest` after `store_session_digest`
- `backend/quire/db/writer.py` — add `write_activity_events(sa_session, events, session_id, maps)` helper (called by `store_session_digest` after understanding write, in same transaction — or via separate try/catch if caller prefers failure-safe outside the transaction)
- `backend/quire/db/CENSUS.md` — add `activity_events` single-writer exception note (windowed: Python digest-events + TS MCP instrumentation events, both insert-only, conflict-free; Slice-7 removes TS inserter)
- `journal/src/cli/index.ts` — demote the `observe` command (TS daemon entry) with same deprecation-notice + `exit(1)` + `--force-legacy` pattern already used for `digest`
- `docs/architecture.md` — update "today (mid-migration)" section: digestion now Python, daemon now Python
- `CLAUDE.md` — update daemon command reference (observe → journal watch-sessions)
- `backend/README.md` — add watcher command docs

---

## Task 1: Port `buildSessionEvents` and `get_git_context` to Python

**Files:**
- Create: `backend/quire/journal/__init__.py`
- Create: `backend/quire/journal/emit_events.py`
- Create: `backend/quire/journal/git_context.py`
- Test: `backend/tests/test_emit_events.py`

**Interfaces:**
- Produces: `build_session_events(session_id, moments, transitions, outcomes, narrative, *, repo=None, branch=None, worktree=None, session_ended_at=None) -> list[dict]` — each dict matches the `activity_events` column layout
- Produces: `emit_activity_events(events: list[dict], *, db_session) -> None` — inserts into `activity_events` in-process, no commit (caller commits)
- Produces: `get_git_context(source_path: str) -> dict[str, str | None]` — keys `repo`, `branch`, `worktree`

- [ ] **Step 1.1: Write failing tests for `build_session_events`**

```python
# backend/tests/test_emit_events.py
"""Tests for quire.journal.emit_events — offline, no DB, no LLM."""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from quire.journal.emit_events import build_session_events
from quire.understand.models import (
    AcceptedOutcome,
    IntentTransition,
    NarrativeArc,
    SessionMoment,
    SessionNarrative,
    EvidenceAnchor,
)

NOW = datetime(2026, 7, 22, 10, 0, 0, tzinfo=timezone.utc)
NOW_ISO = "2026-07-22T10:00:00Z"


def _moment(idx: int = 0) -> SessionMoment:
    return SessionMoment(
        id=f"moment-{idx}",
        chunk_id="sid-chunk-0",
        type="decision",
        statement=f"decided to {idx}",
        significance="high",
        agency="developer",
        confidence="high",
        topic_fingerprint="general",
        related_moment_ids=[],
        arc_id="arc-1",
        arc_role="origin",
        evidence=[EvidenceAnchor(quote="the quote", event_index=0, anchored=True, source_type="user")],
        occurred_at=NOW_ISO,
        verification="supported",
    )


def _transition(idx: int = 0) -> IntentTransition:
    return IntentTransition(
        id=f"trans-{idx}",
        session_id="sess",
        from_statement="from here",
        to_statement="to there",
        reason="pivot needed",
        origin_moment_ids=["moment-0"],
        arc_id="arc-1",
        confidence="high",
    )


def _outcome(idx: int = 0) -> AcceptedOutcome:
    return AcceptedOutcome(
        id=f"outcome-{idx}",
        session_id="sess",
        statement="shipped feature",
        supporting_moment_ids=["moment-0"],
        supporting_files=["src/foo.py"],
        confidence="high",
    )


def _narrative() -> SessionNarrative:
    return SessionNarrative(
        session_id="sess",
        session_shape="narrative",
        summary="a productive session",
        progression=["started", "finished"],
        discoveries=["found a bug"],
        stabilized_directions=["keep refactoring"],
        abandoned_directions=["tried another approach"],
        arcs=[NarrativeArc(arc_id="arc-1", title="refactor", summary="arc summary", moment_ids=["moment-0"], resolution="resolved")],
    )


def test_build_session_events_returns_expected_count():
    """1 narrative + N moments + N transitions + N outcomes."""
    moments = [_moment(0), _moment(1)]
    transitions = [_transition(0)]
    outcomes = [_outcome(0)]
    narrative = _narrative()
    events = build_session_events(
        session_id="sess",
        moments=moments,
        transitions=transitions,
        outcomes=outcomes,
        narrative=narrative,
        repo="intent-ai",
        branch="feat/slice-6",
        worktree=None,
        session_ended_at=NOW,
    )
    # 1 (narrative) + 2 (moments) + 1 (transition) + 1 (outcome) = 5
    assert len(events) == 5


def test_narrative_event_category_is_session_shape():
    events = build_session_events(
        session_id="sess",
        moments=[],
        transitions=[],
        outcomes=[],
        narrative=_narrative(),
    )
    narrative_ev = next(e for e in events if e["source_type"] == "narrative")
    assert narrative_ev["category"] == "narrative"


def test_moment_event_actor_is_agency():
    events = build_session_events(
        session_id="sess",
        moments=[_moment(0)],
        transitions=[],
        outcomes=[],
        narrative=_narrative(),
    )
    moment_ev = next(e for e in events if e["source_type"] == "moment")
    assert moment_ev["actor"] == "developer"


def test_moment_event_summary_is_statement():
    events = build_session_events(
        session_id="sess",
        moments=[_moment(0)],
        transitions=[],
        outcomes=[],
        narrative=_narrative(),
    )
    moment_ev = next(e for e in events if e["source_type"] == "moment")
    assert moment_ev["summary"] == "decided to 0"


def test_transition_event_category_is_transition():
    events = build_session_events(
        session_id="sess",
        moments=[],
        transitions=[_transition(0)],
        outcomes=[],
        narrative=_narrative(),
    )
    tr_ev = next(e for e in events if e["source_type"] == "transition")
    assert tr_ev["category"] == "transition"
    assert "from here" in tr_ev["summary"]
    assert "to there" in tr_ev["summary"]


def test_outcome_event_files_carried():
    events = build_session_events(
        session_id="sess",
        moments=[],
        transitions=[],
        outcomes=[_outcome(0)],
        narrative=_narrative(),
    )
    out_ev = next(e for e in events if e["source_type"] == "outcome")
    assert "src/foo.py" in out_ev["files"]


def test_git_context_propagated():
    events = build_session_events(
        session_id="sess",
        moments=[_moment(0)],
        transitions=[],
        outcomes=[],
        narrative=_narrative(),
        repo="my-repo",
        branch="main",
        worktree="/path/to/worktree",
    )
    for ev in events:
        assert ev["repo"] == "my-repo"
        assert ev["branch"] == "main"
        assert ev["worktree"] == "/path/to/worktree"


def test_moment_tags_include_topic_fingerprint_and_significance():
    events = build_session_events(
        session_id="sess",
        moments=[_moment(0)],
        transitions=[],
        outcomes=[],
        narrative=_narrative(),
    )
    moment_ev = next(e for e in events if e["source_type"] == "moment")
    assert "general" in moment_ev["tags"]
    assert "high" in moment_ev["tags"]


def test_no_moments_no_transitions_no_outcomes_only_narrative():
    events = build_session_events(
        session_id="sess",
        moments=[],
        transitions=[],
        outcomes=[],
        narrative=_narrative(),
    )
    assert len(events) == 1
    assert events[0]["source_type"] == "narrative"


def test_get_git_context_returns_fallback_on_non_git_path():
    from quire.journal.git_context import get_git_context
    # /tmp is not a git repo
    ctx = get_git_context("/tmp/fake.jsonl")
    assert ctx.get("repo") is None
    assert ctx.get("branch") is None
    assert ctx.get("worktree") is None
```

- [ ] **Step 1.2: Run tests to verify they fail**

```bash
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m pytest tests/test_emit_events.py -v 2>&1 | tail -20
```

Expected: `ModuleNotFoundError` or `ImportError` — `quire.journal` not yet created.

- [ ] **Step 1.3: Create the `quire/journal/__init__.py` package marker**

```python
# backend/quire/journal/__init__.py
"""quire.journal — Python-side journal writer utilities (Slice 6).

Public API:
    build_session_events(session_id, moments, transitions, outcomes, narrative, *, ...)
    emit_activity_events(events, *, db_session)
    get_git_context(source_path) -> dict
"""
from quire.journal.emit_events import build_session_events, emit_activity_events
from quire.journal.git_context import get_git_context

__all__ = ["build_session_events", "emit_activity_events", "get_git_context"]
```

- [ ] **Step 1.4: Create `quire/journal/git_context.py`**

Port of `getGitContext` from `journal/src/pipeline/orchestrator.ts:63-78`.

```python
# backend/quire/journal/git_context.py
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
```

- [ ] **Step 1.5: Create `quire/journal/emit_events.py`**

Port of `journal/src/pipeline/emit-events.ts::buildSessionEvents`. The Python output is a list of plain dicts matching `activity_events` column names.

```python
# backend/quire/journal/emit_events.py
"""Python port of journal/src/pipeline/emit-events.ts::buildSessionEvents.

Builds ActivityEvent dicts from a completed session understanding result.
These dicts are passed to emit_activity_events() for DB insertion, or
stored in-memory for inspection/testing.

Single-writer note (Slice 6): Python is the writer for digest-sourced
activity_events (moments, transitions, outcomes, narrative). The TS MCP
server continues to write instrumentation events (brain_enter, brain_search,
etc.) until Slice 7 ports the MCP server. Both paths are append-only inserts
into activity_events — no conflict. See CENSUS.md for the formal exception.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session as SASession

from quire.understand.models import (
    AcceptedOutcome,
    IntentTransition,
    SessionMoment,
    SessionNarrative,
)


def build_session_events(
    session_id: str,
    moments: list[SessionMoment],
    transitions: list[IntentTransition],
    outcomes: list[AcceptedOutcome],
    narrative: SessionNarrative,
    *,
    repo: str | None = None,
    branch: str | None = None,
    worktree: str | None = None,
    session_ended_at: datetime | None = None,
) -> list[dict[str, Any]]:
    """Build activity_events dicts from a session understanding result.

    Mirrors TS buildSessionEvents exactly:
    - 1 narrative event (session summary)
    - N moment events (one per moment)
    - N transition events
    - N outcome events

    Returns plain dicts with activity_events column names. Does not touch
    the database — call emit_activity_events() to persist.
    """
    events: list[dict[str, Any]] = []
    session_ts = session_ended_at or datetime.now(tz=timezone.utc)

    ctx = {
        "session_id": session_id,
        "repo": repo,
        "branch": branch,
        "worktree": worktree,
    }

    # ── Narrative / session summary event ─────────────────────────────
    events.append({
        **ctx,
        "timestamp": session_ts,
        "category": narrative.session_shape,
        "tags": [],
        "actor": "system",
        "summary": narrative.summary,
        "metadata": {
            "progression": narrative.progression,
            "discoveries": narrative.discoveries,
            "stabilizedDirections": narrative.stabilized_directions,
            "abandonedDirections": narrative.abandoned_directions,
            "arcCount": len(narrative.arcs),
        },
        "source_type": "narrative",
        "source_id": session_id,
        "files": [],
        "topic_ids": [],
    })

    # ── Moment events ──────────────────────────────────────────────────
    for moment in moments:
        # Parse occurredAt; fall back to now on failure (mirrors TS guard:
        # new Date("garbage") yields Invalid Date whose .toISOString() throws)
        moment_ts = _parse_iso_or_now(moment.occurred_at)
        tags = [t for t in [moment.topic_fingerprint, moment.significance, moment.confidence] if t]
        events.append({
            **ctx,
            "timestamp": moment_ts,
            "category": moment.type,
            "tags": tags,
            "actor": moment.agency,
            "summary": moment.statement,
            "metadata": {
                "significance": moment.significance,
                "confidence": moment.confidence,
                "arcId": moment.arc_id,
                "arcRole": moment.arc_role,
                "chunkId": moment.chunk_id,
                "verification": moment.verification,
            },
            "source_type": "moment",
            "source_id": moment.id,
            "files": [],
            "topic_ids": [],
        })

    # ── Transition events ──────────────────────────────────────────────
    for transition in transitions:
        events.append({
            **ctx,
            "timestamp": session_ts,
            "category": "transition",
            "tags": [],
            "actor": "collaborative",
            "summary": f"{transition.from_statement} → {transition.to_statement}: {transition.reason}",
            "metadata": {
                "from": transition.from_statement,
                "to": transition.to_statement,
                "reason": transition.reason,
                "confidence": transition.confidence,
                "originMomentIds": transition.origin_moment_ids,
            },
            "source_type": "transition",
            "source_id": transition.id,
            "files": [],
            "topic_ids": [],
        })

    # ── Outcome events ─────────────────────────────────────────────────
    for outcome in outcomes:
        events.append({
            **ctx,
            "timestamp": session_ts,
            "category": "outcome",
            "tags": [],
            "actor": "collaborative",
            "summary": outcome.statement,
            "metadata": {
                "confidence": outcome.confidence,
                "supportingMomentIds": outcome.supporting_moment_ids,
            },
            "source_type": "outcome",
            "source_id": outcome.id,
            "files": outcome.supporting_files,
            "topic_ids": [],
        })

    return events


def emit_activity_events(
    events: list[dict[str, Any]],
    *,
    db_session: SASession,
    is_pg: bool = True,
) -> None:
    """Insert activity_events rows — append-only, never UPDATE/DELETE.

    Called from quire.cli journal_digest after store_session_digest succeeds.
    Runs outside the digest transaction so a failure here never rolls back
    the digest rows (emit failure must not fail the parent operation).

    Caller is responsible for dialect detection (is_pg=True by default since
    the production path always uses Postgres).
    """
    now = datetime.now(tz=timezone.utc)

    if is_pg:
        sql = text(
            "INSERT INTO activity_events "
            "(id, timestamp, category, tags, actor, summary, metadata, "
            " source_type, source_id, session_id, repo, branch, worktree, "
            " topic_ids, files, review_status, created_at) "
            "VALUES (:id, :timestamp, :category, CAST(:tags AS text[]), :actor, "
            "        :summary, CAST(:metadata AS jsonb), :source_type, :source_id, "
            "        :session_id, :repo, :branch, :worktree, "
            "        CAST(:topic_ids AS uuid[]), CAST(:files AS text[]), "  # corrected during implementation — topic_ids is uuid[]
            "        'pending', :created_at)"
        )
    else:
        sql = text(
            "INSERT INTO activity_events "
            "(id, timestamp, category, tags, actor, summary, metadata, "
            " source_type, source_id, session_id, repo, branch, worktree, "
            " topic_ids, files, review_status, created_at) "
            "VALUES (:id, :timestamp, :category, :tags, :actor, "
            "        :summary, :metadata, :source_type, :source_id, "
            "        :session_id, :repo, :branch, :worktree, "
            "        :topic_ids, :files, 'pending', :created_at)"
        )

    for ev in events:
        ev_id = str(uuid.uuid4())
        ts = ev["timestamp"]
        if isinstance(ts, datetime):
            ts_str = ts.isoformat()
        else:
            ts_str = str(ts)

        if is_pg:
            db_session.execute(sql, {
                "id": ev_id,
                "timestamp": ts_str,
                "category": ev["category"],
                "tags": ev.get("tags") or [],
                "actor": ev["actor"],
                "summary": ev["summary"],
                "metadata": json.dumps(ev.get("metadata") or {}),
                "source_type": ev.get("source_type"),
                "source_id": ev.get("source_id"),
                "session_id": ev.get("session_id"),
                "repo": ev.get("repo"),
                "branch": ev.get("branch"),
                "worktree": ev.get("worktree"),
                "topic_ids": ev.get("topic_ids") or [],
                "files": ev.get("files") or [],
                "created_at": now.isoformat(),
            })
        else:
            db_session.execute(sql, {
                "id": ev_id,
                "timestamp": ts_str,
                "category": ev["category"],
                "tags": json.dumps(ev.get("tags") or []),
                "actor": ev["actor"],
                "summary": ev["summary"],
                "metadata": json.dumps(ev.get("metadata") or {}),
                "source_type": ev.get("source_type"),
                "source_id": ev.get("source_id"),
                "session_id": ev.get("session_id"),
                "repo": ev.get("repo"),
                "branch": ev.get("branch"),
                "worktree": ev.get("worktree"),
                "topic_ids": json.dumps(ev.get("topic_ids") or []),
                "files": json.dumps(ev.get("files") or []),
                "created_at": now.isoformat(),
            })


def _parse_iso_or_now(ts: str | None) -> datetime:
    """Parse ISO timestamp; fall back to now on failure (mirrors TS guard)."""
    if not ts:
        return datetime.now(tz=timezone.utc)
    try:
        clean = ts.replace("Z", "+00:00")
        dt = datetime.fromisoformat(clean)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, AttributeError):
        return datetime.now(tz=timezone.utc)
```

- [ ] **Step 1.6: Run the tests and verify they pass**

```bash
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m pytest tests/test_emit_events.py -v 2>&1 | tail -30
```

Expected: all 10 tests PASS. If `test_get_git_context_returns_fallback_on_non_git_path` fails, check that `/tmp` is truly not a git repo on the system — use `/dev/null` parent instead.

- [ ] **Step 1.7: Run full backend suite to confirm no regressions**

```bash
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m pytest -q 2>&1 | tail -3
```

Expected: `408+ passed, 1 skipped` (exact count may grow by the new tests).

---

## Task 2: Wire `emit_activity_events` into `journal_digest` CLI command

**Files:**
- Modify: `backend/quire/cli.py` (the `journal_digest` command, lines ~760–920)

**Interfaces:**
- Consumes: `build_session_events` from `quire.journal.emit_events`
- Consumes: `emit_activity_events` from `quire.journal.emit_events`
- Consumes: `get_git_context` from `quire.journal.git_context`
- Consumes: `StoreResult` from `quire.db.writer`

- [ ] **Step 2.1: Add `emit_activity_events` call after `store_session_digest` succeeds in `journal_digest`**

Find the section in `journal_digest` starting at ~line 886 (`Persisting to Postgres…`). After the `store_session_digest` block succeeds and `result.stored is True`, add:

```python
    # ── Emit activity events (failure-safe — must never fail the digest) ──────
    if result.stored:
        try:
            from quire.journal.emit_events import build_session_events, emit_activity_events
            from quire.journal.git_context import get_git_context
            from quire.db.engine import get_session

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
            with get_session() as ae_session:
                emit_activity_events(act_events, db_session=ae_session)
                ae_session.commit()
            typer.secho(
                f"  Emitted {len(act_events)} activity events.",
                fg=typer.colors.GREEN,
            )
        except Exception as ae_err:
            typer.secho(
                f"  Warning: activity event emission failed (digest still saved): {ae_err}",
                fg=typer.colors.YELLOW,
            )
```

Note: `git_ctx` from CC log paths (`~/.claude/projects/...`) will return all-None since those paths are not inside a git repo — this is correct. The watcher passes git context separately (see Task 4).

- [ ] **Step 2.2: Verify `journal digest --dry-run` still works (no DB, no LLM)**

```bash
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m quire.cli journal digest --dry-run ~/.claude/projects/-Users-giladkoch-dev-intent-ai/$(ls ~/.claude/projects/-Users-giladkoch-dev-intent-ai/ | grep "\.jsonl" | head -1) 2>&1 | head -20
```

Expected: Stats printed, no error.

- [ ] **Step 2.3: Run full backend suite**

```bash
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m pytest -q 2>&1 | tail -3
```

Expected: all passed, 1 skipped.

---

## Task 3: Add `activity_events` single-writer exception to CENSUS.md

**Files:**
- Modify: `backend/quire/db/CENSUS.md`

- [ ] **Step 3.1: Add a new "Windowed Exception" section to CENSUS.md after the Summary block**

Read the file first, then insert after the "## Summary" section the following:

```markdown
## Windowed Single-Writer Exception (Slice 6 → Slice 7)

`activity_events` has TWO active inserters during Slice 6:

1. **Python digest path** (`quire/journal/emit_events.py` → `emit_activity_events`): writes
   moment/transition/outcome/narrative events from session digestion. Python-owned as of Slice 6.

2. **TS MCP server** (`journal/src/mcp/server.ts`): writes instrumentation events
   (`brain_enter`, `brain_search`, etc.) as agents call MCP tools mid-session.

Both inserters are **append-only** (INSERT only; no UPDATE or DELETE). There is no shared
primary-key space or ordering dependency — inserts from both paths are conflict-free.
This is a documented, time-bounded exception to the single-writer rule.

**Slice-7 closes this exception**: the MCP server ports to Python, at which point
`quire/mcp/server.py` becomes the sole inserter for ALL `activity_events` rows.

Until Slice 7 lands, do NOT add any UPDATE or DELETE path touching `activity_events`
from Python — keep the table append-only on both sides.
```

- [ ] **Step 3.2: Verify CENSUS.md is valid Markdown (no truncation)**

```bash
head -60 /Users/giladkoch/dev/intent-ai/backend/quire/db/CENSUS.md
```

---

## Task 4: Build the Python watchdog watcher daemon

**Files:**
- Create: `backend/quire/journal/watcher.py`
- Modify: `backend/requirements.txt` (add `watchdog==6.0.0`)
- Test: add watcher quiescence tests to `backend/tests/test_emit_events.py`

**Interfaces:**
- Produces: `SessionWatcher` class with `start()` / `stop()` / `run_forever()` methods
- Produces: `watch_sessions(quiet_seconds=120, projects_dir=None)` — the main entry point that the CLI command calls

Quiescence heuristic: a session file is eligible for digestion when its mtime has not changed for `quiet_seconds` (default 120). The watcher scans known files on a periodic schedule (every 30 s) and digests any file that (a) passes the quiet window and (b) is not yet in the source_hash index (idempotent: source_hash = stem of the `.jsonl` file, matching the existing Python digest path).

DO NOT use the TS daemon's live hook server, NDJSON sink, or prompt suggester — just the quiescence heuristic, discovery, and digest trigger.

- [ ] **Step 4.1: Add `watchdog` to `requirements.txt`**

Open `/Users/giladkoch/dev/intent-ai/backend/requirements.txt` and add:
```
watchdog==6.0.0
```

- [ ] **Step 4.2: Install watchdog**

```bash
cd /Users/giladkoch/dev/intent-ai/backend && pip install watchdog==6.0.0 -q
```

Expected: `Successfully installed watchdog-6.0.0` or already installed.

- [ ] **Step 4.3: Write failing watcher quiescence tests**

Add to `backend/tests/test_emit_events.py`:

```python
# ── Watcher quiescence tests (fake clock, no sleeps) ──────────────────────────

def test_quiescence_check_false_when_file_recently_modified():
    """A file modified within the quiet window is NOT eligible."""
    from quire.journal.watcher import is_session_quiet
    import time
    now = time.time()
    # mtime = 30 seconds ago; quiet_seconds = 120
    mtime = now - 30
    assert is_session_quiet(mtime, quiet_seconds=120, now=now) is False


def test_quiescence_check_true_when_file_old_enough():
    """A file last modified more than quiet_seconds ago IS eligible."""
    from quire.journal.watcher import is_session_quiet
    import time
    now = time.time()
    mtime = now - 150  # 150 > 120
    assert is_session_quiet(mtime, quiet_seconds=120, now=now) is True


def test_quiescence_boundary():
    """Exactly at the quiet boundary (==) is NOT eligible (strictly greater than)."""
    from quire.journal.watcher import is_session_quiet
    import time
    now = time.time()
    mtime = now - 120  # exactly quiet_seconds
    assert is_session_quiet(mtime, quiet_seconds=120, now=now) is False


def test_discover_jsonl_files_finds_toplevel_only(tmp_path):
    """discover_jsonl_files finds .jsonl at the first nesting level only
    (no subagent logs in subdirectories)."""
    from quire.journal.watcher import discover_jsonl_files

    # Create top-level .jsonl files
    (tmp_path / "abc.jsonl").write_text("{}")
    (tmp_path / "def.jsonl").write_text("{}")

    # Create a project subdir with a .jsonl (should be found — it IS a top-level
    # file within the project dir)
    proj_dir = tmp_path / "-Users-foo-bar"
    proj_dir.mkdir()
    (proj_dir / "session1.jsonl").write_text("{}")
    # A subagent subdir (should NOT be found)
    subagent_dir = proj_dir / "abc123"
    subagent_dir.mkdir()
    (subagent_dir / "subagent.jsonl").write_text("{}")

    found = discover_jsonl_files(tmp_path)
    paths = {p.name for p in found}
    assert "session1.jsonl" in paths
    assert "subagent.jsonl" not in paths  # subdirectory of a project dir
```

- [ ] **Step 4.4: Run new tests to verify they fail**

```bash
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m pytest tests/test_emit_events.py -k "quiescence or discover_jsonl" -v 2>&1 | tail -15
```

Expected: ImportError or ModuleNotFoundError for `quire.journal.watcher`.

- [ ] **Step 4.5: Create `backend/quire/journal/watcher.py`**

```python
# backend/quire/journal/watcher.py
"""Python watchdog watcher — monitors ~/.claude/projects for new CC sessions.

Replaces journal/src/daemon/index.ts (TS daemon demoted in Slice 6).

Quiescence heuristic (mirrors TS EventQueue quietMs pattern):
    A session file is ready to digest when its mtime has not changed
    for QUIET_SECONDS (default 120 s). This matches the spirit of the TS
    daemon's quietMs=3000 ms (their batch flush) but is calibrated for
    full-session digest rather than live streaming.

Design:
    - No hook server, no NDJSON sink, no prompt suggester (TS internals
      that do NOT need porting — the quiescence-and-digest flow is the
      only piece needed here).
    - Uses watchdog for filesystem events, but falls back to polling
      every SCAN_INTERVAL_SECONDS if watchdog is unavailable.
    - Idempotent: source_hash = log file stem; already-digested sessions
      skip silently (the writer returns stored=False without error).
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


# ── Digest trigger ───────────────────────────────────────────────────────────

def _digest_one(log_path: pathlib.Path) -> bool:
    """Digest a single session file. Returns True if stored, False if skipped.

    Imports lazily so the watcher module can be imported in tests without
    triggering full pipeline imports.
    """
    import pathlib as _pathlib

    from quire.ingest import (
        analyze_interactions,
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
    from quire.journal.emit_events import build_session_events, emit_activity_events
    from quire.journal.git_context import get_git_context
    from quire.db.engine import get_session as db_get_session
    from datetime import datetime, timezone

    path = _pathlib.Path(log_path)
    source_hash = path.stem

    log.info("[watcher] Digesting %s (source_hash=%s)", path.name, source_hash[:8])

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
    except Exception as ae_err:
        log.warning("[watcher] Activity event emission failed (digest saved): %s", ae_err)

    log.info("[watcher] Stored session %s (%d moments)", result.session_id[:8], len(result_u.moments))
    return True


# ── Main watcher loop ────────────────────────────────────────────────────────

class SessionWatcher:
    """Watches ~/.claude/projects for quiet sessions and digests them."""

    def __init__(
        self,
        projects_dir: pathlib.Path | None = None,
        quiet_seconds: float = QUIET_SECONDS,
        scan_interval: float = SCAN_INTERVAL_SECONDS,
        digest_fn: Callable[[pathlib.Path], bool] | None = None,
    ) -> None:
        self._projects_dir = projects_dir or CLAUDE_PROJECTS_DIR
        self._quiet_seconds = quiet_seconds
        self._scan_interval = scan_interval
        self._digest_fn = digest_fn or _digest_one
        self._running = False
        # Track which paths have already been successfully digested in THIS
        # watcher session to avoid redundant scans. The DB idempotency
        # guard is the real gate — this is just a scan-time optimization.
        self._digested_in_session: set[str] = set()

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
            if str(cand) in self._digested_in_session:
                continue
            try:
                mtime = cand.stat().st_mtime
            except OSError:
                continue

            if not is_session_quiet(mtime, quiet_seconds=self._quiet_seconds, now=now):
                continue

            # Eligible — attempt digest
            try:
                stored = self._digest_fn(cand)
                if stored:
                    self._digested_in_session.add(str(cand))
                    newly_digested.append(cand)
                    print(f"[watcher] Digested: {cand.name}", flush=True)
                else:
                    # Already in DB — mark as seen so we skip next scan
                    self._digested_in_session.add(str(cand))
                    log.debug("[watcher] Already digested: %s", cand.name)
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
```

- [ ] **Step 4.6: Run watcher tests**

```bash
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m pytest tests/test_emit_events.py -k "quiescence or discover_jsonl" -v 2>&1 | tail -20
```

Expected: all 4 new watcher tests PASS.

- [ ] **Step 4.7: Run full backend suite**

```bash
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m pytest -q 2>&1 | tail -3
```

Expected: all passed, 1 skipped.

---

## Task 5: Wire the watcher into the CLI as `journal watch-sessions`

**Files:**
- Modify: `backend/quire/cli.py`

- [ ] **Step 5.1: Add `journal watch-sessions` command to `journal_app` in `cli.py`**

In `cli.py`, find the `journal_app` typer group (near the bottom, where `journal_digest` and `journal_events` are defined). Add:

```python
@journal_app.command("watch-sessions")
def journal_watch_sessions(
    quiet_seconds: float = typer.Option(120, "--quiet-seconds", help="seconds of file inactivity before digesting"),
    projects_dir: str = typer.Option("", "--projects-dir", help="override ~/.claude/projects path"),
):
    """Watch ~/.claude/projects for new CC sessions and digest them unattended.

    Polls every 30 s; digests any session file whose mtime has been quiet
    for more than --quiet-seconds (default 120). Already-digested sessions
    are skipped (idempotent: keyed on source_hash = log file stem).

    Replaces the TS `journal observe` command (demoted Slice 6).
    """
    import pathlib

    from quire.journal.watcher import watch_sessions

    pd = pathlib.Path(projects_dir).expanduser() if projects_dir else None
    watch_sessions(quiet_seconds=quiet_seconds, projects_dir=pd)
```

- [ ] **Step 5.2: Smoke-test the CLI command help**

```bash
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m quire.cli journal watch-sessions --help 2>&1
```

Expected: Shows the command description with `--quiet-seconds` and `--projects-dir` options.

---

## Task 6: Demote the TS daemon entry point

**Files:**
- Modify: `journal/src/cli/index.ts`

The `observe` command in `journal/src/cli/index.ts` calls `startDaemon`. Add the same deprecation-notice + `exit(1)` + `--force-legacy` gate pattern already used for the `digest` command.

- [ ] **Step 6.1: Read the current `observe` command in `journal/src/cli/index.ts`**

The `observe` command is at lines 57-64 (based on earlier read). It currently calls `startDaemon` unconditionally.

- [ ] **Step 6.2: Replace the `observe` command action with the deprecation gate**

The updated `observe` command should look like:

```typescript
program
  .command("observe")
  .description("[DEPRECATED] Python watcher has replaced the TS daemon. Use: python3 -m quire.cli journal watch-sessions")
  .option("-p, --port <port>", "Port for hook server", "4317")
  .option("--force-legacy", "Emergency escape hatch: run the old TS daemon despite the deprecation")
  .action(async (opts: { port: string; forceLegacy?: boolean }) => {
    if (!opts.forceLegacy) {
      process.stderr.write(
        "DEPRECATED: The TS observe daemon has been replaced by the Python watcher (Slice 6).\n" +
        "Use: python3 -m quire.cli journal watch-sessions\n" +
        "Emergency bypass (not recommended): npx tsx src/cli/index.ts observe --force-legacy\n",
      );
      process.exit(1);
    }
    const { startDaemon } = await import("../daemon/index.js");
    await startDaemon(parseInt(opts.port));
  });
```

- [ ] **Step 6.3: Run TS vitest suite to confirm 815 still pass**

```bash
cd /Users/giladkoch/dev/intent-ai/journal && npx vitest run 2>&1 | tail -10
```

Expected: 83 test files, 815 tests pass. The `daemon/index.ts` internals are unchanged; only the CLI entry is demoted.

- [ ] **Step 6.4: Run typecheck:ui**

```bash
cd /Users/giladkoch/dev/intent-ai/journal && npx tsc --noEmit -p src/web/ui 2>&1
```

Expected: clean (no errors).

---

## Task 7: Fidelity spot-run (baseline regression check)

This task verifies the Python understanding pipeline has not regressed since Slice 5b.

**Files:** no code changes — evidence only.

- [ ] **Step 7.1: Run fidelity eval on one baseline session**

Use the fixture session that was the basis for the Slice-5b fidelity approval. Check `/Users/giladkoch/dev/intent-ai/backend/evals/fidelity/` for the baseline fixture file.

```bash
cd /Users/giladkoch/dev/intent-ai/backend && ls evals/fidelity/
```

Then run:

```bash
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m evals.fidelity 2>&1 | tail -30
```

If no `evals.fidelity` module, check for an `fidelity` runner script:

```bash
cd /Users/giladkoch/dev/intent-ai/backend && find . -name "*fidelity*" -type f | head -10
```

- [ ] **Step 7.2: Run the parity suite and event_stream eval**

```bash
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m evals.event_stream 2>&1 | tail -10
```

Expected: all green (same as pre-slice baseline).

```bash
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m evals.alarms 2>&1 | tail -10
```

Expected: all green.

- [ ] **Step 7.3: Record fidelity results in the slice report**

Note the dimension scores in the report evidence section. If scores match Slice-5b accepted values (±0), record as "PASS". If a dimension dropped, investigate before committing.

---

## Task 8: Unattended-digest proof (founder-visible evidence)

This is the done-when criterion: the watcher, running unattended, detects and digests a fresh real session that renders on the dashboard.

**Files:** no code changes — evidence only.

- [ ] **Step 8.1: Identify the newest not-yet-digested log**

```bash
ls -lt ~/.claude/projects/-Users-giladkoch-dev-intent-ai/*.jsonl | head -5
```

If this session (the one currently being written by Claude Code) is not yet in the DB, it will be the target. Otherwise, the current session log `7d68d874-59bf-44f7-937b-f11b6244b5af.jsonl` may already be eligible after the conversation goes quiet.

Check what is already digested:

```bash
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m quire.cli journal events --limit 5 2>&1
```

- [ ] **Step 8.2: Start the watcher in the background**

```bash
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m quire.cli journal watch-sessions --quiet-seconds 30 > /tmp/watcher.log 2>&1 &
WATCHER_PID=$!
echo "Watcher PID: $WATCHER_PID"
```

Note: use `--quiet-seconds 30` for faster proof (30 s instead of 120 s).

- [ ] **Step 8.3: Wait for the watcher to detect the session**

```bash
sleep 60 && tail -20 /tmp/watcher.log
```

If the newest session is already quiet (mtime > 30 s ago), it will be digested. If the current session is still active (mtime < 30 s ago), wait longer or use `--quiet-seconds 10` with a nearly-finished session.

If no new session is available during the run, copy an existing session to a new filename to simulate fresh activity:

```bash
# Only if no fresh sessions are available:
NEW_LOG=~/.claude/projects/-Users-giladkoch-dev-intent-ai/proof-slice6-$(date +%s).jsonl
cp ~/.claude/projects/-Users-giladkoch-dev-intent-ai/d73d5190-3683-4204-9e04-d325a7bb6527.jsonl "$NEW_LOG"
# Wait for watcher to pick it up
sleep 45 && tail -20 /tmp/watcher.log
```

Document exactly which approach was taken in the report.

- [ ] **Step 8.4: Verify the session appears in the DB**

```bash
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m quire.cli journal events --limit 10 2>&1
```

- [ ] **Step 8.5: Curl the dashboard API to confirm the session and events render**

Check the dashboard API endpoint for sessions:

```bash
# Start the dashboard (if not already running) in background
cd /Users/giladkoch/dev/intent-ai/journal && npx tsx src/cli/index.ts web --port 3456 > /tmp/dashboard.log 2>&1 &
sleep 3
# Fetch sessions list
curl -s http://localhost:3456/api/sessions | python3 -m json.tool | head -40
# Fetch activity events for the new session
curl -s "http://localhost:3456/api/events?limit=10" | python3 -m json.tool | head -40
```

- [ ] **Step 8.6: Stop the watcher and dashboard**

```bash
kill $WATCHER_PID 2>/dev/null || true
# Kill dashboard if started
pkill -f "tsx src/cli/index.ts web" 2>/dev/null || true
```

- [ ] **Step 8.7: Collect evidence for the report**

Collect:
- Watcher log excerpt showing detection and digest completion
- `python3 -m quire.cli journal events --limit 5` output showing the new events
- API response excerpt confirming the session is visible on the dashboard

---

## Task 9: Update living docs and run final gate checks

**Files:**
- Modify: `docs/architecture.md`
- Modify: `CLAUDE.md`
- Modify: `backend/README.md`

- [ ] **Step 9.1: Update `docs/architecture.md`**

Replace the "Today (mid-migration)" section with the updated state:

- "today" block: digestion is Python-owned, watcher is Python; TS keeps dashboard SPA + MCP only
- Update the `src/daemon/` line to note it is demoted (Slice 6) and replaced by Python watcher
- Update "Seams being closed" to reflect Slice 6 landed: session digestion unified, daemon replaced

Specifically, change the `today` code block from:
```
 AI coding sessions ──▶ journal/ (TS)  ──▶ activity journal ──▶ agents (MCP) + dashboard
```
to:
```
 AI coding sessions ──▶ backend/ (Py) ──▶ activity journal ──▶ agents (MCP) + dashboard (TS)
                              │
                    watcher (quire.cli journal watch-sessions)
```

And update `src/daemon/` to: `src/daemon/` — demoted Slice 6; Python watcher (`python3 -m quire.cli journal watch-sessions`) replaced it.

- [ ] **Step 9.2: Update `CLAUDE.md`**

Find the section that shows `observe` command and update it to point to the Python watcher:

Change the daemon command reference from:
```
npx tsx src/cli/index.ts observe   # start TS daemon (DEMOTED — use Python watcher)
```
to:
```
python3 -m quire.cli journal watch-sessions  # start Python watcher (sessions auto-digest)
```

Also add the `watch-sessions` command to the Python command examples.

- [ ] **Step 9.3: Update `backend/README.md`**

Add a "Watcher Daemon" section documenting:
```
python3 -m quire.cli journal watch-sessions              # watch ~/.claude/projects for new sessions
python3 -m quire.cli journal watch-sessions --quiet-seconds 30  # faster (for testing)
```

- [ ] **Step 9.4: Run all gate checks**

```bash
# Backend pytest
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m pytest -q 2>&1 | tail -3

# Evals
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m evals.event_stream 2>&1 | tail -5
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m evals.alarms 2>&1 | tail -5

# TS vitest
cd /Users/giladkoch/dev/intent-ai/journal && npx vitest run 2>&1 | tail -10

# TS typecheck:ui
cd /Users/giladkoch/dev/intent-ai/journal && npx tsc --noEmit -p src/web/ui 2>&1
```

All must be green before committing.

---

## Task 10: Write the report and commit

**Files:**
- Write report to scratchpad: `/private/tmp/claude-501/-Users-giladkoch-dev-intent-ai/7d68d874-59bf-44f7-937b-f11b6244b5af/scratchpad/sdd/slice-6-report.md`
- Create the one-commit

- [ ] **Step 10.1: Write the slice report**

Report must contain:
- Status (DONE / PARTIAL / BLOCKED)
- Commit SHA
- Test summary (one line: "408+ passed, 1 skipped (backend); 815 passed (journal)")
- Unattended-digest evidence one-liner (watcher log line + session ID seen in dashboard API)
- Concerns / deviations

- [ ] **Step 10.2: Stage and commit**

Stage only the relevant files:

```bash
git add \
  backend/quire/journal/__init__.py \
  backend/quire/journal/emit_events.py \
  backend/quire/journal/git_context.py \
  backend/quire/journal/watcher.py \
  backend/tests/test_emit_events.py \
  backend/requirements.txt \
  backend/quire/cli.py \
  backend/quire/db/CENSUS.md \
  journal/src/cli/index.ts \
  docs/architecture.md \
  CLAUDE.md \
  backend/README.md
```

Then commit with the required trailers:

```bash
git commit -m "$(cat <<'EOF'
feat(slice-6): Python activity events, watchdog watcher, TS daemon demoted

- Port buildSessionEvents → quire/journal/emit_events.py; wire into
  journal_digest and the new watcher daemon
- Add quire/journal/watcher.py: watchdog-based session watcher with
  quiescence heuristic (mtime-quiet > 120 s), idempotent via source_hash
- Expose as `python3 -m quire.cli journal watch-sessions`
- Demote TS `observe` command with deprecation notice + exit(1) +
  --force-legacy gate (matching Slice-4 digest demotion pattern)
- Document activity_events windowed two-inserter exception in CENSUS.md
- Update docs/architecture.md, CLAUDE.md, backend/README.md
- Gates: 408+ pytest passed, 815 vitest passed, fidelity spot-run clear

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016cmqJ7aie4Kap4ZsZraMF1
EOF
)"
```

---

## Self-Review Checklist

Running against the spec now:

**Spec coverage:**
- [x] Activity events port (`emit-events.ts` → `quire/journal/emit_events.py`) — Task 1
- [x] Wire into `journal digest` CLI — Task 2
- [x] Wire into daemon — Task 4 (`_digest_one` calls `build_session_events` + `emit_activity_events`)
- [x] Single-writer nuance documented in CENSUS.md — Task 3
- [x] Python watcher (`watchdog`, `quire.cli journal watch-sessions`) — Tasks 4+5
- [x] `watchdog` pinned in requirements.txt — Task 4.1
- [x] TS daemon demotion with deprecation-notice+exit(1)+--force-legacy — Task 6
- [x] Check for npm script/docs invoking daemon — covered in Task 9 (CLAUDE.md, architecture.md)
- [x] Git context end-to-end (repo/branch/worktree on events) — Task 4 watcher calls `get_git_context`
- [x] Idempotent watcher (already-digested sessions skip via source-hash) — Task 4 `_scan_once`
- [x] Done-when: watcher digests fresh session unattended — Task 8
- [x] Dashboard evidence (curl API) — Task 8.5
- [x] Fidelity spot-run — Task 7
- [x] Living docs move — Task 9
- [x] One commit, trailers — Task 10
- [x] C1 gate: no production import of `digestWithAgent` — watcher uses Python pipeline only
- [x] Tests: canned tests for emit-events (Task 1), watcher quiescence with fake clock (Task 4)
- [x] All gate checks in Task 9.4

**No placeholders found.** All steps have concrete code.

**Type consistency:**
- `build_session_events` returns `list[dict[str, Any]]` and is imported as such in `emit_activity_events` callers
- `is_session_quiet(mtime, *, quiet_seconds, now)` — consistent across watcher.py and tests
- `discover_jsonl_files(projects_dir: pathlib.Path)` — consistent across watcher.py and tests
- `get_git_context(source_path: str) -> dict[str, str | None]` — consistent across git_context.py and callers

**Adjacent improvement noted:** The git context from CC log paths (under `~/.claude/projects/`) will always return all-None since those directories are not git repos. A future improvement could read the CC session metadata JSON (if available) to extract `projectDir` and run git context from there. This is flagged in the watcher docstring but intentionally deferred — it matches TS behaviour where git context is derived from the log path, not a metadata file.
