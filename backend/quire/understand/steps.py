"""Understanding steps: LLM call + deterministic post-processing, per stage.

Each step takes an UnderstandLLM (real or fake) and does exactly what the TS
step does: build the prompt, call the model (structured output), then apply the
deterministic post-processing (anchor validation, dedup+weave application,
verdict application, index→id mapping). Structural string ops here are limited
to id/index parsing — never semantic judgment (founder directive, Slice 5b).
"""

from __future__ import annotations

from typing import Optional

from quire.ingest.models import NormalizedDevEvent, SessionChunk, TurnExchange, build_exchanges
from quire.understand import prompts
from quire.understand.dedup import Pass1Moment, dedup_moments
from quire.understand.models import (
    AcceptedOutcome,
    EvidenceAnchor,
    ExtractedMoment,
    IntentTransition,
    NarrativeArc,
    SessionMoment,
    SessionNarrative,
)
from quire.understand.schemas import ExtractMoment

# ── Constants (mirror TS) ─────────────────────────────────────────────

SHORT_SESSION_THRESHOLD = 10
MAX_TOPIC_SHIFT_CANDIDATES = 250
CLAIM_TYPES = {"confirmation", "breakthrough", "execution"}
WINDOW_CHAR_LIMIT = 4000
TRUNCATION_MARKER = "— window truncated"


# ── classify session ──────────────────────────────────────────────────


def _build_classify_summary(events: list[NormalizedDevEvent]) -> dict:
    event_counts: dict[str, int] = {}
    for e in events:
        event_counts[e.category] = event_counts.get(e.category, 0) + 1
        key = f"actor:{e.actor}"
        event_counts[key] = event_counts.get(key, 0) + 1
    files: set[str] = set()
    for e in events:
        for f in e.content.files_affected or []:
            files.add(f)
    user_messages: list[str] = []
    for e in events:
        if e.actor == "user" and e.category == "intent":
            user_messages.append(e.content.summary[:200])
            if len(user_messages) >= 3:
                break
    return {
        "event_counts": event_counts,
        "files": list(files),
        "sample_user_messages": user_messages,
        "total_events": len(events),
    }


def classify_session(llm, events: list[NormalizedDevEvent]) -> str:
    summary = _build_classify_summary(events)
    system, user = prompts.build_classify_prompt(
        summary["event_counts"],
        summary["files"],
        summary["sample_user_messages"],
        summary["total_events"],
    )
    out = llm.classify_session(system, user)
    return out.shape


# ── topic shifts ──────────────────────────────────────────────────────


def detect_topic_shifts(llm, events: list[NormalizedDevEvent]) -> set[str]:
    """Fail-open: any failure → empty set (deterministic split signals remain)."""
    if len(events) < SHORT_SESSION_THRESHOLD:
        return set()
    candidates = [e for e in events if e.category == "intent"][
        :MAX_TOPIC_SHIFT_CANDIDATES
    ]
    if len(candidates) < 2:
        return set()
    try:
        system, user = prompts.build_topic_shift_prompt(candidates)
        result = llm.detect_topic_shifts(system, user)
        ids: set[str] = set()
        for s in result.shifts:
            if s.is_topic_shift:
                ids.add(s.event_id)
        return ids
    except Exception as err:  # noqa: BLE001 — enrichment must never fail the pipeline
        import sys

        sys.stderr.write(
            f"  ⚠ Topic-shift detection failed ({err}). "
            "Continuing without topic-shift splits.\n"
        )
        return set()


# ── analyze (directives) — LIVE path uses real Haiku classify_exchanges ──


def classify_exchanges(llm, exchanges: list[TurnExchange]) -> list:
    """Real Haiku call; pad/trim to exactly len(exchanges) (TS semantics)."""
    from quire.understand.schemas import ExchangeClassification

    if not exchanges:
        return []
    system = prompts.build_classifier_system_prompt()
    user = prompts.build_classifier_user_prompt(exchanges)
    response = llm.classify_exchanges(system, user)
    results = list(response.classifications)
    while len(results) < len(exchanges):
        results.append(
            ExchangeClassification(
                engagement="passive",
                intent="acceptance",
                agency="ambiguous",
                candidate_type=None,
            )
        )
    return results[: len(exchanges)]


def analyze_interactions_live(llm, events: list[NormalizedDevEvent]):
    """LIVE directives: real Haiku exchange classification (replaces the
    dry-run <100-char structural approximation). Returns PipelineDirectives."""
    from quire.ingest.models import (
        ExchangeSummary,
        PipelineDirectives,
        PromptSections,
    )

    exchanges = build_exchanges(events)
    if not exchanges:
        return PipelineDirectives(
            prompt_sections=PromptSections(
                detect_passive_acceptance=False,
                track_delegation=False,
                detect_ignored_proposals=False,
                is_learning_exchange=False,
            ),
            exchange_summary=ExchangeSummary(
                total_exchanges=0,
                short_response_count=0,
                question_count=0,
                reasoning_count=0,
                new_topic_count=0,
                ignored_proposals=[],
            ),
        )
    classifications = classify_exchanges(llm, exchanges)
    return _compute_directives(exchanges, classifications)


def _compute_directives(exchanges, classifications):
    from quire.ingest.models import (
        ExchangeSummary,
        PipelineDirectives,
        PromptSections,
    )

    passive_count = 0
    delegation_count = 0
    question_count = 0
    challenge_count = 0
    reasoning_count = 0
    new_topic_count = 0
    ignored_proposals: list[str] = []

    for i, ex in enumerate(exchanges):
        cls = classifications[i] if i < len(classifications) else None
        if cls is None:
            continue
        if cls.engagement == "passive":
            passive_count += 1
        if cls.engagement == "challenging":
            challenge_count += 1
        if cls.intent == "question":
            question_count += 1
        if cls.intent == "delegation":
            delegation_count += 1
        if cls.intent in ("challenge", "refinement"):
            reasoning_count += 1
        if cls.candidate_type in ("pivot", "proposal"):
            new_topic_count += 1
        if cls.engagement == "passive" and cls.candidate_type is None:
            ai_proposal_count = sum(
                1
                for e in ex.ai_turn_events
                if e.category == "proposal" and len(e.content.detail) > 200
            )
            if ai_proposal_count > 1:
                ignored_proposals.append(
                    f"Exchange at event {ex.dev_event.causal_order}: dev responded "
                    "passively to multi-part AI proposal"
                )

    total = len(exchanges)
    detect_passive = (passive_count / total) >= 0.7 if total else False
    track_delegation = (
        (delegation_count / total > 0.3)
        or ((passive_count - challenge_count) / total > 0.5)
    ) if total else False

    return PipelineDirectives(
        prompt_sections=PromptSections(
            detect_passive_acceptance=detect_passive,
            track_delegation=track_delegation,
            detect_ignored_proposals=len(ignored_proposals) > 0,
            is_learning_exchange=question_count > 0,
        ),
        exchange_summary=ExchangeSummary(
            total_exchanges=total,
            short_response_count=passive_count,
            question_count=question_count,
            reasoning_count=reasoning_count,
            new_topic_count=new_topic_count,
            ignored_proposals=ignored_proposals,
        ),
    )


# ── extract + validate anchors ────────────────────────────────────────


def _normalize_text(s: str) -> str:
    import re

    return re.sub(r"\s+", " ", s.lower())


def validate_anchors(
    moments: list[ExtractMoment], chunk: SessionChunk
) -> list[ExtractedMoment]:
    event_by_order = {ev.causal_order: ev for ev in chunk.events}
    present_orders = {e.causal_order for e in chunk.events}
    range_start, range_end = chunk.event_range

    def quote_found_in_event(quote: str, ev) -> bool:
        haystack = _normalize_text(ev.content.detail + " " + ev.content.summary)
        needle = _normalize_text(quote)
        return needle in haystack

    def is_in_range(order: int) -> bool:
        return (range_start <= order <= range_end) or (order in present_orders)

    result: list[ExtractedMoment] = []
    for i, m in enumerate(moments):
        moment_id = f"c{chunk.chunk_index}-m{i}"
        resolved: list[EvidenceAnchor] = []
        for ev in m.evidence:
            raw_index = ev.event_index
            # number | string | null → int or None
            if isinstance(raw_index, bool):
                event_index = None
            elif isinstance(raw_index, int):
                event_index = raw_index
            elif isinstance(raw_index, str):
                try:
                    event_index = int(raw_index)
                except ValueError:
                    event_index = None
            else:
                event_index = None

            cited_event = (
                event_by_order.get(event_index) if event_index is not None else None
            )
            cited_in_range = event_index is not None and is_in_range(event_index)
            quote_in_cited = cited_event is not None and quote_found_in_event(
                ev.quote, cited_event
            )

            if cited_in_range and quote_in_cited:
                resolved.append(
                    EvidenceAnchor(
                        quote=ev.quote,
                        event_index=event_index,
                        anchored=True,
                        source_type=ev.source_type,
                    )
                )
                continue

            matching = [c for c in chunk.events if quote_found_in_event(ev.quote, c)]
            if len(matching) == 1:
                resolved.append(
                    EvidenceAnchor(
                        quote=ev.quote,
                        event_index=matching[0].causal_order,
                        anchored=True,
                        source_type=ev.source_type,
                    )
                )
                continue

            resolved.append(
                EvidenceAnchor(
                    quote=ev.quote,
                    event_index=event_index if cited_in_range else None,
                    anchored=False,
                    source_type=ev.source_type,
                )
            )

        occurred_at: Optional[str] = None
        for anchor in resolved:
            if anchor.anchored and anchor.event_index is not None:
                ev = event_by_order.get(anchor.event_index)
                if ev:
                    occurred_at = ev.timestamp
                    break
        if occurred_at is None:
            occurred_at = chunk.events[0].timestamp if chunk.events else None

        result.append(
            ExtractedMoment(
                id=moment_id,
                chunk_index=chunk.chunk_index,
                type=m.type,
                statement=m.statement,
                significance=m.significance or "",
                agency=m.agency,
                confidence=m.confidence,
                topic_fingerprint=m.topic_fingerprint or "general",
                evidence=resolved,
                occurred_at=occurred_at,
            )
        )
    return result


def extract_chunk(
    llm,
    chunk: SessionChunk,
    session_shape: str,
    directives=None,
    digest_header: Optional[str] = None,
) -> list[ExtractedMoment]:
    system, user = prompts.build_extract_prompt(
        chunk, session_shape, directives, digest_header
    )
    output = llm.extract(system, user)
    return validate_anchors(output.moments, chunk)


# ── weave ─────────────────────────────────────────────────────────────


def _map_arc_role(role: str) -> str:
    return "escalation" if role == "development" else role


def apply_weave_decisions(
    decisions: list, extracted: list[ExtractedMoment], chunks: list[SessionChunk]
) -> list[SessionMoment]:
    import sys

    extracted_by_id = {m.id: m for m in extracted}
    chunk_id_by_index = {c.chunk_index: c.id for c in chunks}
    claimed_ids: set[str] = set()

    intermediate: list[dict] = []

    for decision in decisions:
        action = decision.action
        moment_ids = decision.moment_ids
        known_ids: list[str] = []
        for mid in moment_ids:
            if mid not in extracted_by_id:
                sys.stderr.write(
                    f'[weave] warning: unknown moment id "{mid}" in decision — ignored\n'
                )
                continue
            known_ids.append(mid)
        if not known_ids:
            continue

        if action == "drop":
            for mid in known_ids:
                claimed_ids.add(mid)
            continue

        primary_id = known_ids[0]
        primary = extracted_by_id[primary_id]

        if action == "keep":
            claimed_ids.add(primary_id)
        else:
            for mid in known_ids:
                claimed_ids.add(mid)

        if action == "keep" or len(known_ids) == 1:
            chunk_id = chunk_id_by_index.get(primary.chunk_index, primary_id)
            intermediate.append(
                {
                    "extract_id": primary_id,
                    "chunk_id": chunk_id,
                    "type": primary.type,
                    "statement": primary.statement,
                    "significance": primary.significance,
                    "agency": primary.agency,
                    "confidence": primary.confidence or "low",
                    "topic_fingerprint": primary.topic_fingerprint,
                    "evidence": primary.evidence,
                    "occurred_at": primary.occurred_at,
                    "verification": None,
                    "arc_id": decision.arc_id or "general",
                    "arc_role": _map_arc_role(decision.arc_role or "development"),
                    "related_extract_ids": decision.related_to or [],
                }
            )
        else:
            all_moments = [extracted_by_id[mid] for mid in known_ids]
            evidence_union: list[EvidenceAnchor] = []
            for m in all_moments:
                evidence_union.extend(m.evidence)
            times = sorted(m.occurred_at for m in all_moments if m.occurred_at is not None)
            occurred_at = times[0] if times else None
            statement = decision.statement or primary.statement
            chunk_id = chunk_id_by_index.get(primary.chunk_index, primary_id)
            intermediate.append(
                {
                    "extract_id": primary_id,
                    "chunk_id": chunk_id,
                    "type": primary.type,
                    "statement": statement,
                    "significance": primary.significance,
                    "agency": primary.agency,
                    "confidence": primary.confidence or "low",
                    "topic_fingerprint": primary.topic_fingerprint,
                    "evidence": evidence_union,
                    "occurred_at": occurred_at,
                    "verification": None,
                    "arc_id": decision.arc_id or "general",
                    "arc_role": _map_arc_role(decision.arc_role or "development"),
                    "related_extract_ids": decision.related_to or [],
                }
            )

    # Implicit keep
    for m in extracted:
        if m.id not in claimed_ids:
            chunk_id = chunk_id_by_index.get(m.chunk_index, m.id)
            intermediate.append(
                {
                    "extract_id": m.id,
                    "chunk_id": chunk_id,
                    "type": m.type,
                    "statement": m.statement,
                    "significance": m.significance,
                    "agency": m.agency,
                    "confidence": m.confidence or "low",
                    "topic_fingerprint": m.topic_fingerprint,
                    "evidence": m.evidence,
                    "occurred_at": m.occurred_at,
                    "verification": None,
                    "arc_id": "general",
                    "arc_role": None,
                    "related_extract_ids": [],
                }
            )

    final_id_by_extract = {m["extract_id"]: f"moment-{i}" for i, m in enumerate(intermediate)}

    result: list[SessionMoment] = []
    for i, m in enumerate(intermediate):
        resolved_related = [
            final_id_by_extract[eid]
            for eid in m["related_extract_ids"]
            if eid in final_id_by_extract
        ]
        result.append(
            SessionMoment(
                id=f"moment-{i}",
                chunk_id=m["chunk_id"],
                type=m["type"],
                statement=m["statement"],
                significance=m["significance"],
                agency=m["agency"],
                confidence=m["confidence"],
                topic_fingerprint=m["topic_fingerprint"],
                evidence=m["evidence"],
                occurred_at=m["occurred_at"],
                verification=m["verification"],
                arc_id=m["arc_id"],
                arc_role=m["arc_role"],
                related_moment_ids=resolved_related,
            )
        )
    return result


def weave_moments(
    llm,
    extracted: list[ExtractedMoment],
    chunks: list[SessionChunk],
    session_shape: str,
    sittings: list,
) -> list[SessionMoment]:
    # Build Pass1Moment adapter + object-identity map to extract ids.
    pass1_to_extract_id: dict[int, str] = {}
    pass1_results: list[dict] = []
    for chunk in chunks:
        chunk_moments: list[Pass1Moment] = []
        for m in extracted:
            if m.chunk_index != chunk.chunk_index:
                continue
            p1 = Pass1Moment(
                type=m.type,
                statement=m.statement,
                significance=m.significance,
                agency=m.agency,
                confidence=m.confidence or "low",
                topic_fingerprint=m.topic_fingerprint,
                evidence=[
                    {
                        "quote": e.quote,
                        "sourceEventId": str(e.event_index)
                        if e.event_index is not None
                        else None,
                        "sourceType": e.source_type,
                        "quoteType": "verbatim",
                    }
                    for e in m.evidence
                ],
            )
            pass1_to_extract_id[id(p1)] = m.id
            chunk_moments.append(p1)
        pass1_results.append(
            {"chunk_index": chunk.chunk_index, "moments": chunk_moments}
        )

    dedup_result = dedup_moments(pass1_results, chunks)

    removed_extract_ids: set[str] = set()
    for entry in dedup_result.removed:
        eid = pass1_to_extract_id.get(id(entry.moment))
        if eid is not None:
            removed_extract_ids.add(eid)
    surviving = [m for m in extracted if m.id not in removed_extract_ids]

    if not surviving:
        return []

    system, user = prompts.build_weave_prompt(surviving, session_shape, sittings)
    output = llm.weave(system, user)
    return apply_weave_decisions(output.decisions, surviving, chunks)


# ── verify ────────────────────────────────────────────────────────────


def select_claims(moments: list[SessionMoment]) -> list[SessionMoment]:
    return [m for m in moments if m.type in CLAIM_TYPES]


def build_claim_window(moment: SessionMoment, chunks: list[SessionChunk]) -> str:
    chunk = next((c for c in chunks if c.id == moment.chunk_id), None)
    if chunk is None:
        return "(chunk not found)"
    events = [e for e in chunk.events if e.category in ("action", "result")]
    if not events:
        return "(no action or result events in chunk)"
    lines: list[str] = []
    for e in events:
        full_detail = e.content.detail
        detail = full_detail[:500]
        marker = " …[event truncated]" if len(full_detail) > 500 else ""
        lines.append(f"[{e.causal_order}] {e.category.upper()}({e.actor}): {detail}{marker}")
    full_text = "\n".join(lines)
    if len(full_text) <= WINDOW_CHAR_LIMIT:
        return full_text
    for end in range(len(lines) - 1, 0, -1):
        candidate = "\n".join(lines[:end]) + "\n" + TRUNCATION_MARKER
        if len(candidate) <= WINDOW_CHAR_LIMIT:
            return candidate
    return TRUNCATION_MARKER


def apply_verdicts(moments: list[SessionMoment], verdicts: list) -> list[SessionMoment]:
    verdict_by_id = {v.moment_id: v.verdict for v in verdicts}
    claim_ids = {m.id for m in select_claims(moments)}
    result: list[SessionMoment] = []
    for moment in moments:
        if moment.id not in claim_ids:
            result.append(moment)
            continue
        verdict = verdict_by_id.get(moment.id)
        if verdict is None:
            result.append(moment.model_copy(update={"verification": "unverified"}))
        elif verdict == "contradicted":
            result.append(
                moment.model_copy(
                    update={"verification": "contradicted", "confidence": "low"}
                )
            )
        else:
            result.append(moment.model_copy(update={"verification": verdict}))
    return result


def verify_moments(
    llm, moments: list[SessionMoment], chunks: list[SessionChunk]
) -> list[SessionMoment]:
    claims = select_claims(moments)
    if not claims:
        return moments
    windows = {m.id: build_claim_window(m, chunks) for m in claims}
    claim_inputs = [
        {"momentId": m.id, "statement": m.statement, "type": m.type} for m in claims
    ]
    system, user = prompts.build_verify_prompt(claim_inputs, windows)
    try:
        output = llm.verify(system, user)
        return apply_verdicts(moments, output.verdicts)
    except Exception as err:  # noqa: BLE001 — verify is fail-open
        import sys

        sys.stderr.write(
            f"[verify] LLM call failed — returning moments unchanged. Error: {err}\n"
        )
        return moments


# ── transitions ───────────────────────────────────────────────────────


def _moment_to_prompt_dict(m: SessionMoment) -> dict:
    """SessionMoment → the dict the transitions/narrative prompt builders read.
    Maps sourceType/arcRole back to the Pass2 vocabulary the TS prompt renders."""
    return {
        "type": m.type,
        "statement": m.statement,
        "significance": m.significance,
        "agency": _map_agency(m.agency),
        "arcId": m.arc_id or "general",
        "arcRole": _map_arc_role_back(m.arc_role),
        "confidence": m.confidence,
        "topicFingerprint": m.topic_fingerprint,
        "verification": m.verification,
        "occurredAt": m.occurred_at,
        "evidence": [{"quote": e.quote} for e in m.evidence],
    }


def _map_agency(agency: Optional[str]) -> str:
    return agency if agency in ("developer", "ai", "collaborative") else "collaborative"


def _map_arc_role_back(role: Optional[str]) -> str:
    if role in ("origin", "turning_point", "resolution"):
        return role
    return "development"


def _parse_moment_index(moment_id: str) -> int:
    import re

    m = re.search(r"\d+", moment_id)
    return int(m.group()) if m else 0


def _collect_files(chunks: list[SessionChunk]) -> list[str]:
    files: set[str] = set()
    for c in chunks:
        for f in c.files_in_scope:
            files.add(f)
    return list(files)


def detect_transitions_and_outcomes(
    llm, moments: list[SessionMoment], session_id: str, chunks: list[SessionChunk]
) -> tuple[list[IntentTransition], list[AcceptedOutcome]]:
    prompt_moments = [_moment_to_prompt_dict(m) for m in moments]
    files_in_session = _collect_files(chunks)
    system, user = prompts.build_transitions_prompt(
        prompt_moments, "narrative", files_in_session
    )
    output = llm.transitions(system, user)

    transitions: list[IntentTransition] = []
    for i, t in enumerate(output.transitions):
        transitions.append(
            IntentTransition(
                id=f"transition-{i}",
                session_id=session_id,
                from_statement=t.from_statement,
                to_statement=t.to_statement,
                reason=t.reason,
                origin_moment_ids=[f"moment-{idx}" for idx in t.triggering_moment_indices],
                arc_id=t.arc_id,
                confidence=t.confidence,
            )
        )

    outcomes: list[AcceptedOutcome] = []
    for i, o in enumerate(output.outcomes):
        outcomes.append(
            AcceptedOutcome(
                id=f"outcome-{i}",
                session_id=session_id,
                statement=o.statement,
                supporting_moment_ids=[f"moment-{idx}" for idx in o.supporting_moment_indices],
                supporting_files=o.files_affected,
                confidence=o.confidence,
            )
        )

    return transitions, outcomes


# ── narrative ─────────────────────────────────────────────────────────


def _map_resolution(res: str) -> str:
    return {
        "completed": "resolved",
        "abandoned": "abandoned",
        "ongoing": "open",
        "merged": "resolved",
    }.get(res, "open")


def generate_narrative(
    llm,
    moments: list[SessionMoment],
    transitions: list[IntentTransition],
    outcomes: list[AcceptedOutcome],
    session_shape: str,
    sittings: list,
) -> SessionNarrative:
    prompt_moments = [_moment_to_prompt_dict(m) for m in moments]
    prompt_transitions = [
        {
            "fromStatement": t.from_statement,
            "toStatement": t.to_statement,
            "reason": t.reason,
            "arcId": t.arc_id or "general",
        }
        for t in transitions
    ]
    prompt_outcomes = [
        {"statement": o.statement, "filesAffected": o.supporting_files} for o in outcomes
    ]
    system, user = prompts.build_narrative_prompt(
        prompt_moments, prompt_transitions, prompt_outcomes, session_shape, sittings
    )
    result = llm.narrative(system, user)

    arcs = [
        NarrativeArc(
            arc_id=arc.arc_id,
            title=arc.title,
            summary=arc.summary,
            moment_ids=[f"moment-{idx}" for idx in arc.moment_ids],
            resolution=_map_resolution(arc.resolution),
        )
        for arc in result.arcs
    ]

    return SessionNarrative(
        session_id="",
        session_shape=session_shape,
        summary=result.summary,
        progression=result.progression,
        discoveries=result.discoveries,
        stabilized_directions=result.stabilized_directions,
        abandoned_directions=result.abandoned_directions,
        arcs=arcs,
    )
