"""Analyze normalized events to produce PipelineDirectives.

Port of the DETERMINISTIC parts of journal/src/pipeline/analyze.ts.

The TS pipeline uses Haiku to classify exchanges (classifyExchanges). In the
dry-run path, analyzeInteractions is called WITHOUT await, so the Promise is
never resolved — the Directives block crashes in the TS dry-run output.

The Python port implements the STRUCTURAL analysis (buildExchanges + the
structural defaults used in dry-run) as a pure synchronous function. This
matches what the TS code *would* compute if the await were present and no
LLM call was made (i.e., using only the structural defaults populated in
buildExchanges, with the Haiku-side fields zeroed).

For parity with the dry-run corpus: the Python CLI prints the correct
Directives values (not the crashed TS output). The parity harness skips
Directives comparison per the corpus README.
"""

from __future__ import annotations

from .models import (
    NormalizedDevEvent,
    TurnExchange,
    PipelineDirectives,
    PromptSections,
    ExchangeSummary,
)


def analyze_interactions(events: list[NormalizedDevEvent]) -> PipelineDirectives:
    """Structural exchange analysis — no LLM calls.

    Builds TurnExchanges from intent events and computes directives using only
    the structural signals available without LLM classification (question mark
    detection, passive acceptance via short responses, etc.).
    """
    exchanges = _build_exchanges(events)

    if not exchanges:
        return _empty_directives()

    return _compute_directives_structural(exchanges)


def _build_exchanges(events: list[NormalizedDevEvent]) -> list[TurnExchange]:
    """Pair each intent event with all following events until the next intent."""
    exchanges: list[TurnExchange] = []
    intent_indices = [i for i, e in enumerate(events) if e.category == "intent"]

    for k, dev_idx in enumerate(intent_indices):
        dev_event = events[dev_idx]
        next_intent_idx = intent_indices[k + 1] if k + 1 < len(intent_indices) else len(events)
        ai_turn_events = events[dev_idx + 1:next_intent_idx]
        dev_detail = dev_event.content.detail

        exchanges.append(TurnExchange(
            dev_event=dev_event,
            ai_turn_events=ai_turn_events,
            dev_response_chars=len(dev_detail),
            dev_asked_question="?" in dev_detail,
            dev_used_reasoning=False,         # Haiku determines this
            dev_introduced_new_topic=False,   # Haiku determines this
            ai_proposed_multiple_options=False,  # Haiku determines this
            dev_responded_to_all_options=False,
        ))

    return exchanges


def _compute_directives_structural(exchanges: list[TurnExchange]) -> PipelineDirectives:
    """Compute directives using only structural signals (no LLM classification).

    This approximates what the TS live pipeline would produce after Haiku
    classification, but uses only the structural defaults set in buildExchanges.
    For the dry-run parity check, Directives are not compared (per corpus README).
    """
    total = len(exchanges)
    question_count = sum(1 for ex in exchanges if ex.dev_asked_question)

    # Structural passive approximation: short user responses (< 100 chars)
    passive_count = sum(1 for ex in exchanges if ex.dev_response_chars < 100)

    return PipelineDirectives(
        prompt_sections=PromptSections(
            detect_passive_acceptance=passive_count / total >= 0.7,
            track_delegation=False,  # requires Haiku
            detect_ignored_proposals=False,  # requires Haiku
            is_learning_exchange=question_count > 0,
        ),
        exchange_summary=ExchangeSummary(
            total_exchanges=total,
            short_response_count=passive_count,
            question_count=question_count,
            reasoning_count=0,  # requires Haiku
            new_topic_count=0,  # requires Haiku
            ignored_proposals=[],
        ),
    )


def _empty_directives() -> PipelineDirectives:
    return PipelineDirectives(
        prompt_sections=PromptSections(
            detect_passive_acceptance=False,
            track_delegation=False,
            detect_ignored_proposals=False,
            is_learning_exchange=False,
        ),
        exchange_summary=ExchangeSummary(
            total_exchanges=0,
            short_response_count=0,
            question_count=0,
            reasoning_count=0,
            new_topic_count=0,
            ignored_proposals=[],
        ),
    )
