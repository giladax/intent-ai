"""Python MCP server for intent-brain — exposes 12 brain_* tools via stdio.

NOTHING may print to stdout. All logging goes to stderr.
Transport: stdio (FastMCP default when mcp.run(transport="stdio") is called).

Parameter names match the TS server's camelCase contract exactly (featureId,
momentId, sessionId, callerSessionId) so existing agents need no changes.
"""

from __future__ import annotations

import os
import re
import sys
import time
from pathlib import Path
from typing import Optional

# ── Load .env BEFORE any DB import ──────────────────────────────────────
# Must be the very first import from quire to avoid DATABASE_URL errors.
from quire import workspace as _workspace_mod  # noqa: E402

_workspace_mod.load_env()

# ── FastMCP ──────────────────────────────────────────────────────────────
from mcp.server.fastmcp import FastMCP

from quire.mcp.feature import (
    FeatureRecord,
    format_attention_mcp_text,
    format_candidates,
    format_feature_context,
    format_moment_evidence,
    format_moment_list,
    format_session_narrative,
    resolve_feature,
    resolve_task,
    select_key_moments,
)
from quire.mcp.queries import (
    emit_mcp_read_event,
    get_default_project_id,
    get_feature_by_id,
    get_feature_file_rows,
    get_feature_moments,
    get_moment_by_id,
    get_moment_evidence,
    get_session_narrative,
    insert_observation,
    list_features,
    load_feature_context,
    read_attention,
)

# ── Repo context (stamped on every event) ───────────────────────────────

def _get_repo_context(cwd: Optional[str] = None) -> dict:
    """Walk up from cwd to the git root and read repo name + branch.

    The server usually starts in backend/ (no .git there), so a cwd-only
    lookup stamped events with repo="backend", branch=None. Walking to the
    git root yields repo="intent-ai" + the real branch — this context feeds
    the PR-session coupling design, so it must be right. (The TS server has
    the same cwd-only flaw; this walk is a sanctioned improvement over it.)
    """
    start = Path(cwd or os.getcwd()).resolve()
    repo = start.name
    branch = None
    candidate = start
    while True:
        git_dir = candidate / ".git"
        if git_dir.exists():
            repo = candidate.name
            try:
                head = (git_dir / "HEAD").read_text().strip()
                m = re.match(r"^ref: refs/heads/(.+)$", head)
                if m:
                    branch = m.group(1)
            except Exception:
                pass
            break
        parent = candidate.parent
        if parent == candidate:  # filesystem root — no .git anywhere above
            break
        candidate = parent
    return {"repo": repo, "branch": branch}


_REPO_CTX = _get_repo_context()

# Actor stamped on every MCP-read event. NOTE (attribution gap vs the TS
# server): the TS MCP derived a per-client actor from the initialize
# clientInfo (e.g. "agent:claude-code"); FastMCP does not surface that here,
# so all reads collapse to one generic actor. Centralized so per-client
# attribution is a one-line change once FastMCP exposes client info.
_MCP_ACTOR = "agent:mcp-client"

# ── FastMCP app ──────────────────────────────────────────────────────────

mcp = FastMCP("intent-brain")

# ── Instrumentation helper ───────────────────────────────────────────────

def _emit_read(
    tool: str,
    started_at: float,
    outcome: str,
    summary: str,
    session_id: Optional[str] = None,
    feature_id: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> None:
    latency_ms = int((time.time() - started_at) * 1000)
    emit_mcp_read_event(
        tool=tool,
        outcome=outcome,
        summary=summary,
        latency_ms=latency_ms,
        actor=_MCP_ACTOR,
        repo=_REPO_CTX.get("repo"),
        branch=_REPO_CTX.get("branch"),
        session_id=session_id,
        feature_id=feature_id,
        metadata=metadata,
    )


def _feature_context_response(feature_id: str, depth: str = "orientation") -> str:
    ctx = load_feature_context(feature_id)
    if not ctx:
        return f"Feature {feature_id} not found."
    return format_feature_context(ctx, depth)


def _features_by_ids(ids: list[str], project_id: Optional[str]) -> list[FeatureRecord]:
    """On 0 candidates, surface the full project Feature list."""
    if not ids:
        return list_features(project_id)
    out: list[FeatureRecord] = []
    for fid in ids:
        f = get_feature_by_id(fid)
        if f:
            out.append(f)
    return out


# ── Tool 1: brain_search ─────────────────────────────────────────────────

@mcp.tool()
def brain_search(query: str) -> str:
    """Search the Brain's Features — matches name, understanding, and file globs. Returns candidates with ids for brain_feature_context."""
    from quire.mcp.feature import fuzzy_score

    started_at = time.time()
    try:
        project_id = get_default_project_id()
        features = list_features(project_id)
        file_rows = get_feature_file_rows(project_id)

        globs_by_feature: dict[str, list[str]] = {}
        for r in file_rows:
            lst = globs_by_feature.setdefault(r.feature_id, [])
            if r.glob:
                lst.append(r.glob)
            if r.file_path:
                lst.append(r.file_path)

        hits: list[dict] = []
        for f in features:
            best = 0.0
            via = "name"

            def consider(txt: Optional[str], weight: float, label: str) -> None:
                nonlocal best, via
                if not txt:
                    return
                s = fuzzy_score(query, txt) * weight
                if s > best:
                    best = s
                    via = label

            consider(f.name, 2.0, "name")
            consider(f.description, 1.2, "description")
            consider(f.current_understanding, 1.0, "understanding")
            for g in globs_by_feature.get(f.id, []):
                consider(g, 1.5, f"file: {g}")

            if best > 0.3:
                hits.append({"f": f, "score": best, "via": via})

        hits.sort(key=lambda h: h["score"], reverse=True)
        top = hits[:6]

        _emit_read(
            "search", started_at,
            "hit" if top else "miss",
            f'Agent searched the Brain for "{query}" — {len(top)} feature{"" if len(top) == 1 else "s"}',
            metadata={"query": query, "results": len(top)},
        )

        if not top:
            return (
                f'No Features match "{query}". Try brain_enter(task: "...") for candidate resolution, '
                "or report what you were looking for with brain_report_unknown."
            )

        parts: list[str] = []
        for hit in top:
            f = hit["f"]
            score = hit["score"]
            via = hit["via"]
            lines = [f"### {f.name}  [id: {f.id}]"]
            if f.description:
                lines.append(f.description[:200])
            understanding_lines = [
                ln for ln in (f.current_understanding or "").split("\n") if ln.strip()
            ][:3]
            for ln in understanding_lines:
                lines.append(ln if ln.startswith("- ") else f"- {ln}")
            # Round half-up like TS `(score * 100).toFixed(0)` — int() truncates
            # and drifts one percent below TS on x.5+ scores (goldens caught this).
            pct = int(score * 100 + 0.5)
            lines.append(
                f'_matched via {via} ({pct}%) — brain_feature_context("{f.id}") for the full context_'
            )
            parts.append("\n".join(lines))

        return "\n\n---\n\n".join(parts)

    except Exception as e:
        return f"brain_search unavailable: {e}"


# ── Tool 2: brain_file_context ───────────────────────────────────────────

@mcp.tool()
def brain_file_context(
    file: str,
    depth: Optional[str] = None,
    sessionId: Optional[str] = None,
) -> str:
    """Get Brain context for a source file — resolves the file's Feature and returns a terse orientation (understanding verdict, constraints, drill handles). Use before editing unfamiliar code. Pass depth:"full" for the complete assembled block."""
    started_at = time.time()
    resolved_depth = depth or "orientation"
    try:
        project_id = get_default_project_id()
        rows = get_feature_file_rows(project_id)
        res = resolve_feature(file, rows)
        if res.feature_id:
            _emit_read(
                "file-context", started_at, "hit",
                f"Agent got feature context for {file}",
                session_id=sessionId, feature_id=res.feature_id,
                metadata={"file": file, "depth": resolved_depth},
            )
            return _feature_context_response(res.feature_id, resolved_depth)

        outcome = "miss" if not res.candidate_ids else "candidates"
        _emit_read(
            "file-context", started_at, outcome,
            f"Agent asked for context on {file} — no Feature maps it"
            if outcome == "miss"
            else f"Agent asked for context on {file} — {len(res.candidate_ids)} candidate Features",
            session_id=sessionId,
            metadata={"file": file, "candidates": len(res.candidate_ids)},
        )
        candidates = _features_by_ids(res.candidate_ids, project_id)
        return format_candidates(candidates, f"file: {file}")

    except Exception as err:
        _emit_read(
            "file-context", started_at, "error",
            f"brain_file_context failed for {file}",
            session_id=sessionId,
            metadata={"file": file, "error": str(err)},
        )
        return f"brain_file_context unavailable: {err}"


# ── Tool 3: brain_enter ──────────────────────────────────────────────────

@mcp.tool()
def brain_enter(
    file: Optional[str] = None,
    task: Optional[str] = None,
    depth: Optional[str] = None,
    sessionId: Optional[str] = None,
) -> str:
    """Enter the Brain for a file or task. Returns a terse orientation: verdict-grade understanding (2-3 sentences), all constraints inline, and drill handles (moment/session counts + ids). Use brain_moments, brain_evidence, brain_narrative to pull depth on demand. Pass depth:"full" for the full assembled block. On 0 or >1 matches, returns the candidate list."""
    started_at = time.time()
    resolved_depth = depth or "orientation"
    target = f"file {file}" if file else (f'task "{task}"' if task else "nothing")

    try:
        project_id = get_default_project_id()

        if file:
            rows = get_feature_file_rows(project_id)
            res = resolve_feature(file, rows)
            if res.feature_id:
                _emit_read(
                    "enter", started_at, "hit",
                    f"Agent entered the Brain for {target}",
                    session_id=sessionId, feature_id=res.feature_id,
                    metadata={"file": file, "depth": resolved_depth},
                )
                return _feature_context_response(res.feature_id, resolved_depth)
            outcome = "miss" if not res.candidate_ids else "candidates"
            _emit_read(
                "enter", started_at, outcome,
                f"Agent entered for {target} — no Feature maps it"
                if outcome == "miss"
                else f"Agent entered for {target} — {len(res.candidate_ids)} candidate Features",
                session_id=sessionId,
                metadata={"file": file, "candidates": len(res.candidate_ids)},
            )
            candidates = _features_by_ids(res.candidate_ids, project_id)
            return format_candidates(candidates, f"file: {file}")

        if task:
            features = list_features(project_id)
            res = resolve_task(task, features)
            if res.feature:
                _emit_read(
                    "enter", started_at, "hit",
                    f"Agent entered the Brain for {target}",
                    session_id=sessionId, feature_id=res.feature.id,
                    metadata={"task": task, "depth": resolved_depth},
                )
                return _feature_context_response(res.feature.id, resolved_depth)
            outcome = "miss" if not res.candidates else "candidates"
            _emit_read(
                "enter", started_at, outcome,
                f"Agent entered for {target} — no Feature matched"
                if outcome == "miss"
                else f"Agent entered for {target} — {len(res.candidates)} candidate Features",
                session_id=sessionId,
                metadata={"task": task, "candidates": len(res.candidates)},
            )
            return format_candidates(res.candidates, f"task: {task}")

        return "Provide either `file` or `task` to enter the Brain."

    except Exception as err:
        _emit_read(
            "enter", started_at, "error",
            f"brain_enter failed for {target}",
            session_id=sessionId,
            metadata={"file": file, "task": task, "error": str(err)},
        )
        return f"brain_enter unavailable: {err}"


# ── Tool 4: brain_feature_context ────────────────────────────────────────

@mcp.tool()
def brain_feature_context(
    featureId: str,
    depth: Optional[str] = None,
    sessionId: Optional[str] = None,
) -> str:
    """Get the Brain's context for a Feature by id. Default: terse orientation (verdict, constraints, drill handles). Pass depth:"full" for the complete assembled block (understanding + key moments with evidence + sessions + files + agent instructions)."""
    started_at = time.time()
    resolved_depth = depth or "orientation"
    try:
        feature = get_feature_by_id(featureId)
        _emit_read(
            "feature-context", started_at,
            "hit" if feature else "miss",
            f'Agent got context for Feature "{feature.name}" ({resolved_depth})'
            if feature
            else f"Agent requested Feature {featureId} — not found",
            session_id=sessionId, feature_id=featureId,
            metadata={"depth": resolved_depth},
        )
        if not feature:
            return f"Feature {featureId} not found."
        return _feature_context_response(featureId, resolved_depth)

    except Exception as err:
        _emit_read(
            "feature-context", started_at, "error",
            f"brain_feature_context failed for {featureId}",
            session_id=sessionId, feature_id=featureId,
            metadata={"error": str(err)},
        )
        return f"brain_feature_context unavailable: {err}"


# ── Tool 5: brain_moments ────────────────────────────────────────────────

@mcp.tool()
def brain_moments(
    featureId: str,
    limit: Optional[int] = None,
    sessionId: Optional[str] = None,
) -> str:
    """List the key moments for a Feature — terse statements with confidence, verification status, and moment ids. Call brain_evidence(momentId) to pull anchored quotes for any moment."""
    started_at = time.time()
    resolved_limit = limit if limit is not None else 12
    try:
        feature = get_feature_by_id(featureId)
        if not feature:
            _emit_read(
                "moments", started_at, "miss",
                f"brain_moments: Feature {featureId} not found",
                session_id=sessionId, feature_id=featureId,
            )
            return f"Feature {featureId} not found."

        candidates = get_feature_moments(featureId)
        ctx = load_feature_context(featureId)
        patterns = ctx.relevant_files if ctx else []
        moments = select_key_moments(candidates, patterns, resolved_limit)

        _emit_read(
            "moments", started_at,
            "hit" if moments else "miss",
            f'Agent listed moments for Feature "{feature.name}" — {len(moments)} returned',
            session_id=sessionId, feature_id=featureId,
            metadata={"count": len(moments)},
        )
        return format_moment_list(moments)

    except Exception as err:
        _emit_read(
            "moments", started_at, "error",
            f"brain_moments failed for {featureId}",
            session_id=sessionId, feature_id=featureId,
            metadata={"error": str(err)},
        )
        return f"brain_moments unavailable: {err}"


# ── Tool 6: brain_evidence ───────────────────────────────────────────────

@mcp.tool()
def brain_evidence(
    momentId: str,
    sessionId: Optional[str] = None,
) -> str:
    """Get the anchored evidence quotes for a moment — verbatim transcript excerpts that ground the claim. Call after brain_moments to pull provenance for a specific moment id."""
    started_at = time.time()
    try:
        moment = get_moment_by_id(momentId)
        if not moment:
            _emit_read(
                "evidence", started_at, "miss",
                f"brain_evidence: moment {momentId} not found",
                session_id=sessionId,
            )
            return f"Moment {momentId} not found."

        evidence = get_moment_evidence(momentId)
        _emit_read(
            "evidence", started_at,
            "hit" if evidence else "miss",
            f'Agent pulled evidence for moment [{momentId[:8]}…] — {len(evidence)} quote{"" if len(evidence) == 1 else "s"}',
            session_id=sessionId,
            metadata={"momentId": momentId, "count": len(evidence)},
        )
        return format_moment_evidence(momentId, moment["statement"], evidence)

    except Exception as err:
        _emit_read(
            "evidence", started_at, "error",
            f"brain_evidence failed for {momentId}",
            session_id=sessionId,
            metadata={"momentId": momentId, "error": str(err)},
        )
        return f"brain_evidence unavailable: {err}"


# ── Tool 7: brain_narrative ──────────────────────────────────────────────

@mcp.tool()
def brain_narrative(
    sessionId: str,
    callerSessionId: Optional[str] = None,
) -> str:
    """Get the narrative summary and progression for a session — what happened, key discoveries, how intent evolved. Call after brain_enter or brain_moments to understand a specific session's arc."""
    started_at = time.time()
    try:
        narrative = get_session_narrative(sessionId)
        if not narrative:
            _emit_read(
                "narrative", started_at, "miss",
                f"brain_narrative: no narrative for session {sessionId}",
                session_id=callerSessionId,
            )
            return f"No narrative found for session {sessionId}."

        _emit_read(
            "narrative", started_at, "hit",
            f"Agent pulled narrative for session [{sessionId[:8]}…]",
            session_id=callerSessionId,
            metadata={"targetSessionId": sessionId},
        )
        return format_session_narrative(narrative)

    except Exception as err:
        _emit_read(
            "narrative", started_at, "error",
            f"brain_narrative failed for {sessionId}",
            session_id=callerSessionId,
            metadata={"targetSessionId": sessionId, "error": str(err)},
        )
        return f"brain_narrative unavailable: {err}"


# ── Tool 8: brain_report_observation ────────────────────────────────────

@mcp.tool()
def brain_report_observation(
    summary: str,
    featureId: Optional[str] = None,
    kind: Optional[str] = None,
    tags: Optional[list[str]] = None,
    files: Optional[list[str]] = None,
    sessionId: Optional[str] = None,
) -> str:
    """Report an observation about a Feature (something you noticed while working). Stored pending human review."""
    try:
        event_id = insert_observation(
            kind=kind or "observation",
            summary=summary,
            feature_id=featureId,
            actor=_MCP_ACTOR,
            session_id=sessionId,
            repo=_REPO_CTX.get("repo"),
            branch=_REPO_CTX.get("branch"),
            tags=tags,
            files=files,
            metadata={"kind": kind or "observation"},
        )
        return f"Observation recorded (id: {event_id}, status: pending review)."
    except Exception as err:
        return f"Could not record observation: {err}"


# ── Tool 9: brain_report_unknown ─────────────────────────────────────────

@mcp.tool()
def brain_report_unknown(
    summary: str,
    featureId: Optional[str] = None,
    files: Optional[list[str]] = None,
    sessionId: Optional[str] = None,
) -> str:
    """Report an open question / unknown about a Feature — something Brain does not yet know. Stored pending human review."""
    try:
        event_id = insert_observation(
            kind="unknown",
            summary=summary,
            feature_id=featureId,
            actor=_MCP_ACTOR,
            session_id=sessionId,
            repo=_REPO_CTX.get("repo"),
            branch=_REPO_CTX.get("branch"),
            files=files,
        )
        return f"Unknown recorded (id: {event_id}, status: pending review)."
    except Exception as err:
        return f"Could not record unknown: {err}"


# ── Tool 10: brain_rate_context ──────────────────────────────────────────

@mcp.tool()
def brain_rate_context(
    rating: int,
    featureId: Optional[str] = None,
    comment: Optional[str] = None,
    sessionId: Optional[str] = None,
) -> str:
    """Rate how useful the Feature context was for your task (self-report). Stored as a pending observation."""
    try:
        summary = comment or f"Context usefulness rating: {rating}"
        event_id = insert_observation(
            kind="context-rating",
            summary=summary,
            feature_id=featureId,
            actor=_MCP_ACTOR,
            session_id=sessionId,
            repo=_REPO_CTX.get("repo"),
            branch=_REPO_CTX.get("branch"),
            metadata={"rating": rating, "comment": comment},
        )
        return f"Context rating recorded (id: {event_id})."
    except Exception as err:
        return f"Could not record rating: {err}"


# ── Tool 11: brain_propose_knowledge_delta ───────────────────────────────

@mcp.tool()
def brain_propose_knowledge_delta(
    summary: str,
    featureId: Optional[str] = None,
    before: Optional[str] = None,
    after: Optional[str] = None,
    sessionId: Optional[str] = None,
) -> str:
    """Propose a change to a Feature's understanding (a reviewable delta). Stored pending human review — Brain never edits understanding silently."""
    try:
        event_id = insert_observation(
            kind="knowledge-delta",
            summary=summary,
            feature_id=featureId,
            actor=_MCP_ACTOR,
            session_id=sessionId,
            repo=_REPO_CTX.get("repo"),
            branch=_REPO_CTX.get("branch"),
            metadata={"before": before, "after": after},
        )
        return f"Knowledge delta proposed (id: {event_id}, status: pending review)."
    except Exception as err:
        return f"Could not propose knowledge delta: {err}"


# ── Tool 12: brain_attention ─────────────────────────────────────────────

@mcp.tool()
def brain_attention(
    sessionId: Optional[str] = None,
) -> str:
    """Get the user's current attention state — what they are looking at in the Brain dashboard right now. Returns the lens focus, open session, and a terse assembled context. No attention reported → honest 'no attention (dashboard not open)'."""
    started_at = time.time()
    try:
        result = read_attention()

        if not result:
            _emit_read(
                "attention", started_at, "miss",
                "brain_attention: no attention reported",
                session_id=sessionId,
            )
            return "No attention reported — the Brain dashboard does not appear to be open."

        attn = result["state"]
        lens = attn.get("lens") or {} if isinstance(attn, dict) else {}

        # Augment with feature orientation if a feature lens is active
        feature_orientation: Optional[str] = None
        lens_feature_id = lens.get("featureId") if isinstance(lens, dict) else None
        if lens_feature_id:
            try:
                feature_orientation = _feature_context_response(lens_feature_id, "orientation")
            except Exception:
                pass

        # Augment with session narrative if a session is open
        session_summary: Optional[str] = None
        open_session_id = attn.get("openSessionId") if isinstance(attn, dict) else None
        if open_session_id:
            try:
                narrative = get_session_narrative(open_session_id)
                if narrative and narrative.summary:
                    session_summary = narrative.summary[:300]
            except Exception:
                pass

        base_text = format_attention_mcp_text(
            attn if isinstance(attn, dict) else None,
            result["updated_at"],
            result["stale"],
        )

        extras: list[str] = []
        if feature_orientation:
            extras.append(f"\n### Feature orientation\n{feature_orientation}")
        if session_summary:
            extras.append(f"\nSession summary: {session_summary}")

        full_text = base_text + ("\n" + "\n".join(extras) if extras else "")

        surface = attn.get("surface", "unknown") if isinstance(attn, dict) else "unknown"
        lens_name = lens.get("featureName") if isinstance(lens, dict) else None
        _emit_read(
            "attention", started_at, "hit",
            f"brain_attention: user looking at {lens_name or surface}",
            session_id=sessionId,
            feature_id=lens_feature_id,
            metadata={
                "surface": surface,
                "lensType": lens.get("type") if isinstance(lens, dict) else None,
                "stale": result["stale"],
            },
        )

        return full_text

    except Exception as err:
        return f"brain_attention unavailable: {err}"


# ── Entry point ──────────────────────────────────────────────────────────

def start_mcp_server() -> None:
    """Start the MCP server on stdio. Nothing may write to stdout."""
    sys.stderr.write("[intent-brain] MCP server starting (stdio transport)\n")
    sys.stderr.flush()
    mcp.run(transport="stdio")
