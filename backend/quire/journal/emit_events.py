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
            "        CAST(:topic_ids AS uuid[]), CAST(:files AS text[]), "
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
