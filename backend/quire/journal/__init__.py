"""quire.journal — Python-side journal writer utilities (Slice 6).

Public API:
    build_session_events(session_id, moments, transitions, outcomes, narrative, *, ...)
    emit_activity_events(events, *, db_session)
    get_git_context(source_path) -> dict
"""
from quire.journal.emit_events import build_session_events, emit_activity_events
from quire.journal.git_context import get_git_context

__all__ = ["build_session_events", "emit_activity_events", "get_git_context"]
