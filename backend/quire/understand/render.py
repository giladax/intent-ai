"""render_chunk_events — port of understand/render-chunk-events.ts.

Single source of truth for rendering a chunk's events into the LLM prompt.
Deterministic. Structural string formatting only (no semantic classification).
"""

from __future__ import annotations


def render_chunk_events(events: list) -> str:
    """Render a chunk's events to a string for the LLM prompt.

    Each event is prefixed with [causalOrder], then formatted by category —
    exactly as journal/src/pipeline/understand/render-chunk-events.ts does.
    """
    lines: list[str] = []
    for e in events:
        co = e.causal_order
        detail = e.content.detail or ""
        summary = e.content.summary or ""
        files = e.content.files_affected or []
        cat = e.category

        if cat == "intent":
            lines.append(f"[{co}] DEV: {detail}")
        elif cat == "proposal":
            lines.append(f"[{co}] AI: {detail}")
        elif cat == "reflection":
            lines.append(f"[{co}] AI: {detail}")
        elif cat == "action":
            file_str = ", ".join(files) if files else summary
            detail_snippet = detail[:200]
            lines.append(f"[{co}] AI/ACTION({file_str}): {detail_snippet}")
        elif cat == "result":
            lower = detail.lower()
            is_error = (
                "error" in lower or "fail" in lower or "err!" in lower
            )
            if is_error:
                lines.append(f"[{co}] RESULT(error): {detail[:300]}")
            else:
                lines.append(f"[{co}] RESULT: {summary[:120]}")
        else:
            lines.append(f"[{co}] {e.actor.upper()}: {detail}")

    return "\n".join(lines)
