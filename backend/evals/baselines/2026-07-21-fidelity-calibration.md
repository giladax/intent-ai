# Fidelity Harness Calibration — 2026-07-21

Calibration of the Python fidelity harness (`backend/evals/fidelity/`) against the
pinned TS baseline (`2026-07-21-ts-fidelity.md`). Confirms the Python port produces
identical scores to the TS harness on the 4 baseline sessions.

## Calibration commands

```bash
# From journal/ — run the TS harness (requires Postgres on port 5433)
cd journal && npx tsx run-fidelity.ts

# From backend/ — run the Python harness
cd backend && python3 -m evals.fidelity

# Compare (diff should be empty for sessions 1-3; session 4 differs — see §Data-state note)
diff <(cd journal && npx tsx run-fidelity.ts 2>&1) <(cd backend && python3 -m evals.fidelity 2>&1)
```

## Per-dimension comparison table

### Session 1: large + self-digested mid-life — `20f5efec`

| Dimension | TS baseline | Python harness | Match? |
|-----------|-------------|----------------|--------|
| evidenceReal | 100% | 100% | EXACT |
| anchored | 75.3% | 75.3% | EXACT |
| chunks | 27 (ok) | 27 (ok) | EXACT |
| occurredSpan | 624min | 624min | EXACT |
| moments cal | {"low":18,"medium":35,"high":24} | {"low":18,"medium":35,"high":24} | EXACT |
| transitions+outcomes cal | {"high":7,"medium":7} | {"high":7,"medium":7} | EXACT |
| calibration informative | informative | informative | EXACT |
| tail | LOST 2min | LOST 2min | EXACT |
| recall | 9/9 | 9/9 | EXACT |
| precision violations | none | none | EXACT |
| agency | 0/0 | 0/0 | EXACT |

### Session 2: resumed, 3 sittings over 4 days — `b9ab1a0c`

| Dimension | TS baseline | Python harness | Match? |
|-----------|-------------|----------------|--------|
| evidenceReal | 98.1% | 98.1% | EXACT |
| anchored | 88.9% | 88.9% | EXACT |
| chunks | 13 (ok) | 13 (ok) | EXACT |
| occurredSpan | 4611min | 4611min | EXACT |
| moments cal | {"low":6,"high":28,"medium":20} | {"low":6,"high":28,"medium":20} | EXACT |
| transitions+outcomes cal | {"high":7,"medium":5,"low":1} | {"high":7,"medium":5,"low":1} | EXACT |
| calibration informative | informative | informative | EXACT |
| tail | covered | covered | EXACT |
| recall | 3/5 | 3/5 | EXACT |
| recall misses | brain helps next agent; index-layer | brain helps next agent; index-layer | EXACT |
| precision violations | all 5 tools confirmed (audit F4) | all 5 tools confirmed (audit F4) | EXACT |
| agency | 0/0 | 0/0 | EXACT |

### Session 3: 17/17-high-confidence symptom case — `5b31a1bb`

| Dimension | TS baseline | Python harness | Match? |
|-----------|-------------|----------------|--------|
| evidenceReal | 100% | 100% | EXACT |
| anchored | 88.1% | 88.1% | EXACT |
| chunks | 17 (ok) | 17 (ok) | EXACT |
| occurredSpan | 102min | 102min | EXACT |
| moments cal | {"high":24,"low":5,"medium":13} | {"high":24,"low":5,"medium":13} | EXACT |
| transitions+outcomes cal | {"high":11,"medium":1} UNINFORMATIVE | {"high":11,"medium":1} UNINFORMATIVE | EXACT |
| tail | LOST 2min | LOST 2min | EXACT |
| recall | 2/3 | 2/3 | EXACT |
| recall misses | emit-events chronology bug | emit-events chronology bug | EXACT |
| precision violations | none | none | EXACT |
| agency | 0/1 wrong | 0/1 wrong | EXACT |
| agency detail | got ai, want developer | got ai, want developer | EXACT |

### Session 4: short (15 min) — `d73d5190` — DATA-STATE CHANGE

**This session's scores differ from the pinned baseline.** The baseline was scored against
an earlier digest (created 2026-07-04) which had 5 moments. A re-digest on 2026-07-21
15:18:04 UTC created a new session record (`c6ff9b53`) with 0 moments (the new digest
produced an empty result, likely because the digestion failed silently or the session
was re-classified). The TS harness also sees 0 moments today — the TS and Python
harnesses agree on the current DB state. The discrepancy is **not a port bug**.

| Dimension | Pinned baseline | Current TS | Current Python | Match TS? |
|-----------|-----------------|------------|----------------|-----------|
| evidenceReal | 100% | 0% | 0% | EXACT |
| anchored | 80% | 0% | 0% | EXACT |
| chunks | 2 (ok) | 0 (ok) | 0 (ok) | EXACT |
| occurredSpan | 2min | none | none | EXACT |
| moments cal | {"high":2,"medium":2,"low":1} | {} UNINFORMATIVE | {} UNINFORMATIVE | EXACT |
| transitions+outcomes cal | {"high":1,"medium":1} | {} UNINFORMATIVE | {} UNINFORMATIVE | EXACT |
| tail | covered | covered | covered | EXACT |
| recall | 2/3 | 0/3 | 0/3 | EXACT |
| precision violations | none | none | none | EXACT |
| agency | 1/2 wrong | 0/0 | 0/0 | EXACT |

Python matches TS for all 4 sessions. The baseline-vs-current difference in session 4 is
a data-state issue (the 2026-07-21 re-digest wiped the old moments) — same change visible
in both harnesses.

## Deterministic dimensions — calibration verdict

All deterministic dimensions (provenance %, tail, counts, calibration distributions, recall,
precision, agency) match between Python and TS harnesses on the current DB state.
**DETERMINISTIC DIMENSIONS: EXACT MATCH — no port bugs.**

## LLM-judged dimensions — variance measurement

The current fidelity harness has **no LLM-judged dimensions**: all scoring is deterministic
(keyword matching, percentage calculation, boolean rules). Recall, precision, and agency
are all keyword-based pure functions.

This is by design: the TS harness is also fully deterministic. LLM judging was considered
(for free-text quality), but EDD practice dictates criteria-before-code; the current
criteria are keyword-based, so no LLM variance exists to measure.

**Consequence for tolerance:** Zero LLM variance means zero tolerance is required. Every
run on the same DB state produces identical scores. If a future slice introduces LLM-judged
dimensions, run 3–8 sweeps (alignment precedent: 8×) and state the measured variance as
the tolerance.

**Budget note:** 3 live LLM sweeps were authorized for calibration. None were consumed
because there is nothing to sweep — the harness is fully deterministic. This is the correct
outcome: LLM spend is 0.

## Stated tolerance

| Dimension | Tolerance | Rationale |
|-----------|-----------|-----------|
| evidenceReal % | ±0.0% | Deterministic — exact match required |
| evidenceAnchored % | ±0.0% | Deterministic — exact match required |
| chunks | exact | Deterministic — exact match required |
| occurredSpan | exact (±0ms) | Deterministic — timestamps from DB |
| calibration distribution | exact | Deterministic — counts from DB |
| tail lost_ms | exact | Deterministic — timestamp arithmetic |
| tail covered | exact | Deterministic — boolean from lost_ms |
| recall matched/expected | exact | Deterministic — keyword matching |
| recall misses | exact set | Deterministic — keyword matching |
| precision violations | exact set | Deterministic — keyword matching |
| agency correct/checked | exact | Deterministic — keyword matching |

## Data-state caveat

The d73d5190 session was re-digested on 2026-07-21, producing 0 moments (the new session
record replaced the old one). The pinned baseline scored the OLD digest (5 moments). The
Python harness cannot reproduce the pinned baseline for this session because the underlying
data is gone — this is a DB-state issue, not a port defect. Both harnesses agree on the
current DB state. Future re-digests of this session would update both harnesses equally.

**Recommendation:** If session 4's original scores matter (for regression gating), the
old session data should be restored or the session re-digested with a working pipeline.
This is out of scope for Slice 5a.

## Gate status at calibration

| Gate | Result |
|------|--------|
| `python3 -m pytest` (backend) | 374 passed, 1 skipped |
| `python3 -m evals.event_stream` | all clear |
| `python3 -m evals.alarms` | all clear |
| `npx vitest run` (journal) | 815 passed |
| Python harness matches TS (sessions 1–3) | EXACT MATCH |
| Python harness matches TS (session 4, current DB) | EXACT MATCH |
| Python harness matches pinned baseline (session 4) | DATA-STATE DIVERGENCE (not a port bug) |
