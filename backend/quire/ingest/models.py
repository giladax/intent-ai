"""Pydantic models mirroring the TS interface contracts.

See: backend/evals/baselines/2026-07-21-ts-pipeline-contracts.md

Enum distinctions preserved from the contracts doc:
- SessionMoment.arcRole: "origin" | "escalation" | "turning_point" | "resolution"
- Pass2Moment.arcRole: "origin" | "development" | "turning_point" | "resolution"
- EvidenceAnchor.sourceType: "user" | "ai" | "tool_output"
- Evidence.sourceType: "human_message" | "ai_message" | "tool_output" | "tool_input"
"""

from __future__ import annotations

from typing import Any, Literal, Optional
from pydantic import BaseModel, Field


# ── 1. Ingestion boundary ─────────────────────────────────────────────

class RawDevEvent(BaseModel):
    """One log entry emitted by the Claude Code adapter."""

    id: str
    source: Literal["claude-code"] = "claude-code"
    timestamp: str  # ISO 8601
    type: Literal["conversation_turn", "tool_call", "tool_result", "ai_response"]
    raw: dict[str, Any]  # original log entry, preserved verbatim


# ── 2. Normalisation ──────────────────────────────────────────────────

class NormalizedContent(BaseModel):
    summary: str
    detail: str
    files_affected: Optional[list[str]] = Field(None, alias="filesAffected")

    model_config = {"populate_by_name": True}


class NormalizedDevEvent(BaseModel):
    id: str
    session_id: str = Field(alias="sessionId")
    timestamp: str  # ISO 8601, forwarded
    causal_order: int = Field(alias="causalOrder")
    category: Literal["intent", "proposal", "action", "result", "reflection"]
    actor: Literal["user", "ai"]
    content: NormalizedContent
    raw_event_id: str = Field(alias="rawEventId")
    responding_to: Optional[str] = Field(None, alias="respondingTo")
    turn_id: str = Field(alias="turnId")

    model_config = {"populate_by_name": True}


# ── 3. Turn exchange ──────────────────────────────────────────────────

class TurnExchange(BaseModel):
    dev_event: NormalizedDevEvent
    ai_turn_events: list[NormalizedDevEvent]
    dev_response_chars: int
    dev_asked_question: bool
    dev_used_reasoning: bool
    dev_introduced_new_topic: bool
    ai_proposed_multiple_options: bool
    dev_responded_to_all_options: bool


def build_exchanges(events: list[NormalizedDevEvent]) -> list[TurnExchange]:
    """Pair each intent event with all following events until the next intent.

    Shared by both the dry-run (ingest.analyze) and live (understand.steps)
    paths — the structural flags (reasoning/topic/options) default False here
    and are filled by Haiku classification on the live path only.
    """
    exchanges: list[TurnExchange] = []
    intent_indices = [i for i, e in enumerate(events) if e.category == "intent"]
    for k, dev_idx in enumerate(intent_indices):
        dev_event = events[dev_idx]
        next_intent_idx = (
            intent_indices[k + 1] if k + 1 < len(intent_indices) else len(events)
        )
        ai_turn_events = events[dev_idx + 1:next_intent_idx]
        dev_detail = dev_event.content.detail
        exchanges.append(TurnExchange(
            dev_event=dev_event,
            ai_turn_events=ai_turn_events,
            dev_response_chars=len(dev_detail),
            dev_asked_question="?" in dev_detail,
            dev_used_reasoning=False,
            dev_introduced_new_topic=False,
            ai_proposed_multiple_options=False,
            dev_responded_to_all_options=False,
        ))
    return exchanges


# ── 4. Pipeline directives ────────────────────────────────────────────

class PromptSections(BaseModel):
    detect_passive_acceptance: bool
    track_delegation: bool
    detect_ignored_proposals: bool
    is_learning_exchange: bool


class ExchangeSummary(BaseModel):
    total_exchanges: int
    short_response_count: int
    question_count: int
    reasoning_count: int
    new_topic_count: int
    ignored_proposals: list[str]


class PipelineDirectives(BaseModel):
    prompt_sections: PromptSections
    exchange_summary: ExchangeSummary


# ── 5. Chunking ───────────────────────────────────────────────────────

class SessionChunk(BaseModel):
    id: str
    session_id: str
    chunk_index: int
    events: list[NormalizedDevEvent]  # includes overlap
    topic_hint: str
    files_in_scope: list[str]
    event_range: tuple[int, int]  # [startCausalOrder, endCausalOrder], inclusive


# ── 7. Sitting detection ──────────────────────────────────────────────

class Sitting(BaseModel):
    sitting_index: int
    started_at: str   # ISO 8601
    ended_at: str     # ISO 8601
    event_range: tuple[int, int]  # [startCausalOrder, endCausalOrder], inclusive
