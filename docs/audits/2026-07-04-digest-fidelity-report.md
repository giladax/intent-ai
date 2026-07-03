# Digest Fidelity Report — 2026-07-04

Side-by-side audit of 4 digested sessions against their raw transcripts, plus a code trace
of every failure found back to its mechanism. Per-session evidence catalogs (quoted, with
transcript line references) live in [`catalogs/`](catalogs/). This report is the synthesis
the [audit handoff](../handoffs/2026-07-04-digest-quality-audit-handoff.md) asked for.

## Verdict

**The pipeline is content-faithful and structure-unfaithful.** What the digests *say*
verifies remarkably well against transcripts — verbatim quotes, commit hashes,
test/file counts, and core narrative arcs are accurate in all four sessions, and the
pipeline correctly stays quiet on trivial sessions. But every structural channel that
would let a consumer *check* or *situate* a claim is broken — most of them 100% broken,
deterministically, in code rather than in prompts:

- **101 of 102 moments in the database have the literal string "no evidence provided" as their only evidence.** Pass 2 doesn't re-emit pass-1's evidence and the lenient Zod default silently swallows it.
- **102 of 102 moments point at their session's first chunk** (`organism.ts` hardcodes `chunks[0]`), so no moment is traceable to where in the session it happened.
- **102 of 102 evidence rows have NULL `source_event_id`.**
- **All 47 transition/outcome confidence values are the Zod default** — the prompt never asks the LLM for confidence at all.
- **97% of moment confidences are "high"** with no rubric anywhere; auditors found wrong claims marked high in 3 of 4 sessions.
- **A session that pauses >10 min is digested mid-life and its tail is lost forever** — in the worst audited case, 65% of the session, and the stale digest asserts the *opposite* of the session's end state.

The plausibility symptom from the handoff is confirmed and explained: the words are
right, so nothing looks wrong — but the provenance behind the words is fabricated,
uniformly, by schema defaults and hardcoded fallbacks rather than by the LLM.

## Sessions audited

| Session (CC uuid) | Profile | Events / moments | Auditor's verdict |
|---|---|---|---|
| `20f5efec` | large, digested itself mid-life | 582 / 20 | faithful within window; **critically unfaithful by omission** (tail) |
| `b9ab1a0c` | resumed, 3 sittings over 4 days | 570 / 26 | content-faithful, structure-unfaithful (time flattened) |
| `5b31a1bb` | the 17/17-high-confidence symptom case | 398 / 17 | mostly faithful on facts, uncalibrated on judgment |
| `d73d5190` | short (15 min) | 40 / 1 | accurate but inverted emphasis; wrong protagonist |

Also examined: `581def3d`, whose apparent day-later "tail" is two `system`/`local_command`
lines — a non-issue that confirms `ended_at` correctly excludes system-only noise.

## Failure classes

### F1 — Resumed-session tail loss · **CRITICAL**

`orchestrator.ts:90-96` keys idempotency on the CC session UUID and returns the stored
digest without ever re-reading a grown log. With scheduled digestion (10-min quiet
debounce) this is systematic, and session `20f5efec` is the proof: it *digested itself*
at 15:33, then continued until 23:14. The lost 65% contains the journal-as-product pivot,
the Correspondence feature built and verified, PRD v0.3.1+v0.3.2, the ~4,300-LOC Topic
excision, and 7 commits. Worse than missing: the stored digest still claims cron digestion
"is unbuilt" — the tail built and ran it. **A stale digest is not a partial record; it is
an actively false record of end-of-day state.**

The raw archive (`archiveRawSession`) keeps grown logs re-derivable, but nothing
re-derives them.

### F2 — Provenance destruction · **CRITICAL** (deterministic, 100% of rows)

Four independent breaks, all in code, none in prompts:

1. **Evidence quotes destroyed at pass 2.** Pass-1 moments carry real quotes. The pass-2
   prompt (`moments.ts`, `buildPass2Prompt`) never instructs the model to re-emit
   `evidence`, and `Pass1MomentSchema`'s `evidence` field defaults to
   `[{quote: "no evidence provided", quoteType: "paraphrase"}]` — so the merge silently
   replaces every quote. DB: 101/102 rows are the default string. (This is the exact
   failure — "evidence destroyed at each pipeline stage" — that the original quality-pivot
   session identified; it survived the redesign.)
2. **`source_event_id` NULL in 102/102 rows.** The production pass-1 prompt (1b scorer,
   `chr1-instructions.ts`) doesn't even ask for an event reference; the hunter variant asks
   for a chunk-local index that can't satisfy the UUID FK.
3. **`chunkId` fabricated.** `organism.ts:171` assigns `chunks[0]?.id` to every pass-2
   moment. All 102 moments in the DB sit on chunk_index 0. A moment from hour 6 claims the
   event range of the session's opening.
4. **Occurred-time never stored.** `emit-events.ts` stamps every activity event
   `new Date()` at digest time. The Journal's river — whose axis is time — collapses each
   session to a single instant.

Recoverability: `raw_events` has timestamps and chunks have causal-order ranges, so the
chain moment→chunk→events→time *exists*; it is severed only by (3).

### F3 — Confidence carries no information · **MAJOR**

- Moments: 99 high / 3 medium / 0 low corpus-wide. No prompt defines what confidence
  means. Auditors: ≥5/20 (`20f5efec`), ~4/26, 3/17 should be medium/low; several
  factually *wrong* claims are marked high (F4 examples).
- Transitions and outcomes: **all 47 rows "medium"** — `transitions.ts:16,32` has
  `.optional().default("medium")` and the prompt's output spec omits the field entirely.
  The LLM has never once emitted a confidence for a transition or outcome; downstream
  consumers (fitness, served context, Journal tags) are reading a schema constant.

### F4 — Self-report laundering · **MAJOR** (the audit's novel finding)

The digest canonizes the assistant's own unverified claims as fact, at high confidence:

- "All 5 MCP tools confirmed working" → only 3 were invoked; the assistant itself later
  admitted two were untested; `brain_traverse` is never called in the transcript (`b9ab1a0c`).
- "Switching to `vi.hoisted` unblocked the failing tests" → tests still failed after that
  edit; a later, different fix unblocked them (`5b31a1bb`).
- "First edit targeted the wrong location in the file" → fabricated mechanism; the edit
  failed on the read-before-write guard and the identical edit succeeded after a Read (`20f5efec`).
- Superseded hypotheses crowned as "root cause identified" while the digest's *own later
  moments* contain the real root cause (`20f5efec`).

Mechanism: the production organism's data selection is **conversation-only**
(`chr4-data.ts`, allele 4a) — tool calls and results are dropped before moment detection.
The AI's narration is the only signal about what happened, so its victory laps cannot be
checked against what the tools actually did.

### F5 — Agency inversion · **MAJOR, uneven**

Short session `d73d5190`: every progression step says "Developer examined/identified/
noted…" when each was AI tool use; the developer only sent prompts. `5b31a1bb`'s narrative
claims "the AI identified this without being prompted" when the developer explicitly
prompted the redesign. Yet `20f5efec` and `b9ab1a0c` attribute agency correctly throughout.

Mechanism: agency is pre-computed by a Haiku exchange classifier
(`classify-exchanges.ts`) that sees ≤300 chars of dev text + 2 AI snippets + 3 action
summaries, batched; array-length shortfalls are padded `agency: "ambiguous"`; the
production scorer prompt says "Keep agency as pre-computed unless clearly wrong." And the
eval never pushes back: `fitness.ts` specifies expected agency in criteria but **never
checks it**.

### F6 — Under-extraction of intent and discoveries · **MAJOR**

What goes missing is patterned, not random: the *developer's intent* and
*understanding-shifting discoveries* drop while AI implementation detail survives.
The founding requirement of the activity-event backbone ("i want 2 things: a table for
the user activity event… derive the memory layer") left zero trace in its session's
digest. The 30-day log-purge discovery — which rewrote the PRD's scope and is the reason
the raw archive now exists — is absent from `5b31a1bb`'s digest. Closing architectural
forks (the natural next-session handoff) go unrecorded.

### F7 — Multi-day structure erased · **MAJOR for resumed sessions**

`b9ab1a0c` spans three sittings over 4 days, with a 2.3-day gap falling mid-design-review
and a sitting ending on a 401 API-key failure resolved next day ("updated the api key. we
are shifting focus now"). The digest renders one continuous arc; a pivot that came after a
night's break reads as an in-session whim. Nothing in the domain model represents a gap or
sitting.

### F8 — Chronology in narrative prose · **MINOR**

Mostly correct ordering; localized errors (product-direction discussion narrated after an
infra resolution it preceded; "session closed with…" false — because of F1). The prose
survives only because narrative generation happens while order is still implicit in the
moments array; nothing downstream can reconstruct it (F2.3/F2.4).

### What the digest gets right (verified, not assumed)

Verbatim quotes, commit hashes, insertion/file/test counts check out across all four
sessions; the infra-debugging saga in `20f5efec` is captured beat-for-beat within its
window; `b9ab1a0c`'s "brain didn't help me, it helps the next agent" insight is faithfully
kept; the short session's single moment is a near-quote of the transcript; no session
shows wholesale invention of moments; span endpoints are exact except where F1 applies.
**Compression quality is not the problem. Provenance, calibration, and the resume/tail
model are.**

## The eval harness measures the wrong thing

- `fitness.ts` string-matches hand-authored keywords on one fixture session from May 22,
  ignores agency (present in criteria, never checked), has no calibration or
  evidence/provenance checks, and spends 20% of its weight on the directives subsystem.
- `judge.ts` (Haiku) scores output against `groundTruth` prose — plausibility relative to
  a summary, not fidelity to a transcript. It is *asked* about evidence-backing while the
  stored evidence is 99% "no evidence provided"; nothing fails.
- The chromosome/organism machinery is **not** dead eval-era code: production moment
  detection runs `DEFAULT_ORGANISM` (`orchestrator.ts:133`, `default-organism.ts`) through
  `eval/organism.ts`. Retiring the excised world means promoting the winning alleles into
  first-class pipeline code, not deleting a directory.
- `run-gen0.ts`, `run-crossover.ts`, `run-learn.ts`, `run-phase1.ts` are Gen-0-era entry
  points. `src/eval/mvp-*.ts` is the measurement-v2 harness (keep).

None of the audit's failure classes — evidence destruction, chunk fabrication, default
confidence, tail loss, self-report laundering — is detectable by the current eval. A
pipeline change could make all of them worse and the score would not move.

## What gets fixed, and in what order

Two categories with different disciplines:

**Deterministic code bugs — TDD, no eval gate needed** (the audit is the justification;
these are unambiguous):

1. **Evidence + chunk provenance through pass 2** (F2.1–F2.3). Pass 2 must cite source
   chunk/pass-1 indices (schema-required, not prompt-suggested); evidence and real
   `chunkId` restored deterministically from pass-1 output. Kill the
   `"no evidence provided"` default — an absent evidence array must be visible, not
   masked.
2. **Occurred-time stamping** (F2.4). Derive per-moment time from its chunk's raw-event
   range; `emit-events.ts` stamps occurred-time, not digest-time.
3. **Tail capture** (F1). On the already-digested path, compare source size/event count
   against what was digested; if grown, re-digest and transactionally replace. Keeps
   `digest` idempotent for unchanged logs.
4. **Stop fabricating confidence** (F3, transitions/outcomes). Either ask the LLM with a
   rubric and require the field, or store null. A schema default masquerading as a
   judgment is worse than no field.

**LLM-behavior changes — EDD: fidelity eval first, baseline, then one change at a time:**

5. Confidence rubric for moments (or drop to two values with defined meaning).
6. Data selection: include tool actions (allele 4b exists) so outcome claims are
   checkable against what tools actually did (F4). Cost-visible: this grows chunk tokens.
7. Agency: richer classifier context, or move agency judgment into pass 1 with the full
   exchange visible.
8. Sitting/gap awareness for resumed sessions (F7) — likely a chunking + narrative-prompt
   change.

**Making fidelity measurable first (the gate for 5-8):** the four audit catalogs are now
machine-usable ground truth. A fidelity eval should score, per audited session: recall of
the cataloged real decisions; precision of claimed moments (auditor-flagged over-claims
must not reappear); agency accuracy against the catalog labels; calibration (confidence
distribution + zero wrong-claims-at-high); provenance validity (deterministic DB checks:
evidence non-default, chunk ids vary, occurred-times span the session); tail coverage
(digest end ≥ raw end). Pre-registered "better": provenance checks go 0→pass without
regression in the catalog-recall/precision scores.
