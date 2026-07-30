"""quire.ingest — deterministic ingestion pipeline (TS→Python port, Slice 3).

Public API:
    parse_transcript(path) -> list[RawDevEvent]
    normalize(events, session_id) -> list[NormalizedDevEvent]
    chunk_session(events, session_id, ...) -> list[SessionChunk]
    detect_sittings(events) -> list[Sitting]
    analyze_interactions(events) -> PipelineDirectives
"""

from .models import (
    RawDevEvent,
    NormalizedDevEvent,
    SessionChunk,
    Sitting,
    TurnExchange,
    PipelineDirectives,
)
from .transcript import parse_transcript
from .normalize import normalize
from .chunk import chunk_session
from .sittings import detect_sittings
from .analyze import analyze_interactions

__all__ = [
    "RawDevEvent",
    "NormalizedDevEvent",
    "SessionChunk",
    "Sitting",
    "TurnExchange",
    "PipelineDirectives",
    "parse_transcript",
    "normalize",
    "chunk_session",
    "detect_sittings",
    "analyze_interactions",
]
