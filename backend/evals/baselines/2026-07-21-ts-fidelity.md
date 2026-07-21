# TS Pipeline Fidelity Baseline — 2026-07-21

Pinned before the TS→Python migration (feat/repo-brain). This document records the live fidelity
eval scores so later slices can verify that the Python port does not regress.

## How to reproduce

```bash
# From journal/ (Postgres must be running on port 5433)
docker compose up -d
npx tsx run-fidelity.ts
```

The harness reads from the `sessions`, `moments`, `chunks`, `moment_evidence`, `transitions`,
`outcomes`, and `narratives` tables (populated by prior `digest` runs). Criteria live in
`journal/tests/eval/fidelity-criteria.ts`.

## Eval date

2026-07-21 (branch feat/repo-brain, commit pinned in Slice 0)

## Session scores

### 1. large + self-digested mid-life (tail = 65% of session) — `20f5efec`

```
provenance: evidenceReal 100% | anchored 75.3% | chunks 27 (ok) | occurredSpan 624min
calibration: moments {"low":18,"medium":35,"high":24}  | transitions+outcomes {"high":7,"medium":7}
tail: LOST 2min
recall: 9/9
precision violations: none
agency: 0/0 (no agency checks defined)
```

**Status:** PASSING — full recall, no precision violations. Tail loss is 2 min (negligible).

### 2. resumed, 3 sittings over 4 days — `b9ab1a0c`

```
provenance: evidenceReal 98.1% | anchored 88.9% | chunks 13 (ok) | occurredSpan 4611min
calibration: moments {"low":6,"high":28,"medium":20}  | transitions+outcomes {"high":7,"medium":5,"low":1}
tail: covered
recall: 3/5 missed: "brain helps the next agent insight"; "index-layer architecture decision (layer on top of events)"
precision violations: all 5 tools confirmed (only 3 invoked — audit F4)
agency: 0/0 (no agency checks defined)
```

**Status:** PARTIAL — 2 recall misses, 1 precision violation (a known F4 fabrication pattern).

### 3. 17/17-high-confidence symptom case — `5b31a1bb`

```
provenance: evidenceReal 100% | anchored 88.1% | chunks 17 (ok) | occurredSpan 102min
calibration: moments {"high":24,"low":5,"medium":13}  | transitions+outcomes {"high":11,"medium":1} UNINFORMATIVE
tail: LOST 2min
recall: 2/3 missed: "emit-events chronology bug (all events stamped at digest time)"
precision violations: none
agency: 0/1 wrong: "developer prompted the UI redesign": got ai, want developer
```

**Status:** PARTIAL — 1 recall miss, 1 agency error. transitions+outcomes calibration UNINFORMATIVE
(all-high distribution). Tail loss 2 min (negligible).

### 4. short (15 min) — intent dropped, agency inverted — `d73d5190`

**Incident note (2026-07-21):** The original artifact (session `c6ff9b53`, 5 moments) was destroyed
by Slice-4 testing — the Python deterministic-only path re-digested this session via `--force`,
cascade-purging all LLM-derived rows. Re-pinned from a fresh TS digest (session `28b91d77`) run
same day via `npx tsx src/cli/index.ts digest --force-legacy --force`. This is PRE-5b, so the
fresh digest remains a valid TS-pipeline baseline. Scores differ slightly from the original due to
LLM nondeterminism (transitions+outcomes distribution changed; agency improved to 2/2).

```
provenance: evidenceReal 100% | anchored 80% | chunks 2 (ok) | occurredSpan 2min
calibration: moments {"high":2,"medium":2,"low":1}  | transitions+outcomes {"medium":2,"low":1}
tail: covered
recall: 2/3 missed: "open A/B/C architectural fork at session end"
precision violations: none
agency: 2/2
```

**Status:** PARTIAL — 1 recall miss. Agency improved to full agreement in the re-digest (LLM
nondeterminism; the agency error observed in the original digest is a known weakness per known
issue #2 below, not a regression).

## Summary table

| Session label                             | Session ID prefix | Recall     | Precision | Agency    | Tail       |
|-------------------------------------------|-------------------|------------|-----------|-----------|------------|
| large + self-digested mid-life            | 20f5efec          | 9/9 ✓      | 0 viol ✓  | 0/0 (n/a) | LOST 2min  |
| resumed, 3 sittings over 4 days           | b9ab1a0c          | 3/5 (miss) | 1 viol    | 0/0 (n/a) | covered ✓  |
| 17/17-high-confidence symptom case        | 5b31a1bb          | 2/3 (miss) | 0 viol ✓  | 0/1 wrong | LOST 2min  |
| short (15 min) — intent dropped           | d73d5190          | 2/3 (miss) | 0 viol ✓  | 2/2 ✓     | covered ✓  |

## Known issues (pre-existing, not introduced by this slice)

1. **Tail coverage:** Sessions 20f5efec and 5b31a1bb both show 2 min tail loss. Noted in fidelity
   criteria as an expected limitation before an F1 fix.
2. **Agency inversion:** Session 5b31a1bb shows agency attribution error (ai vs developer). Known
   weakness documented in fidelity criteria. (Session d73d5190's re-digest at 28b91d77 resolved its
   agency error to 2/2.)
3. **Recall misses:** Sessions b9ab1a0c, 5b31a1bb, and d73d5190 each miss 1–2 expected moments.
   The "index-layer architecture decision" and "emit-events chronology bug" moments require deeper
   narrative extraction.
4. **Precision violation (b9ab1a0c):** "all 5 tools confirmed" is a fabrication pattern (audit F4).
   Pre-existing.
5. **Directives dry-run bug:** `analyzeInteractions` is `async` but called without `await` in the
   CLI dry-run path, causing a crash after categories print. This affects only the dry-run CLI
   output; the full pipeline is unaffected (it awaits the call correctly). Captured in parity corpus.

## Gate status at time of pinning

| Gate                          | Result       |
|-------------------------------|--------------|
| `npx vitest run` (815 tests)  | 815 passed   |
| `npm run typecheck:ui`        | clean        |
| `pytest` (229 tests)          | 229 passed   |
| `python3 -m evals.event_stream` | all clear  |
| `python3 -m evals.alarms`     | all clear    |

## Artifacts

- Parity corpus: `backend/evals/parity-corpus/` — deterministic dry-run outputs for 7 sessions. The fidelity eval scored the 4 sessions detailed above (those with existing digests stored in Postgres); the parity corpus scope holds 7 sessions for dry-run parity testing.
- Contracts spec: `backend/evals/baselines/2026-07-21-ts-pipeline-contracts.md`

**Note on measurement scope:** The fidelity `occurredSpan` metric measures the anchored-evidence time window (e.g., 102 min for session 5b31a1bb), while the parity corpus `Time span` measures the full session clock (e.g., 108 min for the same session). These measure different things and should not be directly compared; ensure the Python port documents both clearly.
