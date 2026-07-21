"""Tests for quire.journal.emit_events — offline, no DB, no LLM."""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from quire.journal.emit_events import build_session_events
from quire.understand.models import (
    AcceptedOutcome,
    IntentTransition,
    NarrativeArc,
    SessionMoment,
    SessionNarrative,
    EvidenceAnchor,
)

NOW = datetime(2026, 7, 22, 10, 0, 0, tzinfo=timezone.utc)
NOW_ISO = "2026-07-22T10:00:00Z"


def _moment(idx: int = 0) -> SessionMoment:
    return SessionMoment(
        id=f"moment-{idx}",
        chunk_id="sid-chunk-0",
        type="commitment",
        statement=f"decided to {idx}",
        significance="high",
        agency="developer",
        confidence="high",
        topic_fingerprint="general",
        related_moment_ids=[],
        arc_id="arc-1",
        arc_role="origin",
        evidence=[EvidenceAnchor(quote="the quote", event_index=0, anchored=True, source_type="user")],
        occurred_at=NOW_ISO,
        verification="supported",
    )


def _transition(idx: int = 0) -> IntentTransition:
    return IntentTransition(
        id=f"trans-{idx}",
        session_id="sess",
        from_statement="from here",
        to_statement="to there",
        reason="pivot needed",
        origin_moment_ids=["moment-0"],
        arc_id="arc-1",
        confidence="high",
    )


def _outcome(idx: int = 0) -> AcceptedOutcome:
    return AcceptedOutcome(
        id=f"outcome-{idx}",
        session_id="sess",
        statement="shipped feature",
        supporting_moment_ids=["moment-0"],
        supporting_files=["src/foo.py"],
        confidence="high",
    )


def _narrative() -> SessionNarrative:
    return SessionNarrative(
        session_id="sess",
        session_shape="narrative",
        summary="a productive session",
        progression=["started", "finished"],
        discoveries=["found a bug"],
        stabilized_directions=["keep refactoring"],
        abandoned_directions=["tried another approach"],
        arcs=[NarrativeArc(arc_id="arc-1", title="refactor", summary="arc summary", moment_ids=["moment-0"], resolution="resolved")],
    )


def test_build_session_events_returns_expected_count():
    """1 narrative + N moments + N transitions + N outcomes."""
    moments = [_moment(0), _moment(1)]
    transitions = [_transition(0)]
    outcomes = [_outcome(0)]
    narrative = _narrative()
    events = build_session_events(
        session_id="sess",
        moments=moments,
        transitions=transitions,
        outcomes=outcomes,
        narrative=narrative,
        repo="intent-ai",
        branch="feat/slice-6",
        worktree=None,
        session_ended_at=NOW,
    )
    # 1 (narrative) + 2 (moments) + 1 (transition) + 1 (outcome) = 5
    assert len(events) == 5


def test_narrative_event_category_is_session_shape():
    events = build_session_events(
        session_id="sess",
        moments=[],
        transitions=[],
        outcomes=[],
        narrative=_narrative(),
    )
    narrative_ev = next(e for e in events if e["source_type"] == "narrative")
    assert narrative_ev["category"] == "narrative"


def test_moment_event_actor_is_agency():
    events = build_session_events(
        session_id="sess",
        moments=[_moment(0)],
        transitions=[],
        outcomes=[],
        narrative=_narrative(),
    )
    moment_ev = next(e for e in events if e["source_type"] == "moment")
    assert moment_ev["actor"] == "developer"


def test_moment_event_summary_is_statement():
    events = build_session_events(
        session_id="sess",
        moments=[_moment(0)],
        transitions=[],
        outcomes=[],
        narrative=_narrative(),
    )
    moment_ev = next(e for e in events if e["source_type"] == "moment")
    assert moment_ev["summary"] == "decided to 0"


def test_transition_event_category_is_transition():
    events = build_session_events(
        session_id="sess",
        moments=[],
        transitions=[_transition(0)],
        outcomes=[],
        narrative=_narrative(),
    )
    tr_ev = next(e for e in events if e["source_type"] == "transition")
    assert tr_ev["category"] == "transition"
    assert "from here" in tr_ev["summary"]
    assert "to there" in tr_ev["summary"]


def test_outcome_event_files_carried():
    events = build_session_events(
        session_id="sess",
        moments=[],
        transitions=[],
        outcomes=[_outcome(0)],
        narrative=_narrative(),
    )
    out_ev = next(e for e in events if e["source_type"] == "outcome")
    assert "src/foo.py" in out_ev["files"]


def test_git_context_propagated():
    events = build_session_events(
        session_id="sess",
        moments=[_moment(0)],
        transitions=[],
        outcomes=[],
        narrative=_narrative(),
        repo="my-repo",
        branch="main",
        worktree="/path/to/worktree",
    )
    for ev in events:
        assert ev["repo"] == "my-repo"
        assert ev["branch"] == "main"
        assert ev["worktree"] == "/path/to/worktree"


def test_moment_tags_include_topic_fingerprint_and_significance():
    events = build_session_events(
        session_id="sess",
        moments=[_moment(0)],
        transitions=[],
        outcomes=[],
        narrative=_narrative(),
    )
    moment_ev = next(e for e in events if e["source_type"] == "moment")
    assert "general" in moment_ev["tags"]
    assert "high" in moment_ev["tags"]


def test_no_moments_no_transitions_no_outcomes_only_narrative():
    events = build_session_events(
        session_id="sess",
        moments=[],
        transitions=[],
        outcomes=[],
        narrative=_narrative(),
    )
    assert len(events) == 1
    assert events[0]["source_type"] == "narrative"


def test_get_git_context_returns_fallback_on_non_git_path():
    from quire.journal.git_context import get_git_context
    # /tmp is not a git repo
    ctx = get_git_context("/tmp/fake.jsonl")
    assert ctx.get("repo") is None
    assert ctx.get("branch") is None
    assert ctx.get("worktree") is None


# ── Watcher quiescence tests (fake clock, no sleeps) ──────────────────────────

def test_quiescence_check_false_when_file_recently_modified():
    """A file modified within the quiet window is NOT eligible."""
    from quire.journal.watcher import is_session_quiet
    import time
    now = time.time()
    # mtime = 30 seconds ago; quiet_seconds = 120
    mtime = now - 30
    assert is_session_quiet(mtime, quiet_seconds=120, now=now) is False


def test_quiescence_check_true_when_file_old_enough():
    """A file last modified more than quiet_seconds ago IS eligible."""
    from quire.journal.watcher import is_session_quiet
    import time
    now = time.time()
    mtime = now - 150  # 150 > 120
    assert is_session_quiet(mtime, quiet_seconds=120, now=now) is True


def test_quiescence_boundary():
    """Exactly at the quiet boundary (==) is NOT eligible (strictly greater than)."""
    from quire.journal.watcher import is_session_quiet
    import time
    now = time.time()
    mtime = now - 120  # exactly quiet_seconds
    assert is_session_quiet(mtime, quiet_seconds=120, now=now) is False


def test_discover_jsonl_files_finds_toplevel_only(tmp_path):
    """discover_jsonl_files finds .jsonl at the first nesting level only
    (no subagent logs in subdirectories)."""
    from quire.journal.watcher import discover_jsonl_files

    # Create top-level .jsonl files
    (tmp_path / "abc.jsonl").write_text("{}")
    (tmp_path / "def.jsonl").write_text("{}")

    # Create a project subdir with a .jsonl (should be found — it IS a top-level
    # file within the project dir)
    proj_dir = tmp_path / "-Users-foo-bar"
    proj_dir.mkdir()
    (proj_dir / "session1.jsonl").write_text("{}")
    # A subagent subdir (should NOT be found)
    subagent_dir = proj_dir / "abc123"
    subagent_dir.mkdir()
    (subagent_dir / "subagent.jsonl").write_text("{}")

    found = discover_jsonl_files(tmp_path)
    paths = {p.name for p in found}
    assert "session1.jsonl" in paths
    assert "subagent.jsonl" not in paths  # subdirectory of a project dir


# ── emit_activity_events DB-path tests (mock session, no Postgres) ────────────

def test_emit_activity_events_is_pg_true_uses_uuid_array_cast():
    """is_pg=True path must cast topic_ids AS uuid[] — not text[].

    This test is a revert-check: if someone changes CAST(:topic_ids AS uuid[])
    back to CAST(:topic_ids AS text[]) this test will FAIL.
    The assertion inspects the SQL string built inside emit_activity_events
    so the cast expression is literally present in the executed statement.
    """
    from unittest.mock import MagicMock, call
    from quire.journal.emit_events import emit_activity_events

    mock_session = MagicMock()
    executed_sqls: list[str] = []

    def capture_execute(sql, params=None):
        # SQLAlchemy text() objects expose the query as .text attribute
        executed_sqls.append(str(sql))
        return MagicMock()

    mock_session.execute.side_effect = capture_execute

    events = [
        {
            "timestamp": NOW,
            "category": "test",
            "tags": [],
            "actor": "system",
            "summary": "test event",
            "metadata": {},
            "source_type": "moment",
            "source_id": "src-1",
            "session_id": "sess-1",
            "repo": None,
            "branch": None,
            "worktree": None,
            "topic_ids": [],
            "files": [],
        }
    ]

    emit_activity_events(events, db_session=mock_session, is_pg=True)

    assert mock_session.execute.called, "execute() was not called"
    assert len(executed_sqls) == 1
    sql_text = executed_sqls[0]
    # The uuid[] cast must be present — revert to text[] breaks this assertion
    assert "CAST(:topic_ids AS uuid[])" in sql_text, (
        f"Expected 'CAST(:topic_ids AS uuid[])' in SQL but got:\n{sql_text}\n"
        "Did someone revert the uuid[] cast back to text[]?"
    )
    # Sanity: tags and files use text[]
    assert "CAST(:tags AS text[])" in sql_text
    assert "CAST(:files AS text[])" in sql_text


def test_emit_activity_events_is_pg_false_no_casts():
    """is_pg=False path uses plain :param bindings without Postgres casts."""
    from unittest.mock import MagicMock
    from quire.journal.emit_events import emit_activity_events

    mock_session = MagicMock()
    executed_sqls: list[str] = []

    def capture_execute(sql, params=None):
        executed_sqls.append(str(sql))
        return MagicMock()

    mock_session.execute.side_effect = capture_execute

    events = [
        {
            "timestamp": NOW,
            "category": "outcome",
            "tags": ["high"],
            "actor": "developer",
            "summary": "shipped it",
            "metadata": {"confidence": "high"},
            "source_type": "outcome",
            "source_id": "out-1",
            "session_id": "sess-2",
            "repo": "my-repo",
            "branch": "main",
            "worktree": None,
            "topic_ids": [],
            "files": ["src/foo.py"],
        }
    ]

    emit_activity_events(events, db_session=mock_session, is_pg=False)

    assert mock_session.execute.called
    assert len(executed_sqls) == 1
    sql_text = executed_sqls[0]
    # Non-PG path must NOT use CAST(... AS uuid[]) or CAST(... AS text[])
    assert "CAST(" not in sql_text, (
        f"is_pg=False path should not contain CAST() but found:\n{sql_text}"
    )


# ── SessionWatcher resume-detection tests (fake clock, no sleeps, no DB) ──────

def test_watcher_quiet_file_not_in_db_triggers_first_digest(tmp_path):
    """A quiet file with no DB record (get_created_at returns None) triggers
    a normal (force=False) digest call."""
    from quire.journal.watcher import SessionWatcher

    session_file = tmp_path / "proj" / "abc123.jsonl"
    session_file.parent.mkdir()
    session_file.write_text("{}")

    now = 2_000_000.0
    # mtime is 200 s ago — well past quiet_seconds=120
    import os
    os.utime(session_file, (now - 200, now - 200))

    digest_calls: list[tuple] = []

    def fake_digest(path, force):
        digest_calls.append((path, force))
        return True

    watcher = SessionWatcher(
        projects_dir=tmp_path,
        quiet_seconds=120,
        digest_fn=fake_digest,
        get_created_at_fn=lambda source_hash: None,  # not yet in DB
    )

    import unittest.mock as mock
    with mock.patch("time.time", return_value=now):
        watcher._scan_once()

    assert len(digest_calls) == 1
    assert digest_calls[0][1] is False  # force=False for first digest


def test_watcher_file_grew_after_digest_triggers_force_redigest(tmp_path):
    """A quiet file whose mtime > stored created_at triggers a force re-digest
    (session resumed after initial digest)."""
    from quire.journal.watcher import SessionWatcher

    session_file = tmp_path / "proj" / "resumed123.jsonl"
    session_file.parent.mkdir()
    session_file.write_text("{}")

    now = 2_000_000.0
    # mtime is 200 s ago — quiet
    import os
    os.utime(session_file, (now - 200, now - 200))
    mtime = now - 200

    # The DB says the session was created_at now-500 (before this mtime)
    created_at_stored = now - 500

    digest_calls: list[tuple] = []

    def fake_digest(path, force):
        digest_calls.append((path, force))
        return True

    watcher = SessionWatcher(
        projects_dir=tmp_path,
        quiet_seconds=120,
        digest_fn=fake_digest,
        get_created_at_fn=lambda source_hash: created_at_stored,
    )

    import unittest.mock as mock
    with mock.patch("time.time", return_value=now):
        watcher._scan_once()

    assert len(digest_calls) == 1, "Expected exactly one digest call"
    assert digest_calls[0][1] is True  # force=True — resumed session


def test_watcher_unchanged_after_digest_skips(tmp_path):
    """A quiet file whose mtime <= stored created_at is skipped — the session
    has not grown since it was digested."""
    from quire.journal.watcher import SessionWatcher

    session_file = tmp_path / "proj" / "done456.jsonl"
    session_file.parent.mkdir()
    session_file.write_text("{}")

    now = 2_000_000.0
    # mtime is 300 s ago — quiet
    import os
    os.utime(session_file, (now - 300, now - 300))
    mtime = now - 300

    # DB says the session was created_at now-200 (AFTER the mtime — already captured)
    created_at_stored = now - 200

    digest_calls: list[tuple] = []

    def fake_digest(path, force):
        digest_calls.append((path, force))
        return False

    watcher = SessionWatcher(
        projects_dir=tmp_path,
        quiet_seconds=120,
        digest_fn=fake_digest,
        get_created_at_fn=lambda source_hash: created_at_stored,
    )

    import unittest.mock as mock
    with mock.patch("time.time", return_value=now):
        watcher._scan_once()

    assert len(digest_calls) == 0, "Expected no digest call for up-to-date session"


# ── Seam-compat guard: _scan_once must work with the REAL _digest_one ─────────

def test_digest_one_accepts_positional_force():
    """_digest_one's signature must accept (path, force) positionally, matching
    the Callable[[pathlib.Path, bool], bool] hint and _scan_once's call site.
    A keyword-only `force` would raise TypeError here."""
    import inspect
    import pathlib as _pathlib
    from quire.journal.watcher import _digest_one

    sig = inspect.signature(_digest_one)
    # Raises TypeError if force is keyword-only — exactly the regression class
    sig.bind(_pathlib.Path("x.jsonl"), True)


def test_scan_once_invokes_real_digest_one_seam(tmp_path):
    """Real-seam guard: run _scan_once wired to the REAL _digest_one (no fake
    double), with the pipeline internals mocked at their source modules (the
    lazy imports inside _digest_one resolve at call time, so the mocks take).

    This puts the real _digest_one signature on the hook: a positional/keyword
    mismatch between _scan_once's `self._digest_fn(cand, force)` call and
    _digest_one's signature raises TypeError inside _scan_once's try block and
    the file never lands in newly_digested — failing this test instead of
    being silently swallowed in production.
    """
    import os
    import unittest.mock as mock
    from quire.db.writer import StoreResult
    from quire.journal.watcher import SessionWatcher

    session_file = tmp_path / "proj" / "seamtest1.jsonl"
    session_file.parent.mkdir()
    session_file.write_text("{}")
    now = 2_000_000.0
    os.utime(session_file, (now - 200, now - 200))  # quiet (200 > 120)

    store_kwargs: dict = {}

    def fake_store(**kwargs):
        store_kwargs.update(kwargs)
        return StoreResult(stored=True, session_id="sess-seam")

    fake_understanding = mock.MagicMock()
    fake_understanding.chunks = []
    fake_understanding.moments = []
    fake_understanding.transitions = []
    fake_understanding.outcomes = []

    db_ctx = mock.MagicMock()
    db_ctx.__enter__ = mock.MagicMock(return_value=mock.MagicMock())
    db_ctx.__exit__ = mock.MagicMock(return_value=False)

    with mock.patch("quire.ingest.parse_transcript", return_value=[]), \
         mock.patch("quire.ingest.normalize", return_value=[]), \
         mock.patch("quire.ingest.chunk_session", return_value=[]), \
         mock.patch("quire.ingest.detect_sittings", return_value=[]), \
         mock.patch("quire.understand.AnthropicUnderstandLLM", return_value=mock.MagicMock()), \
         mock.patch("quire.understand.classify_session", return_value="narrative"), \
         mock.patch("quire.understand.detect_topic_shifts", return_value=[]), \
         mock.patch("quire.understand.analyze_interactions_live", return_value=[]), \
         mock.patch("quire.understand.understand", return_value=fake_understanding), \
         mock.patch("quire.db.writer.store_session_digest", side_effect=fake_store), \
         mock.patch("quire.journal.git_context.get_git_context",
                    return_value={"repo": None, "branch": None, "worktree": None}), \
         mock.patch("quire.journal.emit_events.build_session_events", return_value=[]), \
         mock.patch("quire.journal.emit_events.emit_activity_events"), \
         mock.patch("quire.db.engine.get_session", return_value=db_ctx), \
         mock.patch("time.time", return_value=now):
        watcher = SessionWatcher(
            projects_dir=tmp_path,
            quiet_seconds=120,
            # digest_fn NOT overridden — the real _digest_one is on the hook
            get_created_at_fn=lambda source_hash: None,  # not in DB → first digest
        )
        digested = watcher._scan_once()

    assert digested == [session_file], (
        "the real _digest_one was not successfully invoked by _scan_once — "
        "signature mismatch between the _digest_fn call site and _digest_one?"
    )
    assert store_kwargs.get("force") is False
    assert store_kwargs.get("allow_llm_purge") is False
