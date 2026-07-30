"""build_session_digest + build_digest_header — deterministic cross-chunk context.

Port of journal/src/pipeline/session-digest.ts and the buildDigestHeader helper
from understand/index.ts. No LLM calls. Pre-computed context handed to the
per-chunk extractor so it knows where it sits in the session.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class DeveloperStatement:
    causal_order: int
    text: str
    chunk_index: int


@dataclass
class TopicFlowEntry:
    chunk_index: int
    topic_hint: str
    files_in_scope: list[str]


@dataclass
class BoundaryExchange:
    chunk_a: int
    chunk_b: int
    event_ids: list[str]


@dataclass
class SessionDigest:
    developer_statements: list[DeveloperStatement] = field(default_factory=list)
    topic_flow: list[TopicFlowEntry] = field(default_factory=list)
    boundary_exchanges: list[BoundaryExchange] = field(default_factory=list)


def build_session_digest(chunks: list, events: list) -> SessionDigest:
    """Build a SessionDigest from chunks and their source events."""
    developer_statements: list[DeveloperStatement] = []
    for chunk in chunks:
        for ev in chunk.events:
            if ev.category == "intent":
                developer_statements.append(
                    DeveloperStatement(
                        causal_order=ev.causal_order,
                        text=ev.content.detail or ev.content.summary,
                        chunk_index=chunk.chunk_index,
                    )
                )

    topic_flow = [
        TopicFlowEntry(
            chunk_index=c.chunk_index,
            topic_hint=c.topic_hint,
            files_in_scope=c.files_in_scope,
        )
        for c in chunks
    ]

    # eventId → chunkIndex
    event_to_chunk: dict[str, int] = {}
    for chunk in chunks:
        for ev in chunk.events:
            event_to_chunk[ev.id] = chunk.chunk_index

    # turnId → set of chunk indices
    turn_id_chunks: dict[str, set[int]] = {}
    for chunk in chunks:
        for ev in chunk.events:
            if ev.turn_id:
                turn_id_chunks.setdefault(ev.turn_id, set()).add(chunk.chunk_index)

    boundary_map: dict[str, set[str]] = {}

    # 1) respondingTo spanning chunks
    for chunk in chunks:
        for ev in chunk.events:
            if ev.responding_to:
                other_chunk = event_to_chunk.get(ev.responding_to)
                if other_chunk is not None and other_chunk != chunk.chunk_index:
                    a, b = (
                        (other_chunk, chunk.chunk_index)
                        if other_chunk < chunk.chunk_index
                        else (chunk.chunk_index, other_chunk)
                    )
                    key = f"{a}-{b}"
                    boundary_map.setdefault(key, set())
                    boundary_map[key].add(ev.id)
                    boundary_map[key].add(ev.responding_to)

    # 2) turnId spanning chunks
    for turn_id, chunk_set in turn_id_chunks.items():
        if len(chunk_set) > 1:
            sorted_chunks = sorted(chunk_set)
            for i in range(len(sorted_chunks) - 1):
                a = sorted_chunks[i]
                b = sorted_chunks[i + 1]
                key = f"{a}-{b}"
                boundary_map.setdefault(key, set())
                for chunk in chunks:
                    if chunk.chunk_index in (a, b):
                        for ev in chunk.events:
                            if ev.turn_id == turn_id:
                                boundary_map[key].add(ev.id)

    boundary_exchanges: list[BoundaryExchange] = []
    for key, event_ids in boundary_map.items():
        a_str, b_str = key.split("-")
        boundary_exchanges.append(
            BoundaryExchange(chunk_a=int(a_str), chunk_b=int(b_str), event_ids=list(event_ids))
        )
    boundary_exchanges.sort(key=lambda e: (e.chunk_a, e.chunk_b))

    return SessionDigest(
        developer_statements=developer_statements,
        topic_flow=topic_flow,
        boundary_exchanges=boundary_exchanges,
    )


def build_digest_header(
    chunk_index: int, total_chunks: int, digest: SessionDigest
) -> str:
    """Per-chunk context header string passed to extract as digest_header."""
    lines: list[str] = []
    lines.append(f"\n## Session Context (Chunk {chunk_index} of {total_chunks - 1})")

    prior_topics = [
        f"Chunk {t.chunk_index}: {t.topic_hint}"
        for t in digest.topic_flow
        if t.chunk_index < chunk_index
    ][-5:]
    if prior_topics:
        lines.append(f"Prior topics: {', '.join(prior_topics)}")

    prior_statements_src = [
        s for s in digest.developer_statements if s.chunk_index < chunk_index
    ][-5:]
    prior_statements: list[str] = []
    for s in prior_statements_src:
        truncated = s.text[:80] + "..." if len(s.text) > 80 else s.text
        prior_statements.append(f'[{s.causal_order}] "{truncated}"')
    if prior_statements:
        lines.append(f"Key developer statements: {', '.join(prior_statements)}")

    boundaries = [
        b
        for b in digest.boundary_exchanges
        if b.chunk_a == chunk_index or b.chunk_b == chunk_index
    ]
    if boundaries:
        boundary_notes = [
            f"Exchange spanning chunks {b.chunk_a}-{b.chunk_b}" for b in boundaries
        ]
        lines.append(f"Boundary: {'; '.join(boundary_notes)}")

    return "\n".join(lines)
