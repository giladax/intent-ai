"""Database loader for the fidelity harness.

Reads stored digests from Postgres (sessions, moments, chunks, moment_evidence,
transitions, outcomes, narratives tables) and assembles the data structures
the scorers consume.

Read-only. Drizzle (journal/src) owns all writes.
"""

from __future__ import annotations

import json
import pathlib
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session as SASession

from quire.db.models import (
    Chunk,
    Moment,
    MomentEvidence,
    Narrative,
    Outcome,
    Session as JournalSession,
    Transition,
)

from evals.fidelity.scorers import MomentFidelityRow


def load_session_by_hash(db: SASession, cc_session_id: str) -> Optional[JournalSession]:
    """Return the most-recently created session matching the given CC session hash."""
    stmt = (
        select(JournalSession)
        .where(JournalSession.source_hash == cc_session_id)
        .order_by(JournalSession.created_at.desc())
        .limit(1)
    )
    return db.execute(stmt).scalar_one_or_none()


def load_moment_rows(db: SASession, session_id: str) -> list[MomentFidelityRow]:
    """Load moments + evidence for a session, assembled into MomentFidelityRow objects."""
    # Load moments with their chunk_index via a join
    moment_stmt = select(Moment, Chunk.chunk_index).outerjoin(
        Chunk, Moment.chunk_id == Chunk.id
    ).where(Moment.session_id == session_id)
    moment_rows = db.execute(moment_stmt).all()

    # Load all evidence for this session's moments
    moment_ids = [row[0].id for row in moment_rows]
    evidence_stmt = select(MomentEvidence).where(MomentEvidence.moment_id.in_(moment_ids))
    all_evidence = db.execute(evidence_stmt).scalars().all()

    # Group evidence by moment_id
    evidence_by_moment: dict[str, list[MomentEvidence]] = {}
    for ev in all_evidence:
        evidence_by_moment.setdefault(ev.moment_id, []).append(ev)

    result: list[MomentFidelityRow] = []
    for moment, chunk_index in moment_rows:
        ev_list = evidence_by_moment.get(moment.id, [])
        result.append(MomentFidelityRow(
            statement=moment.statement,
            type=moment.type,
            agency=moment.agency,
            confidence=moment.confidence,
            chunk_index=chunk_index,
            occurred_at=moment.occurred_at,
            evidence_quotes=[e.quote for e in ev_list],
            anchored_evidence_count=sum(1 for e in ev_list if e.source_event_id is not None),
        ))

    return result


def load_narrative_text(db: SASession, session_id: str) -> str:
    """Load narrative for a session and concatenate summary + progression + discoveries."""
    stmt = select(Narrative).where(Narrative.session_id == session_id).limit(1)
    narr = db.execute(stmt).scalar_one_or_none()
    if narr is None:
        return ""

    parts = [narr.summary]
    if narr.progression:
        parts.extend(narr.progression)
    if narr.discoveries:
        parts.extend(narr.discoveries)
    return " ".join(parts)


def load_transition_confidence_values(db: SASession, session_id: str) -> list[Optional[str]]:
    """Load confidence values from transitions for a session."""
    stmt = select(Transition.confidence).where(Transition.session_id == session_id)
    return list(db.execute(stmt).scalars().all())


def load_outcome_confidence_values(db: SASession, session_id: str) -> list[Optional[str]]:
    """Load confidence values from outcomes for a session."""
    stmt = select(Outcome.confidence).where(Outcome.session_id == session_id)
    return list(db.execute(stmt).scalars().all())


def raw_last_event_at(log_path: pathlib.Path) -> Optional[datetime]:
    """Read the last non-system event timestamp from a raw CC session JSONL file.

    Mirrors the TS rawLastEventAt() in run-fidelity.ts: scans from the end,
    skipping lines where type == 'system', and returns the timestamp of the
    first match.
    """
    try:
        lines = log_path.read_text(encoding="utf-8").strip().split("\n")
    except (OSError, IOError):
        return None

    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
            if d.get("timestamp") and d.get("type") != "system":
                ts_str = d["timestamp"]
                # Handle both "2026-07-03T23:12:29.066Z" and offset forms
                if ts_str.endswith("Z"):
                    ts_str = ts_str[:-1] + "+00:00"
                return datetime.fromisoformat(ts_str)
        except (json.JSONDecodeError, ValueError, KeyError):
            continue
    return None


def resolve_raw_log(
    raw_log_path: str,
    cc_session_id: str,
    repo_root: pathlib.Path,
) -> Optional[pathlib.Path]:
    """Resolve the raw session log: prefer .intent/raw-sessions/, fall back to ~/.claude/."""
    archive = repo_root / raw_log_path
    if archive.exists():
        return archive

    home = pathlib.Path.home()
    cc_path = home / ".claude" / "projects" / "-Users-giladkoch-dev-intent-ai" / f"{cc_session_id}.jsonl"
    if cc_path.exists():
        return cc_path

    return None
