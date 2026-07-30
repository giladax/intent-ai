"""understand() — the full understanding stage orchestrator.

Port of journal/src/pipeline/understand/index.ts::understand plus the classify /
topic-shift / analyze steps the TS orchestrator runs just before it. Wires:

  detect_sittings → chunk (hard breaks) → session_digest → extract (per chunk)
  → weave → verify → derive_confidence → transitions → narrative

Every model step is a real structured-output LLM call (see steps.py + llm.py).
Extraction runs per-chunk; in Python we run it sequentially (the fidelity gate is
order-independent — moments carry deterministic ids and are re-sorted by weave).
"""

from __future__ import annotations

from quire.ingest.chunk import chunk_session
from quire.ingest.sittings import detect_sittings
from quire.understand.confidence import apply_derived_confidence
from quire.understand.models import UnderstandResult
from quire.understand.session_digest import build_digest_header, build_session_digest
from quire.understand.steps import (
    detect_transitions_and_outcomes,
    extract_chunk,
    generate_narrative,
    verify_moments,
    weave_moments,
)


def understand(
    llm,
    normalized_events: list,
    session_id: str,
    session_shape: str,
    directives,
    topic_shift_ids: set,
) -> UnderstandResult:
    # 1. Sittings
    sittings = detect_sittings(normalized_events)

    # 2. Sitting boundary causalOrders → hard chunk breaks
    hard_breaks = [s.event_range[0] for s in sittings[1:]]

    # 3. Chunk with hard breaks
    chunks = chunk_session(
        normalized_events, session_id, topic_shift_ids, hard_breaks=hard_breaks
    )

    # 4. Cross-chunk digest for context headers
    digest = build_session_digest(chunks, normalized_events)

    # 5. Extract per chunk (parallel, mirroring the TS Promise.all fan-out).
    #    Results are collected in chunk order so downstream ids are stable.
    def _extract_one(chunk):
        digest_header = (
            build_digest_header(chunk.chunk_index, len(chunks), digest)
            if len(chunks) > 1
            else None
        )
        return extract_chunk(llm, chunk, session_shape, directives, digest_header)

    extracted = []
    if len(chunks) <= 1:
        for chunk in chunks:
            extracted.extend(_extract_one(chunk))
    else:
        from concurrent.futures import ThreadPoolExecutor

        with ThreadPoolExecutor(max_workers=min(8, len(chunks))) as pool:
            per_chunk = list(pool.map(_extract_one, chunks))
        for res in per_chunk:
            extracted.extend(res)

    # 6. Weave
    woven = weave_moments(llm, extracted, chunks, session_shape, sittings)

    # 7. Verify (fail-open)
    verified = verify_moments(llm, woven, chunks)

    # 7b. Derive confidence deterministically
    moments = apply_derived_confidence(verified)

    # 8. Transitions + outcomes
    transitions, outcomes = detect_transitions_and_outcomes(
        llm, moments, session_id, chunks
    )

    # 9. Narrative
    narrative = generate_narrative(
        llm, moments, transitions, outcomes, session_shape, sittings
    )
    narrative.session_id = session_id

    return UnderstandResult(
        sittings=sittings,
        chunks=chunks,
        moments=moments,
        transitions=transitions,
        outcomes=outcomes,
        narrative=narrative,
    )
