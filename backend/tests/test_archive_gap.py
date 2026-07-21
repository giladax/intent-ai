"""Tests for the raw-session archive (Slice 8b archive gap).

Exercises the PRODUCTION helper quire.journal.archive.archive_raw_session —
the same function called from cli.py journal_digest and the watcher's
_digest_one — not a re-simulation of its logic. Semantics ported from
journal/src/pipeline/orchestrator.ts::archiveRawSession:
  - copy when dest missing
  - skip when dest exists and dest.size >= src.size
  - re-copy when the source grew (resumed session)
  - failure-safe: unwritable dir → returns None, warn() called, never raises
"""
from __future__ import annotations

import os

import pytest

from quire.journal.archive import archive_raw_session, get_archive_dir


def test_archive_dir_points_to_backend_intent():
    """get_archive_dir() should return backend/.intent/raw-sessions/."""
    d = get_archive_dir()
    assert d.name == "raw-sessions"
    assert d.parent.name == ".intent"


def test_archive_copies_when_dest_missing(tmp_path):
    """First digest: the .jsonl is copied into the archive dir."""
    src = tmp_path / "abc-123.jsonl"
    src.write_text('{"test": 1}\n')
    archive_dir = tmp_path / "raw-sessions"

    dest = archive_raw_session(src, archive_dir=archive_dir)

    assert dest is not None
    assert dest == archive_dir / "abc-123.jsonl"
    assert dest.exists()
    assert dest.read_text() == src.read_text()


def test_archive_creates_dest_dir(tmp_path):
    """Archive creates the destination directory when it does not exist."""
    src = tmp_path / "s.jsonl"
    src.write_text('{"a": 1}\n')
    archive_dir = tmp_path / "does" / "not" / "exist"
    assert not archive_dir.exists()

    dest = archive_raw_session(src, archive_dir=archive_dir)

    assert dest is not None
    assert archive_dir.is_dir()


def test_archive_skip_if_dest_same_size(tmp_path):
    """Skip copy when dest exists and is the same size as the source."""
    src = tmp_path / "s.jsonl"
    src.write_text('{"test": 1}\n')
    archive_dir = tmp_path / "raw-sessions"
    first = archive_raw_session(src, archive_dir=archive_dir)
    assert first is not None

    second = archive_raw_session(src, archive_dir=archive_dir)
    assert second is None  # skipped — dest is current


def test_archive_skip_when_dest_larger(tmp_path):
    """Skip when dest is already larger than source."""
    src = tmp_path / "s.jsonl"
    src.write_text('{"a": 1}\n')
    archive_dir = tmp_path / "raw-sessions"
    archive_dir.mkdir()
    (archive_dir / "s.jsonl").write_text('{"a": 1}\n{"b": 2}\n')

    assert archive_raw_session(src, archive_dir=archive_dir) is None


def test_archive_recopies_when_source_grew(tmp_path):
    """Resumed session: source grew after archive → re-copy refreshes dest."""
    src = tmp_path / "s.jsonl"
    src.write_text('{"a": 1}\n')
    archive_dir = tmp_path / "raw-sessions"
    assert archive_raw_session(src, archive_dir=archive_dir) is not None

    src.write_text('{"a": 1}\n{"b": 2}\n')  # session resumed, log grew
    dest = archive_raw_session(src, archive_dir=archive_dir)

    assert dest is not None
    assert dest.read_text() == '{"a": 1}\n{"b": 2}\n'


def test_archive_failure_safe_unwritable_dir(tmp_path):
    """Unwritable archive dir → returns None and warns; NEVER raises.

    This is the founder invariant: archive failure never fails the digest.
    """
    src = tmp_path / "s.jsonl"
    src.write_text('{"a": 1}\n')
    locked = tmp_path / "locked"
    locked.mkdir()
    os.chmod(locked, 0o444)  # read-only — mkdir/copy inside will fail
    warnings: list[str] = []
    try:
        dest = archive_raw_session(
            src, warn=warnings.append, archive_dir=locked / "raw-sessions"
        )
    finally:
        os.chmod(locked, 0o755)

    assert dest is None
    assert len(warnings) == 1


def test_archive_failure_safe_missing_source(tmp_path):
    """Missing source file → returns None and warns; never raises."""
    warnings: list[str] = []
    dest = archive_raw_session(
        tmp_path / "no-such.jsonl",
        warn=warnings.append,
        archive_dir=tmp_path / "raw-sessions",
    )
    assert dest is None
    assert len(warnings) == 1


def test_watcher_digest_path_archives(tmp_path, monkeypatch):
    """The watcher's _digest_one archives the log before digesting.

    We stop the pipeline right after the archive step by making
    parse_transcript raise — the archive must already have happened
    (TS semantics: archive unconditionally at step 0, before parse).
    """
    import quire.journal.archive as archive_mod
    from quire.journal.watcher import _digest_one

    src = tmp_path / "watched-session.jsonl"
    src.write_text('{"type": "user"}\n')
    archive_dir = tmp_path / "raw-sessions"
    monkeypatch.setattr(archive_mod, "get_archive_dir", lambda: archive_dir)

    class _StopAfterArchive(Exception):
        pass

    import quire.ingest as ingest_mod

    def _boom(_path):
        raise _StopAfterArchive("stop before LLM pipeline")

    monkeypatch.setattr(ingest_mod, "parse_transcript", _boom)

    with pytest.raises(_StopAfterArchive):
        _digest_one(src)

    assert (archive_dir / "watched-session.jsonl").exists()


def test_cli_digest_path_archives_before_parse(tmp_path, monkeypatch):
    """The CLI's journal_digest archives the log at step 0, before parse.

    We stop the pipeline right after parse_transcript raises — the archive
    must already exist (same invariant as the watcher: evidence survives a
    failed digest).
    """
    import quire.journal.archive as archive_mod
    import quire.ingest as ingest_mod
    from typer.testing import CliRunner
    from quire.cli import app

    src = tmp_path / "cli-session.jsonl"
    src.write_text('{"type": "user"}\n')
    archive_dir = tmp_path / "raw-sessions"
    monkeypatch.setattr(archive_mod, "get_archive_dir", lambda: archive_dir)

    # Make parse_transcript raise so the digest fails before any LLM/DB work.
    original_parse = ingest_mod.parse_transcript

    def _boom(path):
        raise RuntimeError("forced failure after archive step")

    monkeypatch.setattr(ingest_mod, "parse_transcript", _boom)

    runner = CliRunner()
    result = runner.invoke(app, ["journal", "digest", str(src)])
    # Digest should have failed (non-zero or exception captured), but archive
    # must already exist.
    assert (archive_dir / "cli-session.jsonl").exists(), (
        f"Archive not found; CLI output: {result.output}"
    )
