"""dedup_moments — port of journal/src/pipeline/dedup-moments.ts.

Deterministic pre-filter between extract and weave. Removes obvious overlap
duplicates (same sourceEventId in adjacent chunks; keep the higher-scored one)
and flags contradictions/boundary merges. Structural only — no LLM, no semantic
similarity. Keyed on sourceEventId (a structural id), never on statement text.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

_CONFIDENCE_SCORES = {"high": 3, "medium": 2, "low": 1}


@dataclass
class Pass1Moment:
    """Adapter shape dedup operates on (mirrors TS Pass1Moment relevant fields)."""

    type: str
    statement: str
    significance: str
    agency: str
    confidence: str
    topic_fingerprint: str
    evidence: list[dict]  # {quote, sourceEventId?, sourceType, quoteType}


@dataclass
class RemovedEntry:
    chunk_index: int
    moment: Pass1Moment
    reason: str


@dataclass
class DedupResult:
    moments: list[dict] = field(default_factory=list)  # [{chunkIndex, moments}]
    removed: list[RemovedEntry] = field(default_factory=list)
    boundary_merges: list[dict] = field(default_factory=list)
    contradictions: list[dict] = field(default_factory=list)


def _moment_score(m: Pass1Moment) -> int:
    evidence_count = len(m.evidence) if isinstance(m.evidence, list) else 0
    confidence_score = _CONFIDENCE_SCORES.get(m.confidence, 1)
    return evidence_count * 2 + confidence_score


def dedup_moments(pass1_results: list[dict], chunks: list) -> DedupResult:
    """pass1_results: [{"chunk_index": int, "moments": list[Pass1Moment]}]."""
    removed: list[RemovedEntry] = []
    boundary_merges: list[dict] = []
    contradictions: list[dict] = []

    working = [
        {"chunk_index": r["chunk_index"], "moments": list(r["moments"])}
        for r in pass1_results
    ]

    # 1. Overlap dedup: sourceEventId → entries
    event_id_index: dict[str, list[dict]] = {}
    for result in working:
        for mi, m in enumerate(result["moments"]):
            evidence_array = m.evidence if isinstance(m.evidence, list) else []
            for ev in evidence_array:
                eid = ev.get("sourceEventId") if isinstance(ev, dict) else None
                if eid:
                    event_id_index.setdefault(eid, []).append(
                        {"chunk_index": result["chunk_index"], "moment_index": mi, "moment": m}
                    )

    to_remove: set[str] = set()

    for event_id, entries in event_id_index.items():
        if len(entries) >= 2:
            by_chunk: dict[int, list[dict]] = {}
            for entry in entries:
                by_chunk.setdefault(entry["chunk_index"], []).append(entry)

            chunk_indices = sorted(by_chunk.keys())
            for i in range(len(chunk_indices) - 1):
                c_a = chunk_indices[i]
                c_b = chunk_indices[i + 1]
                if c_b - c_a > 1:
                    continue  # not adjacent
                entries_a = by_chunk[c_a]
                entries_b = by_chunk[c_b]
                for e_a in entries_a:
                    for e_b in entries_b:
                        score_a = _moment_score(e_a["moment"])
                        score_b = _moment_score(e_b["moment"])
                        if score_a >= score_b:
                            key = f"{e_b['chunk_index']}-{e_b['moment_index']}"
                            if key not in to_remove:
                                to_remove.add(key)
                                removed.append(
                                    RemovedEntry(
                                        chunk_index=e_b["chunk_index"],
                                        moment=e_b["moment"],
                                        reason=f"duplicate of event {event_id} in chunk {e_a['chunk_index']}",
                                    )
                                )
                        else:
                            key = f"{e_a['chunk_index']}-{e_a['moment_index']}"
                            if key not in to_remove:
                                to_remove.add(key)
                                removed.append(
                                    RemovedEntry(
                                        chunk_index=e_a["chunk_index"],
                                        moment=e_a["moment"],
                                        reason=f"duplicate of event {event_id} in chunk {e_b['chunk_index']}",
                                    )
                                )

        # 3. Contradiction detection
        agencies = {e["moment"].agency for e in entries}
        if len(agencies) > 1:
            contradictions.append(
                {
                    "event_id": event_id,
                    "entries": [
                        {
                            "chunk_index": e["chunk_index"],
                            "agency": e["moment"].agency,
                            "moment_index": e["moment_index"],
                        }
                        for e in entries
                    ],
                }
            )

    # Apply removals
    moments_out = [
        {
            "chunk_index": r["chunk_index"],
            "moments": [
                m
                for mi, m in enumerate(r["moments"])
                if f"{r['chunk_index']}-{mi}" not in to_remove
            ],
        }
        for r in working
    ]

    # 2. Boundary merge flags
    sorted_results = sorted(moments_out, key=lambda r: r["chunk_index"])
    for i in range(len(sorted_results) - 1):
        r_a = sorted_results[i]
        r_b = sorted_results[i + 1]
        if r_b["chunk_index"] - r_a["chunk_index"] > 1:
            continue
        topics_a: dict[str, list[int]] = {}
        for mi, m in enumerate(r_a["moments"]):
            fp = m.topic_fingerprint or "general"
            topics_a.setdefault(fp, []).append(mi)
        topics_b: dict[str, list[int]] = {}
        for mi, m in enumerate(r_b["moments"]):
            fp = m.topic_fingerprint or "general"
            topics_b.setdefault(fp, []).append(mi)
        for fp, indices_a in topics_a.items():
            if fp == "general":
                continue
            indices_b = topics_b.get(fp)
            if indices_b:
                boundary_merges.append(
                    {
                        "chunk_a": r_a["chunk_index"],
                        "chunk_b": r_b["chunk_index"],
                        "topic_fingerprint": fp,
                        "moment_indices_a": indices_a,
                        "moment_indices_b": indices_b,
                    }
                )

    return DedupResult(
        moments=moments_out,
        removed=removed,
        boundary_merges=boundary_merges,
        contradictions=contradictions,
    )
