"""quire.understand — LLM understanding stage (moments → narrative).

TS→Python port (Slice 5b) of journal/src/pipeline/understand/** plus the
classify / topic-shift / transitions / narrative steps. Every model step is a
real structured-output LangChain call; deterministic post-processing lives
alongside it.

Public API:
    understand(llm, events, session_id, session_shape, directives, topic_shift_ids)
    classify_session(llm, events) -> str
    detect_topic_shifts(llm, events) -> set[str]
    analyze_interactions_live(llm, events) -> PipelineDirectives
    AnthropicUnderstandLLM / FakeUnderstandLLM
"""

from quire.understand.llm import AnthropicUnderstandLLM, FakeUnderstandLLM, UnderstandLLM
from quire.understand.models import (
    AcceptedOutcome,
    EvidenceAnchor,
    ExtractedMoment,
    IntentTransition,
    NarrativeArc,
    SessionMoment,
    SessionNarrative,
    UnderstandResult,
)
from quire.understand.pipeline import understand
from quire.understand.steps import (
    analyze_interactions_live,
    classify_session,
    detect_topic_shifts,
)

__all__ = [
    "understand",
    "classify_session",
    "detect_topic_shifts",
    "analyze_interactions_live",
    "AnthropicUnderstandLLM",
    "FakeUnderstandLLM",
    "UnderstandLLM",
    "AcceptedOutcome",
    "EvidenceAnchor",
    "ExtractedMoment",
    "IntentTransition",
    "NarrativeArc",
    "SessionMoment",
    "SessionNarrative",
    "UnderstandResult",
]
