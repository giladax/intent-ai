"""Split a session's normalized events into bounded reasoning windows (chunks).

Port of journal/src/pipeline/chunk.ts — exact algorithmic equivalence with the
DETERMINISTIC path (no LLM calls). In the TS pipeline, topic-shift detection
uses Haiku; the dry-run path calls chunkSession with an empty topicShiftEventIds
set, so the Python port's default is also an empty set.

Constants (must match TS exactly):
    PAUSE_THRESHOLD_MS = 5 * 60 * 1000   (5 minutes)
    FILE_SHIFT_THRESHOLD = 0.7            (70% new files)
    MIN_PREVIOUS_FILES = 3
    MIN_CURRENT_FILES = 1
    MIN_CHUNK_SIZE = 8
    SIZE_CAP = 80
    OVERLAP = 3
    SHORT_SESSION_THRESHOLD = 10
"""

from __future__ import annotations

import re
from typing import Optional

from .models import NormalizedDevEvent, SessionChunk
from .sittings import _parse_ts

# ── Constants (must match TS chunk.ts exactly) ────────────────────────
PAUSE_THRESHOLD_MS = 5 * 60 * 1000   # 5 minutes
FILE_SHIFT_THRESHOLD = 0.7            # 70% new files trigger a cluster shift
MIN_PREVIOUS_FILES = 3
MIN_CURRENT_FILES = 1
MIN_CHUNK_SIZE = 8
SIZE_CAP = 80
OVERLAP = 3
SHORT_SESSION_THRESHOLD = 10

# Files outside the project are ignored for file-cluster shift detection
_IGNORED_FILE_PATTERNS = [
    re.compile(r"/\.claude/"),
    re.compile(r"/node_modules/"),
    re.compile(r"^/tmp/"),
    re.compile(r"^/private/tmp/"),
]


# ── Public entry point ────────────────────────────────────────────────

def chunk_session(
    events: list[NormalizedDevEvent],
    session_id: str,
    topic_shift_event_ids: Optional[set[str]] = None,
    hard_breaks: Optional[list[int]] = None,
) -> list[SessionChunk]:
    """Split events into bounded chunks.

    topic_shift_event_ids: set of normalized event IDs classified as explicit
        topic shifts (Haiku-classified in the live pipeline; empty set on dry-run).
    hard_breaks: causalOrder values that MUST start a new chunk (e.g. sitting
        boundaries). Applied after normal split detection, before tiny-chunk merging.
    """
    if topic_shift_event_ids is None:
        topic_shift_event_ids = set()
    if hard_breaks is None:
        hard_breaks = []

    if not events:
        return []

    hard_break_orders = set(hard_breaks)

    # Short sessions
    if len(events) < SHORT_SESSION_THRESHOLD:
        if not hard_break_orders:
            return [_build_chunk(events, session_id, 0, [])]
        # Short session with hard breaks: only apply hard-break splits
        split_indices = [
            i for i in range(1, len(events))
            if events[i].causal_order in hard_break_orders
        ]
        raw_chunks = _split_at_indices(events, split_indices)
        merged = _merge_tiny_chunks(raw_chunks, hard_break_orders)
        capped = [c for chunk in merged for c in _apply_size_cap(chunk)]
        return _build_chunks_with_overlap(capped, session_id)

    # Normal path: find split points
    split_indices = _find_split_points(events, topic_shift_event_ids)

    # Apply hard breaks
    if hard_break_orders:
        existing = set(split_indices)
        for i in range(1, len(events)):
            if events[i].causal_order in hard_break_orders and i not in existing:
                split_indices.append(i)
        split_indices.sort()

    raw_chunks = _split_at_indices(events, split_indices)
    merged = _merge_tiny_chunks(raw_chunks, hard_break_orders)
    capped = [c for chunk in merged for c in _apply_size_cap(chunk)]
    return _build_chunks_with_overlap(capped, session_id)


# ── Split point detection ─────────────────────────────────────────────

def _find_split_points(
    events: list[NormalizedDevEvent],
    topic_shift_event_ids: set[str],
) -> list[int]:
    splits: list[int] = []
    last_split = 0

    for i in range(1, len(events)):
        if i - last_split < MIN_CHUNK_SIZE:
            continue

        # Priority 1: Large pause (> 5 min)
        gap = _timestamp_gap_ms(events[i - 1].timestamp, events[i].timestamp)
        if gap is not None and gap > PAUSE_THRESHOLD_MS:
            splits.append(i)
            last_split = i
            continue

        # Priority 2: File cluster shift
        if _has_file_cluster_shift(events, i):
            splits.append(i)
            last_split = i
            continue

        # Priority 3: Explicit topic shift (Haiku-classified)
        if _has_topic_shift(events[i], topic_shift_event_ids):
            splits.append(i)
            last_split = i

    return splits


def _timestamp_gap_ms(ts1: str, ts2: str) -> Optional[int]:
    ms1 = _parse_ts(ts1, None)
    ms2 = _parse_ts(ts2, None)
    if ms1 is None or ms2 is None:
        return None
    return ms2 - ms1


def _has_file_cluster_shift(events: list[NormalizedDevEvent], index: int) -> bool:
    LOOKAHEAD = 5
    LOOKBACK = 15

    forward_end = min(len(events), index + LOOKAHEAD)
    forward_files: set[str] = set()
    for j in range(index, forward_end):
        for f in _get_project_files(events[j]):
            forward_files.add(f)
    if len(forward_files) < MIN_CURRENT_FILES:
        return False

    lookback_start = max(0, index - LOOKBACK)
    previous_files: set[str] = set()
    for j in range(lookback_start, index):
        for f in _get_project_files(events[j]):
            previous_files.add(f)

    if len(previous_files) < MIN_PREVIOUS_FILES:
        return False

    forward_arr = list(forward_files)
    new_files = [f for f in forward_arr if f not in previous_files]
    return len(new_files) / len(forward_arr) > FILE_SHIFT_THRESHOLD


def _has_topic_shift(event: NormalizedDevEvent, topic_shift_event_ids: set[str]) -> bool:
    if event.category != "intent":
        return False
    return event.id in topic_shift_event_ids


# ── Merge tiny chunks ─────────────────────────────────────────────────

def _merge_tiny_chunks(
    chunks: list[list[NormalizedDevEvent]],
    hard_break_orders: set[int],
) -> list[list[NormalizedDevEvent]]:
    if len(chunks) <= 1:
        return chunks

    def starts_at_hard_break(chunk: list[NormalizedDevEvent]) -> bool:
        return bool(chunk) and chunk[0].causal_order in hard_break_orders

    result = [chunks[0]]

    for i in range(1, len(chunks)):
        is_hard_break_chunk = starts_at_hard_break(chunks[i])

        if len(chunks[i]) < MIN_CHUNK_SIZE and not is_hard_break_chunk:
            # Backward merge (safe: no hard break here)
            result[-1] = result[-1] + chunks[i]
        else:
            result.append(chunks[i])

    # If the first chunk is tiny and does NOT protect a hard-break, merge forward
    if (len(result) > 1
            and len(result[0]) < MIN_CHUNK_SIZE
            and not starts_at_hard_break(result[1])):
        result[1] = result[0] + result[1]
        result.pop(0)

    return result


# ── Size cap ──────────────────────────────────────────────────────────

def _apply_size_cap(events: list[NormalizedDevEvent]) -> list[list[NormalizedDevEvent]]:
    if len(events) <= SIZE_CAP:
        return [events]

    result: list[list[NormalizedDevEvent]] = []
    start = 0

    while start < len(events):
        remaining = len(events) - start
        if remaining <= SIZE_CAP:
            result.append(events[start:])
            break

        target = start + SIZE_CAP
        split_at = _find_natural_boundary(events, target)
        result.append(events[start:split_at])
        start = split_at

    return result


def _find_natural_boundary(events: list[NormalizedDevEvent], target: int) -> int:
    search_radius = 10
    lo = max(1, target - search_radius)
    hi = min(len(events), target + search_radius)

    # Prefer: after tool_result
    for i in range(target, lo - 1, -1):
        if events[i - 1].category == "result":
            return i
    for i in range(target + 1, hi):
        if events[i - 1].category == "result":
            return i

    # Fallback: before conversation_turn
    for i in range(target, lo - 1, -1):
        if events[i].category == "intent":
            return i
    for i in range(target + 1, hi):
        if events[i].category == "intent":
            return i

    return min(target, len(events))


# ── Chunk building ────────────────────────────────────────────────────

def _split_at_indices(
    events: list[NormalizedDevEvent],
    indices: list[int],
) -> list[list[NormalizedDevEvent]]:
    if not indices:
        return [events]

    chunks: list[list[NormalizedDevEvent]] = []
    start = 0
    for idx in indices:
        if idx > start:
            chunks.append(events[start:idx])
        start = idx
    if start < len(events):
        chunks.append(events[start:])
    return chunks


def _build_chunks_with_overlap(
    raw_chunks: list[list[NormalizedDevEvent]],
    session_id: str,
) -> list[SessionChunk]:
    result: list[SessionChunk] = []
    for i, owned_events in enumerate(raw_chunks):
        overlap_events = raw_chunks[i - 1][-OVERLAP:] if i > 0 else []
        result.append(_build_chunk(owned_events, session_id, i, overlap_events))
    return result


def _build_chunk(
    owned_events: list[NormalizedDevEvent],
    session_id: str,
    chunk_index: int,
    overlap_events: list[NormalizedDevEvent],
) -> SessionChunk:
    all_events = overlap_events + owned_events

    start_causal = owned_events[0].causal_order
    end_causal = owned_events[-1].causal_order

    return SessionChunk(
        id=f"{session_id}-chunk-{chunk_index}",
        session_id=session_id,
        chunk_index=chunk_index,
        events=all_events,
        topic_hint=_derive_topic_hint(owned_events),
        files_in_scope=_derive_files_in_scope(all_events),
        event_range=(start_causal, end_causal),
    )


# ── Topic hint & files ────────────────────────────────────────────────

def _derive_topic_hint(events: list[NormalizedDevEvent]) -> str:
    """Heuristic: most frequent file path, fallback to first user message."""
    freq: dict[str, int] = {}
    for event in events:
        for f in _get_files_affected(event):
            freq[f] = freq.get(f, 0) + 1

    if freq:
        return max(freq, key=lambda k: freq[k])

    user_event = next((e for e in events if e.category == "intent"), None)
    if user_event:
        return user_event.content.summary

    return "unknown"


def _derive_files_in_scope(events: list[NormalizedDevEvent]) -> list[str]:
    files: set[str] = set()
    for event in events:
        for f in _get_files_affected(event):
            files.add(f)
    return list(files)


def _get_files_affected(event: NormalizedDevEvent) -> list[str]:
    return event.content.files_affected or []


def _get_project_files(event: NormalizedDevEvent) -> list[str]:
    return [
        f for f in _get_files_affected(event)
        if not any(p.search(f) for p in _IGNORED_FILE_PATTERNS)
    ]
