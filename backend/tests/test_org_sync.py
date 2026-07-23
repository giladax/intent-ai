"""Tests for quire.org_sync (O2) — offline, no live GitHub, no live Postgres.

All tests use SQLite-in-memory for the alignment store.
The GitHub adapter is replaced by canned fixtures (StubSession pattern from
test_github_adapter.py).  No live network calls.  No OrgStore writes (the
conftest guard applies — OrgStore() without engine raises).

Coverage:
  - PrEvent dataclass (frozen, field names)
  - GitHubPollEventSource.poll_events extracts events from stub list_prs
  - _load_sync_meta / _save_sync_meta round-trip
  - _load_seen_shas / _mark_sha_seen round-trip
  - _publishing_allowed: giladax+flag required; non-giladax always OFF
  - _update_prs_yaml_from_events: new entries added, existing updated
  - _emit_check_analyzed: failure-safe (DB unavailable → logs, doesn't raise)
  - handle_pr_event: end-to-end with canned adapter (analysis mocked)
  - sync_org: iterates repos, skips non-active / no-remote; analyzes new events
  - Budget guard: max_prs_per_repo cap respected
"""
from __future__ import annotations

import json
import pathlib
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
import yaml

from quire.org_sync import (
    PrEvent,
    GitHubPollEventSource,
    _load_sync_meta,
    _save_sync_meta,
    _load_seen_shas,
    _mark_sha_seen,
    _publishing_allowed,
    _update_prs_yaml_from_events,
    _emit_check_analyzed,
    handle_pr_event,
    sync_org,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_event(
    pr_number: int = 1,
    head_sha: str = "headabc",
    base_sha: str = "basedef",
    title: str = "Add feature",
    author: str = "alice",
    state: str = "open",
    updated_at: str = "2026-07-23T10:00:00Z",
) -> PrEvent:
    return PrEvent(
        pr_number=pr_number,
        head_sha=head_sha,
        base_sha=base_sha,
        title=title,
        author=author,
        state=state,
        updated_at=updated_at,
    )


def _stub_pr_list_response(prs: list[dict]) -> Any:
    """Build a stub requests.Session that returns `prs` from GET /repos/.../pulls."""
    class _StubResponse:
        def __init__(self, payload):
            self._payload = payload
            self.status_code = 200
        def json(self):
            return self._payload
        def raise_for_status(self):
            pass

    class _StubSession:
        def __init__(self):
            self.headers = {}
        def get(self, url, params=None, headers=None):
            if "/pulls" in url and "diff" not in str(headers or {}):
                return _StubResponse(prs)
            return _StubResponse([])
        def update(self, *a, **kw):
            pass

    return _StubSession()


# ---------------------------------------------------------------------------
# PrEvent — dataclass contract
# ---------------------------------------------------------------------------

class TestPrEventDataclass:
    def test_fields_present(self):
        ev = _make_event()
        assert ev.pr_number == 1
        assert ev.head_sha == "headabc"
        assert ev.base_sha == "basedef"
        assert ev.title == "Add feature"
        assert ev.author == "alice"
        assert ev.state == "open"
        assert ev.updated_at == "2026-07-23T10:00:00Z"

    def test_frozen(self):
        ev = _make_event()
        with pytest.raises((AttributeError, TypeError)):
            ev.pr_number = 99  # type: ignore[misc]

    def test_equality_by_value(self):
        a = _make_event(head_sha="abc")
        b = _make_event(head_sha="abc")
        assert a == b

    def test_inequality_on_different_sha(self):
        a = _make_event(head_sha="abc")
        b = _make_event(head_sha="def")
        assert a != b


# ---------------------------------------------------------------------------
# Sync-meta helpers
# ---------------------------------------------------------------------------

class TestSyncMeta:
    def test_load_missing_returns_empty(self, tmp_path):
        assert _load_sync_meta(tmp_path) == {}

    def test_save_and_load_roundtrip(self, tmp_path):
        _save_sync_meta(tmp_path, {"foo": "bar", "count": 3})
        loaded = _load_sync_meta(tmp_path)
        assert loaded == {"foo": "bar", "count": 3}

    def test_load_invalid_yaml_returns_empty(self, tmp_path):
        (tmp_path / "sync_meta.yaml").write_text("{{{{ not yaml")
        # should not raise
        result = _load_sync_meta(tmp_path)
        assert isinstance(result, dict)

    def test_mark_sha_seen_accumulates(self, tmp_path):
        _mark_sha_seen(tmp_path, "sha1")
        _mark_sha_seen(tmp_path, "sha2")
        seen = _load_seen_shas(tmp_path)
        assert "sha1" in seen
        assert "sha2" in seen

    def test_mark_sha_seen_idempotent(self, tmp_path):
        _mark_sha_seen(tmp_path, "sha1")
        _mark_sha_seen(tmp_path, "sha1")
        seen = _load_seen_shas(tmp_path)
        assert len([s for s in seen if s == "sha1"]) == 1

    def test_load_seen_shas_empty(self, tmp_path):
        assert _load_seen_shas(tmp_path) == set()


# ---------------------------------------------------------------------------
# Publishing guard
# ---------------------------------------------------------------------------

class TestPublishingAllowed:
    def test_non_giladax_remote_always_off(self, tmp_path):
        # Even with publish_enabled=true in meta, non-giladax repos must be OFF
        _save_sync_meta(tmp_path, {"publish_enabled": True})
        assert _publishing_allowed("https://github.com/psf/requests", tmp_path) is False

    def test_pallets_always_off(self, tmp_path):
        _save_sync_meta(tmp_path, {"publish_enabled": True})
        assert _publishing_allowed("https://github.com/pallets/itsdangerous", tmp_path) is False

    def test_giladax_without_flag_is_off(self, tmp_path):
        # flag not set → default OFF
        assert _publishing_allowed("https://github.com/giladax/intent-ai", tmp_path) is False

    def test_giladax_with_flag_is_on(self, tmp_path):
        _save_sync_meta(tmp_path, {"publish_enabled": True})
        assert _publishing_allowed("https://github.com/giladax/intent-ai", tmp_path) is True

    def test_none_remote_is_off(self, tmp_path):
        _save_sync_meta(tmp_path, {"publish_enabled": True})
        assert _publishing_allowed(None, tmp_path) is False

    def test_giladax_case_insensitive(self, tmp_path):
        _save_sync_meta(tmp_path, {"publish_enabled": True})
        # GitHub remotes are always lowercase but guard against capitalisation
        assert _publishing_allowed("https://github.com/GiladAX/myrepo", tmp_path) is True


# ---------------------------------------------------------------------------
# _update_prs_yaml_from_events
# ---------------------------------------------------------------------------

class TestUpdatePrsYaml:
    def test_new_pr_added(self, tmp_path):
        ev = _make_event(pr_number=42, head_sha="head42")
        _update_prs_yaml_from_events(tmp_path, [ev])
        data = yaml.safe_load((tmp_path / "prs.yaml").read_text())
        assert 42 in data
        assert data[42]["head"] == "head42"

    def test_existing_pr_not_overwritten(self, tmp_path):
        # Pre-populate prs.yaml with a stale entry
        (tmp_path / "prs.yaml").write_text(
            yaml.safe_dump({42: {"head": "oldsha", "base": "basex", "title": "old"}})
        )
        ev = _make_event(pr_number=42, head_sha="newsha")
        _update_prs_yaml_from_events(tmp_path, [ev])
        data = yaml.safe_load((tmp_path / "prs.yaml").read_text())
        # head should be updated when sha changed
        assert data[42]["head"] == "newsha"

    def test_existing_pr_with_same_sha_unchanged(self, tmp_path):
        (tmp_path / "prs.yaml").write_text(
            yaml.safe_dump({42: {"head": "samasha", "base": "b", "title": "t"}})
        )
        ev = _make_event(pr_number=42, head_sha="samasha")
        _update_prs_yaml_from_events(tmp_path, [ev])
        data = yaml.safe_load((tmp_path / "prs.yaml").read_text())
        assert data[42]["head"] == "samasha"

    def test_multiple_prs(self, tmp_path):
        evs = [_make_event(pr_number=i, head_sha=f"sha{i}") for i in range(1, 4)]
        _update_prs_yaml_from_events(tmp_path, evs)
        data = yaml.safe_load((tmp_path / "prs.yaml").read_text())
        for i in range(1, 4):
            assert i in data

    def test_empty_events_no_file_created(self, tmp_path):
        _update_prs_yaml_from_events(tmp_path, [])
        # With zero events, no file should be created
        assert not (tmp_path / "prs.yaml").exists()

    def test_creates_new_file_when_absent(self, tmp_path):
        ev = _make_event(pr_number=1)
        _update_prs_yaml_from_events(tmp_path, [ev])
        assert (tmp_path / "prs.yaml").exists()


# ---------------------------------------------------------------------------
# _emit_check_analyzed — failure-safe
# ---------------------------------------------------------------------------

class TestEmitCheckAnalyzed:
    def test_does_not_raise_when_db_unavailable(self):
        """DB unavailable → logs, never raises."""
        with patch("quire.org_sync.get_session", side_effect=RuntimeError("no DB")):
            # Should complete silently
            _emit_check_analyzed(
                pr_number=1,
                head_sha="abc123",
                verdict="ALIGNED",
                workspace="test-ws",
                repository="owner/repo",
                publish_url=None,
                repo="owner/repo",
                branch=None,
            )

    def test_summary_contains_pr_number_and_label(self):
        """Verify summary text is meaningful before any DB call."""
        captured: list[dict] = []

        def fake_emit(events, db_session, is_pg=True):
            captured.extend(events)

        with patch("quire.org_sync.get_session") as mock_sess, \
             patch("quire.org_sync.emit_activity_events", side_effect=fake_emit):
            cm = MagicMock()
            cm.__enter__ = MagicMock(return_value=MagicMock())
            cm.__exit__ = MagicMock(return_value=False)
            mock_sess.return_value = cm

            _emit_check_analyzed(
                pr_number=42,
                head_sha="abc123",
                verdict="ALIGNED",
                workspace="my-ws",
                repository="psf/requests",
                publish_url=None,
                repo="psf/requests",
                branch=None,
            )

        assert len(captured) == 1
        ev = captured[0]
        assert "42" in ev["summary"]
        assert "psf/requests" in ev["summary"]
        assert ev["category"] == "check:analyzed"
        assert ev["actor"] == "org-sync"
        assert ev["metadata"]["verdict"] == "ALIGNED"

    def test_off_intent_verdict_in_summary(self):
        captured: list[dict] = []

        def fake_emit(events, db_session, is_pg=True):
            captured.extend(events)

        with patch("quire.org_sync.get_session") as mock_sess, \
             patch("quire.org_sync.emit_activity_events", side_effect=fake_emit):
            cm = MagicMock()
            cm.__enter__ = MagicMock(return_value=MagicMock())
            cm.__exit__ = MagicMock(return_value=False)
            mock_sess.return_value = cm

            _emit_check_analyzed(
                pr_number=1,
                head_sha="sha1",
                verdict="OFF_INTENT",
                workspace="ws",
                repository="owner/repo",
                publish_url=None,
                repo="owner/repo",
                branch=None,
            )

        ev = captured[0]
        # vocab label for OFF_INTENT is "Breaks a promise"
        assert "Breaks a promise" in ev["summary"]
        assert "critical" in ev["tags"]


# ---------------------------------------------------------------------------
# GitHubPollEventSource — stubbed adapter
# ---------------------------------------------------------------------------

class TestGitHubPollEventSource:
    def _make_mock_adapter(self, prs_payload: list[dict]) -> MagicMock:
        """Build a mock GitHubWorkspace that returns prs_payload from list_prs."""
        mock = MagicMock()
        mock.list_prs.return_value = prs_payload
        return mock

    def test_poll_events_returns_pr_events(self, tmp_path):
        source = GitHubPollEventSource(
            ws_path=tmp_path,
            repository="psf/requests",
            token=None,
        )
        prs_payload = [
            {
                "number": 10,
                "title": "Fix bug",
                "state": "open",
                "head_sha": "hsha10",
                "base_sha": "bsha10",
                "author": "alice",
                "created_at": "2026-07-23T10:00:00Z",
                "updated_at": "2026-07-23T10:00:00Z",
                "html_url": "https://github.com/psf/requests/pull/10",
            }
        ]
        mock_adapter = self._make_mock_adapter(prs_payload)
        with patch("quire.org_sync.GitHubWorkspace", return_value=mock_adapter):
            events = source.poll_events("psf/requests", None)

        assert len(events) == 1
        ev = events[0]
        assert ev.pr_number == 10
        assert ev.head_sha == "hsha10"
        assert ev.author == "alice"
        assert ev.updated_at == "2026-07-23T10:00:00Z"

    def test_poll_events_multiple_prs(self, tmp_path):
        source = GitHubPollEventSource(
            ws_path=tmp_path,
            repository="psf/requests",
            token=None,
        )
        prs_payload = [
            {
                "number": i,
                "title": f"PR {i}",
                "state": "open",
                "head_sha": f"head{i}",
                "base_sha": f"base{i}",
                "author": "bob",
                "created_at": "2026-07-23T10:00:00Z",
                "updated_at": "2026-07-23T10:00:00Z",
                "html_url": f"https://github.com/psf/requests/pull/{i}",
            }
            for i in range(1, 4)
        ]
        mock_adapter = self._make_mock_adapter(prs_payload)
        with patch("quire.org_sync.GitHubWorkspace", return_value=mock_adapter):
            events = source.poll_events("psf/requests", None)

        assert len(events) == 3
        numbers = {ev.pr_number for ev in events}
        assert numbers == {1, 2, 3}

    def test_poll_events_empty_list(self, tmp_path):
        source = GitHubPollEventSource(
            ws_path=tmp_path,
            repository="psf/requests",
            token=None,
        )
        mock_adapter = self._make_mock_adapter([])
        with patch("quire.org_sync.GitHubWorkspace", return_value=mock_adapter):
            events = source.poll_events("psf/requests", None)

        assert events == []

    def test_poll_events_falls_back_to_created_at_when_no_updated_at(self, tmp_path):
        source = GitHubPollEventSource(
            ws_path=tmp_path,
            repository="owner/repo",
            token=None,
        )
        prs_payload = [
            {
                "number": 1,
                "title": "PR",
                "state": "open",
                "head_sha": "sha1",
                "base_sha": "base1",
                "author": "alice",
                "created_at": "2026-07-23T09:00:00Z",
                # no updated_at key — tests fallback
                "html_url": "https://github.com/owner/repo/pull/1",
            }
        ]
        mock_adapter = self._make_mock_adapter(prs_payload)
        with patch("quire.org_sync.GitHubWorkspace", return_value=mock_adapter):
            events = source.poll_events("owner/repo", None)

        assert len(events) == 1
        # should fall back to created_at
        assert events[0].updated_at == "2026-07-23T09:00:00Z"


# ---------------------------------------------------------------------------
# handle_pr_event — full handler with mocked analysis
# ---------------------------------------------------------------------------

class TestHandlePrEvent:
    def _mock_analysis(self, classification: str = "ALIGNED"):
        """Return a mock PRAnalysis-like object."""
        from quire.models import Classification, ReviewState

        cls_enum = Classification(classification)
        mock = MagicMock()
        mock.classification = cls_enum
        mock.comment_markdown = f"<!-- quire-align -->\nVerdict: {classification}"
        mock.from_cache = False
        return mock

    def _minimal_ws(self, tmp_path: pathlib.Path) -> pathlib.Path:
        """Create a minimal workspace directory (prs.yaml + obligations.yaml)."""
        ws_path = tmp_path / "myws"
        ws_path.mkdir()
        (ws_path / "obligations.yaml").write_text("obligations: []\n")
        (ws_path / "prs.yaml").write_text("# PRs\n{}\n")
        (ws_path / "sources.yaml").write_text("sources: []\n")
        return ws_path

    def _mock_adapter(self) -> MagicMock:
        """Return a mock GitHubWorkspace instance."""
        mock = MagicMock()
        mock.get_pr.return_value = MagicMock()
        mock.publish_comment.return_value = "https://github.com/comment/1"
        return mock

    def test_returns_verdict_on_success(self, tmp_path):
        ws_path = self._minimal_ws(tmp_path)
        ev = _make_event(pr_number=5, head_sha="sha5")
        mock_analysis = self._mock_analysis("ALIGNED")
        mock_adapter = self._mock_adapter()

        with patch("quire.org_sync.run_analysis", return_value=mock_analysis), \
             patch("quire.org_sync._emit_check_analyzed"), \
             patch("quire.org_sync.GitHubWorkspace", return_value=mock_adapter):
            result = handle_pr_event(
                ev,
                workspace="myws",
                ws_path=ws_path,
                owner="psf",
                name="requests",
                github_remote="https://github.com/psf/requests",
                alignment_store=MagicMock(),
                link_store=None,
                token=None,
            )

        assert result["pr_number"] == 5
        assert result["verdict"] == "ALIGNED"
        assert result["error"] is None

    def test_marks_sha_seen_after_analysis(self, tmp_path):
        ws_path = self._minimal_ws(tmp_path)
        ev = _make_event(pr_number=5, head_sha="sha5")
        mock_analysis = self._mock_analysis("ALIGNED")
        mock_adapter = self._mock_adapter()

        with patch("quire.org_sync.run_analysis", return_value=mock_analysis), \
             patch("quire.org_sync._emit_check_analyzed"), \
             patch("quire.org_sync.GitHubWorkspace", return_value=mock_adapter):
            handle_pr_event(
                ev,
                workspace="myws",
                ws_path=ws_path,
                owner="psf",
                name="requests",
                github_remote="https://github.com/psf/requests",
                alignment_store=MagicMock(),
                link_store=None,
                token=None,
            )

        seen = _load_seen_shas(ws_path)
        assert "sha5" in seen

    def test_error_result_on_analysis_failure(self, tmp_path):
        ws_path = self._minimal_ws(tmp_path)
        ev = _make_event(pr_number=5, head_sha="sha5")

        with patch("quire.org_sync.run_analysis", side_effect=RuntimeError("boom")), \
             patch("quire.org_sync._emit_check_analyzed"), \
             patch("quire.org_sync.GitHubWorkspace", return_value=self._mock_adapter()):
            result = handle_pr_event(
                ev,
                workspace="myws",
                ws_path=ws_path,
                owner="psf",
                name="requests",
                github_remote="https://github.com/psf/requests",
                alignment_store=MagicMock(),
                link_store=None,
                token=None,
            )

        assert result["error"] == "boom"
        assert result["verdict"] is None

    def test_no_publish_for_non_giladax(self, tmp_path):
        ws_path = self._minimal_ws(tmp_path)
        # Even with publish_enabled, non-giladax remote blocks publishing
        _save_sync_meta(ws_path, {"publish_enabled": True})
        ev = _make_event(pr_number=5, head_sha="sha5")
        mock_analysis = self._mock_analysis("OFF_INTENT")
        mock_adapter = self._mock_adapter()

        with patch("quire.org_sync.run_analysis", return_value=mock_analysis), \
             patch("quire.org_sync._emit_check_analyzed"), \
             patch("quire.org_sync.GitHubWorkspace", return_value=mock_adapter):
            result = handle_pr_event(
                ev,
                workspace="myws",
                ws_path=ws_path,
                owner="psf",
                name="requests",
                github_remote="https://github.com/psf/requests",  # non-giladax
                alignment_store=MagicMock(),
                link_store=None,
                token=None,
            )

        mock_adapter.publish_comment.assert_not_called()
        assert result["publish_url"] is None

    def test_cache_hit_sets_skipped_true(self, tmp_path):
        """When run_analysis reports a cache hit (from_cache=True), skipped must be True.

        Revert-check guard for review finding #2: the old code did
        `getattr(result, "from_cache", False)` against a PRAnalysis that had
        no such field — the cached flag lived on AnalysisState and
        run_analysis discarded it, so skipped was ALWAYS False.
        """
        from quire.models import PRAnalysis  # real model — getattr default must not mask
        ws_path = self._minimal_ws(tmp_path)
        ev = _make_event(pr_number=5, head_sha="sha5")
        mock_analysis = self._mock_analysis("ALIGNED")
        mock_analysis.from_cache = True  # graph reported an identity-cache hit
        mock_adapter = self._mock_adapter()

        with patch("quire.org_sync.run_analysis", return_value=mock_analysis), \
             patch("quire.org_sync._emit_check_analyzed"), \
             patch("quire.org_sync.GitHubWorkspace", return_value=mock_adapter):
            result = handle_pr_event(
                ev,
                workspace="myws",
                ws_path=ws_path,
                owner="psf",
                name="requests",
                github_remote="https://github.com/psf/requests",
                alignment_store=MagicMock(),
                link_store=None,
                token=None,
            )

        assert result["skipped"] is True, (
            "Cache hit must surface as skipped=True in the handler result"
        )
        # The contract the handler relies on: PRAnalysis carries from_cache.
        assert "from_cache" in PRAnalysis.model_fields, (
            "PRAnalysis must define from_cache — without it the handler's "
            "getattr silently returns False forever (the original bug)"
        )

    def test_cache_hit_does_not_emit_check_analyzed(self, tmp_path):
        """Cache hit must NOT emit a duplicate check:analyzed event."""
        ws_path = self._minimal_ws(tmp_path)
        ev = _make_event(pr_number=5, head_sha="sha5")
        mock_analysis = self._mock_analysis("ALIGNED")
        mock_analysis.from_cache = True
        mock_adapter = self._mock_adapter()

        with patch("quire.org_sync.run_analysis", return_value=mock_analysis), \
             patch("quire.org_sync._emit_check_analyzed") as mock_emit, \
             patch("quire.org_sync.GitHubWorkspace", return_value=mock_adapter):
            handle_pr_event(
                ev,
                workspace="myws",
                ws_path=ws_path,
                owner="psf",
                name="requests",
                github_remote="https://github.com/psf/requests",
                alignment_store=MagicMock(),
                link_store=None,
                token=None,
            )

        mock_emit.assert_not_called()

    def test_cache_hit_does_not_remark_sha_seen(self, tmp_path):
        """Cache hit must not re-mark the sha as seen (it's already tracked)."""
        ws_path = self._minimal_ws(tmp_path)
        ev = _make_event(pr_number=5, head_sha="sha5")
        mock_analysis = self._mock_analysis("ALIGNED")
        mock_analysis.from_cache = True
        mock_adapter = self._mock_adapter()

        with patch("quire.org_sync.run_analysis", return_value=mock_analysis), \
             patch("quire.org_sync._emit_check_analyzed"), \
             patch("quire.org_sync.GitHubWorkspace", return_value=mock_adapter):
            handle_pr_event(
                ev,
                workspace="myws",
                ws_path=ws_path,
                owner="psf",
                name="requests",
                github_remote="https://github.com/psf/requests",
                alignment_store=MagicMock(),
                link_store=None,
                token=None,
            )

        seen = _load_seen_shas(ws_path)
        assert "sha5" not in seen, "Cache hit must not re-mark sha as seen"

    def test_cache_hit_skips_publish(self, tmp_path):
        """Cache hit must not publish a comment even when publishing is allowed."""
        ws_path = self._minimal_ws(tmp_path)
        _save_sync_meta(ws_path, {"publish_enabled": True})
        ev = _make_event(pr_number=5, head_sha="sha5")
        mock_analysis = self._mock_analysis("OFF_INTENT")  # LOUD verdict
        mock_analysis.from_cache = True
        mock_adapter = self._mock_adapter()

        with patch("quire.org_sync.run_analysis", return_value=mock_analysis), \
             patch("quire.org_sync._emit_check_analyzed"), \
             patch("quire.org_sync.GitHubWorkspace", return_value=mock_adapter):
            result = handle_pr_event(
                ev,
                workspace="intent-ai",
                ws_path=ws_path,
                owner="giladax",
                name="intent-ai",
                github_remote="https://github.com/giladax/intent-ai",
                alignment_store=MagicMock(),
                link_store=None,
                token=None,
            )

        mock_adapter.publish_comment.assert_not_called()
        assert result["publish_url"] is None
        assert result["skipped"] is True

    def test_publish_comment_called_for_giladax_loud_verdict(self, tmp_path):
        """Publish-ON path: giladax remote + publish_enabled=true + LOUD verdict
        → adapter.publish_comment IS called (complements the OFF-side tests)."""
        ws_path = self._minimal_ws(tmp_path)
        _save_sync_meta(ws_path, {"publish_enabled": True})
        ev = _make_event(pr_number=10, head_sha="sha10")
        mock_analysis = self._mock_analysis("OFF_INTENT")  # LOUD → must publish
        mock_adapter = self._mock_adapter()
        mock_adapter.publish_comment.return_value = (
            "https://github.com/giladax/intent-ai/pull/10#issuecomment-1"
        )

        with patch("quire.org_sync.run_analysis", return_value=mock_analysis), \
             patch("quire.org_sync._emit_check_analyzed"), \
             patch("quire.org_sync.GitHubWorkspace", return_value=mock_adapter):
            result = handle_pr_event(
                ev,
                workspace="intent-ai",
                ws_path=ws_path,
                owner="giladax",
                name="intent-ai",
                github_remote="https://github.com/giladax/intent-ai",  # giladax ✓
                alignment_store=MagicMock(),
                link_store=None,
                token=None,
            )

        mock_adapter.publish_comment.assert_called_once()
        assert result["publish_url"] == (
            "https://github.com/giladax/intent-ai/pull/10#issuecomment-1"
        )
        assert result["verdict"] == "OFF_INTENT"
        assert result["error"] is None

    def test_emits_check_analyzed_event(self, tmp_path):
        ws_path = self._minimal_ws(tmp_path)
        ev = _make_event(pr_number=7, head_sha="sha7")
        mock_analysis = self._mock_analysis("PARTIAL")
        mock_adapter = self._mock_adapter()

        emitted: list[dict] = []

        def capture_emit(**kwargs):
            emitted.append(kwargs)

        with patch("quire.org_sync.run_analysis", return_value=mock_analysis), \
             patch("quire.org_sync._emit_check_analyzed", side_effect=capture_emit), \
             patch("quire.org_sync.GitHubWorkspace", return_value=mock_adapter):
            handle_pr_event(
                ev,
                workspace="myws",
                ws_path=ws_path,
                owner="psf",
                name="requests",
                github_remote="https://github.com/psf/requests",
                alignment_store=MagicMock(),
            )

        assert len(emitted) == 1
        kwargs = emitted[0]
        assert kwargs["pr_number"] == 7
        assert kwargs["verdict"] == "PARTIAL"
        assert kwargs["workspace"] == "myws"


# ---------------------------------------------------------------------------
# sync_org — top-level pass
# ---------------------------------------------------------------------------

class TestSyncOrg:
    def _make_org_store(
        self,
        repos: list[dict],
    ) -> MagicMock:
        mock = MagicMock()
        mock.list_repos.return_value = repos
        return mock

    def _mock_analysis(self, classification: str = "ALIGNED"):
        from quire.models import Classification
        m = MagicMock()
        m.classification = Classification(classification)
        m.comment_markdown = "## verdict"
        m.from_cache = False
        return m

    def test_skips_non_active_repos(self, tmp_path):
        """Status != "active" repos are not polled."""
        org_store = self._make_org_store([
            {
                "workspace": "frozen-ws",
                "status": "frozen",
                "github_remote": "https://github.com/psf/requests",
            }
        ])

        with patch("quire.org_sync.GitHubPollEventSource.poll_events") as mock_poll:
            results = sync_org(
                org_store,
                MagicMock(),
                workspaces_root=tmp_path,
            )

        mock_poll.assert_not_called()
        assert results == []

    def test_skips_repos_without_github_remote(self, tmp_path):
        """Repos with no github_remote are not polled."""
        org_store = self._make_org_store([
            {
                "workspace": "local-ws",
                "status": "active",
                "github_remote": None,
            }
        ])

        with patch("quire.org_sync.GitHubPollEventSource.poll_events") as mock_poll:
            results = sync_org(
                org_store,
                MagicMock(),
                workspaces_root=tmp_path,
            )

        mock_poll.assert_not_called()
        assert results == []

    def test_skips_repos_without_workspace_dir(self, tmp_path):
        """Repos whose workspace directory doesn't exist are skipped."""
        org_store = self._make_org_store([
            {
                "workspace": "missing-ws",
                "status": "active",
                "github_remote": "https://github.com/psf/requests",
            }
        ])

        with patch("quire.org_sync.GitHubPollEventSource.poll_events") as mock_poll:
            results = sync_org(
                org_store,
                MagicMock(),
                workspaces_root=tmp_path,
            )

        mock_poll.assert_not_called()

    def test_analyzes_new_prs(self, tmp_path):
        """New head SHAs trigger analysis."""
        ws_path = tmp_path / "psf-requests"
        ws_path.mkdir()
        (ws_path / "obligations.yaml").write_text("obligations: []\n")
        (ws_path / "prs.yaml").write_text("{}\n")
        (ws_path / "sources.yaml").write_text("sources: []\n")

        org_store = self._make_org_store([
            {
                "workspace": "psf-requests",
                "status": "active",
                "github_remote": "https://github.com/psf/requests",
            }
        ])

        events = [
            _make_event(pr_number=100, head_sha="newsha100"),
        ]
        mock_result = self._mock_analysis("ALIGNED")

        with patch("quire.org_sync.GitHubPollEventSource.poll_events", return_value=events), \
             patch("quire.org_sync.handle_pr_event") as mock_handle:
            mock_handle.return_value = {
                "pr_number": 100,
                "head_sha": "newsha100",
                "verdict": "ALIGNED",
                "skipped": False,
                "publish_url": None,
                "error": None,
            }
            results = sync_org(
                org_store,
                MagicMock(),
                workspaces_root=tmp_path,
            )

        assert len(results) == 1
        assert results[0]["events_polled"] == 1
        assert results[0]["analyzed"] == 1
        mock_handle.assert_called_once()

    def test_skips_already_seen_shas(self, tmp_path):
        """Already-analyzed head SHAs are not re-analyzed."""
        ws_path = tmp_path / "my-repo"
        ws_path.mkdir()
        # Pre-mark the sha as seen
        _mark_sha_seen(ws_path, "seensha")
        (ws_path / "prs.yaml").write_text("{}\n")

        org_store = self._make_org_store([
            {
                "workspace": "my-repo",
                "status": "active",
                "github_remote": "https://github.com/psf/requests",
            }
        ])
        events = [_make_event(pr_number=1, head_sha="seensha")]

        with patch("quire.org_sync.GitHubPollEventSource.poll_events", return_value=events), \
             patch("quire.org_sync.handle_pr_event") as mock_handle:
            results = sync_org(
                org_store,
                MagicMock(),
                workspaces_root=tmp_path,
            )

        mock_handle.assert_not_called()
        assert results[0]["analyzed"] == 0

    def test_max_prs_cap_respected(self, tmp_path):
        """max_prs_per_repo caps the number of PRs analyzed per pass."""
        ws_path = tmp_path / "busy-repo"
        ws_path.mkdir()
        (ws_path / "prs.yaml").write_text("{}\n")

        org_store = self._make_org_store([
            {
                "workspace": "busy-repo",
                "status": "active",
                "github_remote": "https://github.com/psf/requests",
            }
        ])
        # 10 new PRs
        events = [_make_event(pr_number=i, head_sha=f"sha{i}") for i in range(1, 11)]

        handle_calls: list = []

        def fake_handle(ev, **kwargs):
            handle_calls.append(ev.pr_number)
            return {
                "pr_number": ev.pr_number,
                "head_sha": ev.head_sha,
                "verdict": "ALIGNED",
                "skipped": False,
                "publish_url": None,
                "error": None,
            }

        with patch("quire.org_sync.GitHubPollEventSource.poll_events", return_value=events), \
             patch("quire.org_sync.handle_pr_event", side_effect=fake_handle):
            sync_org(
                org_store,
                MagicMock(),
                workspaces_root=tmp_path,
                max_prs_per_repo=3,
            )

        assert len(handle_calls) == 3  # capped at 3

    def test_summary_counts_cache_hit_as_skipped(self, tmp_path):
        """A cache-hit result (skipped=True) must NOT count toward `analyzed`."""
        ws_path = tmp_path / "psf-requests"
        ws_path.mkdir()
        (ws_path / "prs.yaml").write_text("{}\n")

        org_store = self._make_org_store([
            {
                "workspace": "psf-requests",
                "status": "active",
                "github_remote": "https://github.com/psf/requests",
            }
        ])
        events = [_make_event(pr_number=100, head_sha="cachedsha")]

        with patch("quire.org_sync.GitHubPollEventSource.poll_events", return_value=events), \
             patch("quire.org_sync.handle_pr_event") as mock_handle:
            mock_handle.return_value = {
                "pr_number": 100,
                "head_sha": "cachedsha",
                "verdict": "ALIGNED",
                "skipped": True,  # cache hit within the pass
                "publish_url": None,
                "error": None,
            }
            results = sync_org(
                org_store,
                MagicMock(),
                workspaces_root=tmp_path,
            )

        assert results[0]["events_polled"] == 1
        assert results[0]["analyzed"] == 0, (
            "Cache-hit (skipped) results must not count as analyzed in the summary"
        )

    def test_poll_error_returns_error_in_result(self, tmp_path):
        """If poll_events raises, the error is recorded and we continue."""
        ws_path = tmp_path / "broken-repo"
        ws_path.mkdir()

        org_store = self._make_org_store([
            {
                "workspace": "broken-repo",
                "status": "active",
                "github_remote": "https://github.com/psf/requests",
            }
        ])

        with patch("quire.org_sync.GitHubPollEventSource.poll_events",
                   side_effect=RuntimeError("network error")):
            results = sync_org(
                org_store,
                MagicMock(),
                workspaces_root=tmp_path,
            )

        assert len(results) == 1
        assert results[0]["error"] == "network error"
        assert results[0]["events_polled"] == 0

    def test_updates_last_seen_updated_at(self, tmp_path):
        """After a successful pass, last_seen_updated_at is stored."""
        ws_path = tmp_path / "psf-requests"
        ws_path.mkdir()
        (ws_path / "prs.yaml").write_text("{}\n")

        org_store = self._make_org_store([
            {
                "workspace": "psf-requests",
                "status": "active",
                "github_remote": "https://github.com/psf/requests",
            }
        ])
        events = [
            _make_event(pr_number=1, head_sha="sha1", updated_at="2026-07-23T12:00:00Z"),
            _make_event(pr_number=2, head_sha="sha2", updated_at="2026-07-23T11:00:00Z"),
        ]
        # Mark both shas as already seen so no analysis
        _mark_sha_seen(ws_path, "sha1")
        _mark_sha_seen(ws_path, "sha2")

        with patch("quire.org_sync.GitHubPollEventSource.poll_events", return_value=events):
            sync_org(org_store, MagicMock(), workspaces_root=tmp_path)

        meta = _load_sync_meta(ws_path)
        # Should track the latest (max) updated_at across polled events
        assert meta.get("last_seen_updated_at") == "2026-07-23T12:00:00Z"

    def test_multiple_repos_processed_independently(self, tmp_path):
        """Two repos are each polled and results are independent."""
        for ws_name in ("repo-a", "repo-b"):
            ws = tmp_path / ws_name
            ws.mkdir()
            (ws / "prs.yaml").write_text("{}\n")

        org_store = self._make_org_store([
            {
                "workspace": "repo-a",
                "status": "active",
                "github_remote": "https://github.com/psf/requests",
            },
            {
                "workspace": "repo-b",
                "status": "active",
                "github_remote": "https://github.com/pallets/itsdangerous",
            },
        ])

        with patch("quire.org_sync.GitHubPollEventSource.poll_events", return_value=[]):
            results = sync_org(org_store, MagicMock(), workspaces_root=tmp_path)

        assert len(results) == 2
        workspaces = {r["workspace"] for r in results}
        assert workspaces == {"repo-a", "repo-b"}


# ---------------------------------------------------------------------------
# GitHub adapter list_prs updated_at field guard
# ---------------------------------------------------------------------------

class TestGithubAdapterUpdatedAt:
    """Guard that GitHubWorkspace.list_prs returns updated_at."""

    def test_list_prs_includes_updated_at(self):
        from quire.adapters.github import GitHubWorkspace

        pr_payload = [
            {
                "number": 1,
                "title": "Test PR",
                "state": "open",
                "head": {"sha": "headsha"},
                "base": {"sha": "basesha"},
                "user": {"login": "alice"},
                "created_at": "2026-07-23T10:00:00Z",
                "updated_at": "2026-07-23T11:00:00Z",
                "html_url": "https://github.com/owner/repo/pull/1",
            }
        ]

        # Build adapter with a stub session
        import fixtures as _  # noqa
        from quire.adapters.fixture import FixtureWorkspace
        import pathlib

        # We just test the list_prs parsing logic directly
        # by building a stub that returns the payload
        class _Resp:
            status_code = 200
            def json(self): return pr_payload
            def raise_for_status(self): pass

        class _Session:
            headers = {}
            def get(self, url, params=None, headers=None):
                return _Resp()

        # Build workspace manually bypassing __init__ to avoid filesystem
        ws = object.__new__(GitHubWorkspace)
        ws.repo = "owner/repo"
        ws.session = _Session()
        ws._issue_pattern = None
        ws.local = MagicMock()

        items = ws.list_prs(state="open", max_pages=1)
        assert len(items) == 1
        assert "updated_at" in items[0]
        assert items[0]["updated_at"] == "2026-07-23T11:00:00Z"
