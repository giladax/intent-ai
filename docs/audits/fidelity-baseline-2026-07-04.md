# Fidelity Baseline — 2026-07-04

Command: `npx tsx run-fidelity.ts`

Pre-registered definition of better: provenance checks go 0→pass without regression in the catalog-recall/precision scores.

---

```
## large + self-digested mid-life (tail = 65% of session) (20f5efec)
  provenance: evidenceReal 0% | anchored 0% | chunks 1 (DEGENERATE) | occurredSpan none
  calibration: moments {"high":17,"medium":3}  | transitions+outcomes {"medium":7} UNINFORMATIVE
  tail: LOST 461min
  recall: 6/9 missed: journal-as-product pivot (trees rejected); correspondence chat built; scheduled/cron digestion built and running
  precision violations: fabricated wrong-location edit mechanism (audit F4); cron digestion claimed unbuilt (falsified by tail)
  agency: 0/0

## resumed, 3 sittings over 4 days (b9ab1a0c)
  provenance: evidenceReal 0% | anchored 0% | chunks 1 (DEGENERATE) | occurredSpan none
  calibration: moments {"high":26} UNINFORMATIVE | transitions+outcomes {"medium":10} UNINFORMATIVE
  tail: covered
  recall: 0/5 missed: brain helps the next agent insight; API-key blocker + resume refocus; brain_cards unique-constraint bug (4th bug, dropped); rag-readiness requirement (embedding column, pgvector); index-layer architecture decision (layer on top of events)
  precision violations: all 5 tools confirmed (only 3 invoked — audit F4)
  agency: 0/0

## 17/17-high-confidence symptom case (5b31a1bb)
  provenance: evidenceReal 0% | anchored 0% | chunks 1 (DEGENERATE) | occurredSpan none
  calibration: moments {"high":17} UNINFORMATIVE | transitions+outcomes {"medium":9} UNINFORMATIVE
  tail: LOST 2min
  recall: 1/3 missed: 30-day log purge discovery (rewrote PRD scope); emit-events chronology bug (all events stamped at digest time)
  precision violations: vi.hoisted claimed to unblock tests (a later fix did — audit F4); ai identified redesign without being prompted (inverts developer initiative)
  agency: 1/1

## short (15 min) — intent dropped, agency inverted (d73d5190)
  provenance: evidenceReal 100% | anchored 0% | chunks 1 (ok) | occurredSpan none
  calibration: moments {"high":1} UNINFORMATIVE | transitions+outcomes {} UNINFORMATIVE
  tail: covered
  recall: 1/3 missed: founding requirement: activity event table + derived memory; open A/B/C architectural fork at session end
  precision violations: none
  agency: 0/1 wrong: file-sink vs DB gap discovery: got collaborative, want ai
```

---

## Notes

- `occurredSpan none` everywhere: the `moments` table has no `occurred_at` column; runner uses `NULL as occurred_at` — this will remain 0 until a migration adds the column. (The SQL workaround is `NULL as occurred_at /* TODO: replace with m.occurred_at once the understanding-stage migration adds the column */`.)
- `20f5efec` calibration shows `{"high":17,"medium":3}` and is **NOT flagged UNINFORMATIVE**. This is correct: `scoreCalibration` treats any distribution that contains at least two distinct confidence values as informative (a mixed distribution signals per-item judgment). The `UNINFORMATIVE` flag fires only when all moments collapse to a single value (e.g. 17/17 high with zero variance, as in `5b31a1bb`). The audit's "uninformative" observation applies corpus-wide (blanket defaults are common); per-session mixes are correctly allowed through.
- `5b31a1bb` tail shows `LOST 2min`: the raw log has two trailing `queue-operation` events at 12:48:38 (2 min after digest `ended_at`). The audit confirms no real content is lost (catalog §4: "After L1118 only empty `<queue-operation>` markers"). The 2-minute loss is noise, not a real gap.
- `d73d5190` evidenceReal 100%: single-moment session; the one moment's quote (`events.ndjson`) is real (>10 chars, not the fabricated default).
- Tail misses for `20f5efec` (3 recall misses: journal-as-product, correspondence, cron) are **pre-registered expected failures** — these require the F1 self-digest fix + re-digest to pass.
