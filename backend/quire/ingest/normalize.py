"""Normalize RawDevEvent[] into NormalizedDevEvent[].

Port of journal/src/pipeline/normalize.ts — exact algorithmic equivalence.

Category assignment (deterministic, structural):
  - conversation_turn   → intent   (actor: user)
  - tool_result         → result   (actor: user)
  - tool_call           → action   if state-modifying tool else reflection  (actor: ai)
  - ai_response         → reflection if previous non-ai_response was tool_result
                        → proposal  otherwise  (actor: ai)

Content filtering: events with no extractable text are dropped (causal order
only increments for kept events, matching TS behavior).
"""

from __future__ import annotations

import json
import re
from typing import Optional

from .models import RawDevEvent, NormalizedDevEvent, NormalizedContent

# Tools that modify state → category = "action"
_STATE_MODIFYING_TOOLS = {"Edit", "Write", "Bash", "NotebookEdit"}

# File path keys to look for in tool input
_FILE_PATH_KEYS = ("file_path", "path", "filePath")


# ── Public entry point ────────────────────────────────────────────────

def normalize(events: list[RawDevEvent], session_id: str) -> list[NormalizedDevEvent]:
    """Normalize raw events → NormalizedDevEvent list.

    Pass 1: classify + extract content (drops empty events).
    Pass 2: assign respondingTo via turn-threading.
    """
    result: list[NormalizedDevEvent] = []
    causal_order = 0

    for i, event in enumerate(events):
        content = _extract_content(event)
        if content is None:
            continue  # Filter: no meaningful content

        category, actor = _classify(event, events, i)

        ne = NormalizedDevEvent(
            id=f"{session_id}-{causal_order}",
            sessionId=session_id,
            timestamp=event.timestamp,
            causalOrder=causal_order,
            category=category,
            actor=actor,
            content=content,
            rawEventId=event.id,
            turnId=_derive_turn_id(event.id),
        )
        result.append(ne)
        causal_order += 1

    # Pass 2: threading
    _assign_responding_to(result, events)

    return result


# ── Classification ────────────────────────────────────────────────────

def _classify(event: RawDevEvent, events: list[RawDevEvent], index: int):
    t = event.type

    if t == "conversation_turn":
        return "intent", "user"

    if t == "tool_result":
        return "result", "user"

    if t == "tool_call":
        if _is_state_modifying(event):
            return "action", "ai"
        return "reflection", "ai"

    if t == "ai_response":
        if _is_after_tool_result(events, index):
            return "reflection", "ai"
        return "proposal", "ai"

    return "reflection", "ai"  # fallback (shouldn't happen)


def _is_state_modifying(event: RawDevEvent) -> bool:
    tool_name = _get_tool_name(event)
    return tool_name is not None and tool_name in _STATE_MODIFYING_TOOLS


def _is_after_tool_result(events: list[RawDevEvent], index: int) -> bool:
    """An ai_response is 'reflection' if the nearest preceding non-ai_response event is a tool_result."""
    for j in range(index - 1, -1, -1):
        prev = events[j]
        if prev.type == "ai_response":
            continue  # skip sibling ai_response events
        return prev.type == "tool_result"
    return False


# ── Content extraction ────────────────────────────────────────────────

def _extract_content(event: RawDevEvent) -> Optional[NormalizedContent]:
    t = event.type

    if t == "conversation_turn":
        text = _get_user_text(event.raw)
        if not text:
            return None
        return NormalizedContent(
            summary=_truncate(text, 200),
            detail=text,
        )

    if t == "ai_response":
        text = _get_ai_text(event)
        if not text:
            return None
        return NormalizedContent(
            summary=_truncate(text, 200),
            detail=text,
        )

    if t == "tool_call":
        tool_name = _get_tool_name(event)
        if not tool_name:
            return None
        inp = _get_tool_input(event)
        file_path = _extract_file_path(inp)
        summary = f"Tool: {tool_name} on {file_path}" if file_path else f"Tool: {tool_name}"
        detail = json.dumps(inp) if inp else summary
        files_affected = [file_path] if file_path else None
        return NormalizedContent(
            summary=_truncate(summary, 200),
            detail=detail,
            filesAffected=files_affected,
        )

    if t == "tool_result":
        text = _get_tool_result_text(event.raw)
        if not text:
            return None
        return NormalizedContent(
            summary=_truncate(text, 200),
            detail=text,
        )

    return None


# ── Helpers ───────────────────────────────────────────────────────────

def _truncate(s: str, max_len: int) -> str:
    return s if len(s) <= max_len else s[:max_len]


def _get_user_text(raw: dict) -> Optional[str]:
    msg = raw.get("message") or {}
    content = msg.get("content")
    if not content:
        return None
    if isinstance(content, str):
        return content
    return None  # array content = tool_result blocks, not user text


def _get_ai_text(event: RawDevEvent) -> Optional[str]:
    msg = (event.raw.get("message") or {})
    content = msg.get("content")
    if not isinstance(content, list):
        return None

    # Find block index from event ID: "...-text-N"
    m = re.search(r"-text-(\d+)$", event.id)
    if m:
        idx = int(m.group(1))
        if idx < len(content):
            block = content[idx]
            if isinstance(block, dict) and block.get("type") == "text" and block.get("text"):
                return block["text"]

    # Fallback: first text block
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text" and block.get("text"):
            return block["text"]
    return None


def _get_tool_name(event: RawDevEvent) -> Optional[str]:
    msg = (event.raw.get("message") or {})
    content = msg.get("content")
    if not isinstance(content, list):
        return None

    m = re.search(r"-tool-(\d+)$", event.id)
    if m:
        idx = int(m.group(1))
        if idx < len(content):
            block = content[idx]
            if isinstance(block, dict) and block.get("type") == "tool_use" and block.get("name"):
                return block["name"]

    # Fallback: first tool_use block
    for block in content:
        if isinstance(block, dict) and block.get("type") == "tool_use" and block.get("name"):
            return block["name"]
    return None


def _get_tool_input(event: RawDevEvent) -> Optional[dict]:
    msg = (event.raw.get("message") or {})
    content = msg.get("content")
    if not isinstance(content, list):
        return None

    m = re.search(r"-tool-(\d+)$", event.id)
    if m:
        idx = int(m.group(1))
        if idx < len(content):
            block = content[idx]
            if isinstance(block, dict) and block.get("type") == "tool_use":
                return block.get("input") or {}

    for block in content:
        if isinstance(block, dict) and block.get("type") == "tool_use":
            return block.get("input") or {}
    return None


def _extract_file_path(inp: Optional[dict]) -> Optional[str]:
    if not inp:
        return None
    for key in _FILE_PATH_KEYS:
        val = inp.get(key)
        if isinstance(val, str):
            return val
    return None


def _get_tool_result_text(raw: dict) -> Optional[str]:
    msg = raw.get("message") or {}
    content = msg.get("content")

    if not content:
        return None

    if isinstance(content, str):
        return content

    if isinstance(content, list):
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_result":
                inner = block.get("content")
                if isinstance(inner, str):
                    return inner
                if isinstance(inner, list):
                    texts = []
                    for b in inner:
                        if isinstance(b, dict) and b.get("type") == "text" and b.get("text"):
                            texts.append(b["text"])
                    if texts:
                        return "\n".join(texts)
    return None


# ── Causal threading ──────────────────────────────────────────────────

def _derive_turn_id(raw_event_id: str) -> str:
    """Strip '-text-N', '-tool-N', '-result-N' suffixes to get the base UUID."""
    m = re.match(r"^(.+)-(text|tool|result)-\d+$", raw_event_id)
    if m:
        return m.group(1)
    return raw_event_id


def _get_tool_use_id_from_result(event: NormalizedDevEvent, raw_events: list[RawDevEvent]) -> Optional[str]:
    """Extract the tool_use_id from a tool_result event's raw data."""
    raw_event = next((r for r in raw_events if r.id == event.raw_event_id), None)
    if not raw_event:
        return None
    msg = raw_event.raw.get("message") or {}
    content = msg.get("content")
    if not isinstance(content, list):
        return None

    m = re.search(r"-result-(\d+)$", event.raw_event_id)
    if m:
        idx = int(m.group(1))
        if idx < len(content):
            block = content[idx]
            if isinstance(block, dict) and block.get("type") == "tool_result":
                return block.get("tool_use_id")

    # Fallback: first tool_result block
    for block in content:
        if isinstance(block, dict) and block.get("type") == "tool_result":
            return block.get("tool_use_id")
    return None


def _get_tool_use_id_from_call(event: NormalizedDevEvent, raw_events: list[RawDevEvent]) -> Optional[str]:
    """Extract the tool_use id from a tool_call event's raw data."""
    raw_event = next((r for r in raw_events if r.id == event.raw_event_id), None)
    if not raw_event:
        return None
    msg = raw_event.raw.get("message") or {}
    content = msg.get("content")
    if not isinstance(content, list):
        return None

    m = re.search(r"-tool-(\d+)$", event.raw_event_id)
    if m:
        idx = int(m.group(1))
        if idx < len(content):
            block = content[idx]
            if isinstance(block, dict) and block.get("type") == "tool_use":
                return block.get("id")
    return None


def _assign_responding_to(
    events: list[NormalizedDevEvent],
    raw_events: list[RawDevEvent],
) -> None:
    """Pass 2: assign respondingTo for each normalized event.

    Rules (matching TS):
    - First event: no respondingTo
    - tool_result: responds to matching tool_call (by tool_use_id)
    - AI event: responds to first event of most recent user turn
    - User conversation_turn: responds to last event of most recent AI turn
    """
    # Build map: tool_use_id → normalized event id for tool_call events
    tool_use_to_event_id: dict[str, str] = {}
    for event in events:
        if "-tool-" in event.raw_event_id:
            tool_use_id = _get_tool_use_id_from_call(event, raw_events)
            if tool_use_id:
                tool_use_to_event_id[tool_use_id] = event.id

    # Track first/last event per turn
    first_by_turn: dict[str, NormalizedDevEvent] = {}
    last_by_turn: dict[str, NormalizedDevEvent] = {}
    last_user_turn_id: Optional[str] = None
    last_ai_turn_id: Optional[str] = None

    for event in events:
        turn_id = event.turn_id
        # NOTE: real CC turn_ids are message UUIDs, which never start with
        # "u-"/"a-" — so these prefixes only match synthetic fixture ids, and
        # the branches they gate are dead on production sessions. Kept verbatim
        # from the TS source (parity-gated); do not assume threading is fully
        # wired for real logs on the strength of this.
        is_user_turn = turn_id.startswith("u-")
        is_ai_turn = turn_id.startswith("a-")

        if turn_id not in first_by_turn:
            first_by_turn[turn_id] = event
        last_by_turn[turn_id] = event

        if event.causal_order == 0:
            pass  # first event — no respondingTo
        elif "-result-" in event.raw_event_id:
            # tool_result → responds to matching tool_call
            tool_use_id = _get_tool_use_id_from_result(event, raw_events)
            if tool_use_id and tool_use_id in tool_use_to_event_id:
                event.responding_to = tool_use_to_event_id[tool_use_id]
        elif is_ai_turn:
            # AI event → responds to first event of most recent user turn
            if last_user_turn_id:
                first_user = first_by_turn.get(last_user_turn_id)
                if first_user:
                    event.responding_to = first_user.id
        elif is_user_turn and "-result-" not in event.raw_event_id:
            # User conversation_turn → responds to last event of most recent AI turn
            if last_ai_turn_id:
                last_ai = last_by_turn.get(last_ai_turn_id)
                if last_ai:
                    event.responding_to = last_ai.id

        if is_user_turn and last_user_turn_id != turn_id:
            last_user_turn_id = turn_id
        if is_ai_turn and last_ai_turn_id != turn_id:
            last_ai_turn_id = turn_id
