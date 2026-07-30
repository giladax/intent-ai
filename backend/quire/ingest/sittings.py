"""Detect sittings (contiguous work sessions) from normalized events.

Port of journal/src/pipeline/understand/sittings.ts — exact algorithmic equivalence.

A "sitting" is a sequence of events with no idle gap >= 30 minutes.
Events with unparseable timestamps inherit the previous event's timestamp for gap
purposes (never crash).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from .models import NormalizedDevEvent, Sitting

SITTING_GAP_MS = 30 * 60 * 1000  # 30 minutes in milliseconds


def detect_sittings(events: list[NormalizedDevEvent]) -> list[Sitting]:
    """Segment events into sittings separated by idle gaps >= 30 minutes.

    Returns an empty list for empty input.
    """
    if not events:
        return []

    sorted_events = sorted(events, key=lambda e: e.causal_order)

    sittings: list[Sitting] = []
    sitting_index = 0
    sitting_start = sorted_events[0].causal_order
    sitting_start_ts = sorted_events[0].timestamp
    prev_ms = _parse_ts(sorted_events[0].timestamp, None)

    for i in range(1, len(sorted_events)):
        ev = sorted_events[i]
        ts_ms = _parse_ts(ev.timestamp, prev_ms)
        gap = (ts_ms - prev_ms) if (prev_ms is not None and ts_ms is not None) else 0

        if gap >= SITTING_GAP_MS:
            # Close current sitting
            sittings.append(Sitting(
                sitting_index=sitting_index,
                started_at=sitting_start_ts,
                ended_at=sorted_events[i - 1].timestamp,
                event_range=(sitting_start, sorted_events[i - 1].causal_order),
            ))
            sitting_index += 1
            sitting_start = ev.causal_order
            sitting_start_ts = ev.timestamp

        if ts_ms is not None:
            prev_ms = ts_ms

    # Close the last sitting
    sittings.append(Sitting(
        sitting_index=sitting_index,
        started_at=sitting_start_ts,
        ended_at=sorted_events[-1].timestamp,
        event_range=(sitting_start, sorted_events[-1].causal_order),
    ))

    return sittings


def _parse_ts(iso: str, fallback: Optional[int]) -> Optional[int]:
    """Parse an ISO 8601 timestamp to milliseconds since epoch.

    Returns `fallback` on parse failure (mirrors TS Date.parse semantics).
    """
    if not iso:
        return fallback
    try:
        # Handle trailing Z or +00:00
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return int(dt.timestamp() * 1000)
    except (ValueError, AttributeError):
        return fallback
