"""Golden tests for the Python MCP brain server.

These tests compare the Python server's responses against golden fixtures
recorded from the TS server. They run against the LIVE Postgres database
(same as other Postgres tests in this suite).

Normalizations applied (documented per test):
- tools/list: description newlines are stripped (FastMCP adds newline from
  multi-line Python docstrings; TS has single-line descriptions). Names and
  required/properties schemas must match exactly.
- write tools (report_observation, report_unknown, rate_context, propose_delta):
  UUIDs differ per run; assertions check structure only (prefix match).
- brain_attention: updated_at timestamp in the stale mark may differ; check
  content structure only.

Golden files are in backend/tests/goldens/mcp/ and were recorded from the
TS server (deterministic read-tool goldens re-recorded 2026-07-22 from the
current TS server against the same DB). Two layers of assertion:
- fast structural tests (format markers, key content) — cheap smoke;
- full-text equality tests (the safety case) — byte-for-byte against the
  golden, no normalization (see the full-text section for rationale).
"""

from __future__ import annotations

import json
import os
import re
import select
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import pytest

GOLDENS_DIR = Path(__file__).parent / "goldens" / "mcp"
BACKEND_DIR = Path(__file__).parent.parent

# ── Fixture helpers ──────────────────────────────────────────────────────

def _load_golden(name: str) -> dict:
    p = GOLDENS_DIR / name
    assert p.exists(), f"Golden fixture missing: {p}"
    with open(p) as f:
        return json.load(f)


def _golden_text(name: str) -> str:
    """Extract the text content from a golden fixture."""
    golden = _load_golden(name)
    content = golden.get("result", {}).get("content", [])
    return content[0].get("text", "") if content else ""


# ── Python MCP server driver ─────────────────────────────────────────────

class McpServerDriver:
    """Drive the Python MCP server via stdin/stdout."""

    def __init__(self):
        self.proc = subprocess.Popen(
            ["python3", "-m", "quire.cli", "mcp"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            cwd=str(BACKEND_DIR),
        )
        self._next_id = 0

    def _send_recv(self, request: dict, timeout: float = 60.0) -> dict:
        msg = json.dumps(request) + "\n"
        self.proc.stdin.write(msg.encode())
        self.proc.stdin.flush()
        deadline = time.time() + timeout
        while time.time() < deadline:
            rlist, _, _ = select.select([self.proc.stdout], [], [], 0.5)
            if rlist:
                line = self.proc.stdout.readline().decode().strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    if obj.get("id") == request.get("id"):
                        return obj
                except json.JSONDecodeError:
                    pass
        raise TimeoutError(f"No response for request id={request.get('id')}")

    def _notify(self, method: str, params: dict | None = None) -> None:
        msg = {"jsonrpc": "2.0", "method": method, "params": params or {}}
        self.proc.stdin.write((json.dumps(msg) + "\n").encode())
        self.proc.stdin.flush()

    def initialize(self) -> dict:
        req = {
            "jsonrpc": "2.0",
            "id": 0,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "golden-test", "version": "0.0.1"},
            },
        }
        resp = self._send_recv(req)
        self._notify("notifications/initialized")
        return resp

    def tools_list(self) -> dict:
        req = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
        return self._send_recv(req)

    def call_tool(self, name: str, args: dict, timeout: float = 60.0) -> dict:
        self._next_id += 10
        req = {
            "jsonrpc": "2.0",
            "id": self._next_id,
            "method": "tools/call",
            "params": {"name": name, "arguments": args},
        }
        return self._send_recv(req, timeout=timeout)

    def close(self) -> None:
        try:
            self.proc.stdin.close()
        except Exception:
            pass
        try:
            os.kill(self.proc.pid, signal.SIGTERM)
        except Exception:
            pass

    def __enter__(self):
        self.initialize()
        return self

    def __exit__(self, *args):
        self.close()


@pytest.fixture(scope="module")
def mcp_driver():
    """Module-scoped MCP driver — one server process per test module."""
    with McpServerDriver() as driver:
        yield driver


# ── _get_repo_context (event repo/branch stamping) ───────────────────────

def test_get_repo_context_walks_to_git_root():
    """_get_repo_context must walk parent dirs to the git root — called from
    backend/ (no .git) it must yield repo='intent-ai' + the real branch,
    not repo='backend' + branch=None. Events feed PR-session coupling, so
    this context must be right."""
    from quire.mcp.server import _get_repo_context

    ctx = _get_repo_context(str(BACKEND_DIR))
    assert ctx["repo"] == "intent-ai", (
        f"Expected repo='intent-ai', got {ctx['repo']!r} — git-root walk broken"
    )
    assert ctx["branch"], "Branch must come from the git root's .git/HEAD"


def test_get_repo_context_synthetic_repo(tmp_path):
    """Walk from a nested subdir of a synthetic repo; stop at filesystem
    root without error when no .git exists."""
    from quire.mcp.server import _get_repo_context

    repo = tmp_path / "myrepo"
    nested = repo / "a" / "b"
    nested.mkdir(parents=True)
    git = repo / ".git"
    git.mkdir()
    (git / "HEAD").write_text("ref: refs/heads/feat/x\n")

    ctx = _get_repo_context(str(nested))
    assert ctx == {"repo": "myrepo", "branch": "feat/x"}

    # No .git anywhere above tmp_path sibling → falls back to basename, no crash
    bare = tmp_path / "no-repo-here"
    bare.mkdir()
    # tmp_path itself lives under /private/tmp or similar which has no .git;
    # if the host has a .git above tmp (unlikely), repo would differ — assert
    # only that it does not crash and branch parsing stays consistent.
    ctx2 = _get_repo_context(str(bare))
    assert isinstance(ctx2["repo"], str) and ctx2["repo"]


# ── Stdout guard test ────────────────────────────────────────────────────

def test_mcp_server_stdout_clean():
    """CRITICAL: the MCP server must not print anything to stdout before
    the JSON-RPC handshake. A single spurious print corrupts the transport."""
    proc = subprocess.Popen(
        ["python3", "-m", "quire.cli", "mcp"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        cwd=str(BACKEND_DIR),
    )
    try:
        init_req = json.dumps({
            "jsonrpc": "2.0",
            "id": 0,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "stdout-guard-test", "version": "0.0.1"},
            },
        }) + "\n"
        proc.stdin.write(init_req.encode())
        proc.stdin.flush()

        # Read exactly one line — it must be JSON-RPC, nothing else
        deadline = time.time() + 30
        lines = []
        while time.time() < deadline:
            rlist, _, _ = select.select([proc.stdout], [], [], 0.5)
            if rlist:
                line = proc.stdout.readline().decode().strip()
                if line:
                    lines.append(line)
                    break

        assert lines, "No output from MCP server"
        first_line = lines[0]
        # Must be valid JSON-RPC (not a dotenv tip, startup message, etc.)
        obj = json.loads(first_line)
        assert obj.get("jsonrpc") == "2.0", f"First stdout line is not JSON-RPC: {first_line!r}"
        assert "result" in obj, f"First response is not a result: {first_line!r}"
    finally:
        try:
            proc.stdin.close()
        except Exception:
            pass
        try:
            os.kill(proc.pid, signal.SIGTERM)
        except Exception:
            pass


# ── tools/list golden ────────────────────────────────────────────────────

def test_tools_list_names(mcp_driver):
    """Python server must expose exactly the same 12 tool names as the TS server."""
    golden = _load_golden("tools_list.json")
    golden_names = sorted(t["name"] for t in golden["result"]["tools"])

    resp = mcp_driver.tools_list()
    python_names = sorted(t["name"] for t in resp["result"]["tools"])

    assert python_names == golden_names


def test_tools_list_required_params(mcp_driver):
    """Required parameter names must match the TS server for each tool."""
    golden = _load_golden("tools_list.json")
    golden_required = {
        t["name"]: sorted(t["inputSchema"].get("required", []))
        for t in golden["result"]["tools"]
    }

    resp = mcp_driver.tools_list()
    python_required = {
        t["name"]: sorted(t["inputSchema"].get("required", []))
        for t in resp["result"]["tools"]
    }

    for name, expected in golden_required.items():
        assert python_required.get(name) == expected, (
            f"{name}: required params mismatch: expected {expected}, got {python_required.get(name)}"
        )


def test_tools_list_input_properties(mcp_driver):
    """Parameter property names (camelCase contract) must match TS server."""
    golden = _load_golden("tools_list.json")
    golden_props = {
        t["name"]: sorted(t["inputSchema"].get("properties", {}).keys())
        for t in golden["result"]["tools"]
    }

    resp = mcp_driver.tools_list()
    python_props = {
        t["name"]: sorted(t["inputSchema"].get("properties", {}).keys())
        for t in resp["result"]["tools"]
    }

    for name, expected in golden_props.items():
        assert python_props.get(name) == expected, (
            f"{name}: property names mismatch: expected {expected}, got {python_props.get(name)}"
        )


def test_tools_list_descriptions(mcp_driver):
    """Tool DESCRIPTIONS must match the golden — names/schemas alone don't
    catch contract drift in what we tell agents each tool does.

    Normalization: whitespace collapsed on both sides (FastMCP renders
    multi-line Python docstrings with embedded newlines; TS descriptions
    are single-line — the words are the contract, not the line wrapping).

    DELIBERATE GOLDEN EDIT (2026-07-22): brain_enter's description in the
    golden was updated from the TS-recorded text 'constraints (if ≤3)' to
    'all constraints inline' — 94ee702 made ALL constraints ride inline and
    the TS copy is stale pre-94ee702 text. The CONTRACT is the Python
    server's now-correct description. If this test fails, either fix the
    server docstring or (for a deliberate contract change) update the
    golden and document it here."""
    golden = _load_golden("tools_list.json")
    golden_desc = {
        t["name"]: t.get("description", "") for t in golden["result"]["tools"]
    }

    def normalize_desc(s: str) -> str:
        return re.sub(r"\s+", " ", s).strip()

    resp = mcp_driver.tools_list()
    python_desc = {
        t["name"]: normalize_desc(t.get("description", ""))
        for t in resp["result"]["tools"]
    }

    for name, expected in golden_desc.items():
        actual = python_desc.get(name, "")
        assert actual == normalize_desc(expected), (
            f"{name}: description drift.\n"
            f"  GOLDEN: {normalize_desc(expected)!r}\n"
            f"  PYTHON: {actual!r}"
        )


# ── brain_search ─────────────────────────────────────────────────────────

@pytest.mark.requires_postgres
def test_brain_search_hit(mcp_driver):
    """brain_search returns Feature cards with ids — structure and content match."""
    golden_text = _golden_text("brain_search_hit.json")
    resp = mcp_driver.call_tool("brain_search", {"query": "mcp server brain tools"})
    content = resp.get("result", {}).get("content", [])
    assert content, "No content in response"
    py_text = content[0].get("text", "")

    # Key structural markers must be present
    assert "###" in py_text, "Missing Feature header"
    assert "[id:" in py_text, "Missing Feature id"
    assert "brain_feature_context(" in py_text, "Missing drill handle"
    assert "_matched via" in py_text, "Missing match-via label"

    # Same top Feature name should appear
    # Extract first feature name from golden
    m = re.search(r"### (.+?)  \[id:", golden_text)
    if m:
        expected_first = m.group(1)
        assert expected_first in py_text, (
            f"Top result '{expected_first}' missing from Python response"
        )


# ── brain_file_context ───────────────────────────────────────────────────

@pytest.mark.requires_postgres
def test_brain_file_context_candidates(mcp_driver):
    """brain_file_context returns candidate list when file is ambiguous."""
    golden_text = _golden_text("brain_file_context_candidates.json")
    resp = mcp_driver.call_tool("brain_file_context", {"file": "journal/src/mcp/server.ts"})
    content = resp.get("result", {}).get("content", [])
    py_text = content[0].get("text", "") if content else ""

    # Both TS and Python should see same ambiguous candidates
    assert "Feature candidates" in py_text or "Feature:" in py_text, (
        f"Unexpected response: {py_text[:200]}"
    )


# ── brain_enter ──────────────────────────────────────────────────────────

@pytest.mark.requires_postgres
def test_brain_enter_task_candidates(mcp_driver):
    """brain_enter with ambiguous task returns candidate list with constraints inline."""
    golden_text = _golden_text("brain_enter_task_hit.json")
    resp = mcp_driver.call_tool("brain_enter", {"task": "implement the MCP brain server"})
    content = resp.get("result", {}).get("content", [])
    py_text = content[0].get("text", "") if content else ""

    assert "Feature candidates" in py_text, "Expected candidate list"
    assert "brain_feature_context(featureId)" in py_text, "Missing drill instruction"

    # 94ee702 behavior: top candidate constraints ride inline
    assert "constraints (verify the Feature match" in py_text, (
        "Missing inline constraints (94ee702 behavior not ported)"
    )


@pytest.mark.requires_postgres
def test_brain_enter_file_candidates(mcp_driver):
    """brain_enter with file that maps ambiguously returns candidates."""
    resp = mcp_driver.call_tool("brain_enter", {"file": "journal/src/mcp/server.ts"})
    content = resp.get("result", {}).get("content", [])
    py_text = content[0].get("text", "") if content else ""

    assert "Feature" in py_text, f"Unexpected response: {py_text[:200]}"


@pytest.mark.requires_postgres
def test_brain_enter_ambiguous_storage(mcp_driver):
    """brain_enter with storage task returns candidate list."""
    golden_text = _golden_text("brain_enter_ambiguous.json")
    resp = mcp_driver.call_tool("brain_enter", {"task": "storage database schema"})
    content = resp.get("result", {}).get("content", [])
    py_text = content[0].get("text", "") if content else ""

    assert "Feature candidates" in py_text, "Expected candidate list"
    # Same first candidate name
    m = re.search(r"- (.+?)  \[id:", golden_text)
    if m:
        expected_first = m.group(1)
        assert expected_first in py_text, (
            f"Top candidate '{expected_first}' missing"
        )


# ── brain_feature_context ────────────────────────────────────────────────

@pytest.mark.requires_postgres
def test_brain_feature_context_hit(mcp_driver):
    """brain_feature_context returns orientation with Feature header."""
    golden_text = _golden_text("brain_feature_context_hit.json")
    feature_id = "c03233e5-6a19-44fd-a5f5-3d4ccd3351f5"  # MCP Server feature

    resp = mcp_driver.call_tool("brain_feature_context", {"featureId": feature_id})
    content = resp.get("result", {}).get("content", [])
    py_text = content[0].get("text", "") if content else ""

    assert f"Feature: MCP Server & Brain Query Layer" in py_text, (
        f"Feature header missing from: {py_text[:200]}"
    )
    assert f"[id: {feature_id}]" in py_text, "Feature id missing"
    # Must have drill section
    assert "For full context" in py_text, "Missing full context hint"


# ── brain_moments ────────────────────────────────────────────────────────

@pytest.mark.requires_postgres
def test_brain_moments_hit(mcp_driver):
    """brain_moments returns moment list with ids and evidence hints."""
    golden_text = _golden_text("brain_moments_hit.json")
    feature_id = "9e23fadf-7d34-49aa-87bd-e741ad09d84e"  # Digest Pipeline

    resp = mcp_driver.call_tool("brain_moments", {"featureId": feature_id})
    content = resp.get("result", {}).get("content", [])
    py_text = content[0].get("text", "") if content else ""

    # Moment list format: [id…] [confidence, verification] statement (date)
    assert "…]" in py_text, "Missing truncated id"
    assert "brain_evidence" in py_text, "Missing evidence drill handle"
    assert "Use brain_evidence(momentId)" in py_text, "Missing trailing instruction"


# ── brain_evidence ────────────────────────────────────────────────────────

@pytest.mark.requires_postgres
def test_brain_evidence_hit(mcp_driver):
    """brain_evidence returns evidence quotes for a moment."""
    golden_text = _golden_text("brain_evidence_hit.json")
    moment_id = "1b00ccce-bb26-4a3e-9a28-8583c246a1fa"

    resp = mcp_driver.call_tool("brain_evidence", {"momentId": moment_id})
    content = resp.get("result", {}).get("content", [])
    py_text = content[0].get("text", "") if content else ""

    assert f"Moment [{moment_id[:8]}…]" in py_text, "Missing moment id header"
    assert "Evidence (" in py_text, "Missing evidence header"

    # Same statement as golden
    m = re.search(r"Moment \[.+?\]: (.+?)\n", golden_text)
    if m:
        expected_stmt = m.group(1)
        assert expected_stmt in py_text, f"Statement mismatch: {expected_stmt!r}"


# ── brain_narrative ───────────────────────────────────────────────────────

@pytest.mark.requires_postgres
def test_brain_narrative_hit(mcp_driver):
    """brain_narrative returns session summary and progression."""
    golden_text = _golden_text("brain_narrative_hit.json")
    session_id = "3977fef3-ca52-4947-bdb4-f7433713d5b0"

    resp = mcp_driver.call_tool("brain_narrative", {"sessionId": session_id})
    content = resp.get("result", {}).get("content", [])
    py_text = content[0].get("text", "") if content else ""

    assert f"Session {session_id[:8]}…" in py_text, "Missing session header"
    assert "Summary:" in py_text, "Missing Summary section"

    # Same session shape as golden
    m = re.search(r"Session .+? \((.+?)\)", golden_text)
    if m:
        expected_shape = m.group(1)
        assert expected_shape in py_text, f"Shape mismatch: {expected_shape!r}"


# ── brain_attention ───────────────────────────────────────────────────────

@pytest.mark.requires_postgres
def test_brain_attention_structure(mcp_driver):
    """brain_attention returns attention state or 'no attention' message."""
    resp = mcp_driver.call_tool("brain_attention", {})
    content = resp.get("result", {}).get("content", [])
    py_text = content[0].get("text", "") if content else ""

    # Either has attention data or says it doesn't
    assert (
        "## User Attention" in py_text
        or "No attention reported" in py_text
    ), f"Unexpected attention response: {py_text[:200]}"


# ── Write tools ───────────────────────────────────────────────────────────

@pytest.mark.requires_postgres
def test_brain_report_observation(mcp_driver):
    """brain_report_observation returns confirmation with a UUID id."""
    resp = mcp_driver.call_tool(
        "brain_report_observation",
        {"summary": "golden test observation (pytest)"},
    )
    content = resp.get("result", {}).get("content", [])
    py_text = content[0].get("text", "") if content else ""

    assert "Observation recorded (id:" in py_text, f"Unexpected: {py_text}"
    assert "status: pending review" in py_text


@pytest.mark.requires_postgres
def test_brain_report_unknown(mcp_driver):
    """brain_report_unknown returns confirmation with a UUID id."""
    resp = mcp_driver.call_tool(
        "brain_report_unknown",
        {"summary": "golden test unknown (pytest)"},
    )
    content = resp.get("result", {}).get("content", [])
    py_text = content[0].get("text", "") if content else ""

    assert "Unknown recorded (id:" in py_text, f"Unexpected: {py_text}"
    assert "status: pending review" in py_text


@pytest.mark.requires_postgres
def test_brain_rate_context(mcp_driver):
    """brain_rate_context returns confirmation with a UUID id."""
    resp = mcp_driver.call_tool(
        "brain_rate_context",
        {"rating": 4, "comment": "golden test rating (pytest)"},
    )
    content = resp.get("result", {}).get("content", [])
    py_text = content[0].get("text", "") if content else ""

    assert "Context rating recorded (id:" in py_text, f"Unexpected: {py_text}"


@pytest.mark.requires_postgres
def test_brain_propose_knowledge_delta(mcp_driver):
    """brain_propose_knowledge_delta returns confirmation with a UUID id."""
    resp = mcp_driver.call_tool(
        "brain_propose_knowledge_delta",
        {"summary": "golden test delta (pytest)"},
    )
    content = resp.get("result", {}).get("content", [])
    py_text = content[0].get("text", "") if content else ""

    assert "Knowledge delta proposed (id:" in py_text, f"Unexpected: {py_text}"
    assert "status: pending review" in py_text


# ── Instrumentation: mcp:* event metadata contract ───────────────────────

@pytest.mark.requires_postgres
def test_emit_mcp_read_event_featureid_null_when_absent():
    """emit_mcp_read_event must include featureId: null in metadata when no
    feature is associated (TS parity — instrument.ts emits `featureId ?? null`
    so consumers can always rely on the key)."""
    import uuid as _uuid

    from sqlalchemy import text as _sql

    from quire.db.engine import get_session
    from quire.mcp.queries import emit_mcp_read_event

    marker = f"pytest featureId-null check {_uuid.uuid4()}"
    emit_mcp_read_event(
        tool="search",
        outcome="miss",
        summary=marker,
        latency_ms=1,
    )

    with get_session() as db:
        row = db.execute(
            _sql(
                "SELECT metadata, repo, branch FROM activity_events "
                "WHERE category = 'mcp:search' AND summary = :s "
                "ORDER BY timestamp DESC LIMIT 1"
            ),
            {"s": marker},
        ).fetchone()
        # cleanup the probe event
        db.execute(
            _sql("DELETE FROM activity_events WHERE summary = :s"), {"s": marker}
        )
        db.commit()

    assert row is not None, "Probe event not found in activity_events"
    meta = row[0] if isinstance(row[0], dict) else json.loads(row[0])
    assert "featureId" in meta, f"featureId key missing from metadata: {meta}"
    assert meta["featureId"] is None, (
        f"featureId must be null when absent, got: {meta['featureId']!r}"
    )


@pytest.mark.requires_postgres
def test_mcp_events_carry_git_root_repo_context():
    """Events emitted via the server's _emit_read must carry the git-root
    repo/branch (intent-ai + real branch), not backend/None — this context
    feeds PR-session coupling."""
    import uuid as _uuid

    from sqlalchemy import text as _sql

    from quire.db.engine import get_session
    from quire.mcp.queries import emit_mcp_read_event
    from quire.mcp.server import _REPO_CTX

    assert _REPO_CTX["repo"] == "intent-ai"
    assert _REPO_CTX["branch"], "branch missing from repo context"

    marker = f"pytest repo-context check {_uuid.uuid4()}"
    emit_mcp_read_event(
        tool="search",
        outcome="miss",
        summary=marker,
        latency_ms=1,
        repo=_REPO_CTX["repo"],
        branch=_REPO_CTX["branch"],
    )

    with get_session() as db:
        row = db.execute(
            _sql(
                "SELECT repo, branch FROM activity_events WHERE summary = :s "
                "ORDER BY timestamp DESC LIMIT 1"
            ),
            {"s": marker},
        ).fetchone()
        db.execute(
            _sql("DELETE FROM activity_events WHERE summary = :s"), {"s": marker}
        )
        db.commit()

    assert row is not None, "Probe event not found"
    assert row[0] == "intent-ai", f"repo column wrong: {row[0]!r}"
    assert row[1] == _REPO_CTX["branch"], f"branch column wrong: {row[1]!r}"


# ── Content parity: key DB-derived text matches golden ──────────────────

@pytest.mark.requires_postgres
def test_brain_feature_context_content_parity(mcp_driver):
    """Feature orientation content must match TS golden for the MCP feature."""
    feature_id = "c03233e5-6a19-44fd-a5f5-3d4ccd3351f5"
    golden_text = _golden_text("brain_feature_context_hit.json")

    resp = mcp_driver.call_tool("brain_feature_context", {"featureId": feature_id})
    content = resp.get("result", {}).get("content", [])
    py_text = content[0].get("text", "") if content else ""

    # Normalize: collapse whitespace diff, compare key lines
    def normalize(t: str) -> str:
        return re.sub(r'\s+', ' ', t).strip()

    # The Feature name line must match exactly
    golden_header = f"Feature: MCP Server & Brain Query Layer  [id: {feature_id}]"
    assert golden_header in py_text, f"Header mismatch. Got: {py_text[:300]}"

    # Understanding section present if golden has it
    if "Understanding:" in golden_text:
        assert "Understanding:" in py_text, "Missing Understanding section"

    # Constraints present if golden has them
    if "Constraints:" in golden_text:
        assert "Constraints:" in py_text, "Missing Constraints section"


@pytest.mark.requires_postgres
def test_brain_narrative_content_parity(mcp_driver):
    """Session narrative content matches TS golden (same DB data)."""
    session_id = "3977fef3-ca52-4947-bdb4-f7433713d5b0"
    golden_text = _golden_text("brain_narrative_hit.json")

    resp = mcp_driver.call_tool("brain_narrative", {"sessionId": session_id})
    content = resp.get("result", {}).get("content", [])
    py_text = content[0].get("text", "") if content else ""

    # Extract golden summary
    m = re.search(r"Summary: (.+?)(?:\n|$)", golden_text)
    if m:
        expected_summary_start = m.group(1)[:50]
        assert expected_summary_start in py_text, (
            f"Summary mismatch. Expected to start with: {expected_summary_start!r}\n"
            f"Got: {py_text[:300]}"
        )


# ── Full-text equality: the golden safety case ───────────────────────────
# These assert COMPLETE equality of the Python response against goldens
# re-recorded from the CURRENT TS server (2026-07-22, same DB). The
# structural tests above are the fast layer; these are the safety case —
# a server serving syntactically-valid but WRONG context fails here.
#
# Query targets are pinned to fixed feature/moment/session ids (stable DB
# rows) so later slices that mutate live state (e.g. attention windows)
# cannot shift these responses.
#
# Normalizations: NONE. All five responses are byte-identical between TS
# and Python against the same DB — including brain_search's match
# percentages, which are deterministic (same fuzzy-score algorithm, same
# rows; not floating-point-noisy). Recording these goldens exposed one
# real parity bug: Python truncated the percentage (int()) where TS
# rounds half-up (toFixed(0)) — fixed in server.py, not normalized away.
# If a future DB refresh changes scores, re-record the golden rather
# than loosening the assert.


def _assert_full_text(py_text: str, golden_text: str, tool: str) -> None:
    if py_text == golden_text:
        return
    # Build a small diff pointer for debuggability
    idx = next(
        (i for i, (a, b) in enumerate(zip(py_text, golden_text)) if a != b),
        min(len(py_text), len(golden_text)),
    )
    lo = max(0, idx - 80)
    raise AssertionError(
        f"{tool}: full-text mismatch at char {idx}.\n"
        f"--- GOLDEN [{lo}:{idx + 80}] ---\n{golden_text[lo:idx + 80]}\n"
        f"--- PYTHON [{lo}:{idx + 80}] ---\n{py_text[lo:idx + 80]}"
    )


@pytest.mark.requires_postgres
def test_brain_feature_context_full_text_equality(mcp_driver):
    """brain_feature_context must match the TS golden byte-for-byte
    (pinned featureId — stable DB row, no nondeterministic fields)."""
    feature_id = "c03233e5-6a19-44fd-a5f5-3d4ccd3351f5"  # MCP Server feature
    golden_text = _golden_text("brain_feature_context_hit.json")
    assert golden_text, "Empty golden"

    resp = mcp_driver.call_tool("brain_feature_context", {"featureId": feature_id})
    content = resp.get("result", {}).get("content", [])
    py_text = content[0].get("text", "") if content else ""
    _assert_full_text(py_text, golden_text, "brain_feature_context")


@pytest.mark.requires_postgres
def test_brain_moments_full_text_equality(mcp_driver):
    """brain_moments must match the TS golden byte-for-byte
    (pinned featureId — moment selection is deterministic over stable rows)."""
    feature_id = "9e23fadf-7d34-49aa-87bd-e741ad09d84e"  # Digest Pipeline
    golden_text = _golden_text("brain_moments_hit.json")
    assert golden_text, "Empty golden"

    resp = mcp_driver.call_tool("brain_moments", {"featureId": feature_id})
    content = resp.get("result", {}).get("content", [])
    py_text = content[0].get("text", "") if content else ""
    _assert_full_text(py_text, golden_text, "brain_moments")


@pytest.mark.requires_postgres
def test_brain_evidence_full_text_equality(mcp_driver):
    """brain_evidence must match the TS golden byte-for-byte
    (pinned momentId — evidence quotes are immutable rows)."""
    moment_id = "1b00ccce-bb26-4a3e-9a28-8583c246a1fa"
    golden_text = _golden_text("brain_evidence_hit.json")
    assert golden_text, "Empty golden"

    resp = mcp_driver.call_tool("brain_evidence", {"momentId": moment_id})
    content = resp.get("result", {}).get("content", [])
    py_text = content[0].get("text", "") if content else ""
    _assert_full_text(py_text, golden_text, "brain_evidence")


@pytest.mark.requires_postgres
def test_brain_narrative_full_text_equality(mcp_driver):
    """brain_narrative must match the TS golden byte-for-byte
    (pinned sessionId — narratives are written once at digest time)."""
    session_id = "3977fef3-ca52-4947-bdb4-f7433713d5b0"
    golden_text = _golden_text("brain_narrative_hit.json")
    assert golden_text, "Empty golden"

    resp = mcp_driver.call_tool("brain_narrative", {"sessionId": session_id})
    content = resp.get("result", {}).get("content", [])
    py_text = content[0].get("text", "") if content else ""
    _assert_full_text(py_text, golden_text, "brain_narrative")


@pytest.mark.requires_postgres
def test_brain_search_full_text_equality(mcp_driver):
    """brain_search must match the TS golden byte-for-byte, including match
    percentages — the fuzzy score is deterministic over the same rows, so
    no normalization is applied (see section comment above)."""
    golden_text = _golden_text("brain_search_hit.json")
    assert golden_text, "Empty golden"

    resp = mcp_driver.call_tool("brain_search", {"query": "mcp server brain tools"})
    content = resp.get("result", {}).get("content", [])
    py_text = content[0].get("text", "") if content else ""
    _assert_full_text(py_text, golden_text, "brain_search")
