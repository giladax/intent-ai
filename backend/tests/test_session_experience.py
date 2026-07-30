"""Tests for quire.session_experience — the session page contract.

Coverage:
1. parse_conversation — prompts first-class, tool calls paired with results,
   file-change artifacts (mini-diffs), effort figures, malformed lines skipped
2. anchor_quote — exact, whitespace-tolerant, honest None
3. build_experience — resolution by cc id / upload id, digest join,
   referenced_by (links → verdict), produced (intent memos), missing
   transcript degrades honestly, unknown session → None
4. build_ledger — workspace sweep, per-repo aggregation, failure-safe
5. Router — GET /api/sessions/{id}/experience and /api/sessions/ledger
   (injectable stores; 404 in plain language)
6. resolve_workspace_name — org_repos mapping wins over name-slicing;
   failure-safe fallback
"""
from __future__ import annotations

import json
import pathlib

import pytest
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SESSION_ID = "sx-demo-session-001"


def _transcript_lines() -> list[dict]:
    return [
        {"sessionId": SESSION_ID, "timestamp": "2026-07-18T14:22:00Z", "type": "user",
         "userType": "external",
         "message": {"role": "user",
                     "content": "Raise the premium auto-approval limit to $250. Policy-only change."}},
        {"sessionId": SESSION_ID, "timestamp": "2026-07-18T14:22:10Z", "type": "assistant",
         "requestId": "req_1",
         "message": {"role": "assistant", "content": [
             {"type": "text", "text": "I'll read the policy module first."},
             {"type": "tool_use", "id": "toolu_read1", "name": "Read",
              "input": {"file_path": "/repo/swiftrefunds/policy.py"}},
         ]}},
        {"sessionId": SESSION_ID, "timestamp": "2026-07-18T14:22:20Z", "type": "user",
         "userType": "external",
         "message": {"role": "user", "content": [
             {"type": "tool_result", "tool_use_id": "toolu_read1",
              "content": [{"type": "text", "text": "TIER_PREMIUM: 100.00,"}]},
         ]}},
        {"sessionId": SESSION_ID, "timestamp": "2026-07-18T14:23:00Z", "type": "assistant",
         "requestId": "req_2",
         "message": {"role": "assistant", "content": [
             {"type": "text", "text": "Updating the limit now."},
             {"type": "tool_use", "id": "toolu_edit1", "name": "Edit",
              "input": {"file_path": "/repo/swiftrefunds/policy.py",
                        "old_string": "    TIER_PREMIUM: 100.00,",
                        "new_string": "    TIER_PREMIUM: 250.00,"}},
             {"type": "tool_use", "id": "toolu_bash1", "name": "Bash",
              "input": {"command": "pytest --tb=short"}},
         ]}},
        {"sessionId": SESSION_ID, "timestamp": "2026-07-18T14:24:00Z", "type": "user",
         "userType": "external",
         "message": {"role": "user", "content": [
             {"type": "tool_result", "tool_use_id": "toolu_bash1",
              "content": "34 passed, 1 warning in 0.24s"},
         ]}},
        {"sessionId": SESSION_ID, "timestamp": "2026-07-18T14:25:00Z", "type": "assistant",
         "requestId": "req_3",
         "message": {"role": "assistant", "content": [
             {"type": "text",
              "text": "All green. I noted there is no end-to-end test for the "
                      "new range; tracking that guard update separately."},
         ]}},
    ]


def _write_transcript(tmp_path: pathlib.Path, name: str = "sx-demo.jsonl") -> pathlib.Path:
    p = tmp_path / name
    lines = [json.dumps(l) for l in _transcript_lines()]
    lines.insert(2, "{not json")  # malformed line must be skipped, not fatal
    p.write_text("\n".join(lines))
    return p


def _make_engine(tmp_path: pathlib.Path | None = None):
    """File-based SQLite when tmp_path is given — TestClient runs endpoints
    in worker threads, and SQLite :memory: is connection-scoped (a new
    thread's connection sees an empty DB). In-memory otherwise."""
    from quire.db.engine import make_test_engine
    from quire.db.models import Base
    from quire.links import SessionCheck  # noqa: F401 — registers table
    from quire.sessions_api import SessionUpload  # noqa: F401 — registers table

    url = f"sqlite:///{tmp_path / 'test.db'}" if tmp_path else "sqlite:///:memory:"
    eng = make_test_engine(url)
    Base.metadata.create_all(eng)
    return eng


# ---------------------------------------------------------------------------
# 1. parse_conversation
# ---------------------------------------------------------------------------

class TestParseConversation:
    def test_prompts_are_first_class(self, tmp_path):
        from quire.session_experience import parse_conversation

        convo = parse_conversation(_write_transcript(tmp_path))
        users = [t for t in convo["turns"] if t["role"] == "user"]
        assert len(users) == 1
        assert users[0]["text"].startswith("Raise the premium")
        assert convo["session_id"] == SESSION_ID

    def test_tool_calls_paired_with_results(self, tmp_path):
        from quire.session_experience import parse_conversation

        convo = parse_conversation(_write_transcript(tmp_path))
        tools = [
            b for t in convo["turns"] if t["role"] == "assistant"
            for b in t["blocks"] if b["type"] == "tool"
        ]
        by_name = {b["name"]: b for b in tools}
        assert by_name["Read"]["summary"] == "Read policy.py"
        assert "TIER_PREMIUM" in by_name["Read"]["result_display"]
        assert by_name["Bash"]["result_note"] == "34 passed, 1 warning in 0.24s"

    def test_edit_becomes_change_artifact_with_diff(self, tmp_path):
        from quire.session_experience import parse_conversation

        convo = parse_conversation(_write_transcript(tmp_path))
        edit = next(
            b for t in convo["turns"] if t["role"] == "assistant"
            for b in t["blocks"] if b["type"] == "tool" and b["name"] == "Edit"
        )
        fc = edit["file_change"]
        assert fc["path"].endswith("swiftrefunds/policy.py")
        assert "-    TIER_PREMIUM: 100.00," in fc["diff"]
        assert "+    TIER_PREMIUM: 250.00," in fc["diff"]
        # the turn aggregates its artifacts
        turn = next(t for t in convo["turns"] if t["role"] == "assistant"
                    and t["files_changed"])
        assert turn["files_changed"][0]["path"].endswith("policy.py")

    def test_effort_figures(self, tmp_path):
        from quire.session_experience import parse_conversation

        convo = parse_conversation(_write_transcript(tmp_path))
        e = convo["effort"]
        assert e["prompts"] == 1
        assert e["assistant_turns"] == 3
        assert e["tool_calls"] == 3
        assert e["files_touched"] == 1
        assert e["duration_seconds"] == 180  # 14:22 → 14:25


# ---------------------------------------------------------------------------
# 2. anchor_quote
# ---------------------------------------------------------------------------

class TestAnchorQuote:
    def _turns(self, tmp_path):
        from quire.session_experience import parse_conversation
        return parse_conversation(_write_transcript(tmp_path))["turns"]

    def test_exact_anchor(self, tmp_path):
        from quire.session_experience import anchor_quote

        turns = self._turns(tmp_path)
        a = anchor_quote(turns, "tracking that guard update separately")
        assert a is not None
        text = turns[a["turn"]]["blocks"][a["block"]]["text"]
        assert text[a["start"]:a["end"]] == "tracking that guard update separately"

    def test_whitespace_tolerant(self, tmp_path):
        from quire.session_experience import anchor_quote

        turns = self._turns(tmp_path)
        a = anchor_quote(turns, "tracking  that guard\nupdate separately")
        assert a is not None

    def test_user_prompt_anchors(self, tmp_path):
        from quire.session_experience import anchor_quote

        turns = self._turns(tmp_path)
        a = anchor_quote(turns, "Policy-only change.")
        assert a is not None
        assert turns[a["turn"]]["role"] == "user"

    def test_unresolvable_quote_is_none(self, tmp_path):
        from quire.session_experience import anchor_quote

        assert anchor_quote(self._turns(tmp_path), "never said this") is None


# ---------------------------------------------------------------------------
# 3. build_experience
# ---------------------------------------------------------------------------

def _upload_store_with(tmp_path, transcript: pathlib.Path, pr: int | None = 2):
    from quire.sessions_api import UploadStore, process_upload
    from quire.session import Decision, FakeSessionDigester, SessionDigest

    store = UploadStore(engine=_make_engine(tmp_path))
    ws = tmp_path / "workspaces" / "swift-ws"
    ws.mkdir(parents=True)
    digester = FakeSessionDigester(SessionDigest(
        title="Raise the premium limit",
        summary="Raised the premium auto-approval limit to $250.",
        decisions=[Decision(choice="No guard edits", why="policy is source of truth",
                            rejected="hard-coded guard check")],
        reasoning="tracking that guard update separately",
    ))
    from quire.links import LinkStore
    link_store = LinkStore(engine=store._engine)
    record = process_upload(
        transcript_bytes=transcript.read_bytes(),
        filename=transcript.name,
        provider="claude-code", format="jsonl-v1",
        repo="giladax/swiftrefunds", branch=None,
        commits=[], pr_number=pr, actor="dana",
        as_intent=False, upload_store=store,
        link_store=link_store,
        archive_dir=tmp_path / "archive",
        digester=digester,
        workspace_dir=ws,
    )
    return store, link_store, ws, record


class TestBuildExperience:
    def test_resolves_by_cc_session_id_with_digest_and_quotes(self, tmp_path):
        from quire.session_experience import build_experience

        transcript = _write_transcript(tmp_path)
        store, link_store, ws, record = _upload_store_with(tmp_path, transcript)
        assert record.status == "digested"

        exp = build_experience(
            SESSION_ID,
            upload_store=store, link_store=link_store,
            journal_engine=store._engine,   # empty journal tables — no moment quotes
            workspaces_dir=ws.parent,
        )
        assert exp is not None
        assert exp["session_id"] == SESSION_ID
        assert exp["header"]["title"] == "Raise the premium limit"
        assert exp["header"]["repo"] == "giladax/swiftrefunds"
        assert exp["header"]["actor"] == "dana"
        assert exp["header"]["effort"]["tool_calls"] == 3
        assert exp["digest"]["decisions"][0]["choice"] == "No guard edits"
        assert len(exp["turns"]) == 4

    def test_referenced_by_carries_the_coupled_check(self, tmp_path):
        from quire.session_experience import build_experience

        transcript = _write_transcript(tmp_path)
        store, link_store, ws, _ = _upload_store_with(tmp_path, transcript, pr=2)
        exp = build_experience(
            SESSION_ID,
            upload_store=store, link_store=link_store,
            journal_engine=store._engine,
            workspaces_dir=ws.parent,
        )
        refs = exp["referenced_by"]
        assert len(refs) == 1
        assert refs[0]["pr_number"] == 2
        assert refs[0]["link"].endswith("/review/2")
        # no analysis store injected — the label degrades honestly
        assert refs[0]["label"] == "Awaiting review"

    def test_resolves_by_upload_id(self, tmp_path):
        from quire.session_experience import build_experience

        transcript = _write_transcript(tmp_path)
        store, link_store, ws, record = _upload_store_with(tmp_path, transcript)
        exp = build_experience(
            record.id,
            upload_store=store, link_store=link_store,
            journal_engine=store._engine,
            workspaces_dir=ws.parent,
        )
        assert exp is not None and exp["session_id"] == SESSION_ID

    def test_missing_transcript_degrades_honestly(self, tmp_path):
        from quire.session_experience import build_experience

        transcript = _write_transcript(tmp_path)
        store, link_store, ws, _ = _upload_store_with(tmp_path, transcript)
        # wipe the archive out from under the record
        for p in (tmp_path / "archive").iterdir():
            p.unlink()
        transcript.unlink()
        exp = build_experience(
            SESSION_ID,
            upload_store=store, link_store=link_store,
            journal_engine=store._engine,
            workspaces_dir=ws.parent,
        )
        assert exp is not None
        assert exp["turns"] == []
        assert any("transcript" in n for n in exp["notes"])
        assert exp["digest"]["title"] == "Raise the premium limit"

    def test_unknown_session_is_none(self, tmp_path):
        from quire.session_experience import build_experience

        store = None
        from quire.sessions_api import UploadStore
        store = UploadStore(engine=_make_engine())
        exp = build_experience(
            "no-such-session",
            upload_store=store,
            journal_engine=store._engine,
            workspaces_dir=tmp_path / "empty-ws",
        )
        assert exp is None

    def test_produced_lists_intent_memos(self, tmp_path):
        from quire.session_experience import build_experience

        transcript = _write_transcript(tmp_path)
        store, link_store, ws, _ = _upload_store_with(tmp_path, transcript)
        intent_dir = ws / "intent"
        intent_dir.mkdir()
        (intent_dir / "memo.md").write_text(
            f"# Session memo\nsource session: {SESSION_ID}\n"
        )
        (ws / "sources.yaml").write_text(
            "- reference: session-memo-abc123\n"
            "  path: intent/memo.md\n"
            "  title: Premium refunds direction\n"
        )
        exp = build_experience(
            SESSION_ID,
            upload_store=store, link_store=link_store,
            journal_engine=store._engine,
            workspaces_dir=ws.parent,
        )
        assert exp["produced"] == [{
            "kind": "intent_memo",
            "reference": "session-memo-abc123",
            "title": "Premium refunds direction",
            "workspace": "swift-ws",
            "link": "/intent/swift-ws",
        }]


# ---------------------------------------------------------------------------
# 4. build_ledger
# ---------------------------------------------------------------------------

class TestBuildLedger:
    def test_aggregates_by_repo(self, tmp_path):
        from quire.session_experience import build_ledger

        transcript = _write_transcript(tmp_path)
        store, _, ws, _ = _upload_store_with(tmp_path, transcript)
        ledger = build_ledger(workspaces_dir=ws.parent, upload_store=store)
        assert ledger["totals"]["sessions"] == 1
        row = ledger["sessions"][0]
        assert row["session_id"] == SESSION_ID
        assert row["repo"] == "giladax/swiftrefunds"  # joined from the upload
        assert row["actor"] == "dana"
        assert row["link"] == f"/session/{SESSION_ID}"
        assert ledger["by_repo"][0]["sessions"] == 1

    def test_empty_root_is_first_class(self, tmp_path):
        from quire.session_experience import build_ledger

        ledger = build_ledger(workspaces_dir=tmp_path / "nope")
        assert ledger["sessions"] == []
        assert ledger["totals"]["sessions"] == 0


# ---------------------------------------------------------------------------
# 5. Router
# ---------------------------------------------------------------------------

class TestRouter:
    def _client(self, tmp_path, pr=2):
        from fastapi import FastAPI
        from quire.sessions_api import create_sessions_router

        transcript = _write_transcript(tmp_path)
        store, link_store, ws, record = _upload_store_with(tmp_path, transcript, pr=pr)
        app = FastAPI()
        app.include_router(create_sessions_router(
            store,
            link_store=link_store,
            journal_engine=store._engine,
            workspaces_dir=ws.parent,
        ))
        return TestClient(app), record

    def test_experience_endpoint(self, tmp_path):
        client, _ = self._client(tmp_path)
        res = client.get(f"/api/sessions/{SESSION_ID}/experience")
        assert res.status_code == 200
        body = res.json()
        assert body["header"]["title"] == "Raise the premium limit"
        assert body["referenced_by"][0]["pr_number"] == 2
        assert [t["role"] for t in body["turns"]][:2] == ["user", "assistant"]

    def test_experience_404_plain_language(self, tmp_path):
        client, _ = self._client(tmp_path)
        res = client.get("/api/sessions/who-dis/experience")
        assert res.status_code == 404
        assert "no record of session" in res.json()["detail"]

    def test_ledger_endpoint(self, tmp_path):
        client, _ = self._client(tmp_path)
        res = client.get("/api/sessions/ledger")
        assert res.status_code == 200
        body = res.json()
        assert body["totals"]["sessions"] == 1
        assert body["by_repo"][0]["repo"] == "giladax/swiftrefunds"


# ---------------------------------------------------------------------------
# 6. resolve_workspace_name — O6 normalisation
# ---------------------------------------------------------------------------

class TestResolveWorkspaceName:
    def _org_engine(self):
        from quire.db.engine import make_test_engine
        from quire.org_store import OrgStore
        from quire.db.models import Base

        eng = make_test_engine()
        Base.metadata.create_all(eng)
        store = OrgStore(engine=eng)
        store.seed("Acme", "acme", [{
            "id": "acme-swiftrefunds",
            "workspace": "giladax-swiftrefunds",
            "display_name": "giladax/swiftrefunds",
            "repository": "giladax/swiftrefunds",
            "github_remote": "https://github.com/giladax/swiftrefunds",
        }])
        return eng

    def test_repository_key_wins(self):
        from quire.sessions_api import resolve_workspace_name

        assert resolve_workspace_name(
            "giladax/swiftrefunds", org_engine=self._org_engine()
        ) == "giladax-swiftrefunds"

    def test_unknown_repo_falls_back_to_none(self):
        from quire.sessions_api import resolve_workspace_name

        assert resolve_workspace_name(
            "nobody/nothing", org_engine=self._org_engine()
        ) is None

    def test_engineless_lookup_is_failure_safe(self):
        # In tests the conftest guard makes engine-less OrgStore raise —
        # resolve_workspace_name must swallow that and return None.
        from quire.sessions_api import resolve_workspace_name

        assert resolve_workspace_name("giladax/swiftrefunds") is None
