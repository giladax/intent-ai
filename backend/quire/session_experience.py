"""quire.session_experience — one uploaded session, rendered as it was lived.

The session page is the emotional surface of the product: the adopter sees
THEIR crafted prompts remembered and quoted; the org sees what actually
happened and where the effort went. This module assembles everything that
page needs into ONE documented JSON contract (agents call the same endpoint
— ruling 4):

  GET /api/sessions/{id}/experience
    header      — title/summary (from the workspace digest), repo, actor,
                  when, and honest effort figures (prompts, tool calls,
                  files touched, duration). Effort proxies, never invented
                  dollars — spend integration is roadmap.
    turns       — the conversation, structured: user prompts verbatim,
                  assistant text, tool calls PAIRED with their results,
                  file-change artifacts (mini-diffs from Edit/Write inputs).
    quotes      — the spans Quire extracted as evidence (moment_evidence in
                  the journal DB + signed intent cards), each anchored back
                  to (turn, block, start, end) so the page can highlight the
                  exact words that became receipts.
    produced    — artifacts BORN in this session (signed intent memos).
    referenced_by — artifacts that CITE this session (session↔check links →
                  the review's verdict, plain-language label + ink).
    digest      — what Quire kept: summary, decisions, distilled reasoning.

  GET /api/sessions/ledger
    Every digested session across the org's workspaces, with per-repo effort
    aggregation — the honest "how AI effort is distributed" read.

Resolution: a session id may arrive as the CC session id (the id inside the
transcript), an upload id, or a journal DB UUID. All three resolve.

Everything is failure-safe: a missing transcript, an unreachable Postgres, or
an absent digest degrades to an honest partial state (with a plain-language
note), never a 500.
"""
from __future__ import annotations

import difflib
import json
import logging
import pathlib
import re
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)

# Tools whose input names a file they modify — these become change artifacts.
_EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
# Tools that only read — summarized, never artifacts.
_READ_TOOLS = {"Read", "Glob", "Grep", "LS", "NotebookRead"}

_MAX_BLOCK_CHARS = 20_000     # keep a single text block bounded
_MAX_DETAIL_CHARS = 4_000     # tool input/result deep-dive bound
_MAX_NOTE_CHARS = 160         # one-line result note


# ---------------------------------------------------------------------------
# Deterministic transcript → conversation (no LLM; the transcript IS the data)
# ---------------------------------------------------------------------------

def _clip(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


def _basename(path: str) -> str:
    return path.rstrip("/").rsplit("/", 1)[-1] if path else ""


def summarize_tool(name: str, tool_input: dict) -> str:
    """One plain line for a collapsed tool chip. Structural, not semantic —
    the verb comes from the tool name, the object from its input."""
    fp = str(tool_input.get("file_path") or tool_input.get("path") or "")
    base = _basename(fp)
    if name in ("Edit", "MultiEdit"):
        return f"Edited {base}" if base else "Edited a file"
    if name in ("Write", "NotebookEdit"):
        return f"Wrote {base}" if base else "Wrote a file"
    if name in ("Read", "NotebookRead"):
        return f"Read {base}" if base else "Read a file"
    if name == "Bash":
        cmd = str(tool_input.get("command") or "").strip().splitlines()
        first = _clip(cmd[0], 80) if cmd else ""
        return f"Ran {first}" if first else "Ran a command"
    if name in ("Grep", "Glob"):
        pattern = str(tool_input.get("pattern") or "")
        return f"Searched for {_clip(pattern, 60)}" if pattern else "Searched the repo"
    if name == "LS":
        return f"Listed {base}" if base else "Listed a directory"
    if name == "WebFetch":
        return "Fetched a page"
    if name == "Task" or name == "Agent":
        return "Delegated a task"
    return name or "Used a tool"


def _result_note(result_text: str) -> str:
    """The honest one-liner for a collapsed chip: the result's last
    non-empty line (e.g. "34 passed, 1 warning in 0.24s")."""
    for line in reversed(result_text.strip().splitlines()):
        line = line.strip()
        if line:
            return _clip(line, _MAX_NOTE_CHARS)
    return ""


def _file_change(name: str, tool_input: dict) -> dict | None:
    """A change artifact from an edit tool's input — the diff the session
    actually wrote, reconstructed from old/new strings (Edit) or shown as a
    new-file body (Write). Deterministic; no git required."""
    fp = str(tool_input.get("file_path") or "")
    if not fp or name not in _EDIT_TOOLS:
        return None
    path = _display_path(fp)
    if name in ("Edit", "MultiEdit"):
        old = str(tool_input.get("old_string") or "")
        new = str(tool_input.get("new_string") or "")
        if not old and not new:
            return None
        diff_lines = list(
            difflib.unified_diff(
                old.splitlines(), new.splitlines(), lineterm="", n=2
            )
        )[2:]  # drop ---/+++ headers; the chip carries the path
        additions = sum(1 for l in diff_lines if l.startswith("+"))
        deletions = sum(1 for l in diff_lines if l.startswith("-"))
        return {
            "path": path,
            "kind": "edit",
            "diff": _clip("\n".join(diff_lines), _MAX_DETAIL_CHARS),
            "additions": additions,
            "deletions": deletions,
        }
    content = str(tool_input.get("content") or "")
    body = content.splitlines()
    return {
        "path": path,
        "kind": "write",
        "diff": _clip("\n".join("+" + l for l in body[:40]), _MAX_DETAIL_CHARS),
        "additions": len(body),
        "deletions": 0,
    }


def _display_path(path: str) -> str:
    """Trim an absolute path to a readable repo-relative tail."""
    parts = path.strip("/").split("/")
    if len(parts) > 3:
        return "/".join(parts[-3:])
    return path


def _result_to_text(content: Any) -> str:
    """Flatten a tool_result content payload (string or text blocks)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out: list[str] = []
        for b in content:
            if isinstance(b, dict) and b.get("type") == "text":
                out.append(str(b.get("text") or ""))
        return "\n".join(out)
    return ""


def parse_conversation(path: pathlib.Path) -> dict[str, Any]:
    """Parse a Claude Code .jsonl transcript into the render-ready
    conversation: turns (user prompts first-class, assistant blocks with
    paired tool calls), per-turn change artifacts, and effort figures.

    Purely structural — IDs, roles, timestamps, tool inputs. Never fails on
    a malformed line; skips it.
    """
    # First pass: map tool_use_id → result text (results arrive as later
    # user messages carrying tool_result blocks).
    results: dict[str, str] = {}
    records: list[dict] = []
    for line in path.read_text(errors="ignore").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        records.append(obj)
        message = obj.get("message") or {}
        content = message.get("content")
        if message.get("role") == "user" and isinstance(content, list):
            for b in content:
                if isinstance(b, dict) and b.get("type") == "tool_result":
                    tid = str(b.get("tool_use_id") or "")
                    if tid:
                        results[tid] = _result_to_text(b.get("content"))

    turns: list[dict] = []
    session_id = path.stem
    started_at = ""
    ended_at = ""
    prompts = 0
    assistant_turns = 0
    tool_calls = 0
    files_touched: set[str] = set()

    for obj in records:
        session_id = obj.get("sessionId") or session_id
        ts = str(obj.get("timestamp") or "")
        if ts:
            if not started_at:
                started_at = ts
            ended_at = ts
        message = obj.get("message") or {}
        role = message.get("role")
        content = message.get("content")

        if role == "user":
            text_val: str | None = None
            if isinstance(content, str):
                text_val = content
            elif isinstance(content, list):
                # A user message that is pure text blocks (no tool results)
                # is still a prompt.
                texts = [
                    str(b.get("text") or "")
                    for b in content
                    if isinstance(b, dict) and b.get("type") == "text"
                ]
                has_results = any(
                    isinstance(b, dict) and b.get("type") == "tool_result"
                    for b in content
                )
                if texts and not has_results:
                    text_val = "\n\n".join(texts)
            if text_val and text_val.strip():
                prompts += 1
                turns.append({
                    "index": len(turns),
                    "role": "user",
                    "ts": ts,
                    "text": _clip(text_val, _MAX_BLOCK_CHARS),
                })
            continue

        if role != "assistant" or not isinstance(content, list):
            continue

        blocks: list[dict] = []
        turn_changes: list[dict] = []
        for b in content:
            if not isinstance(b, dict):
                continue
            btype = b.get("type")
            if btype == "text" and (b.get("text") or "").strip():
                blocks.append({
                    "type": "text",
                    "text": _clip(str(b["text"]), _MAX_BLOCK_CHARS),
                })
            elif btype == "tool_use":
                tool_calls += 1
                name = str(b.get("name") or "")
                tool_input = b.get("input") or {}
                if not isinstance(tool_input, dict):
                    tool_input = {}
                tid = str(b.get("id") or "")
                result_text = results.get(tid, "")
                change = _file_change(name, tool_input)
                if change:
                    files_touched.add(change["path"])
                    turn_changes.append({
                        "path": change["path"],
                        "additions": change["additions"],
                        "deletions": change["deletions"],
                    })
                blocks.append({
                    "type": "tool",
                    "id": tid,
                    "name": name,
                    "summary": summarize_tool(name, tool_input),
                    "result_note": _result_note(result_text),
                    "input_display": _clip(
                        json.dumps(tool_input, indent=2, ensure_ascii=False),
                        _MAX_DETAIL_CHARS,
                    ),
                    "result_display": _clip(result_text, _MAX_DETAIL_CHARS),
                    "file_change": change,
                })
        if blocks:
            assistant_turns += 1
            turns.append({
                "index": len(turns),
                "role": "assistant",
                "ts": ts,
                "blocks": blocks,
                "files_changed": turn_changes,
            })

    duration = _duration_seconds(started_at, ended_at)
    return {
        "session_id": session_id,
        "turns": turns,
        "started_at": started_at,
        "ended_at": ended_at,
        "effort": {
            "prompts": prompts,
            "assistant_turns": assistant_turns,
            "tool_calls": tool_calls,
            "files_touched": len(files_touched),
            "duration_seconds": duration,
        },
    }


def _duration_seconds(start: str, end: str) -> int | None:
    try:
        s = datetime.fromisoformat(start.replace("Z", "+00:00"))
        e = datetime.fromisoformat(end.replace("Z", "+00:00"))
        return max(0, int((e - s).total_seconds()))
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Quote anchoring — the "you're heard" mechanics
# ---------------------------------------------------------------------------

def anchor_quote(turns: list[dict], quote: str) -> dict | None:
    """Find a quote's exact span in the conversation.

    Exact substring first; then whitespace-tolerant (the quote is a literal —
    the regex only relaxes runs of whitespace, structural not semantic).
    Returns {turn, block, start, end} or None (an unanchored quote still
    renders in the rail, honestly marked).
    """
    quote = quote.strip()
    if not quote:
        return None
    pattern = None

    def _texts():
        for t in turns:
            if t["role"] == "user":
                yield t["index"], 0, t.get("text") or ""
            else:
                for bi, b in enumerate(t.get("blocks") or []):
                    if b.get("type") == "text":
                        yield t["index"], bi, b.get("text") or ""

    for turn_idx, block_idx, text in _texts():
        pos = text.find(quote)
        if pos >= 0:
            return {"turn": turn_idx, "block": block_idx,
                    "start": pos, "end": pos + len(quote)}
    # Whitespace-tolerant pass
    try:
        pattern = re.compile(
            r"\s+".join(re.escape(w) for w in quote.split()), re.DOTALL
        )
    except re.error:
        return None
    for turn_idx, block_idx, text in _texts():
        m = pattern.search(text)
        if m:
            return {"turn": turn_idx, "block": block_idx,
                    "start": m.start(), "end": m.end()}
    return None


def _moment_quotes(session_ids: set[str], journal_engine=None) -> list[dict]:
    """Evidence quotes the understanding pass extracted (moment_evidence),
    joined through the journal sessions table by source_hash OR id.
    Failure-safe: an unreachable journal DB yields []."""
    try:
        from sqlalchemy import bindparam, text as _text
        from sqlalchemy.orm import Session as SASession

        if journal_engine is None:
            from quire.db.engine import get_engine
            journal_engine = get_engine()
        ids = sorted(session_ids) or [""]
        with SASession(journal_engine) as s:
            rows = s.execute(
                _text(
                    "SELECT me.quote AS quote, m.type AS mtype, "
                    "m.statement AS statement "
                    "FROM moment_evidence me "
                    "JOIN moments m ON m.id = me.moment_id "
                    "JOIN sessions se ON se.id = m.session_id "
                    "WHERE se.source_hash IN :ids OR CAST(se.id AS TEXT) IN :ids"
                ).bindparams(bindparam("ids", expanding=True)),
                {"ids": ids},
            ).mappings().all()
        out = []
        seen: set[str] = set()
        for r in rows:
            q = (r["quote"] or "").strip()
            if not q or q in seen:
                continue
            seen.add(q)
            out.append({
                "quote": q,
                "kind": "moment",
                "why": f"{r['mtype']} — {r['statement']}" if r["statement"] else r["mtype"],
            })
        return out
    except Exception as exc:  # noqa: BLE001
        logger.debug("moment quotes unavailable: %s", exc)
        return []


def _intent_card_quotes(archive_path: pathlib.Path | None, upload_id: str | None) -> list[dict]:
    """Quotes from distilled intent cards (cached beside the archive)."""
    if archive_path is None or upload_id is None:
        return []
    cache = archive_path.parent / f"{upload_id}.intent-cards.json"
    if not cache.exists():
        return []
    try:
        payload = json.loads(cache.read_text())
        out = []
        for c in payload.get("cards", []):
            q = (c.get("source_quote") or "").strip()
            if q:
                out.append({
                    "quote": q,
                    "kind": "intent_card",
                    "why": f"proposed intent — {c.get('statement', '')}",
                })
        return out
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Resolution: cc session id | upload id | journal UUID → transcript + context
# ---------------------------------------------------------------------------

def _workspaces_root() -> pathlib.Path:
    return pathlib.Path(__file__).parent.parent / "workspaces"


def _find_upload(session_ref: str, upload_store) -> Any | None:
    """The session_uploads row whose session_id, id, or sha256 matches."""
    if upload_store is None:
        return None
    try:
        from sqlalchemy import or_, select
        from sqlalchemy.orm import Session as SASession

        from quire.sessions_api import SessionUpload, _row_to_record

        with SASession(upload_store._engine) as s:
            row = s.execute(
                select(SessionUpload).where(
                    or_(
                        SessionUpload.session_id == session_ref,
                        SessionUpload.id == session_ref,
                        SessionUpload.sha256 == session_ref,
                    )
                )
            ).scalars().first()
        return _row_to_record(row) if row is not None else None
    except Exception as exc:  # noqa: BLE001
        logger.debug("experience: upload lookup failed: %s", exc)
        return None


def _find_journal_source(session_ref: str, journal_engine=None) -> tuple[str, str] | None:
    """(source_path, source_hash) from the journal sessions table, matching
    the DB UUID or the CC session id (source_hash)."""
    try:
        from sqlalchemy import text as _text
        from sqlalchemy.orm import Session as SASession

        if journal_engine is None:
            from quire.db.engine import get_engine
            journal_engine = get_engine()
        with SASession(journal_engine) as s:
            row = s.execute(
                _text(
                    "SELECT source_path, source_hash FROM sessions "
                    "WHERE CAST(id AS TEXT) = :r OR source_hash = :r LIMIT 1"
                ),
                {"r": session_ref},
            ).mappings().fetchone()
        if row:
            return str(row["source_path"] or ""), str(row["source_hash"] or "")
        return None
    except Exception as exc:  # noqa: BLE001
        logger.debug("experience: journal lookup failed: %s", exc)
        return None


def _find_workspace_record(
    session_ref: str, workspaces_dir: pathlib.Path
) -> tuple[dict, str] | None:
    """(sessions.yaml record, workspace name) for a digested session."""
    try:
        from quire.session import load_sessions
    except Exception:  # pragma: no cover - defensive
        return None
    if not workspaces_dir.exists():
        return None
    for ws_dir in sorted(workspaces_dir.iterdir()):
        if not ws_dir.is_dir():
            continue
        try:
            for rec in load_sessions(ws_dir):
                if rec.get("session_id") == session_ref:
                    return rec, ws_dir.name
        except Exception:
            continue
    return None


# ---------------------------------------------------------------------------
# Relations — both directions
# ---------------------------------------------------------------------------

def _referenced_by(
    session_ids: set[str], link_store=None, store=None
) -> list[dict]:
    """Artifacts that cite this session: session↔check links, joined to the
    review's verdict when an analysis exists. Failure-safe throughout."""
    if link_store is None:
        try:
            from quire.db.engine import get_engine
            from quire.links import LinkStore
            link_store = LinkStore(engine=get_engine())
        except Exception:
            return []

    links = []
    for sid in sorted(session_ids):
        try:
            links.extend(link_store.links_for_session(sid))
        except Exception:
            continue

    # Group: one entry per (workspace, pr_number); trailers keep count.
    groups: dict[tuple[str, int], dict] = {}
    for link in links:
        if not link.pr_number:
            continue
        key = (link.workspace, link.pr_number)
        g = groups.setdefault(key, {"kinds": set(), "count": 0})
        g["kinds"].add(link.kind)
        g["count"] += 1

    out: list[dict] = []
    for (workspace, pr_number), g in sorted(groups.items()):
        entry = {
            "kind": "review",
            "workspace": workspace,
            "pr_number": pr_number,
            "title": f"PR #{pr_number}",
            "label": "Awaiting review",
            "ink": "gray",
            "verdict": None,
            "via": ", ".join(sorted(g["kinds"])),
            "link": f"/repo/{workspace}/review/{pr_number}",
        }
        try:
            from quire import vocab
            from quire import workspace as workspace_mod

            adapter = workspace_mod.build_adapter(workspace)
            try:
                entry["title"] = adapter.get_pr(pr_number).title or entry["title"]
            except Exception:
                pass
            if store is not None:
                analyses = store.list_analyses(
                    repository=adapter.repository(), pr_number=pr_number
                )
                if analyses:
                    latest = max(analyses, key=lambda a: a.created_at)
                    v = vocab.verdict(latest.classification.value)
                    entry["label"] = v["label"]
                    entry["ink"] = v["ink"]
                    entry["verdict"] = latest.classification.value
        except Exception as exc:  # noqa: BLE001
            logger.debug("experience: verdict join failed for %s#%s: %s",
                         workspace, pr_number, exc)
        out.append(entry)
    return out


def _produced(session_ids: set[str], workspaces_dir: pathlib.Path) -> list[dict]:
    """Artifacts BORN in this session: signed intent memos whose source is
    this session (sources.yaml session-memo entries citing the session id)."""
    import yaml as _yaml

    out: list[dict] = []
    if not workspaces_dir.exists():
        return out
    for ws_dir in sorted(workspaces_dir.iterdir()):
        sources_file = ws_dir / "sources.yaml"
        if not sources_file.exists():
            continue
        try:
            sources = _yaml.safe_load(sources_file.read_text()) or []
        except Exception:
            continue
        if not isinstance(sources, list):
            continue
        for entry in sources:
            if not isinstance(entry, dict):
                continue
            ref = str(entry.get("reference") or "")
            if not ref.startswith("session-memo-"):
                continue
            memo_path = ws_dir / str(entry.get("path", ""))
            try:
                if memo_path.exists() and any(
                    sid in memo_path.read_text() for sid in session_ids
                ):
                    out.append({
                        "kind": "intent_memo",
                        "reference": ref,
                        "title": str(entry.get("title") or ref),
                        "workspace": ws_dir.name,
                        "link": f"/intent/{ws_dir.name}",
                    })
            except Exception:
                continue
    return out


# ---------------------------------------------------------------------------
# The assembled experience
# ---------------------------------------------------------------------------

def build_experience(
    session_ref: str,
    *,
    upload_store=None,
    link_store=None,
    store=None,
    journal_engine=None,
    workspaces_dir: pathlib.Path | None = None,
) -> dict[str, Any] | None:
    """Assemble the session-experience contract for one session reference.

    Returns None when nothing at all is known about the session (caller
    404s in plain language). A known session with a missing transcript
    still renders: digest + relations, turns=[], plus an honest note.
    """
    ws_root = workspaces_dir if workspaces_dir is not None else _workspaces_root()
    notes: list[str] = []

    upload = _find_upload(session_ref, upload_store)
    journal = _find_journal_source(session_ref, journal_engine)
    ws_hit = _find_workspace_record(session_ref, ws_root)
    if upload is None and journal is None and ws_hit is None:
        return None

    # The transcript: archive first (uploads), then journal source, then the
    # workspace record's stored source path.
    transcript_path: pathlib.Path | None = None
    for candidate in (
        pathlib.Path(upload.archive_path) if upload and upload.archive_path else None,
        pathlib.Path(journal[0]) if journal and journal[0] else None,
        pathlib.Path(str(ws_hit[0].get("source") or "")) if ws_hit else None,
    ):
        if candidate and candidate.exists():
            transcript_path = candidate
            break

    if transcript_path is not None:
        convo = parse_conversation(transcript_path)
    else:
        notes.append("The original transcript isn't on disk any more — showing what Quire kept.")
        convo = {
            "session_id": session_ref,
            "turns": [],
            "started_at": "",
            "ended_at": "",
            "effort": {"prompts": 0, "assistant_turns": 0, "tool_calls": 0,
                       "files_touched": 0, "duration_seconds": None},
        }

    # Every alias this session is known by (for joins).
    session_ids = {session_ref, convo["session_id"]}
    if upload:
        session_ids |= {upload.id, upload.session_id or ""}
        if upload.archive_path:
            session_ids.add(pathlib.Path(upload.archive_path).stem)
    if journal:
        session_ids.add(journal[1])
    if transcript_path is not None:
        session_ids.add(transcript_path.stem)
    session_ids.discard("")

    # The digest (what Quire kept) — workspace record wins; find by any alias.
    digest = None
    workspace_name = None
    if ws_hit is None:
        for alias in sorted(session_ids):
            ws_hit = _find_workspace_record(alias, ws_root)
            if ws_hit:
                break
    if ws_hit:
        rec, workspace_name = ws_hit
        digest = {
            "title": rec.get("title") or "",
            "summary": rec.get("summary") or "",
            "decisions": rec.get("decisions") or [],
            "reasoning": rec.get("reasoning") or "",
            "pr": rec.get("pr"),
        }

    # Quotes → anchors (the "you're heard" spans).
    quotes = _moment_quotes(session_ids, journal_engine=journal_engine)
    quotes += _intent_card_quotes(
        transcript_path, upload.id if upload else None
    )
    for q in quotes:
        q["anchor"] = anchor_quote(convo["turns"], q["quote"])

    referenced_by = _referenced_by(session_ids, link_store=link_store, store=store)
    produced = _produced(session_ids, ws_root)

    started = convo["started_at"] or (upload.uploaded_at if upload else "")
    title = (digest and digest["title"]) or _fallback_title(convo, started)

    return {
        "session_id": convo["session_id"],
        "header": {
            "title": title,
            "summary": (digest and digest["summary"]) or "",
            "repo": upload.repo if upload else "",
            "workspace": workspace_name or "",
            "actor": (upload.actor if upload else None) or "",
            "pr": (upload.pr_number if upload else None) or (digest and digest.get("pr")),
            "started_at": started,
            "ended_at": convo["ended_at"],
            "effort": convo["effort"],
        },
        "turns": convo["turns"],
        "quotes": quotes,
        "produced": produced,
        "referenced_by": referenced_by,
        "digest": digest,
        "notes": notes,
    }


def _fallback_title(convo: dict, started: str) -> str:
    for t in convo["turns"]:
        if t["role"] == "user" and t.get("text"):
            return _clip(t["text"].strip().splitlines()[0], 80)
    if started:
        return f"Session of {started[:10]}"
    return "A coding session"


# ---------------------------------------------------------------------------
# The ledger — every session, with the effort distribution
# ---------------------------------------------------------------------------

def build_ledger(
    *,
    workspaces_dir: pathlib.Path | None = None,
    store=None,
    upload_store=None,
) -> dict[str, Any]:
    """All digested sessions across the org's workspaces, newest first,
    with per-repo effort aggregation. Failure-safe: each workspace that
    can't be read is skipped; the ledger never 500s."""
    try:
        from quire.session import load_sessions
    except Exception:  # pragma: no cover - defensive
        return {"sessions": [], "totals": {"sessions": 0, "prompts": 0, "files_touched": 0}, "by_repo": []}

    ws_root = workspaces_dir if workspaces_dir is not None else _workspaces_root()

    # actor/repo join from uploads (best-effort).
    upload_by_sid: dict[str, Any] = {}
    if upload_store is not None:
        try:
            from sqlalchemy import select
            from sqlalchemy.orm import Session as SASession

            from quire.sessions_api import SessionUpload, _row_to_record

            with SASession(upload_store._engine) as s:
                for row in s.execute(select(SessionUpload)).scalars().all():
                    rec = _row_to_record(row)
                    if rec.session_id:
                        upload_by_sid[rec.session_id] = rec
        except Exception as exc:  # noqa: BLE001
            logger.debug("ledger: uploads join unavailable: %s", exc)

    sessions: list[dict] = []
    by_repo: dict[str, dict] = {}
    if ws_root.exists():
        for ws_dir in sorted(ws_root.iterdir()):
            if not ws_dir.is_dir():
                continue
            try:
                records = load_sessions(ws_dir)
            except Exception:
                continue
            for rec in records:
                sid = str(rec.get("session_id") or "")
                if not sid:
                    continue
                upload = upload_by_sid.get(sid)
                repo = (upload.repo if upload else "") or ws_dir.name
                verdict = _ledger_verdict(ws_dir.name, rec.get("pr"), store)
                row = {
                    "session_id": sid,
                    "workspace": ws_dir.name,
                    "repo": repo,
                    "actor": (upload.actor if upload else None) or "",
                    "title": rec.get("title") or "",
                    "summary": rec.get("summary") or "",
                    "when": rec.get("started_at") or rec.get("digested_at") or "",
                    "turns": int(rec.get("turns") or 0),
                    "files_touched": len(rec.get("touched_paths") or []),
                    "decisions": len(rec.get("decisions") or []),
                    "pr": rec.get("pr"),
                    "verdict": verdict,
                    "link": f"/session/{sid}",
                }
                sessions.append(row)
                agg = by_repo.setdefault(repo, {
                    "repo": repo, "workspace": ws_dir.name,
                    "sessions": 0, "turns": 0, "files_touched": 0,
                })
                agg["sessions"] += 1
                agg["turns"] += row["turns"]
                agg["files_touched"] += row["files_touched"]

    sessions.sort(key=lambda r: r["when"], reverse=True)
    repos = sorted(by_repo.values(), key=lambda r: -r["sessions"])
    return {
        "sessions": sessions,
        "totals": {
            "sessions": len(sessions),
            "turns": sum(r["turns"] for r in sessions),
            "files_touched": sum(r["files_touched"] for r in sessions),
        },
        "by_repo": repos,
    }


def _ledger_verdict(workspace: str, pr, store) -> dict | None:
    """The coupled check's plain verdict, when one exists."""
    if not pr or store is None:
        return None
    try:
        from quire import vocab
        from quire import workspace as workspace_mod

        adapter = workspace_mod.build_adapter(workspace)
        analyses = store.list_analyses(
            repository=adapter.repository(), pr_number=int(pr)
        )
        if not analyses:
            return None
        latest = max(analyses, key=lambda a: a.created_at)
        v = vocab.verdict(latest.classification.value)
        return {"label": v["label"], "ink": v["ink"], "pr": int(pr)}
    except Exception:
        return None
