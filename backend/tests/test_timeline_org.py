"""Tests for compose_org_timeline — no Postgres required.

We use unittest.mock to provide a minimal pg_session duck-type and verify
the shape + logic without a live database.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from quire.timeline_org import (
    _MAX_WINDOW_DAYS,
    _empty_shape,
    _verdict_plain,
    compose_org_timeline,
)


# ── helpers ──────────────────────────────────────────────────────────────────

def _ts(days_ago: int = 1) -> datetime:
    return datetime.now(tz=timezone.utc) - timedelta(days=days_ago)


def _mock_session(feature_rows=None, ae_rows=None):
    """Return a MagicMock SQLAlchemy session.

    execute() is called up to twice:
      1st call → features query (always)
      2nd call → activity_events query (only when feature_rows is non-empty)

    Using a list side_effect that stops raising StopIteration on exhaustion
    by providing enough entries for either call pattern.
    """
    sess = MagicMock()

    def _make_result(rows):
        r = MagicMock()
        r.mappings.return_value.all.return_value = rows or []
        return r

    feat_result = _make_result(feature_rows)
    ae_result = _make_result(ae_rows)

    # Provide both results; if only one call is made the second is never used.
    sess.execute.side_effect = [feat_result, ae_result]
    return sess


# ── shape tests ──────────────────────────────────────────────────────────────

def test_empty_shape_keys():
    """_empty_shape always returns the required top-level keys."""
    now = datetime.now(tz=timezone.utc)
    shape = _empty_shape(30, now - timedelta(days=30), now)
    assert "window" in shape
    assert "rows" in shape
    assert "empty" in shape
    assert shape["empty"] is True
    assert shape["rows"] == []


def test_compose_no_features_returns_empty():
    """No features → empty: True, rows: []."""
    sess = _mock_session(feature_rows=[], ae_rows=[])
    result = compose_org_timeline(sess, alignment_store=None, window_days=30)
    assert result["empty"] is True
    assert result["rows"] == []
    assert "window" in result
    assert result["window"]["days"] == 30


def test_compose_feature_no_activity_omitted():
    """Feature with no activity in window → omitted from rows."""
    feature_rows = [{"id": "f1", "name": "Auth", "project_name": "api", "project_id": "p1"}]
    sess = _mock_session(feature_rows=feature_rows, ae_rows=[])
    result = compose_org_timeline(sess, alignment_store=None)
    assert result["empty"] is True
    assert result["rows"] == []


def test_compose_feature_with_activity_included():
    """Feature with activity in window → appears in rows with marks."""
    feature_rows = [{"id": "f1", "name": "Auth", "project_name": "api", "project_id": "p1"}]
    ae_rows = [
        {
            "feature_id": "f1",
            "id": "e1",
            "timestamp": _ts(1),
            "category": "session.moment",
            "summary": "Added token refresh logic",
            "session_id": "s1",
            "source_type": "session",
        }
    ]
    sess = _mock_session(feature_rows=feature_rows, ae_rows=ae_rows)
    result = compose_org_timeline(sess, alignment_store=None)
    assert not result["empty"]
    assert len(result["rows"]) == 1
    row = result["rows"][0]
    assert row["feature_id"] == "f1"
    assert row["feature_name"] == "Auth"
    assert row["event_count"] == 1
    # Should have at least one activity mark and one session mark
    kinds = {m["kind"] for m in row["marks"]}
    assert "activity" in kinds
    assert "session" in kinds


def test_compose_mark_fields():
    """Each mark has required fields: kind, ts, label, ink, link."""
    feature_rows = [{"id": "f1", "name": "Billing", "project_name": "fin", "project_id": "p2"}]
    ae_rows = [
        {
            "feature_id": "f1",
            "id": "e1",
            "timestamp": _ts(2),
            "category": "session.moment",
            "summary": "Billing refactor",
            "session_id": None,
            "source_type": "session",
        }
    ]
    sess = _mock_session(feature_rows=feature_rows, ae_rows=ae_rows)
    result = compose_org_timeline(sess, alignment_store=None)
    for mark in result["rows"][0]["marks"]:
        assert "kind" in mark
        assert "ts" in mark
        assert "label" in mark
        assert "ink" in mark
        assert "link" in mark


def test_window_clamped_to_max():
    """window_days > 90 is clamped to 90."""
    sess = _mock_session(feature_rows=[], ae_rows=[])
    result = compose_org_timeline(sess, alignment_store=None, window_days=999)
    assert result["window"]["days"] == _MAX_WINDOW_DAYS


def test_verdict_plain_known_values():
    """_verdict_plain returns human strings for all known verdicts."""
    assert "Kept" in _verdict_plain("ALIGNED")
    assert "promise" in _verdict_plain("UNGOVERNED").lower()
    assert "drift" in _verdict_plain("POSSIBLE_DRIFT").lower()


def test_verdict_plain_unknown_passthrough():
    """Unknown classification → returned as-is."""
    assert _verdict_plain("SOME_NEW_ENUM") == "SOME_NEW_ENUM"


def test_row_fields_present():
    """Each row has the required fields for the frontend contract."""
    feature_rows = [{"id": "f1", "name": "Payments", "project_name": "fin", "project_id": "p1"}]
    ae_rows = [
        {
            "feature_id": "f1",
            "id": "e1",
            "timestamp": _ts(3),
            "category": "session.moment",
            "summary": "Payment gateway",
            "session_id": None,
            "source_type": "session",
        }
    ]
    sess = _mock_session(feature_rows=feature_rows, ae_rows=ae_rows)
    result = compose_org_timeline(sess, alignment_store=None)
    row = result["rows"][0]
    for field in (
        "feature_id",
        "feature_name",
        "repo",
        "repo_workspace",
        "first_activity",
        "last_activity",
        "event_count",
        "marks",
    ):
        assert field in row, f"missing field: {field}"


def test_compose_session_exception_returns_empty():
    """If the pg_session raises, return the empty shape without propagating."""
    sess = MagicMock()
    sess.execute.side_effect = RuntimeError("DB down")
    result = compose_org_timeline(sess, alignment_store=None)
    assert result["empty"] is True
    assert result["rows"] == []


def test_rows_sorted_by_last_activity_descending():
    """Rows are sorted newest-last-activity first."""
    feature_rows = [
        {"id": "f1", "name": "Alpha", "project_name": "api", "project_id": "p1"},
        {"id": "f2", "name": "Beta", "project_name": "api", "project_id": "p1"},
    ]
    ae_rows = [
        {
            "feature_id": "f1",
            "id": "e1",
            "timestamp": _ts(10),
            "category": "c",
            "summary": "old",
            "session_id": None,
            "source_type": "session",
        },
        {
            "feature_id": "f2",
            "id": "e2",
            "timestamp": _ts(1),
            "category": "c",
            "summary": "new",
            "session_id": None,
            "source_type": "session",
        },
    ]
    sess = _mock_session(feature_rows=feature_rows, ae_rows=ae_rows)
    result = compose_org_timeline(sess, alignment_store=None)
    assert result["rows"][0]["feature_id"] == "f2"  # most recent first
    assert result["rows"][1]["feature_id"] == "f1"
