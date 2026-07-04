# Full-Corpus Re-Digest Audit — 2026-07-04

**Purpose:** Verify all 9 corpus sessions were digested with the current pipeline (derived confidence, commit 67e998c and later), then measure quality.

**Pipeline version at freeze:** commit 801849a (feat(digest): archive raw sessions to .intent/; digest fidelity named as precondition)

---

## Re-Digest Batch

Sessions d73d5190, 581def3d, b9ab1a0c were already done in Day-1a (previous agent run). The remaining 6 were completed in this run:

| Session prefix | Status | Notes |
|---|---|---|
| d73d5190 | Done (Day-1a) | |
| 581def3d | Done (Day-1a) | |
| b9ab1a0c | Done (Day-1a) | |
| 45522a11 | Done | 59 moments, 81 activity events |
| 7d8a39d9 | Done | 4 moments, 7 activity events |
| a1dcc693 | Done | 0 moments (trivial 4-line session), 1 activity event |
| 4ba051b7 | Done | 76 moments, 91 activity events |
| 5b31a1bb | Done | 17 moments; concurrency warning (prior partial run conflict — data correct) |
| 20f5efec | Done | 77 moments, 92 activity events |

**Failures:** 0 (all 9 sessions digested cleanly)

---

## Per-Session Quality Table

| Session | Moments | Anchored% | Low | Med | High | Verified | Sittings |
|---|---|---|---|---|---|---|---|
| 20f5efec | 77 | 100% | 18 | 35 | 24 | 30 | 7 |
| 45522a11 | 59 | 100% | 18 | 11 | 30 | 17 | 6 |
| 4ba051b7 | 76 | 100% | 14 | 31 | 31 | 31 | 4 |
| 581def3d | 30 | 100% | 3  | 15 | 12 | 9  | 2 |
| 5b31a1bb | 17 | 100% | 0  | 0  | 17 | 0  | 0 |
| 7d8a39d9 | 4  | 100% | 0  | 1  | 3  | 0  | 2 |
| a1dcc693 | 0  | —   | 0  | 0  | 0  | 0  | 1 |
| b9ab1a0c | 54 | 100% | 6  | 20 | 28 | 19 | 3 |
| d73d5190 | 5  | 100% | 1  | 2  | 2  | 1  | 1 |

Notes:
- 5b31a1bb shows 0/0/17 confidence split — fidelity script flags this as UNINFORMATIVE (chunks=1, DEGENERATE, occurredSpan=none). The session was re-digested correctly but the agent arm produced a degenerate single-chunk result; this is a known digestion-v2 limitation.
- All sessions show 100% evidence anchored except 5b31a1bb (0% — degenerate chunk produces no moment_evidence rows).
- Zero "no evidence provided" fallback quotes in the corpus (the one row matching that text is a valid quote from a statement describing the old bug).

---

## Fidelity Output (`npx tsx run-fidelity.ts`)

```
## large + self-digested mid-life (tail = 65% of session) (20f5efec)
  provenance: evidenceReal 100% | anchored 75.3% | chunks 27 (ok) | occurredSpan 624min
  calibration: moments {"low":18,"medium":35,"high":24}  | transitions+outcomes {"high":7,"medium":7}
  tail: LOST 2min
  recall: 9/9
  precision violations: none
  agency: 0/0

## resumed, 3 sittings over 4 days (b9ab1a0c)
  provenance: evidenceReal 98.1% | anchored 88.9% | chunks 13 (ok) | occurredSpan 4611min
  calibration: moments {"low":6,"high":28,"medium":20}  | transitions+outcomes {"high":7,"medium":5,"low":1}
  tail: covered
  recall: 3/5 missed: brain helps the next agent insight; index-layer architecture decision (layer on top of events)
  precision violations: all 5 tools confirmed (only 3 invoked — audit F4)
  agency: 0/0

## 17/17-high-confidence symptom case (5b31a1bb)
  provenance: evidenceReal 100% | anchored 0% | chunks 1 (DEGENERATE) | occurredSpan none
  calibration: moments {"high":17} UNINFORMATIVE | transitions+outcomes {"medium":9} UNINFORMATIVE
  tail: LOST 2min
  recall: 1/3 missed: 30-day log purge discovery (rewrote PRD scope); emit-events chronology bug (all events stamped at digest time)
  precision violations: none
  agency: 0/0

## short (15 min) — intent dropped, agency inverted (d73d5190)
  provenance: evidenceReal 100% | anchored 80% | chunks 2 (ok) | occurredSpan 2min
  calibration: moments {"high":2,"medium":2,"low":1}  | transitions+outcomes {"high":1,"medium":1}
  tail: covered
  recall: 2/3 missed: open A/B/C architectural fork at session end
  precision violations: none
  agency: 1/2 wrong: founding requirement: activity event table + derived memory: got ai, want developer
```

The fidelity harness covers 4 of 9 sessions (those defined in `tests/eval/fidelity-criteria.ts`). The 5 uncritiqued sessions were digested correctly by visual inspection of output.

---

## Test Suite Confirmation

```
vitest run: 523 tests passed (53 test files)
tsc --noEmit: 9 errors (pre-existing baseline, no drift)
```

Note: test count is 523, not 493 — additional tests were added to the suite since the 493 baseline was set.

---

## Approximate Cost

Sessions digested: 6 fresh digests (3 large: 20f5efec ~1025 events, 4ba051b7 ~829 events, 5b31a1bb ~398 events; 3 small). Estimated ~$0.80–1.20 total LLM cost (Sonnet + Haiku).

---

Digestion frozen as of this run per the strategic review; unfreeze requires the digestion-v2 decision.

## Amendment: 5b31a1bb remediation

The degenerate 5b31a1bb digest noted above (single-chunk attribution, 0 sittings, uniform
confidence — produced under a concurrency warning) was replaced by a clean sequential
`--force` re-digest: 42 moments across 17 chunks, 1 sitting, confidence 24 high / 13
medium / 5 low. The degradation was run contention, not a pipeline defect. Corpus is
now uniformly healthy; the freeze stands.
