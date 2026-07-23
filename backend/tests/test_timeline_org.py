"""Tests for compose_org_timeline — no Postgres required.

We use unittest.mock to provide a minimal pg_session duck-type and verify
the shape + logic without a live database.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from quire.models import Classification
from quire.timeline_org import (
    _MAX_WINDOW_DAYS,
    _VERDICT_INK,
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
    aligned = _verdict_plain("ALIGNED")
    assert "promise" in aligned.lower() or "kept" in aligned.lower()
    assert "promise" in _verdict_plain("UNGOVERNED").lower()
    assert "drift" in _verdict_plain("POSSIBLE_DRIFT").lower()


def test_verdict_plain_label_lock():
    """Label lock: every Classification enum value produces a non-enum label.

    Ensures _verdict_plain routes through vocab and never leaks raw enum
    values into user-facing text (F1 violation prevention).
    """
    all_classifications = {c.value for c in Classification}
    for classification in all_classifications:
        label = _verdict_plain(classification)
        # Assert the label is not the enum value itself (would be a leak)
        assert label != classification, (
            f"_verdict_plain({classification!r}) returned the enum value itself. "
            f"Must return a human-readable label from vocab."
        )
        # Assert no underscores (enum naming pattern) in the label
        assert "_" not in label, (
            f"_verdict_plain({classification!r}) returned {label!r}, "
            f"which contains underscores (enum naming). Must be plain English."
        )


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


# ── C1: alignment store → check marks ────────────────────────────────────────

def _fake_analysis(repository="org/my-repo", pr_number=42, classification="ALIGNED",
                   days_ago=1):
    """Return a minimal PRAnalysis-like object for check mark tests."""
    a = MagicMock()
    a.repository = repository
    a.pr_number = pr_number
    a.classification.value = classification
    a.created_at = datetime.now(tz=timezone.utc) - timedelta(days=days_ago)
    a.behavioral_delta = None
    return a


def test_check_marks_appear_when_alignment_store_wired():
    """C1 proof: with a seeded alignment store, check marks appear in the row.

    Before the C1 fix, WORKSPACES.values() would raise AttributeError (it is a
    pathlib.Path, not a dict) and the exception was swallowed → alignment_store
    always None → no check marks. This test calls compose_org_timeline with an
    explicit mocked store and asserts the 'check' kind mark is emitted.

    Post-C3 fix: repo-wide checks (default when no obligation_impacts) go to a
    summary row, so we expect 2 rows: summary + feature.
    """
    feature_rows = [{"id": "f1", "name": "Payments", "project_name": "my-repo", "project_id": "p1"}]
    ae_rows = [
        {
            "feature_id": "f1",
            "id": "e1",
            "timestamp": _ts(2),
            "category": "session.moment",
            "summary": "payment gateway work",
            "session_id": "s1",
            "source_type": "session",
        }
    ]
    sess = _mock_session(feature_rows=feature_rows, ae_rows=ae_rows)

    # A store with one ALIGNED analysis on the same repo (repo-wide by default).
    alignment_store = MagicMock()
    alignment_store.list_analyses.return_value = [
        _fake_analysis(repository="org/my-repo", pr_number=7, classification="ALIGNED")
    ]

    result = compose_org_timeline(sess, alignment_store=alignment_store)
    assert not result["empty"]
    assert len(result["rows"]) == 2, "should have summary row + feature row"
    # Check marks should appear in the summary row
    summary_row = result["rows"][0]
    kinds = {m["kind"] for m in summary_row["marks"]}
    assert "check" in kinds, "check mark must appear when alignment store is wired"


def test_check_mark_link_uses_repo_slug_not_raw_repository():
    """I2 proof: check link must not contain a '/' from the org/repo path.

    Raw a.repository 'org/my-repo' in the link would break the
    /repo/<ws>/review/<n> route. Only the slug ('my-repo') should appear.
    """
    feature_rows = [{"id": "f1", "name": "Auth", "project_name": "my-repo", "project_id": "p1"}]
    ae_rows = [
        {
            "feature_id": "f1",
            "id": "e1",
            "timestamp": _ts(1),
            "category": "c",
            "summary": "auth work",
            "session_id": None,
            "source_type": "session",
        }
    ]
    sess = _mock_session(feature_rows=feature_rows, ae_rows=ae_rows)

    alignment_store = MagicMock()
    alignment_store.list_analyses.return_value = [
        _fake_analysis(repository="org/my-repo", pr_number=5, classification="ALIGNED")
    ]

    result = compose_org_timeline(sess, alignment_store=alignment_store)
    check_marks = [m for m in result["rows"][0]["marks"] if m["kind"] == "check"]
    assert check_marks, "at least one check mark expected"
    link = check_marks[0]["link"]
    # /repo/<ws>/review/<n>  — the ws segment must not contain a '/'
    parts = link.split("/")
    # Expected: ['', 'repo', 'my-repo', 'review', '5']
    assert parts[1] == "repo"
    assert "/" not in parts[2], f"slug segment must not contain '/': got {parts[2]!r}"
    assert parts[3] == "review"


# ── C2: feature_sessions path ─────────────────────────────────────────────────

def _mock_session_three(feature_rows=None, ae_rows=None):
    """Mock supporting the new UNION query (still one execute call for AEs)."""
    return _mock_session(feature_rows=feature_rows, ae_rows=ae_rows)


def test_feature_sessions_path_shows_events():
    """C2 proof: events with ae.feature_id IS NULL but linked via feature_sessions appear.

    The mock returns AE rows with feature_id set to the feature's id (mimicking
    what the UNION's second arm returns — fs.feature_id::text). Before the C2
    fix only the direct path was queried, so events associated only via
    feature_sessions were invisible.
    """
    feature_rows = [{"id": "f1", "name": "Onboarding", "project_name": "api", "project_id": "p1"}]
    # Simulate the UNION's second arm: the DB returns feature_id from fs.feature_id
    # (not from ae.feature_id which would be NULL in the real row).
    ae_rows = [
        {
            "feature_id": "f1",          # populated by the UNION fs.feature_id::text alias
            "id": "e2",
            "timestamp": _ts(3),
            "category": "session.moment",
            "summary": "onboarding session work",
            "session_id": "s2",
            "source_type": "session",
        }
    ]
    sess = _mock_session_three(feature_rows=feature_rows, ae_rows=ae_rows)
    result = compose_org_timeline(sess, alignment_store=None)
    assert not result["empty"], "feature_sessions-linked events must surface the row"
    assert result["rows"][0]["event_count"] == 1


# ── I1: per-feature seen_sessions scope ──────────────────────────────────────

def test_session_mark_appears_on_both_features_when_spanning_two():
    """I1 proof: session S1 in both F1 and F2 → session mark on each.

    Before the fix, seen_sessions was global across features, so the session
    mark was only emitted for the first feature iterated.
    """
    feature_rows = [
        {"id": "f1", "name": "Alpha", "project_name": "api", "project_id": "p1"},
        {"id": "f2", "name": "Beta",  "project_name": "api", "project_id": "p1"},
    ]
    shared_ts = _ts(1)
    ae_rows = [
        {
            "feature_id": "f1",
            "id": "e1",
            "timestamp": shared_ts,
            "category": "c",
            "summary": "alpha work",
            "session_id": "shared-session",
            "source_type": "session",
        },
        {
            "feature_id": "f2",
            "id": "e2",
            "timestamp": shared_ts,
            "category": "c",
            "summary": "beta work",
            "session_id": "shared-session",
            "source_type": "session",
        },
    ]
    sess = _mock_session(feature_rows=feature_rows, ae_rows=ae_rows)
    result = compose_org_timeline(sess, alignment_store=None)
    assert len(result["rows"]) == 2
    for row in result["rows"]:
        session_marks = [m for m in row["marks"] if m["kind"] == "session"]
        assert session_marks, (
            f"feature {row['feature_id']} must have a session mark for shared-session"
        )


# ── M2: _VERDICT_INK completeness ────────────────────────────────────────────

def test_verdict_ink_covers_all_classifications():
    """M2: every Classification enum value must have an explicit entry in _VERDICT_INK.

    The .get(key, 'gray') fallback must never be the load-bearing path —
    missing keys are silent misrepresentations (OFF_INTENT 'gray' instead of
    'red' would hide the worst verdict). Lock the mapping to the full vocab.
    """
    all_verdicts = {c.value for c in Classification}
    missing = all_verdicts - set(_VERDICT_INK)
    assert not missing, (
        f"_VERDICT_INK is missing explicit entries for: {missing}. "
        "Add them — OFF_INTENT must map to 'red', "
        "NO_MATERIAL_IMPACT must map to 'gray'."
    )


def test_verdict_ink_off_intent_is_red():
    """OFF_INTENT must map to 'red' — it contradicts intent, the loudest signal."""
    assert _VERDICT_INK["OFF_INTENT"] == "red"


def test_verdict_ink_no_material_impact_is_gray():
    """NO_MATERIAL_IMPACT must map to 'gray' — a quiet, non-alarm verdict."""
    assert _VERDICT_INK["NO_MATERIAL_IMPACT"] == "gray"


# ── M4: repo_workspace slug ──────────────────────────────────────────────────

def test_repo_workspace_is_slugified():
    """M4: repo_workspace must be lower-case with spaces replaced by hyphens."""
    feature_rows = [{"id": "f1", "name": "Search", "project_name": "My Cool Repo", "project_id": "p1"}]
    ae_rows = [
        {
            "feature_id": "f1",
            "id": "e1",
            "timestamp": _ts(1),
            "category": "c",
            "summary": "search work",
            "session_id": None,
            "source_type": "session",
        }
    ]
    sess = _mock_session(feature_rows=feature_rows, ae_rows=ae_rows)
    result = compose_org_timeline(sess, alignment_store=None)
    row = result["rows"][0]
    # Display name preserved
    assert row["repo"] == "My Cool Repo"
    # Slug is lower-case with hyphens
    assert row["repo_workspace"] == "my-cool-repo"


# ── C3: repo-wide check segregation ──────────────────────────────────────

def test_repo_wide_checks_go_to_summary_row():
    """C3 proof: repo-wide checks (no obligation_impacts) attach to 'All of <repo>' row.

    Feature-specific checks should attach to feature rows; repo-wide checks should
    attach only to a synthetic summary row, preventing duplication across all features.
    """
    feature_rows = [
        {"id": "f1", "name": "Auth", "project_name": "my-repo", "project_id": "p1"},
        {"id": "f2", "name": "Billing", "project_name": "my-repo", "project_id": "p1"},
    ]
    ae_rows = [
        {
            "feature_id": "f1",
            "id": "e1",
            "timestamp": _ts(1),
            "category": "c",
            "summary": "auth work",
            "session_id": None,
            "source_type": "session",
        },
        {
            "feature_id": "f2",
            "id": "e2",
            "timestamp": _ts(1),
            "category": "c",
            "summary": "billing work",
            "session_id": None,
            "source_type": "session",
        },
    ]
    sess = _mock_session(feature_rows=feature_rows, ae_rows=ae_rows)

    # A repo-wide check: no obligation_impacts, so relation is not set.
    alignment_store = MagicMock()
    repo_wide_analysis = _fake_analysis(
        repository="org/my-repo",
        pr_number=1,
        classification="ALIGNED"
    )
    repo_wide_analysis.obligation_impacts = []  # No feature-specific evidence
    alignment_store.list_analyses.return_value = [repo_wide_analysis]

    result = compose_org_timeline(sess, alignment_store=alignment_store)
    # Should have 3 rows: summary + f1 + f2
    assert len(result["rows"]) == 3, f"Expected 3 rows, got {len(result['rows'])}"

    # First row should be the summary row
    summary_row = result["rows"][0]
    assert "All of" in summary_row["feature_name"], f"Expected 'All of' in {summary_row['feature_name']}"
    assert summary_row["feature_id"] is None, "summary row should have feature_id=None"
    check_kinds = {m["kind"] for m in summary_row["marks"]}
    assert "check" in check_kinds, "summary row should have check marks"

    # Feature rows should have no check marks (only activity and session marks)
    for row in result["rows"][1:]:
        if row["feature_id"]:  # actual feature row
            check_marks_in_feature = [m for m in row["marks"] if m["kind"] == "check"]
            assert not check_marks_in_feature, (
                f"feature row {row['feature_name']} should not have repo-wide checks"
            )


def test_feature_specific_checks_attach_to_features():
    """Feature-specific checks (with obligation_impacts) attach to their features, not summary."""
    feature_rows = [
        {"id": "f1", "name": "Auth", "project_name": "my-repo", "project_id": "p1"},
    ]
    ae_rows = [
        {
            "feature_id": "f1",
            "id": "e1",
            "timestamp": _ts(1),
            "category": "c",
            "summary": "auth work",
            "session_id": None,
            "source_type": "session",
        },
    ]
    sess = _mock_session(feature_rows=feature_rows, ae_rows=ae_rows)

    # A feature-specific check: has obligation_impacts with a real relation.
    alignment_store = MagicMock()
    feature_analysis = _fake_analysis(
        repository="org/my-repo",
        pr_number=2,
        classification="PARTIAL"
    )
    # Create a mock impact with a meaningful relation
    impact = MagicMock()
    impact.relation = "partially_satisfies"
    feature_analysis.obligation_impacts = [impact]
    alignment_store.list_analyses.return_value = [feature_analysis]

    result = compose_org_timeline(sess, alignment_store=alignment_store)
    # Should have 1 feature row (no summary row, since all checks are feature-specific)
    feature_rows_result = [r for r in result["rows"] if r["feature_id"]]
    assert len(feature_rows_result) == 1
    row = feature_rows_result[0]
    check_marks = [m for m in row["marks"] if m["kind"] == "check"]
    assert check_marks, "feature row should have the feature-specific check"
