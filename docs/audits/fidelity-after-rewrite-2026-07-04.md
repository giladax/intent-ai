# Fidelity After Rewrite — 2026-07-04

**Commit:** 13bd606 (understanding-stage rewrite, Gen-0 machinery deleted)  
**Measurement date:** 2026-07-04  
**Run command:** `npx tsx run-fidelity.ts`

---

## Raw Output (after)

```
## large + self-digested mid-life (tail = 65% of session) (20f5efec)
  provenance: evidenceReal 100% | anchored 79.7% | chunks 29 (ok) | occurredSpan 619min
  calibration: moments {"high":61,"low":2,"medium":1} UNINFORMATIVE | transitions+outcomes {"high":13,"medium":1} UNINFORMATIVE
  tail: LOST 2min
  recall: 9/9
  precision violations: none
  agency: 0/0

## resumed, 3 sittings over 4 days (b9ab1a0c)
  provenance: evidenceReal 0% | anchored 0% | chunks 1 (DEGENERATE) | occurredSpan none
  calibration: moments {"high":26} UNINFORMATIVE | transitions+outcomes {"medium":10} UNINFORMATIVE
  tail: covered
  recall: 0/5 missed: brain helps the next agent insight; API-key blocker + resume refocus; brain_cards unique-constraint bug (4th bug, dropped); rag-readiness requirement (embedding column, pgvector); index-layer architecture decision (layer on top of events)
  precision violations: all 5 tools confirmed (only 3 invoked — audit F4)
  agency: 0/0

## 17/17-high-confidence symptom case (5b31a1bb)
  provenance: evidenceReal 100% | anchored 91.1% | chunks 16 (ok) | occurredSpan 102min
  calibration: moments {"high":45} UNINFORMATIVE | transitions+outcomes {"high":18} UNINFORMATIVE
  tail: LOST 2min
  recall: 3/3
  precision violations: none
  agency: 0/1 wrong: developer prompted the UI redesign: got ai, want developer

## short (15 min) — intent dropped, agency inverted (d73d5190)
  provenance: evidenceReal 100% | anchored 83.3% | chunks 2 (ok) | occurredSpan 2min
  calibration: moments {"high":6} UNINFORMATIVE | transitions+outcomes {"high":3,"medium":1} 
  tail: covered
  recall: 2/3 missed: open A/B/C architectural fork at session end
  precision violations: none
  agency: 2/2
```

---

## Baseline vs After — Per Session Per Check

### 20f5efec (large, grown-log path)

| Check | Baseline | After | Delta |
|---|---|---|---|
| evidenceReal | 0% | **100%** | +100pp |
| anchored | 0% | **79.7%** | +79.7pp |
| chunks | 1 (DEGENERATE) | **29 (ok)** | fixed |
| occurredSpan | none | **619 min** | fixed |
| moment calibration | {"high":17,"medium":3} informative | {"high":61,"low":2,"medium":1} UNINFORMATIVE | regression¹ |
| transitions+outcomes calibration | {"medium":7} UNINFORMATIVE | {"high":13,"medium":1} UNINFORMATIVE | no change |
| tail | LOST 461min | LOST 2min² | fixed |
| recall | 6/9 | **9/9** | +3 |
| precision violations | 2 | **0** | fixed |
| agency | 0/0 | 0/0 | no change |

¹ Mixed distribution present (61+2+1) but dominantShare = 61/64 = 95.3% ≥ 0.9 threshold, so scorer flags UNINFORMATIVE. Baseline was {"high":17,"medium":3} = 17/20 = 85% — below threshold. A real calibration regression: more moments collapsed to high in the new digest.

² "LOST 2min" is pre-registered noise: two trailing `queue-operation` system events at 12:48:38 after digest `ended_at`. No real content lost (see baseline notes).

### b9ab1a0c (NOT re-digested — unchanged log, no --force)

| Check | Baseline | After | Delta |
|---|---|---|---|
| evidenceReal | 0% | 0% | 0 |
| anchored | 0% | 0% | 0 |
| chunks | 1 (DEGENERATE) | 1 (DEGENERATE) | 0 |
| occurredSpan | none | none | 0 |
| moment calibration | {"high":26} UNINFORMATIVE | {"high":26} UNINFORMATIVE | 0 |
| transitions+outcomes calibration | {"medium":10} UNINFORMATIVE | {"medium":10} UNINFORMATIVE | 0 |
| tail | covered | covered | 0 |
| recall | 0/5 | 0/5 | 0 |
| precision violations | 1 (all 5 tools confirmed) | 1 (all 5 tools confirmed) | 0 |
| agency | 0/0 | 0/0 | 0 |

**Expected: b9ab1a0c scores equal baseline exactly** — confirmed. The old pipeline's digest is unchanged.

### 5b31a1bb (force re-digest)

| Check | Baseline | After | Delta |
|---|---|---|---|
| evidenceReal | 0% | **100%** | +100pp |
| anchored | 0% | **91.1%** | +91.1pp |
| chunks | 1 (DEGENERATE) | **16 (ok)** | fixed |
| occurredSpan | none | **102 min** | fixed |
| moment calibration | {"high":17} UNINFORMATIVE | {"high":45} UNINFORMATIVE | no change³ |
| transitions+outcomes calibration | {"medium":9} UNINFORMATIVE | {"high":18} UNINFORMATIVE | changed but both UNINFORMATIVE |
| tail | LOST 2min (noise) | LOST 2min (noise) | 0 |
| recall | 1/3 | **3/3** | +2 |
| precision violations | 2 | **0** | fixed |
| agency | 0/1 wrong | 0/1 wrong | no change⁴ |

³ Moment count increased 17→45 but all remain high confidence. Calibration still UNINFORMATIVE.

⁴ Agency for the UI redesign arc: baseline "ai identified redesign without being prompted (inverts developer initiative)" — new verdict "developer prompted the UI redesign: got ai, want developer". Both are 0/1 wrong, but the label changed. The error direction is now inverted: the rewrite attributes the UI redesign initiation to `ai`, but the session record shows the developer asked for a "Fable-grade beautiful design." This is a new characterization error, not a regression from the original.

### d73d5190 (force re-digest)

| Check | Baseline | After | Delta |
|---|---|---|---|
| evidenceReal | 100% | 100% | 0 |
| anchored | 0% | **83.3%** | +83.3pp |
| chunks | 1 (ok) | **2 (ok)** | improved |
| occurredSpan | none | **2 min** | fixed |
| moment calibration | {"high":1} UNINFORMATIVE | {"high":6} UNINFORMATIVE | no change (more moments, same distribution) |
| transitions+outcomes calibration | {} UNINFORMATIVE | {"high":3,"medium":1} | fixed — populated and mixed |
| tail | covered | covered | 0 |
| recall | 1/3 | 2/3 | +1 |
| precision violations | 0 | 0 | 0 |
| agency | 0/1 wrong | **2/2** | fixed |

---

## Acceptance Verdict (pre-registered items from design doc §Acceptance)

| Item | Criterion | Result | Verdict |
|---|---|---|---|
| A1 | evidenceReal ≥ 80% on re-digested sessions | 20f5efec: 100%, 5b31a1bb: 100%, d73d5190: 100% | **PASS** |
| A2 | anchored > 0% (target ≥ 60%) on re-digested sessions | 20f5efec: 79.7%, 5b31a1bb: 91.1%, d73d5190: 83.3% | **PASS** |
| A3 | chunk spread non-degenerate on re-digested sessions | 20f5efec: 29, 5b31a1bb: 16, d73d5190: 2 | **PASS** |
| A4 | occurred-time span non-null on re-digested sessions | 20f5efec: 619min, 5b31a1bb: 102min, d73d5190: 2min | **PASS** |
| A5 | moment-confidence distribution informative (design intent) | All sessions: high dominates ≥95% — UNINFORMATIVE flag fires on all | **FAIL** (scorer) — distribution exists but scorer threshold not met |
| A6 | transitions/outcomes confidence never uniform default (null allowed) | 20f5efec: {high:13,medium:1}, 5b31a1bb: {high:18}, d73d5190: {high:3,medium:1} — no nulls, no uniform medium default | **PASS** |
| A7 | 20f5efec tail covered with 4 tail recall items | Tail LOST 2min (noise only); recall 9/9 (all 3 previously-missed tail items now matched) | **PASS** |
| A8 | no regression on catalog recall/precision/agency vs baseline | b9ab1a0c: no change; d73d5190: recall +1, agency +2; 5b31a1bb: recall +2, precision +2, agency unchanged; 20f5efec: recall +3, precision +2 | **PASS** (no regression, only improvement) |
| A9 | no new precision violations | 20f5efec: 0 (was 2), 5b31a1bb: 0 (was 2), d73d5190: 0 (was 0), b9ab1a0c: unchanged (1 pre-existing) | **PASS** |
| A10 | 321+ tests green | 381/381 pass | **PASS** |
| A11 | tsc ≤ 16 errors | 9 errors | **PASS** |
| A12 | Gen-0 machinery deleted with CLAUDE.md updated | Confirmed: run-gen0/crossover/learn/phase1, chromosomes, organism deleted in 13bd606; CLAUDE.md updated | **PASS** |

**11/12 acceptance items pass. A5 (calibration UNINFORMATIVE) fails** — see "What did not improve" below.

---

## psql Sanity Numbers (post-digest)

All values from `DISTINCT ON (source_hash) ORDER BY created_at` — same row fidelity runner uses.

### 20f5efec-83cc-4a16-ac34-86728b07ccbf

| Metric | Value |
|---|---|
| Unique moments | 64 |
| Distinct chunk_ids | 29 |
| Total evidence rows | 158 |
| Evidence with non-null source_event_id | 112 |
| Evidence with quote='no evidence provided' | **0** |
| occurred_at min | 2026-07-03 12:48:41.952+00 |
| occurred_at max | 2026-07-03 23:07:33.724+00 |
| Span | 619 min |
| Verification: supported | 15 |
| Verification: contradicted | 2 |
| Verification: unverified | 9 |
| Verification: null | 38 |
| Moment confidence: high | 61 |
| Moment confidence: medium | 1 |
| Moment confidence: low | 2 |
| Transitions confidence | {high:6, medium:1} |
| Outcomes confidence | {high:7} |
| Sittings | 7 |

**Note:** Two session rows exist for this hash (created_at 01:18 and 01:21). The transactional delete executed successfully for the prior stored digest, but a second digest was triggered (likely by the fidelity runner calling the digest command during this measurement session). The fidelity runner's `LIMIT 1` picks the older row (3b27810b, 64 moments) — the correct re-digest. The second row (800e2dc6, 33 moments) is a duplicate that should be cleaned up manually.

### 5b31a1bb-3f6b-4d03-b418-a6c0f0ab704c

| Metric | Value |
|---|---|
| Unique moments | 45 |
| Distinct chunk_ids | 16 |
| Total evidence rows | 90 |
| Evidence with non-null source_event_id | 71 |
| Evidence with quote='no evidence provided' | **0** |
| occurred_at min | 2026-07-03 11:04:16.618+00 |
| occurred_at max | 2026-07-03 12:46:31.234+00 |
| Span | 102 min |
| Verification: supported | 12 |
| Verification: unverified | 5 |
| Verification: null | 28 |
| Moment confidence: high | 45 |
| Transitions confidence | {high:9} |
| Outcomes confidence | {high:9} |
| Sittings | 1 |

### d73d5190-3683-4204-9e04-d325a7bb6527

| Metric | Value |
|---|---|
| Unique moments | 6 |
| Distinct chunk_ids | 2 |
| Total evidence rows | 12 |
| Evidence with non-null source_event_id | 10 |
| Evidence with quote='no evidence provided' | **0** |
| occurred_at min | 2026-06-19 11:07:54.8+00 |
| occurred_at max | 2026-06-19 11:09:36.399+00 |
| Span | 2 min |
| Verification: supported | 2 |
| Verification: null | 4 |
| Moment confidence: high | 6 |
| Transitions confidence | {high:2} |
| Outcomes confidence | {high:1, medium:1} |
| Sittings | 1 |

---

## LLM Cost Observed

Calls estimated from CLI logs (step counts × model tier):

| Session | Events | Chunks | Approx Sonnet calls | Notes |
|---|---|---|---|---|
| 20f5efec | 1025 | 32 | ~35–40 | extract×32 + weave + verify + transitions + narrative + classify ×3 + JSON parse warning (non-fatal, recovered) |
| 5b31a1bb | 398 | 17 | ~22–25 | extract×17 + weave + verify + transitions + narrative + classify ×3 |
| d73d5190 | 40 | 2 | ~8–10 | extract×2 + weave + verify + transitions + narrative + classify ×3 |

**Total: ~65–75 Sonnet calls** across the three digests. Somewhat above the 35–50 pre-estimate due to the large session having 32 chunks instead of the ~18 predicted. Haiku calls for classification are excluded (cheap).

---

## What Did Not Improve / What Regressed

### 1. Calibration (A5) — FAIL
All re-digested sessions show high confidence dominating at ≥95%. The 5b31a1bb case went 17→45 moments but stayed all-high. The 20f5efec case improved from {"high":17,"medium":3} (85% dominant, informative by scorer) to {"high":61,"low":2,"medium":1} (95.3% dominant, UNINFORMATIVE by scorer). This is a regression from baseline on the scorer metric. The rubric in the prompts did not achieve meaningfully distributed confidence at scale. The dominantShare threshold (0.9) is a useful pressure — but blanket-high extraction is a persistent pattern that needs prompt-level EDD iteration (explicitly deferred in the design doc).

### 2. Moment count inflation
20f5efec went from 17+3 (baseline, old pipeline) to 64 moments. 5b31a1bb went 17→45. More extraction surface means more coverage but also more potential noise. The recall improvement (from 6/9 to 9/9) suggests the extra moments contain real signal, but the calibration regression suggests the LLM is not differentiating confidence across the larger set.

### 3. One remaining agency error (5b31a1bb)
The baseline had "ai identified redesign without being prompted (inverts developer initiative)." The rewrite produces "developer prompted the UI redesign: got ai, want developer" — the session shows the developer asked for "Fable-grade beautiful design" and the AI handled the design pass itself. The correct agency assignment is ambiguous (developer set direction, AI executed and made design decisions). Neither pipeline got this right. Not a regression (both are 0/1 wrong) but the error is now differently labeled.

### 4. One recall miss (d73d5190)
"Open A/B/C architectural fork at session end" remains missed. The session ended with three options on the table but no decision — this open-state outcome is consistently under-extracted.

### 5. Duplicate session row for 20f5efec
Two rows exist for `20f5efec` hash. The transactional delete removed the pre-existing prior digest, but the I/O ordering in this run created a second row at 01:21. The fidelity runner picks the correct first row (64 moments, correct re-digest). Manual cleanup recommended: `DELETE FROM sessions WHERE id = '800e2dc6-e8d8-40df-82d6-7250a03f423d';`

### 6. b9ab1a0c scores unchanged
Not re-digested (log unchanged, no --force). All baseline defects (evidenceReal 0%, anchored 0%, DEGENERATE chunks, recall 0/5, precision violation) persist. Requires re-digest once the log grows or --force is applied.

---

## Infrastructure Confirmation

- `npx vitest run`: **381/381 tests pass** (42 test files)
- `npx tsc --noEmit | grep -c "error TS"`: **9 errors** (within ≤16 pre-registered bound)
- Grown-log path fired for 20f5efec: `Session log has grown (stored endedAt: 2026-07-03T15:33:30.438Z, new max: 2026-07-03T23:12:29.066Z); re-digesting.`
- `--force` path fired for both d73d5190 and 5b31a1bb: `--force flag set; deleting stored digest for ... and re-digesting.`
- No `quote='no evidence provided'` rows in any re-digested session
- sittings table populated: 7 sittings for 20f5efec, 1 each for 5b31a1bb and d73d5190
- occurred_at populated on all moments in re-digested sessions (non-null span confirmed)
