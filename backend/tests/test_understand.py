"""Offline tests for quire.understand — canned LLM only, no network.

Exercises the deterministic post-processing around each LLM step (anchor
validation, dedup, weave-decision application, verdicts, confidence derivation)
plus the full understand() pipeline with a FakeUnderstandLLM, and the writer's
LLM-derived persistence on in-memory SQLite.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from sqlalchemy import select, text as sa_text
from sqlalchemy.orm import Session as SASession

from quire.db.engine import make_test_engine
from quire.db.models import Base, Moment, MomentEvidence, Narrative, Transition
from quire.db.writer import store_session_digest
from quire.ingest.models import (
    NormalizedContent,
    NormalizedDevEvent,
    SessionChunk,
)
from quire.understand import FakeUnderstandLLM, understand
from quire.understand.confidence import apply_derived_confidence, derive_confidence
from quire.understand.models import EvidenceAnchor, ExtractedMoment, SessionMoment
from quire.understand.prompts import (
    AGENCY_RUBRIC,
    MOMENT_TYPES_TAXONOMY,
    build_extract_prompt,
    build_narrative_prompt,
    build_transitions_prompt,
    build_verify_prompt,
    build_weave_prompt,
)
from quire.understand.render import render_chunk_events
from quire.understand.schemas import (
    ExtractEvidence,
    ExtractMoment,
    ExtractOutput,
    NarrativeArcOutput,
    SessionNarrativeOutput,
    TransitionsOutput,
    VerifyOutput,
    VerifyVerdict,
    WeaveDecision,
    WeaveOutput,
)
from quire.understand.steps import (
    apply_verdicts,
    apply_weave_decisions,
    build_claim_window,
    select_claims,
    validate_anchors,
    weave_moments,
)


# ── Builders ───────────────────────────────────────────────────────────────


def _ev(idx, category, actor, detail, summary=None, files=None, ts=None):
    return NormalizedDevEvent(
        id=f"e{idx}",
        sessionId="s",
        timestamp=ts or f"2026-07-21T00:{idx:02d}:00Z",
        causalOrder=idx,
        category=category,
        actor=actor,
        content=NormalizedContent(
            summary=summary or detail[:40], detail=detail, filesAffected=files or []
        ),
        rawEventId=f"r{idx}",
        turnId=f"t{idx}",
    )


def _chunk(events, index=0, session_id="s"):
    orders = [e.causal_order for e in events]
    return SessionChunk(
        id=f"{session_id}-chunk-{index}",
        session_id=session_id,
        chunk_index=index,
        events=events,
        topic_hint="topic",
        files_in_scope=["a.py"],
        event_range=(min(orders), max(orders)),
    )


# ── Prompt verbatim checks ──────────────────────────────────────────────────


def test_extract_prompt_embeds_rubrics_verbatim():
    ch = _chunk([_ev(0, "intent", "user", "do the thing?")])
    system, user = build_extract_prompt(ch, "narrative")
    assert MOMENT_TYPES_TAXONOMY in system
    assert AGENCY_RUBRIC in system
    # shape-specific guidance for narrative
    assert "This session has a build arc" in system
    assert "## Session Shape: narrative" in user


def test_render_chunk_events_formats_by_category():
    events = [
        _ev(0, "intent", "user", "make it work"),
        _ev(1, "action", "ai", "editing", files=["x.py"]),
        _ev(2, "result", "ai", "Error: boom"),
        _ev(3, "result", "ai", "done ok", summary="all green"),
    ]
    out = render_chunk_events(events)
    assert "[0] DEV: make it work" in out
    assert "[1] AI/ACTION(x.py): editing" in out
    assert "[2] RESULT(error): Error: boom" in out
    assert "[3] RESULT: all green" in out


# ── validate_anchors ────────────────────────────────────────────────────────


def test_validate_anchors_happy_path():
    ev = _ev(0, "intent", "user", "let us use testcontainers")
    ch = _chunk([ev])
    moments = [
        ExtractMoment(
            type="commitment",
            statement="use testcontainers",
            agency="developer",
            evidence=[
                ExtractEvidence(quote="use testcontainers", eventIndex=0, sourceType="user")
            ],
        )
    ]
    result = validate_anchors(moments, ch)
    assert len(result) == 1
    assert result[0].id == "c0-m0"
    assert result[0].evidence[0].anchored is True
    assert result[0].evidence[0].event_index == 0
    assert result[0].occurred_at == ev.timestamp


def test_validate_anchors_reanchors_when_quote_elsewhere():
    ch = _chunk(
        [
            _ev(0, "intent", "user", "nothing here"),
            _ev(1, "proposal", "ai", "the special phrase lives here"),
        ]
    )
    moments = [
        ExtractMoment(
            type="proposal",
            statement="x",
            agency="ai",
            evidence=[ExtractEvidence(quote="special phrase", eventIndex=0)],
        )
    ]
    result = validate_anchors(moments, ch)
    assert result[0].evidence[0].anchored is True
    assert result[0].evidence[0].event_index == 1  # re-anchored


def test_validate_anchors_unanchored_when_quote_absent():
    ch = _chunk([_ev(0, "intent", "user", "hello world")])
    moments = [
        ExtractMoment(
            type="discovery",
            statement="x",
            agency="ai",
            evidence=[ExtractEvidence(quote="not present anywhere", eventIndex=0)],
        )
    ]
    result = validate_anchors(moments, ch)
    assert result[0].evidence[0].anchored is False


# ── confidence derivation ────────────────────────────────────────────────────


def _moment(evidence, verification=None):
    return SessionMoment(
        id="moment-0",
        chunk_id="s-chunk-0",
        type="discovery",
        statement="x",
        agency="developer",
        confidence="high",
        evidence=evidence,
        verification=verification,
    )


def test_derive_confidence_rules():
    user_anchored = EvidenceAnchor(quote="q", event_index=0, anchored=True, source_type="user")
    ai_anchored = EvidenceAnchor(quote="q", event_index=0, anchored=True, source_type="ai")
    unanchored = EvidenceAnchor(quote="q", event_index=None, anchored=False, source_type="ai")

    assert derive_confidence(_moment([user_anchored])) == "high"
    assert derive_confidence(_moment([ai_anchored])) == "medium"
    assert derive_confidence(_moment([unanchored])) == "low"
    assert derive_confidence(_moment([user_anchored], verification="contradicted")) == "low"
    assert derive_confidence(_moment([unanchored], verification="supported")) == "high"


def test_apply_derived_confidence_is_non_mutating():
    m = _moment([EvidenceAnchor(quote="q", anchored=False, source_type="ai")])
    out = apply_derived_confidence([m])
    assert out[0].confidence == "low"
    assert m.confidence == "high"  # original untouched


# ── weave: dedup survivors + apply decisions ─────────────────────────────────


def _extracted(mid, chunk_index, event_index, agency="developer", conf="high"):
    return ExtractedMoment(
        id=mid,
        chunk_index=chunk_index,
        type="discovery",
        statement=f"stmt {mid}",
        agency=agency,
        confidence=conf,
        evidence=[
            EvidenceAnchor(
                quote="q", event_index=event_index, anchored=True, source_type="ai"
            )
        ],
        occurred_at="2026-07-21T00:00:00Z",
    )


def test_apply_weave_decisions_keep_and_implicit_keep():
    extracted = [_extracted("c0-m0", 0, 0), _extracted("c0-m1", 0, 1)]
    chunks = [_chunk([_ev(0, "intent", "user", "a"), _ev(1, "action", "ai", "b")])]
    decisions = [WeaveDecision(action="keep", momentIds=["c0-m0"], arcId="arc-x")]
    out = apply_weave_decisions(decisions, extracted, chunks)
    assert [m.id for m in out] == ["moment-0", "moment-1"]  # explicit + implicit keep
    assert out[0].arc_id == "arc-x"
    assert out[1].arc_id == "general"  # implicit keep


def test_apply_weave_decisions_merge_unions_evidence():
    extracted = [_extracted("c0-m0", 0, 0), _extracted("c0-m1", 0, 1)]
    chunks = [_chunk([_ev(0, "intent", "user", "a"), _ev(1, "action", "ai", "b")])]
    decisions = [
        WeaveDecision(
            action="merge",
            momentIds=["c0-m0", "c0-m1"],
            statement="merged",
            arcId="arc-x",
            arcRole="development",
        )
    ]
    out = apply_weave_decisions(decisions, extracted, chunks)
    assert len(out) == 1
    assert out[0].statement == "merged"
    assert len(out[0].evidence) == 2  # union
    assert out[0].arc_role == "escalation"  # development → escalation


def test_apply_weave_decisions_drop_excludes():
    extracted = [_extracted("c0-m0", 0, 0), _extracted("c0-m1", 0, 1)]
    chunks = [_chunk([_ev(0, "intent", "user", "a"), _ev(1, "action", "ai", "b")])]
    decisions = [
        WeaveDecision(action="drop", momentIds=["c0-m0"], reason="vague"),
        WeaveDecision(action="keep", momentIds=["c0-m1"]),
    ]
    out = apply_weave_decisions(decisions, extracted, chunks)
    assert [m.statement for m in out] == ["stmt c0-m1"]


def test_weave_dedups_overlap_across_adjacent_chunks():
    # Same sourceEventId (event 5) in adjacent chunks → one removed.
    e_high = _extracted("c0-m0", 0, 5, conf="high")  # score 2*1+3=5
    e_low = _extracted("c1-m0", 1, 5, conf="low")  # score 2*1+1=3
    chunks = [
        _chunk([_ev(5, "action", "ai", "x")], index=0),
        _chunk([_ev(5, "action", "ai", "x")], index=1),
    ]
    llm = FakeUnderstandLLM(
        weave=lambda s, u: WeaveOutput(
            decisions=[
                WeaveDecision(action="keep", momentIds=["c0-m0"]),
            ]
        )
    )
    out = weave_moments(llm, [e_high, e_low], chunks, "narrative", [])
    # low-confidence duplicate removed before weave; only the survivor persists
    statements = [m.statement for m in out]
    assert "stmt c0-m0" in statements
    assert "stmt c1-m0" not in statements


# ── verify: claims, window, verdicts ─────────────────────────────────────────


def test_select_claims_filters_types():
    m_claim = _moment([]).model_copy(update={"type": "confirmation"})
    m_other = _moment([]).model_copy(update={"type": "discovery"})
    claims = select_claims([m_claim, m_other])
    assert [c.type for c in claims] == ["confirmation"]


def test_apply_verdicts_contradicted_demotes_confidence():
    m = _moment([]).model_copy(update={"id": "moment-0", "type": "execution", "confidence": "high"})
    verdicts = [VerifyVerdict(momentId="moment-0", verdict="contradicted")]
    out = apply_verdicts([m], verdicts)
    assert out[0].verification == "contradicted"
    assert out[0].confidence == "low"


def test_apply_verdicts_missing_verdict_is_unverified():
    m = _moment([]).model_copy(update={"id": "moment-0", "type": "breakthrough"})
    out = apply_verdicts([m], [])
    assert out[0].verification == "unverified"


def test_build_claim_window_renders_action_result():
    ch = _chunk(
        [
            _ev(0, "intent", "user", "go"),
            _ev(1, "action", "ai", "run tests"),
            _ev(2, "result", "ai", "3 passed"),
        ]
    )
    m = _moment([]).model_copy(update={"chunk_id": ch.id, "type": "confirmation"})
    window = build_claim_window(m, [ch])
    assert "ACTION" in window and "RESULT" in window
    assert "3 passed" in window


# ── full pipeline (offline) ──────────────────────────────────────────────────


def test_understand_pipeline_offline_end_to_end():
    from quire.canned import fake_understand_llm

    events = [
        _ev(0, "intent", "user", "let us build the parser"),
        _ev(1, "proposal", "ai", "I will start with the tokenizer"),
        _ev(2, "action", "ai", "wrote tokenizer", files=["parser.py"]),
        _ev(3, "result", "ai", "tests pass", summary="green"),
    ]
    llm = fake_understand_llm()
    result = understand(llm, events, "sess-1", "narrative", None, set())
    assert result.narrative.summary == "Canned offline narrative summary."
    assert result.narrative.session_id == "sess-1"
    # at least one moment extracted and woven
    assert len(result.moments) >= 1
    assert all(m.id.startswith("moment-") for m in result.moments)
    # confidence derived (not the raw model value)
    assert all(m.confidence in ("high", "medium", "low") for m in result.moments)


# ── writer: LLM-derived persistence ──────────────────────────────────────────


@pytest.fixture
def engine():
    from sqlalchemy import event as sa_event

    eng = make_test_engine()

    @sa_event.listens_for(eng, "connect")
    def _fk(dbapi_conn, _rec):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    Base.metadata.create_all(eng)
    yield eng
    Base.metadata.drop_all(eng)


@pytest.fixture
def patched_get_session(engine):
    def _get():
        return SASession(engine)

    with patch("quire.db.writer.get_session", _get):
        yield engine


def test_writer_persists_moments_evidence_narrative(patched_get_session):
    from quire.canned import fake_understand_llm
    from quire.ingest import chunk_session
    from quire.ingest.models import RawDevEvent

    events = [
        _ev(0, "intent", "user", "build the parser now"),
        _ev(1, "proposal", "ai", "start with tokenizer"),
        _ev(2, "action", "ai", "wrote tokenizer", files=["parser.py"]),
        _ev(3, "result", "ai", "tests pass", summary="green"),
    ]
    llm = fake_understand_llm()
    understanding = understand(llm, events, "hash-x", "narrative", None, set())

    raw = [
        RawDevEvent(id=f"r{e.causal_order}", timestamp=e.timestamp, type="conversation_turn", raw={})
        for e in events
    ]

    result = store_session_digest(
        source_path="/tmp/x.jsonl",
        source_hash="hash-x",
        raw_events=raw,
        normalized_events=events,
        chunks=understanding.chunks,
        sittings=understanding.sittings,
        started_at=None,
        ended_at=None,
        understanding=understanding,
        session_shape="narrative",
    )
    assert result.stored is True

    with SASession(patched_get_session) as s:
        moments = s.execute(select(Moment)).scalars().all()
        evidence = s.execute(select(MomentEvidence)).scalars().all()
        narratives = s.execute(select(Narrative)).scalars().all()

    assert len(moments) == len(understanding.moments) >= 1
    assert len(narratives) == 1
    assert narratives[0].summary == "Canned offline narrative summary."
    # evidence source_event_id resolves to a normalized event uuid (anchored)
    assert any(e.source_event_id is not None for e in evidence)
    # moment chunk_id resolved to a real chunk row (not null)
    assert any(m.chunk_id is not None for m in moments)


def test_writer_evidence_anchors_to_normalized_event(patched_get_session):
    """The anchored evidence's source_event_id must point at the matching
    normalized event row (the join the fidelity 'anchored%' metric reads)."""
    from quire.ingest.models import RawDevEvent

    ev = _ev(0, "intent", "user", "the anchored phrase")
    chunk = _chunk([ev])
    moment = SessionMoment(
        id="moment-0",
        chunk_id=chunk.id,
        type="discovery",
        statement="s",
        agency="developer",
        confidence="high",
        evidence=[
            EvidenceAnchor(quote="anchored phrase", event_index=0, anchored=True, source_type="user")
        ],
        occurred_at=ev.timestamp,
    )
    from quire.understand.models import SessionNarrative, UnderstandResult

    understanding = UnderstandResult(
        sittings=[],
        chunks=[chunk],
        moments=[moment],
        transitions=[],
        outcomes=[],
        narrative=SessionNarrative(summary="n"),
    )
    raw = [RawDevEvent(id="r0", timestamp=ev.timestamp, type="conversation_turn", raw={})]

    store_session_digest(
        source_path="/tmp/y.jsonl",
        source_hash="hash-y",
        raw_events=raw,
        normalized_events=[ev],
        chunks=[chunk],
        sittings=[],
        started_at=None,
        ended_at=None,
        understanding=understanding,
        session_shape="narrative",
    )

    with SASession(patched_get_session) as s:
        row = s.execute(
            sa_text(
                "SELECT me.source_event_id, ne.causal_order "
                "FROM moment_evidence me JOIN normalized_events ne "
                "ON me.source_event_id = ne.id"
            )
        ).first()
    assert row is not None
    assert row[1] == 0  # anchored to causal_order 0


# ── classify_session / detect_topic_shifts / analyze_interactions_live ──────


def test_classify_session_returns_shape_and_builds_summary():
    from quire.understand.schemas import SessionShapeOutput
    from quire.understand.steps import classify_session

    captured = {}

    def _canned(system, user):
        captured["system"] = system
        captured["user"] = user
        return SessionShapeOutput(shape="debugging")

    llm = FakeUnderstandLLM(classify_session=_canned)
    events = [
        _ev(0, "intent", "user", "why does the test fail?"),
        _ev(1, "action", "ai", "ran pytest", files=["test_x.py"]),
        _ev(2, "result", "ai", "1 failed"),
    ]
    shape = classify_session(llm, events)
    assert shape == "debugging"
    assert llm.calls == ["classify_session"]
    # summary blocks rendered into the user prompt
    assert "**Total events:** 3" in captured["user"]
    assert "test_x.py" in captured["user"]
    assert "why does the test fail?" in captured["user"]
    assert "debugging" in captured["system"]  # five-shape rubric present


def test_detect_topic_shifts_returns_flagged_ids():
    from quire.understand.schemas import TopicShiftEntry, TopicShiftOutput
    from quire.understand.steps import detect_topic_shifts

    events = [
        _ev(i, "intent" if i % 2 == 0 else "action", "user" if i % 2 == 0 else "ai", f"msg {i}")
        for i in range(12)  # ≥ SHORT_SESSION_THRESHOLD, ≥2 intent candidates
    ]
    llm = FakeUnderstandLLM(
        detect_topic_shifts=lambda s, u: TopicShiftOutput(
            shifts=[
                TopicShiftEntry(eventId="e0", isTopicShift=False),
                TopicShiftEntry(eventId="e2", isTopicShift=True),
                TopicShiftEntry(eventId="e4", isTopicShift=True),
            ]
        )
    )
    ids = detect_topic_shifts(llm, events)
    assert ids == {"e2", "e4"}
    assert llm.calls == ["detect_topic_shifts"]


def test_detect_topic_shifts_short_session_skips_llm():
    from quire.understand.steps import detect_topic_shifts

    llm = FakeUnderstandLLM()
    events = [_ev(i, "intent", "user", f"m{i}") for i in range(5)]  # < threshold
    assert detect_topic_shifts(llm, events) == set()
    assert llm.calls == []  # no LLM call on short sessions


def test_detect_topic_shifts_fail_open_on_llm_error():
    from quire.understand.steps import detect_topic_shifts

    def _boom(system, user):
        raise RuntimeError("api down")

    llm = FakeUnderstandLLM(detect_topic_shifts=_boom)
    events = [
        _ev(i, "intent" if i % 2 == 0 else "action", "user" if i % 2 == 0 else "ai", f"m{i}")
        for i in range(12)
    ]
    assert detect_topic_shifts(llm, events) == set()  # empty set, no raise


def test_classify_exchanges_pads_and_trims_to_input_length():
    from quire.understand.schemas import (
        BatchClassificationOutput,
        ExchangeClassification,
    )
    from quire.understand.steps import _build_exchanges, classify_exchanges

    events = [
        _ev(0, "intent", "user", "first"),
        _ev(1, "action", "ai", "did a thing"),
        _ev(2, "intent", "user", "second"),
        _ev(3, "intent", "user", "third"),
    ]
    exchanges = _build_exchanges(events)
    assert len(exchanges) == 3

    # Model returns only ONE classification → padded with passive defaults
    llm = FakeUnderstandLLM(
        classify_exchanges=lambda s, u: BatchClassificationOutput(
            classifications=[
                ExchangeClassification(
                    engagement="challenging",
                    intent="challenge",
                    agency="developer",
                    candidateType="pivot",
                )
            ]
        )
    )
    results = classify_exchanges(llm, exchanges)
    assert len(results) == 3
    assert results[0].engagement == "challenging"
    assert results[1].engagement == "passive"  # padded default
    assert results[1].agency == "ambiguous"
    assert results[2].candidate_type is None


def test_candidate_type_invalid_value_coerced_to_none():
    from quire.understand.schemas import ExchangeClassification

    c = ExchangeClassification(
        engagement="active",
        intent="question",
        agency="developer",
        candidateType="not-a-real-type",
    )
    assert c.candidate_type is None


def test_analyze_interactions_live_computes_directives():
    from quire.understand.schemas import (
        BatchClassificationOutput,
        ExchangeClassification,
    )
    from quire.understand.steps import analyze_interactions_live

    # 4 intents → 4 exchanges; make 3 passive (75% ≥ 0.7 → detect_passive), 1 question
    events = []
    for i in range(4):
        events.append(_ev(i * 2, "intent", "user", "ok" if i < 3 else "how does chunking work?"))
        events.append(_ev(i * 2 + 1, "action", "ai", "worked"))

    def _cls(system, user):
        cs = [
            ExchangeClassification(
                engagement="passive", intent="acceptance", agency="ai", candidateType=None
            )
            for _ in range(3)
        ]
        cs.append(
            ExchangeClassification(
                engagement="active", intent="question", agency="developer", candidateType=None
            )
        )
        return BatchClassificationOutput(classifications=cs)

    llm = FakeUnderstandLLM(classify_exchanges=_cls)
    d = analyze_interactions_live(llm, events)
    assert d.prompt_sections.detect_passive_acceptance is True  # 3/4 ≥ 0.7
    assert d.prompt_sections.is_learning_exchange is True  # 1 question
    assert d.exchange_summary.total_exchanges == 4
    assert d.exchange_summary.short_response_count == 3  # passive count
    assert d.exchange_summary.question_count == 1


def test_analyze_interactions_live_empty_events_no_llm_call():
    from quire.understand.steps import analyze_interactions_live

    llm = FakeUnderstandLLM()
    d = analyze_interactions_live(llm, [_ev(0, "action", "ai", "no intents here")])
    assert d.exchange_summary.total_exchanges == 0
    assert llm.calls == []


# ── writer anchored-gate + prompt-join regressions ──────────────────────────


def test_writer_nulls_source_event_id_for_unanchored_evidence(patched_get_session):
    """Mirror of TS resolveEvidenceSourceIds: evidence with anchored=False must
    store source_event_id NULL even when it carries an in-range event_index —
    the anchored%% fidelity dimension must read the validator's decision."""
    from quire.ingest.models import RawDevEvent
    from quire.understand.models import SessionNarrative, UnderstandResult

    ev = _ev(0, "intent", "user", "the real event text")
    chunk = _chunk([ev])
    moment = SessionMoment(
        id="moment-0",
        chunk_id=chunk.id,
        type="discovery",
        statement="s",
        agency="developer",
        confidence="low",
        evidence=[
            # unanchored but index kept (cited-in-range, quote not found) — TS nulls it
            EvidenceAnchor(quote="a paraphrase not in the event", event_index=0,
                           anchored=False, source_type="ai"),
        ],
        occurred_at=ev.timestamp,
    )
    understanding = UnderstandResult(
        sittings=[], chunks=[chunk], moments=[moment], transitions=[], outcomes=[],
        narrative=SessionNarrative(summary="n"),
    )
    raw = [RawDevEvent(id="r0", timestamp=ev.timestamp, type="conversation_turn", raw={})]
    store_session_digest(
        source_path="/tmp/z.jsonl", source_hash="hash-z",
        raw_events=raw, normalized_events=[ev], chunks=[chunk], sittings=[],
        started_at=None, ended_at=None,
        understanding=understanding, session_shape="narrative",
    )
    with SASession(patched_get_session) as s:
        rows = s.execute(sa_text(
            "SELECT quote, source_event_id, quote_type FROM moment_evidence"
        )).all()
    assert len(rows) == 1
    assert rows[0][1] is None, "unanchored evidence must NOT resolve source_event_id"
    assert rows[0][2] is None, "quote_type passes through (EvidenceAnchor has none → NULL)"


def test_extract_user_prompt_joins_like_ts():
    """TS extract.ts builds the user prompt with userParts.join('\\n'): single
    newlines between headers, digestHeader as its own part, and '## Events'
    separated from it."""
    ch = _chunk([_ev(0, "intent", "user", "hello")])
    header = "\n## Session Context (Chunk 0 of 1)\nPrior topics: Chunk 0: x"
    _, user = build_extract_prompt(ch, "narrative", None, header)
    lines = user.split("\n")
    # Exact leading structure per TS join
    assert lines[0] == "## Session Shape: narrative"
    assert lines[1] == "## Chunk 0 — Topic: topic"
    assert lines[2] == "## Files in scope: a.py"
    assert lines[3] == ""  # digestHeader's leading \n
    assert lines[4] == "## Session Context (Chunk 0 of 1)"
    assert lines[5] == "Prior topics: Chunk 0: x"
    assert lines[6] == "## Events (1 total):"
    assert lines[7] == ""
    assert lines[8] == "[0] DEV: hello"
    # No double blank lines between the top headers (the old f-string bug)
    assert "\n\n## Chunk" not in user


# ── raw-JSON extract modality (TS client parity) ────────────────────────────


def test_validate_json_strips_fences_and_validates():
    from quire.understand.llm import _validate_json
    from quire.understand.schemas import ExtractOutput

    text = '```json\n{"moments": [{"type": "discovery", "statement": "s", "agency": "developer", "evidence": [{"quote": "q q q q q", "eventIndex": 3, "sourceType": "user"}]}]}\n```'
    out = _validate_json(text, ExtractOutput)
    assert len(out.moments) == 1
    assert out.moments[0].evidence[0].event_index == 3
    assert out.moments[0].evidence[0].source_type == "user"


def test_validate_json_extracts_object_from_prose():
    from quire.understand.llm import _validate_json
    from quire.understand.schemas import ExtractOutput

    text = 'Here is the result:\n{"moments": []}\nHope that helps!'
    out = _validate_json(text, ExtractOutput)
    assert out.moments == []


def test_validate_json_raises_on_garbage():
    import pytest as _pytest

    from quire.understand.llm import _JsonValidationError, _validate_json
    from quire.understand.schemas import ExtractOutput

    with _pytest.raises(_JsonValidationError):
        _validate_json("not json at all", ExtractOutput)


def test_invoke_raw_json_retries_with_stricter_prompt():
    from quire.understand.llm import _invoke_raw_json
    from quire.understand.schemas import ExtractOutput

    class _Resp:
        def __init__(self, content):
            self.content = content

    class _FakeChat:
        def __init__(self):
            self.calls = []

        def invoke(self, messages):
            self.calls.append(messages)
            if len(self.calls) == 1:
                return _Resp("garbage, not json")
            return _Resp('{"moments": []}')

    chat = _FakeChat()
    out = _invoke_raw_json(chat, "SYS", "USER", ExtractOutput)
    assert out.moments == []
    assert len(chat.calls) == 2
    # retry keeps the system message and appends the stricter note to user
    retry_messages = chat.calls[1]
    assert retry_messages[0] == ("system", "SYS")
    assert "was not valid JSON" in retry_messages[1][1]
    assert retry_messages[1][1].startswith("USER")
