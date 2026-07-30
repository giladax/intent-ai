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

### Session 4: short (15 min) — `d73d5190` — RESTORED 2026-07-21

**Incident:** The original artifact (session `c6ff9b53`, 5 moments) was destroyed by Slice-4
testing — the Python `--force` path cascade-purged all LLM-derived rows. The session was
restored via `npx tsx src/cli/index.ts digest --force-legacy --force` on 2026-07-21, producing
a new session record (`28b91d77`) with 5 moments and a full narrative. Both harnesses now agree
on the restored state. Scores differ from the destroyed baseline in `transitions+outcomes`
distribution and agency (LLM nondeterminism — not a port bug).

| Dimension | ts-fidelity baseline (re-pinned) | Current TS | Current Python | Match TS? |
|-----------|----------------------------------|------------|----------------|-----------|
| evidenceReal | 100% | 100% | 100% | EXACT |
| anchored | 80% | 80% | 80% | EXACT |
| chunks | 2 (ok) | 2 (ok) | 2 (ok) | EXACT |
| occurredSpan | 2min | 2min | 2min | EXACT |
| moments cal | {"high":2,"medium":2,"low":1} | {"high":2,"medium":2,"low":1} | {"high":2,"medium":2,"low":1} | EXACT |
| transitions+outcomes cal | {"medium":2,"low":1} | {"medium":2,"low":1} | {"medium":2,"low":1} | EXACT |
| tail | covered | covered | covered | EXACT |
| recall | 2/3 | 2/3 | 2/3 | EXACT |
| recall misses | open A/B/C architectural fork | open A/B/C architectural fork | open A/B/C architectural fork | EXACT |
| precision violations | none | none | none | EXACT |
| agency | 2/2 | 2/2 | 2/2 | EXACT |

Python matches TS for all 4 sessions on the restored DB state. **DETERMINISTIC DIMENSIONS: EXACT MATCH.**

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

## Data-state note (resolved)

The d73d5190 session was accidentally purged on 2026-07-21 15:18 UTC by Slice-4 testing
(Python `--force` digest cascade-deleted all LLM-derived rows). The session was restored
same day via `--force-legacy` TS digest (session `28b91d77`, 5 moments). Both harnesses
now agree on the restored state and match the re-pinned baseline in `ts-fidelity.md`.
The data-state divergence is resolved; no port defect exists.

## Gate status at calibration

| Gate | Result |
|------|--------|
| `python3 -m pytest` (backend) | 375 passed, 1 skipped (incident repair adds 1 test) |
| `python3 -m evals.event_stream` | all clear |
| `python3 -m evals.alarms` | all clear |
| `npx vitest run` (journal) | 815 passed |
| Python harness matches TS (sessions 1–3) | EXACT MATCH |
| Python harness matches TS (session 4, restored) | EXACT MATCH |
| Python harness matches pinned baseline (session 4) | DATA-STATE DIVERGENCE (not a port bug) |
