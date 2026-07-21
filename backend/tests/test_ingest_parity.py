"""Parity harness: Python ingest pipeline output vs frozen TS dry-run snapshots.

For each of the 7 corpus sessions (docs at backend/evals/parity-corpus/README.md),
parse the original input file and assert Python output matches the TS snapshot
within the thresholds defined in the corpus README:

  - raw_events:        ±0  (exact match)
  - normalized_events: ±0  (exact match)
  - chunks:            ±1
  - category counts:   ±2% per category

Tests skip cleanly when the input file is missing (all inputs exist in CI today;
skip is for future-proofing if corpus files are removed).

## Categories key (from corpus README)
  i=intent, r=reflection, res=result, p=proposal, a=action
"""

from __future__ import annotations

import pathlib
from typing import NamedTuple

import pytest

from quire.ingest import parse_transcript, normalize, chunk_session

# ── Corpus baseline (from backend/evals/parity-corpus/README.md) ─────────────

JOURNAL_ROOT = pathlib.Path(__file__).parent.parent.parent / "journal"


class Expectation(NamedTuple):
    raw: int
    norm: int
    chunks: int
    # Category expected counts: intent, reflection, result, proposal, action
    intent: int
    reflection: int
    result: int
    proposal: int
    action: int


CORPUS: dict[str, tuple[pathlib.Path, Expectation]] = {
    "fixture-scope-design": (
        JOURNAL_ROOT / "tests/eval/fixtures/scope-design.jsonl",
        Expectation(118, 118, 5, 29, 32, 29, 23, 5),
    ),
    "fixture-scope-full": (
        JOURNAL_ROOT / "tests/eval/fixtures/scope-full.jsonl",
        Expectation(967, 967, 22, 71, 323, 345, 56, 172),
    ),
    "fixture-scope-implementation": (
        JOURNAL_ROOT / "tests/eval/fixtures/scope-implementation.jsonl",
        Expectation(587, 587, 11, 17, 198, 222, 15, 135),
    ),
    "fixture-scope-pivot": (
        JOURNAL_ROOT / "tests/eval/fixtures/scope-pivot.jsonl",
        Expectation(277, 277, 8, 27, 98, 99, 19, 34),
    ),
    "real-20f5efec": (
        JOURNAL_ROOT / ".intent/raw-sessions/20f5efec-83cc-4a16-ac34-86728b07ccbf.jsonl",
        Expectation(1025, 1025, 30, 18, 175, 445, 13, 374),
    ),
    "real-45522a11": (
        JOURNAL_ROOT / ".intent/raw-sessions/45522a11-4686-47bb-93ea-fd29b8ae5e4e.jsonl",
        Expectation(270, 270, 11, 34, 97, 69, 40, 30),
    ),
    "real-5b31a1bb": (
        JOURNAL_ROOT / ".intent/raw-sessions/5b31a1bb-3f6b-4d03-b418-a6c0f0ab704c.jsonl",
        Expectation(398, 398, 15, 17, 93, 156, 12, 120),
    ),
}

# Category threshold: ±2% of total normalized events
CATEGORY_THRESHOLD_PCT = 2.0


def _category_counts(norm_events) -> dict[str, int]:
    counts: dict[str, int] = {}
    for e in norm_events:
        counts[e.category] = counts.get(e.category, 0) + 1
    return counts


@pytest.mark.parametrize("session_name", list(CORPUS.keys()))
def test_parity(session_name: str) -> None:
    """Assert Python ingest matches TS dry-run snapshot within thresholds."""
    path, exp = CORPUS[session_name]

    if not path.exists():
        pytest.skip(f"Input file not found: {path} — run from the repo root with journal/ present")

    raw = parse_transcript(path)
    norm = normalize(raw, "dry-run")
    chunks = chunk_session(norm, "dry-run")

    # ── raw_events: ±0 ───────────────────────────────────────────────
    assert len(raw) == exp.raw, (
        f"{session_name}: raw_events mismatch: got {len(raw)}, expected {exp.raw}"
    )

    # ── normalized_events: ±0 ────────────────────────────────────────
    assert len(norm) == exp.norm, (
        f"{session_name}: normalized_events mismatch: got {len(norm)}, expected {exp.norm}"
    )

    # ── chunks: ±1 ───────────────────────────────────────────────────
    assert abs(len(chunks) - exp.chunks) <= 1, (
        f"{session_name}: chunks mismatch: got {len(chunks)}, expected {exp.chunks} (±1)"
    )

    # ── categories: ±2% per category ─────────────────────────────────
    cats = _category_counts(norm)
    total = exp.norm
    threshold = CATEGORY_THRESHOLD_PCT / 100.0 * total

    for cat_name, exp_count in [
        ("intent", exp.intent),
        ("reflection", exp.reflection),
        ("result", exp.result),
        ("proposal", exp.proposal),
        ("action", exp.action),
    ]:
        got = cats.get(cat_name, 0)
        diff = abs(got - exp_count)
        assert diff <= threshold, (
            f"{session_name}: category '{cat_name}' out of bounds: "
            f"got {got}, expected {exp_count}, "
            f"diff {diff:.1f} > threshold {threshold:.1f} ({CATEGORY_THRESHOLD_PCT}% of {total})"
        )
