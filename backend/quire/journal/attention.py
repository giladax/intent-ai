"""Attention state R/W — ported from journal/src/storage/attention-store.ts.

The TS version writes to the attention_state DB table. This Python version
also uses the same table via SQLAlchemy so MCP brain_attention still works.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

STALE_MS = 10 * 60 * 1000  # 10 minutes


def _is_stale(updated_at: datetime) -> bool:
    now_ms = datetime.now(timezone.utc).timestamp() * 1000
    updated_ms = updated_at.timestamp() * 1000
    return (now_ms - updated_ms) >= STALE_MS


def write_attention(state: dict[str, Any]) -> None:
    """Upsert the current attention state into the attention_state table."""
    from sqlalchemy import text
    from quire.db.engine import get_session

    with get_session() as sess:
        sess.execute(
            text(
                """
                INSERT INTO attention_state (id, state, updated_at)
                VALUES ('current', :state::jsonb, now())
                ON CONFLICT (id) DO UPDATE
                SET state = :state::jsonb, updated_at = now()
                """
            ),
            {"state": json.dumps(state)},
        )
        sess.commit()


def read_attention() -> dict | None:
    """Read the current attention state. Returns None when absent or empty."""
    from sqlalchemy import text
    from quire.db.engine import get_session

    with get_session() as sess:
        row = sess.execute(
            text("SELECT state, updated_at FROM attention_state WHERE id = 'current'")
        ).fetchone()

    if row is None:
        return None

    state = row[0] if isinstance(row[0], dict) else (json.loads(row[0]) if row[0] else {})
    if not state or len(state) == 0:
        return None

    updated_at_raw = row[1]
    if isinstance(updated_at_raw, str):
        updated_at = datetime.fromisoformat(updated_at_raw.replace("Z", "+00:00"))
    elif isinstance(updated_at_raw, datetime):
        updated_at = updated_at_raw.astimezone(timezone.utc)
    else:
        updated_at = datetime.now(timezone.utc)

    return {
        "state": state,
        "stale": _is_stale(updated_at),
        "updatedAt": updated_at.isoformat(),
    }
