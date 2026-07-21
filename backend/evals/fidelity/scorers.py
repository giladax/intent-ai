"""Fidelity scoring core — pure functions, no I/O.

Direct port of journal/src/eval/fidelity.ts (253 lines).

Scoring for the digest-fidelity eval harness:
  - Provenance: evidence realness, chunk spread, time span
  - Calibration: confidence distribution shape
  - Tail: how much session tail the digest missed
  - Recall / Precision / Agency: criteria-based coverage checks
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

FABRICATED_DEFAULT = "no evidence provided"


# ---------------------------------------------------------------------------
# Data classes (mirror TS interfaces)
# ---------------------------------------------------------------------------

@dataclass
class MomentFidelityRow:
    """A single row from the moments+evidence join used by the fidelity harness."""
    statement: str
    type: str
    agency: Optional[str]
    confidence: Optional[str]
    chunk_index: Optional[int]
    occurred_at: Optional[datetime]
    evidence_quotes: list[str]
    anchored_evidence_count: int  # evidence rows with non-null source_event_id


@dataclass
class ProvenanceScore:
    moment_count: int
    evidence_real_pct: float       # % of moments with ≥1 quote that is not the fabricated default
    evidence_anchored_pct: float   # % of moments with ≥1 anchored evidence row
    distinct_chunks: int
    chunk_spread_ok: bool          # distinct_chunks > 1 when moment_count > 3
    occurred_time_span_ms: Optional[int]  # max-min occurred_at in ms, None if none stamped


@dataclass
class CalibrationScore:
    distribution: dict[str, int]  # confidence value -> count (None keyed as "null")
    dominant_share: float          # share of most common value, 0..1
    informative: bool              # >1 distinct value AND dominant_share < 0.9


@dataclass
class TailScore:
    digest_ended_at: Optional[datetime]
    raw_last_event_at: Optional[datetime]
    lost_ms: int                   # max(0, raw_last_event_at - digest_ended_at)
    covered: bool                  # lost_ms <= 60_000


@dataclass
class ExpectedMoment:
    desc: str
    keywords: list[str]
    agency: Optional[str] = None   # "developer" | "ai" | "collaborative"


@dataclass
class ForbiddenClaim:
    desc: str
    keywords: list[str]


@dataclass
class RecallResult:
    expected: int
    matched: int
    missed: list[str] = field(default_factory=list)


@dataclass
class PrecisionResult:
    violations: list[str] = field(default_factory=list)


@dataclass
class AgencyResult:
    checked: int
    correct: int
    wrong: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _pct(numerator: int, denominator: int) -> float:
    """Round a fraction to a percentage with 1 decimal place."""
    if denominator == 0:
        return 0.0
    return round((numerator / denominator) * 1000) / 10


def _is_real_quote(q: str) -> bool:
    """A quote is 'real' when it is not the fabricated default and has ≥10 trimmed chars."""
    return q != FABRICATED_DEFAULT and len(q.strip()) >= 10


def _all_keywords_in(keywords: list[str], text: str) -> bool:
    """Returns True when every keyword appears case-insensitively in text."""
    lower = text.lower()
    return all(k.lower() in lower for k in keywords)


# ---------------------------------------------------------------------------
# scoreProvenance
# ---------------------------------------------------------------------------

def score_provenance(moments: list[MomentFidelityRow]) -> ProvenanceScore:
    moment_count = len(moments)

    real_count = 0
    anchored_count = 0
    chunk_set: set[int] = set()
    timestamps: list[int] = []

    for m in moments:
        if any(_is_real_quote(q) for q in m.evidence_quotes):
            real_count += 1
        if m.anchored_evidence_count > 0:
            anchored_count += 1
        if m.chunk_index is not None:
            chunk_set.add(m.chunk_index)
        if m.occurred_at is not None:
            timestamps.append(int(m.occurred_at.timestamp() * 1000))

    distinct_chunks = len(chunk_set)
    chunk_spread_ok = moment_count <= 3 or distinct_chunks > 1

    occurred_time_span_ms: Optional[int] = None
    if len(timestamps) >= 1:
        occurred_time_span_ms = max(timestamps) - min(timestamps)

    return ProvenanceScore(
        moment_count=moment_count,
        evidence_real_pct=_pct(real_count, moment_count),
        evidence_anchored_pct=_pct(anchored_count, moment_count),
        distinct_chunks=distinct_chunks,
        chunk_spread_ok=chunk_spread_ok,
        occurred_time_span_ms=occurred_time_span_ms,
    )


# ---------------------------------------------------------------------------
# scoreCalibration
# ---------------------------------------------------------------------------

def score_calibration(values: list[Optional[str]]) -> CalibrationScore:
    distribution: dict[str, int] = {}
    for v in values:
        key = "null" if v is None else v
        distribution[key] = distribution.get(key, 0) + 1

    counts = list(distribution.values())
    total = sum(counts)
    max_count = max(counts) if total > 0 else 0
    dominant_share = max_count / total if total > 0 else 0.0

    distinct_count = len(distribution)
    informative = distinct_count > 1 and dominant_share < 0.9

    return CalibrationScore(
        distribution=distribution,
        dominant_share=dominant_share,
        informative=informative,
    )


# ---------------------------------------------------------------------------
# scoreTail
# ---------------------------------------------------------------------------

def score_tail(
    digest_ended_at: Optional[datetime],
    raw_last_event_at: Optional[datetime],
) -> TailScore:
    lost_ms = 0
    if digest_ended_at is not None and raw_last_event_at is not None:
        diff = int(
            (raw_last_event_at.timestamp() - digest_ended_at.timestamp()) * 1000
        )
        lost_ms = max(0, diff)

    return TailScore(
        digest_ended_at=digest_ended_at,
        raw_last_event_at=raw_last_event_at,
        lost_ms=lost_ms,
        covered=lost_ms <= 60_000,
    )


# ---------------------------------------------------------------------------
# scoreRecall
# ---------------------------------------------------------------------------

def score_recall(
    expected: list[ExpectedMoment],
    moment_statements: list[str],
    narrative_text: str,
) -> RecallResult:
    missed: list[str] = []
    matched = 0

    for item in expected:
        found_in_statement = any(
            _all_keywords_in(item.keywords, s) for s in moment_statements
        )
        found_in_narrative = _all_keywords_in(item.keywords, narrative_text)
        if found_in_statement or found_in_narrative:
            matched += 1
        else:
            missed.append(item.desc)

    return RecallResult(expected=len(expected), matched=matched, missed=missed)


# ---------------------------------------------------------------------------
# scorePrecision
# ---------------------------------------------------------------------------

def score_precision(
    forbidden: list[ForbiddenClaim],
    moment_statements: list[str],
    narrative_text: str,
) -> PrecisionResult:
    violations: list[str] = []

    for claim in forbidden:
        found_in_statement = any(
            _all_keywords_in(claim.keywords, s) for s in moment_statements
        )
        found_in_narrative = _all_keywords_in(claim.keywords, narrative_text)
        if found_in_statement or found_in_narrative:
            violations.append(claim.desc)

    return PrecisionResult(violations=violations)


# ---------------------------------------------------------------------------
# scoreAgency
# ---------------------------------------------------------------------------

def score_agency(
    expected: list[ExpectedMoment],
    moments: list[MomentFidelityRow],
) -> AgencyResult:
    checked = 0
    correct = 0
    wrong: list[str] = []

    for item in expected:
        if not item.agency:
            continue

        # Find the first moment whose statement matches all keywords
        match = next(
            (m for m in moments if _all_keywords_in(item.keywords, m.statement)),
            None,
        )
        if match is None:
            continue

        checked += 1
        if match.agency == item.agency:
            correct += 1
        else:
            wrong.append(f"{item.desc}: got {match.agency}, want {item.agency}")

    return AgencyResult(checked=checked, correct=correct, wrong=wrong)
