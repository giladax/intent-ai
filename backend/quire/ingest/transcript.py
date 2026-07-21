"""Parse a Claude Code JSONL transcript into RawDevEvent[].

Port of journal/src/adapters/claude-code.ts — replicates exactly what
@constellos/claude-code-kit's parseTranscript + the TS adapter produce,
without depending on the kit itself.

Mapping (after kit schema validation):
  - user message with string content             → conversation_turn (1 event)
  - user message with array of tool_result       → tool_result (1 per valid block)
  - assistant text blocks                        → ai_response (1 per block)
  - assistant tool_use blocks                    → tool_call (1 per block)
  - thinking blocks, system/progress/queue-op    → skipped

## Kit schema filtering (replicated here for parity)

The kit's `UserMessageSchema` validates every user message with Zod. Lenient
mode silently drops lines that fail. We replicate the relevant filters:

1. `toolUseResult` must be a dict (object) if present — messages with
   `toolUseResult: <string>` (error results) fail the schema and are dropped.
   These correspond to `is_error: true` tool results in the content array.

2. User content must be either:
   - a string → conversation_turn
   - an array of ToolResultItem → one event per item
   Content that is an array of `text` blocks is not valid per `UserContentSchema`
   and is dropped.

3. `ToolResultItemSchema.content` must be `TextContent[]` or `string`. Inner
   blocks of type `tool_reference` (or other non-text types) cause the item to
   fail the discriminated union, so the entire user message is dropped.
   We replicate this by skipping tool_result blocks whose inner content is
   an array of non-text blocks.

Note: the kit uses Zod discriminated union on `type` for AssistantContent, so
only `text`, `tool_use`, and `thinking` blocks survive — same as the TS adapter.
"""

from __future__ import annotations

import json
import pathlib
from typing import Any

from .models import RawDevEvent


def parse_transcript(path: pathlib.Path | str) -> list[RawDevEvent]:
    """Parse a Claude Code .jsonl log file into RawDevEvent[].

    Invariants (matching TS + kit behavior):
    - `id` is copied verbatim from the log UUID or derived as
      `<uuid>-result-<i>` / `<uuid>-text-<i>` / `<uuid>-tool-<i>`.
    - `raw` is the original parsed JSON object, never mutated.
    - Messages that fail kit schema validation are silently skipped.
    """
    path = pathlib.Path(path)
    events: list[RawDevEvent] = []

    for line in path.read_text(errors="ignore").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj: dict[str, Any] = json.loads(line)
        except json.JSONDecodeError:
            continue

        msg_type = obj.get("type")

        # Only "user" and "assistant" entries carry conversation content.
        if msg_type not in ("user", "assistant"):
            continue

        # Kit filter 1: userType must be "external" (implicit in UserMessageSchema)
        if msg_type == "user" and obj.get("userType") != "external":
            continue

        # Kit filter 2: toolUseResult must be a dict (Record<string, unknown>) if present.
        # (toolUseResult: z3.record(z3.unknown()).optional())
        # A string, list, or any non-dict value fails the schema → drop the message.
        if msg_type == "user":
            tur = obj.get("toolUseResult")
            if tur is not None and not isinstance(tur, dict):
                continue  # string, list, or other non-dict → schema failure → drop

        uuid: str = obj.get("uuid", "")
        timestamp: str = obj.get("timestamp", "")
        message: dict[str, Any] = obj.get("message") or {}
        base = {
            "source": "claude-code",
            "timestamp": timestamp,
            "raw": obj,
        }

        if msg_type == "user":
            content = message.get("content")

            if isinstance(content, str):
                # String content → single conversation_turn (matches UserContentSchema)
                events.append(RawDevEvent(
                    id=uuid,
                    type="conversation_turn",
                    **base,
                ))
                continue

            if isinstance(content, list):
                # Kit filter 3: UserContentSchema = string | ToolResultItem[]
                # Arrays of text blocks are NOT valid (not a ToolResultItem).
                # If content has text blocks (not tool_result), skip this message.
                has_tool_result = any(
                    isinstance(b, dict) and b.get("type") == "tool_result"
                    for b in content
                )
                if not has_tool_result:
                    # All non-tool_result arrays are invalid per kit schema → drop
                    continue

                # Emit one tool_result per valid tool_result block.
                # Kit filter 4: ToolResultItemSchema requires tool_use_id (string) and
                # content: TextContent[] | string. Blocks with non-text inner content
                # (e.g. tool_reference) fail the ToolResultItemSchema discriminated union,
                # causing the entire user message to be dropped.
                # We replicate by checking validity per block:
                valid_blocks = _filter_valid_tool_result_blocks(content)
                if not valid_blocks:
                    # No valid tool_result blocks → whole message failed schema → drop
                    # (This matches the kit behavior for tool_reference-only messages)
                    continue

                for i, _block in valid_blocks:
                    events.append(RawDevEvent(
                        id=f"{uuid}-result-{i}",
                        type="tool_result",
                        **base,
                    ))
            # (any other user content shape is skipped)
            continue

        if msg_type == "assistant":
            # Kit filter: AssistantMessageSchema requires requestId (string)
            if not isinstance(obj.get("requestId"), str):
                continue  # synthetic/stub messages without requestId → drop

            content = message.get("content")
            if not isinstance(content, list):
                continue

            for i, block in enumerate(content):
                if not isinstance(block, dict):
                    continue
                bt = block.get("type")
                if bt == "text":
                    events.append(RawDevEvent(
                        id=f"{uuid}-text-{i}",
                        type="ai_response",
                        **base,
                    ))
                elif bt == "tool_use":
                    events.append(RawDevEvent(
                        id=f"{uuid}-tool-{i}",
                        type="tool_call",
                        **base,
                    ))
                # "thinking" blocks are skipped (kit AssistantContentSchema)

    return events


def _filter_valid_tool_result_blocks(
    content: list[Any],
) -> list[tuple[int, dict]]:
    """Return (index, block) pairs for tool_result blocks that pass ToolResultItemSchema.

    ToolResultItemSchema requires:
    - type: "tool_result"
    - tool_use_id: string
    - content: TextContent[] | string

    A block whose inner `content` is an array of non-text items (e.g. tool_reference)
    fails the schema, causing the entire user message to be dropped by the kit.
    We replicate this: if ANY block fails, the entire message is invalid.
    Return empty list to signal message-level failure.
    """
    result: list[tuple[int, dict]] = []

    for i, block in enumerate(content):
        if not isinstance(block, dict):
            continue
        if block.get("type") != "tool_result":
            continue

        # Must have tool_use_id (string)
        tuid = block.get("tool_use_id")
        if not isinstance(tuid, str):
            return []  # Schema failure → drop entire message

        # Inner content must be string or TextContent[]
        inner = block.get("content")
        if inner is None:
            # Missing content — treat as empty string (valid)
            result.append((i, block))
            continue

        if isinstance(inner, str):
            result.append((i, block))
            continue

        if isinstance(inner, list):
            # Must be TextContent[] — each block: {type: "text", text: string}
            all_text = all(
                isinstance(b, dict) and b.get("type") == "text" and isinstance(b.get("text"), str)
                for b in inner
            )
            if not all_text:
                return []  # Non-text inner content → schema failure → drop entire message
            result.append((i, block))
            continue

        # Unknown inner content type → schema failure
        return []

    return result
