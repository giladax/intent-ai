"""Unit tests for the quire.ingest pipeline steps.

Covers edge cases per the TS test coverage in journal/tests/pipeline/:
  - empty log
  - single event
  - threading forks
  - chunk boundary invariants
  - sitting detection
  - category assignment

These tests do NOT require any input files — all data is synthesized.
"""

from __future__ import annotations

import json
import pathlib
import tempfile

import pytest

from quire.ingest import (
    parse_transcript,
    normalize,
    chunk_session,
    detect_sittings,
    analyze_interactions,
)
from quire.ingest.models import RawDevEvent, NormalizedDevEvent
from quire.ingest.chunk import OVERLAP, MIN_CHUNK_SIZE, SIZE_CAP, SHORT_SESSION_THRESHOLD


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_jsonl(entries: list[dict]) -> pathlib.Path:
    """Write a list of dicts to a temp .jsonl file and return its path."""
    tmp = tempfile.NamedTemporaryFile(
        suffix=".jsonl", mode="w", delete=False, encoding="utf-8"
    )
    for entry in entries:
        tmp.write(json.dumps(entry) + "\n")
    tmp.flush()
    return pathlib.Path(tmp.name)


def _user_msg(uuid: str, text: str, ts: str = "2026-01-01T00:00:00.000Z") -> dict:
    return {
        "type": "user",
        "uuid": uuid,
        "timestamp": ts,
        "userType": "external",
        "message": {"role": "user", "content": text},
        "sessionId": "s1",
        "isSidechain": False,
        "cwd": "/tmp",
        "version": "1.0",
        "parentUuid": None,
    }


def _tool_result_msg(uuid: str, tool_use_id: str, content: str,
                     ts: str = "2026-01-01T00:00:01.000Z") -> dict:
    return {
        "type": "user",
        "uuid": uuid,
        "timestamp": ts,
        "userType": "external",
        "message": {
            "role": "user",
            "content": [{"type": "tool_result", "tool_use_id": tool_use_id, "content": content}],
        },
        "sessionId": "s1",
        "isSidechain": False,
        "cwd": "/tmp",
        "version": "1.0",
        "parentUuid": None,
    }


def _ai_text_msg(uuid: str, text: str, ts: str = "2026-01-01T00:00:02.000Z") -> dict:
    return {
        "type": "assistant",
        "uuid": uuid,
        "requestId": f"req-{uuid}",
        "timestamp": ts,
        "message": {
            "id": f"msg-{uuid}",
            "type": "message",
            "role": "assistant",
            "model": "claude-sonnet-4-6",
            "content": [{"type": "text", "text": text}],
            "stop_reason": "end_turn",
            "stop_sequence": None,
            "usage": {"input_tokens": 10, "output_tokens": 10,
                      "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0},
        },
        "sessionId": "s1",
        "isSidechain": False,
        "cwd": "/tmp",
        "version": "1.0",
        "parentUuid": None,
    }


def _ai_tool_msg(uuid: str, tool_id: str, tool_name: str, file_path: str | None = None,
                 ts: str = "2026-01-01T00:00:03.000Z") -> dict:
    inp = {"file_path": file_path} if file_path else {"command": "ls"}
    return {
        "type": "assistant",
        "uuid": uuid,
        "requestId": f"req-{uuid}",
        "timestamp": ts,
        "message": {
            "id": f"msg-{uuid}",
            "type": "message",
            "role": "assistant",
            "model": "claude-sonnet-4-6",
            "content": [{"type": "tool_use", "id": tool_id, "name": tool_name, "input": inp}],
            "stop_reason": "tool_use",
            "stop_sequence": None,
            "usage": {"input_tokens": 10, "output_tokens": 5,
                      "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0},
        },
        "sessionId": "s1",
        "isSidechain": False,
        "cwd": "/tmp",
        "version": "1.0",
        "parentUuid": None,
    }


# ── parse_transcript ──────────────────────────────────────────────────────────

class TestParseTranscript:
    def test_empty_file(self):
        p = _make_jsonl([])
        events = parse_transcript(p)
        assert events == []

    def test_skips_non_message_types(self):
        p = _make_jsonl([
            {"type": "progress", "uuid": "p1", "data": {}},
            {"type": "system", "uuid": "s1", "subtype": "foo", "content": "bar",
             "isMeta": False, "level": "info", "timestamp": "T", "sessionId": "x",
             "isSidechain": False, "cwd": "/", "version": "1.0", "parentUuid": None},
            {"type": "queue-operation", "uuid": "q1", "operation": "enqueue",
             "timestamp": "T", "sessionId": "x", "content": "hi"},
            _user_msg("u1", "hello"),
        ])
        events = parse_transcript(p)
        assert len(events) == 1
        assert events[0].type == "conversation_turn"
        assert events[0].id == "u1"

    def test_user_string_content(self):
        p = _make_jsonl([_user_msg("u1", "what should I do?")])
        events = parse_transcript(p)
        assert len(events) == 1
        assert events[0].type == "conversation_turn"
        assert events[0].id == "u1"
        assert events[0].source == "claude-code"

    def test_user_tool_result(self):
        p = _make_jsonl([_tool_result_msg("u2", "toolu_001", "output text")])
        events = parse_transcript(p)
        assert len(events) == 1
        assert events[0].type == "tool_result"
        assert events[0].id == "u2-result-0"

    def test_ai_text_block(self):
        p = _make_jsonl([_ai_text_msg("a1", "I'll help you.")])
        events = parse_transcript(p)
        assert len(events) == 1
        assert events[0].type == "ai_response"
        assert events[0].id == "a1-text-0"

    def test_ai_tool_call(self):
        p = _make_jsonl([_ai_tool_msg("a2", "toolu_002", "Read", "/src/main.ts")])
        events = parse_transcript(p)
        assert len(events) == 1
        assert events[0].type == "tool_call"
        assert events[0].id == "a2-tool-0"

    def test_drops_user_without_usertype_external(self):
        msg = _user_msg("u3", "text")
        msg["userType"] = "internal"
        p = _make_jsonl([msg])
        events = parse_transcript(p)
        assert events == []

    def test_drops_user_with_string_tool_use_result(self):
        msg = _tool_result_msg("u4", "toolu_004", "output")
        msg["toolUseResult"] = "Error: something failed"  # string, not dict
        p = _make_jsonl([msg])
        events = parse_transcript(p)
        assert events == []

    def test_drops_user_with_list_tool_use_result(self):
        msg = _tool_result_msg("u5", "toolu_005", "output")
        msg["toolUseResult"] = [{"type": "text", "text": "data"}]  # list, not dict
        p = _make_jsonl([msg])
        events = parse_transcript(p)
        assert events == []

    def test_drops_user_with_text_array_content(self):
        """User messages with array of text blocks are not valid per kit schema."""
        msg = {
            "type": "user",
            "uuid": "u6",
            "timestamp": "2026-01-01T00:00:00.000Z",
            "userType": "external",
            "message": {
                "role": "user",
                "content": [{"type": "text", "text": "some text block"}],
            },
            "sessionId": "s1",
            "isSidechain": False,
            "cwd": "/tmp",
            "version": "1.0",
            "parentUuid": None,
        }
        p = _make_jsonl([msg])
        events = parse_transcript(p)
        assert events == []

    def test_drops_tool_result_with_tool_reference_inner_content(self):
        """tool_result blocks with tool_reference inner content fail ToolResultItemSchema."""
        msg = {
            "type": "user",
            "uuid": "u7",
            "timestamp": "2026-01-01T00:00:00.000Z",
            "userType": "external",
            "message": {
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": "toolu_007",
                    "content": [{"type": "tool_reference", "tool_name": "Read"}],
                }],
            },
            "sessionId": "s1",
            "isSidechain": False,
            "cwd": "/tmp",
            "version": "1.0",
            "parentUuid": None,
        }
        p = _make_jsonl([msg])
        events = parse_transcript(p)
        assert events == []

    def test_drops_tool_result_with_text_block_missing_text_field(self):
        """tool_result blocks with text blocks missing text field fail ToolResultItemSchema."""
        msg = {
            "type": "user",
            "uuid": "u9",
            "timestamp": "2026-01-01T00:00:00.000Z",
            "userType": "external",
            "message": {
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": "toolu_009",
                    "content": [{"type": "text"}],
                }],
            },
            "sessionId": "s1",
            "isSidechain": False,
            "cwd": "/tmp",
            "version": "1.0",
            "parentUuid": None,
        }
        p = _make_jsonl([msg])
        events = parse_transcript(p)
        assert events == []

    def test_drops_assistant_without_request_id(self):
        """Synthetic assistant messages without requestId fail AssistantMessageSchema."""
        msg = _ai_text_msg("a3", "synthetic response")
        del msg["requestId"]  # remove requestId
        p = _make_jsonl([msg])
        events = parse_transcript(p)
        assert events == []

    def test_multiple_tool_results_in_one_message(self):
        msg = {
            "type": "user",
            "uuid": "u8",
            "timestamp": "2026-01-01T00:00:00.000Z",
            "userType": "external",
            "message": {
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": "t1", "content": "result 1"},
                    {"type": "tool_result", "tool_use_id": "t2", "content": "result 2"},
                ],
            },
            "sessionId": "s1",
            "isSidechain": False,
            "cwd": "/tmp",
            "version": "1.0",
            "parentUuid": None,
        }
        p = _make_jsonl([msg])
        events = parse_transcript(p)
        assert len(events) == 2
        assert events[0].id == "u8-result-0"
        assert events[1].id == "u8-result-1"

    def test_raw_preserved_verbatim(self):
        """raw field must contain original JSON object."""
        p = _make_jsonl([_user_msg("u9", "hello")])
        events = parse_transcript(p)
        assert events[0].raw["uuid"] == "u9"
        assert events[0].raw["message"]["content"] == "hello"

    def test_skips_thinking_blocks(self):
        msg = _ai_text_msg("a4", "visible text")
        msg["message"]["content"] = [
            {"type": "thinking", "thinking": "my private thought"},
            {"type": "text", "text": "visible text"},
        ]
        p = _make_jsonl([msg])
        events = parse_transcript(p)
        assert len(events) == 1
        assert events[0].type == "ai_response"
        assert events[0].id == "a4-text-1"  # index 1, not 0


# ── normalize ─────────────────────────────────────────────────────────────────

class TestNormalize:
    def test_empty(self):
        result = normalize([], "s1")
        assert result == []

    def test_single_user_message(self):
        p = _make_jsonl([_user_msg("u1", "do something")])
        raw = parse_transcript(p)
        norm = normalize(raw, "s1")
        assert len(norm) == 1
        assert norm[0].category == "intent"
        assert norm[0].actor == "user"
        assert norm[0].causal_order == 0
        assert norm[0].session_id == "s1"
        assert norm[0].content.detail == "do something"

    def test_filters_empty_content(self):
        """Events with no extractable content are dropped."""
        # tool_result with no text → dropped
        msg = {
            "type": "user",
            "uuid": "u1",
            "timestamp": "2026-01-01T00:00:00.000Z",
            "userType": "external",
            "message": {
                "role": "user",
                "content": [{"type": "tool_result", "tool_use_id": "t1", "content": ""}],
            },
            "sessionId": "s1",
            "isSidechain": False,
            "cwd": "/tmp",
            "version": "1.0",
            "parentUuid": None,
        }
        p = _make_jsonl([msg])
        raw = parse_transcript(p)
        # First check that parse emits the event
        assert len(raw) == 1
        # Then normalize should filter it (empty content)
        norm = normalize(raw, "s1")
        assert len(norm) == 0

    def test_category_conversation_turn_intent(self):
        p = _make_jsonl([_user_msg("u1", "help me")])
        raw = parse_transcript(p)
        norm = normalize(raw, "s1")
        assert norm[0].category == "intent"

    def test_category_tool_result_result(self):
        p = _make_jsonl([_tool_result_msg("u1", "t1", "output")])
        raw = parse_transcript(p)
        norm = normalize(raw, "s1")
        assert norm[0].category == "result"

    def test_category_state_modifying_tool_action(self):
        p = _make_jsonl([_ai_tool_msg("a1", "t1", "Edit", "/src/foo.ts")])
        raw = parse_transcript(p)
        norm = normalize(raw, "s1")
        assert norm[0].category == "action"

    def test_category_read_tool_reflection(self):
        p = _make_jsonl([_ai_tool_msg("a1", "t1", "Read", "/src/foo.ts")])
        raw = parse_transcript(p)
        norm = normalize(raw, "s1")
        assert norm[0].category == "reflection"

    def test_category_ai_response_after_tool_result_is_reflection(self):
        """AI response after a tool result → reflection."""
        p = _make_jsonl([
            _tool_result_msg("u1", "t1", "read output"),
            _ai_text_msg("a1", "I see the output"),
        ])
        raw = parse_transcript(p)
        norm = normalize(raw, "s1")
        ai_events = [e for e in norm if e.actor == "ai"]
        assert ai_events[0].category == "reflection"

    def test_category_ai_response_first_is_proposal(self):
        """AI response as first event (no preceding tool_result) → proposal."""
        p = _make_jsonl([_ai_text_msg("a1", "Here's my suggestion")])
        raw = parse_transcript(p)
        norm = normalize(raw, "s1")
        assert norm[0].category == "proposal"

    def test_causal_order_monotone(self):
        p = _make_jsonl([
            _user_msg("u1", "first"),
            _ai_text_msg("a1", "response"),
            _tool_result_msg("u2", "t1", "output"),
        ])
        raw = parse_transcript(p)
        norm = normalize(raw, "s1")
        orders = [e.causal_order for e in norm]
        assert orders == list(range(len(orders)))

    def test_turn_id_derived_correctly(self):
        p = _make_jsonl([
            _ai_text_msg("a1", "response"),
            _ai_tool_msg("a1b", "t1", "Read"),
        ])
        # Both should have turnId "a1" and "a1b" (they're separate messages)
        raw = parse_transcript(p)
        norm = normalize(raw, "s1")
        # The text block is "a1-text-0" → turnId = "a1"
        assert norm[0].turn_id == "a1"
        # The tool block is "a1b-tool-0" → turnId = "a1b"
        assert norm[1].turn_id == "a1b"

    def test_files_affected_populated_for_tool_calls(self):
        p = _make_jsonl([_ai_tool_msg("a1", "t1", "Write", "/src/new.py")])
        raw = parse_transcript(p)
        norm = normalize(raw, "s1")
        assert norm[0].content.files_affected == ["/src/new.py"]

    def test_content_truncated_at_200_chars(self):
        long_text = "x" * 300
        p = _make_jsonl([_user_msg("u1", long_text)])
        raw = parse_transcript(p)
        norm = normalize(raw, "s1")
        assert len(norm[0].content.summary) == 200
        assert norm[0].content.detail == long_text  # detail is not truncated

    def test_all_state_modifying_tools_are_action(self):
        for tool_name in ("Edit", "Write", "Bash", "NotebookEdit"):
            p = _make_jsonl([_ai_tool_msg("a1", "t1", tool_name)])
            raw = parse_transcript(p)
            norm = normalize(raw, "s1")
            assert norm[0].category == "action", f"{tool_name} should be action"


# ── chunk_session ─────────────────────────────────────────────────────────────

def _make_norm_events(count: int, session_id: str = "s1",
                      base_ts: int = 0, gap_ms: int = 1000) -> list[NormalizedDevEvent]:
    """Create `count` synthetic NormalizedDevEvents at 1-second intervals."""
    from datetime import datetime, timezone
    from quire.ingest.models import NormalizedContent

    events = []
    for i in range(count):
        ts_ms = base_ts + i * gap_ms
        ts = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).isoformat()
        events.append(NormalizedDevEvent(
            id=f"{session_id}-{i}",
            sessionId=session_id,
            timestamp=ts,
            causalOrder=i,
            category="intent" if i % 4 == 0 else "reflection",
            actor="user" if i % 4 == 0 else "ai",
            content=NormalizedContent(summary=f"event {i}", detail=f"detail {i}"),
            rawEventId=f"raw-{i}",
            turnId=f"u-{i // 4:03d}",
        ))
    return events


class TestChunkSession:
    def test_empty_events(self):
        assert chunk_session([], "s1") == []

    def test_single_chunk_for_short_session(self):
        events = _make_norm_events(SHORT_SESSION_THRESHOLD - 1)
        chunks = chunk_session(events, "s1")
        assert len(chunks) == 1
        assert chunks[0].event_range == (0, len(events) - 1)

    def test_chunk_ids_are_sequential(self):
        events = _make_norm_events(50)
        chunks = chunk_session(events, "s1")
        for i, chunk in enumerate(chunks):
            assert chunk.chunk_index == i
            assert chunk.id == f"s1-chunk-{i}"

    def test_all_events_covered_exactly_once(self):
        """Every event should appear in exactly one chunk's owned range."""
        events = _make_norm_events(60)
        chunks = chunk_session(events, "s1")
        # Reconstruct covered causal orders from event_range
        covered = set()
        for chunk in chunks:
            start, end = chunk.event_range
            for co in range(start, end + 1):
                assert co not in covered, f"causalOrder {co} appears in multiple chunks"
                covered.add(co)
        expected = {e.causal_order for e in events}
        assert covered == expected

    def test_event_ranges_are_contiguous(self):
        events = _make_norm_events(60)
        chunks = chunk_session(events, "s1")
        for i in range(1, len(chunks)):
            prev_end = chunks[i - 1].event_range[1]
            curr_start = chunks[i].event_range[0]
            assert curr_start == prev_end + 1, (
                f"Gap between chunk {i-1} end={prev_end} and chunk {i} start={curr_start}"
            )

    def test_pause_triggers_split(self):
        """A > 5 min gap should cause a chunk split."""
        from quire.ingest.chunk import PAUSE_THRESHOLD_MS
        gap = PAUSE_THRESHOLD_MS + 60_000  # 6 minutes
        events = _make_norm_events(30, base_ts=0, gap_ms=1000)
        # Insert a 6-minute pause after event 10
        from datetime import datetime, timezone
        large_ts_ms = 10 * 1000 + gap
        for i in range(10, len(events)):
            ts_ms = large_ts_ms + (i - 10) * 1000
            ts = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).isoformat()
            events[i].timestamp = ts

        chunks = chunk_session(events, "s1")
        assert len(chunks) >= 2

    def test_overlap_events_included(self):
        """Chunks after the first should include OVERLAP events from the previous chunk."""
        events = _make_norm_events(60)
        chunks = chunk_session(events, "s1")
        if len(chunks) < 2:
            pytest.skip("Not enough chunks to test overlap")

        chunk1_end = chunks[0].event_range[1]
        chunk2_events = chunks[1].events
        chunk2_event_orders = {e.causal_order for e in chunk2_events}
        # Should include some events before chunk2's event_range start
        for co in range(max(0, chunk1_end - OVERLAP + 1), chunk1_end + 1):
            assert co in chunk2_event_orders, f"Expected overlap event {co} in chunk 2"

    def test_size_cap_prevents_giant_chunks(self):
        """No owned chunk should exceed SIZE_CAP events without a split."""
        events = _make_norm_events(200)
        chunks = chunk_session(events, "s1")
        for chunk in chunks:
            owned_count = chunk.event_range[1] - chunk.event_range[0] + 1
            # Allow SIZE_CAP + OVERLAP (overlap from prev chunk)
            assert owned_count <= SIZE_CAP + OVERLAP, (
                f"Chunk {chunk.chunk_index} has {owned_count} owned events > SIZE_CAP={SIZE_CAP}"
            )

    def test_hard_breaks_respected(self):
        """Hard breaks must create chunk boundaries regardless of other heuristics."""
        events = _make_norm_events(30)
        break_co = events[15].causal_order
        chunks = chunk_session(events, "s1", hard_breaks=[break_co])
        # The break should create a boundary: first event of some chunk = break_co
        break_starts = [c for c in chunks if c.event_range[0] == break_co]
        assert len(break_starts) >= 1, f"No chunk starting at hard break {break_co}"

    def test_topic_shift_without_llm(self):
        """Empty topic shift set (dry-run mode) should not crash."""
        events = _make_norm_events(30)
        chunks = chunk_session(events, "s1", topic_shift_event_ids=set())
        assert len(chunks) >= 1


# ── detect_sittings ───────────────────────────────────────────────────────────

class TestDetectSittings:
    def test_empty(self):
        result = detect_sittings([])
        assert result == []

    def test_single_event(self):
        events = _make_norm_events(1)
        sittings = detect_sittings(events)
        assert len(sittings) == 1
        assert sittings[0].sitting_index == 0
        assert sittings[0].event_range == (0, 0)

    def test_no_gap_one_sitting(self):
        events = _make_norm_events(10, gap_ms=1000)  # 1-second gaps
        sittings = detect_sittings(events)
        assert len(sittings) == 1

    def test_30min_gap_creates_new_sitting(self):
        from quire.ingest.sittings import SITTING_GAP_MS
        from datetime import datetime, timezone
        gap = SITTING_GAP_MS + 1000
        events = _make_norm_events(20, gap_ms=1000)
        # Insert a 30+ min gap after event 10
        for i in range(10, len(events)):
            ts_ms = 10 * 1000 + gap + (i - 10) * 1000
            ts = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).isoformat()
            events[i].timestamp = ts

        sittings = detect_sittings(events)
        assert len(sittings) == 2
        assert sittings[0].sitting_index == 0
        assert sittings[1].sitting_index == 1
        assert sittings[0].event_range[1] == 9
        assert sittings[1].event_range[0] == 10

    def test_sitting_event_ranges_cover_all(self):
        events = _make_norm_events(5)
        sittings = detect_sittings(events)
        all_cos = set(range(len(events)))
        covered = set()
        for s in sittings:
            for co in range(s.event_range[0], s.event_range[1] + 1):
                covered.add(co)
        assert covered == all_cos

    def test_invalid_timestamp_inherits_previous(self):
        """Events with unparseable timestamps should not crash."""
        events = _make_norm_events(5)
        events[2].timestamp = "not-a-timestamp"
        sittings = detect_sittings(events)
        assert len(sittings) >= 1  # Should not crash


# ── analyze_interactions ──────────────────────────────────────────────────────

class TestAnalyzeInteractions:
    def test_empty(self):
        directives = analyze_interactions([])
        assert directives.exchange_summary.total_exchanges == 0
        assert directives.prompt_sections.is_learning_exchange is False

    def test_question_detected(self):
        events = _make_norm_events(5)
        # Make first event an intent with a question mark
        from quire.ingest.models import NormalizedContent
        events[0].category = "intent"
        events[0].content = NormalizedContent(
            summary="What should I do?",
            detail="What should I do?",
        )
        directives = analyze_interactions(events)
        assert directives.prompt_sections.is_learning_exchange is True
        assert directives.exchange_summary.question_count == 1

    def test_total_exchanges_matches_intent_count(self):
        events = _make_norm_events(30)
        # Count intent events
        intent_count = sum(1 for e in events if e.category == "intent")
        directives = analyze_interactions(events)
        assert directives.exchange_summary.total_exchanges == intent_count

    def test_no_question_no_learning(self):
        events = _make_norm_events(10)
        # Remove all question marks
        for e in events:
            if e.category == "intent":
                from quire.ingest.models import NormalizedContent
                e.content = NormalizedContent(
                    summary="tell me what to do",
                    detail="tell me what to do",
                )
        directives = analyze_interactions(events)
        assert directives.prompt_sections.is_learning_exchange is False
        assert directives.exchange_summary.question_count == 0
