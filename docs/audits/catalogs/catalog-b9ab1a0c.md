# Fidelity Audit Catalog — Session b9ab1a0c (digest a8ed0cd8)

Audited: 2026-07-04. Transcript: `.intent/audit/transcript-b9ab1a0c.txt` (5372 lines, 2026-06-19 → 2026-06-22).
Digest: `.intent/audit/digest-b9ab1a0c.txt` (26 moments, 4 transitions, 6 outcomes, narrative).

**Session structure (ground truth):** three sittings, no `/clear`, no compaction, no sidechains in the raw JSONL.

- **Sitting 1** — 2026-06-19 11:08–11:24 [L3–L184]: session opener, brainstorming skill, design Q&A (answers C, D, B, B), hierarchy validation, "REWRITE the current agentic documentation" [L170], three approaches, RAG requirement [L175], schema Section 1–2 approved.
- **Gap ~2d 9h** (L181 user "yes" at 06-19T11:24:02 → L185 user "yes" at 06-21T20:07:59).
- **Sitting 2** — 2026-06-21 20:07–21:32 [L185–L1077]: rigid-category pushback, freeform pivot, spec [L240], plan [L408], subagent-driven implementation of 12 tasks, 283 tests, migration 0004 conflict repair → 0006, `intent events` works empty [L1061], ends on **invalid API key blocking digest** [L1074–L1075].
- **Gap ~17.5h** (06-21T21:32:49 → 06-22T14:59:47).
- **Sitting 3** — 2026-06-22 14:59–16:03 [L1079–L1520]: "updated the api key. we are shifting focus now" [L1079], bug fixes, 292-event backfill, brain synthesis + brain_cards constraint fix, Simplifier/CPO critiques, 3-act demo script, MCP verification, honest brain self-assessment (final message, 16:03:20.906Z).

---

## 1. Decisions/pivots/discoveries the digest MISSED — severity: **minor**

Individually small omissions; a teammate gets the essentials. But several are load-bearing:

- **The fourth bug: `brain_cards` missing unique constraint.** `intent brain` crashed on upsert; fixed with `CREATE UNIQUE INDEX ... ON brain_cards(repo_id, node_name)` [L1224–L1227: "**`intent brain` crashes** — missing unique constraint on `brain_cards(repo_id, node_name)`"]. The narrative explicitly claims only "three bugs" (see class 2). This bug also blocked the demo loop and was fixed live — same significance class as the three that were captured.
- **The "index layer" architecture decision.** The whole design rests on Approach C — event table as queryable index on top of existing tables, answer "B — Layer on top" to the normalized_events question [L147, L171–L175 "ok"]. The digest captures freeform categories and self-contained events but never states the layering decision, arguably the single most consequential design choice.
- **RAG-readiness requirement.** "ok. also make sure that the we can index events with rag later (of course allowing filter and such)" [L175] → embedding column, pgvector, hybrid filter-then-rank strategy [L176, L186]. Absent from moments, discoveries, and stabilized_directions, despite shaping the schema.
- **The API-key blocker that ended sitting 2.** Digest attempt failed with `401 invalid x-api-key` [L1074] and the session halted overnight. The resume message opens "updated the api key" [L1079]. Digest omits this entirely, which erases the sitting boundary (see class 4).
- **User interrupt/steering before brain synthesis.** User rejected the `intent brain` tool call and demanded "whats the plan what are you doing" [L1163–L1166], then redirected execution to a subagent with a quality-assessment mandate [L1171]. A control/trust moment a teammate would want.
- **Current-session digest was deleted and re-ingested** (`DELETE FROM activity_events...; DELETE FROM sessions...` [L1282]) to get the 30-moments/43-events result — explains why "already digested" errors preceded the headline numbers.
- **Brain-output duplication quality issue** noted at MCP verification: "the same constraint about `messages.stream()` appears 6 times across different topics" [L1405]. Missed.
- Smaller: orchestrator test breakage (7 failures) fixed by mocking `emitEvents`/`buildSessionEvents`/`getClient` [L832–L873] — captured only obliquely via the "283 tests pass" moment.

## 2. Moments the digest INVENTED or OVER-CLAIMED — severity: **major**

Nothing is fabricated from thin air, but three statements say more than the transcript supports:

- **RECORD 26 / Outcome 5: "all 5 tools confirmed"** — At the confirmation point exactly **three** tools were invoked: `brain_overview` [L1395], `brain_search` [L1399], `brain_file_context` [L1402]. The assistant's own claim "All 5 tools confirmed" [L1405] was later contradicted by the same assistant: "`brain_get` — available but didn't need it yet, `brain_traverse` — available but didn't need it yet" [L1504]. `brain_traverse` is never called in the entire session. The digest repeats the inflated claim at **high** confidence.
- **Narrative progression: "surfaced three bugs"** — four demo-blocking bugs were found and fixed (source_id UUID/TEXT [L1085], observation JSON [L1142], digest abort [L1252], brain_cards constraint [L1224]). The count is wrong.
- **Outcome 4 / RECORD 10 conflation: "43 events and 5 observations emitted from the current session"** — the 5 observations were produced at 15:05 [L1156] over 30 backfilled events (largely a *different* project's session — security-credentials and bot-threshold content [L1124–L1126]), **before** the current session was re-digested at 15:28 [L1287–L1288]. "Everything works end-to-end" was declared at 15:13 [L1246], also before the 30-moments/43-events run. RECORD 10 stitches three timepoints into one "breakthrough."
- **RECORD 15 is a composite quote presented as one statement** — it merges three separate user messages sent over 26 minutes: "the only thing Im afraid of is the the rigid categories" [L190, 20:10], "these rigid rules concern me" + "A, B, C, regarding d i think hybrid is great" [L200/L205, 20:23–26], "the entire taxonomy is too obscure, digest brain idk, it should be straight forward" [L221, 20:36]. Each fragment is verbatim; the fusion is not. (RECORD 19 similarly fuses L253/L256 with L262/L265, though those are minutes apart in one thread.)

## 3. Wrong AGENCY attribution — severity: **none**

All 26 attributions check out or are defensible:
- Developer moments (R3, R4, R5, R9, R13, R14, R15, R16, R18, R19, R20, R24) all trace to verbatim user messages.
- AI moments from subagent critiques (R1 = CPO [L1362], R22 = Simplifier [L1363]) correctly marked `ai`.
- R10/R26 marked `collaborative` — AI executed under explicit developer direction ("you run all" [L1071], "verify the MCP server starts and test it" [L1387]); `ai` would be equally defensible, but not wrong.

## 4. Resume/multi-day handling — severity: **major**

- **No lost tail**: digest `ended_at 2026-06-22 16:03:20.906` matches the final assistant message [L1520, 16:03:20.906Z]; raw JSONL's true last timestamp is 16:03:20.994Z (trailing system event only). Normalized event 569 is the closing brain self-assessment — the tail is fully captured.
- **All three sittings are represented** — sitting 3 supplies roughly half the moments; sittings 1–2 supply the design and implementation moments. Coverage is balanced, not front-loaded.
- **But the sittings are collapsed into one continuous arc.** The narrative reads as a single session: "The session moved through schema design, a full parallel implementation… After a hard pivot to demo preparation…" Nothing in summary, progression, moments, or transitions signals the ~2.3-day gap (06-19 11:24 → 06-21 20:08 — the gap falls *mid-design-review*, between two "yes" approvals at L181/L185) or the overnight gap after the API-key failure. R13 frames "we are shifting focus now" as an in-session whim, when it was actually a next-day return with a fixed API key and a meeting deadline [L1079]. A teammate reading the digest would believe this all happened in one sitting.
- No `/clear`, compaction, or sidechain markers exist in the raw JSONL, so there was nothing of that kind to mishandle — but timestamps were available and the gaps were not surfaced.

## 5. Chronology / provenance — severity: **major**

- The **narrative prose chronology is correct**: the 7 progression steps match transcript order exactly (commitment → freeform pivot → SDD implementation → migration repair → demo pivot → three fixes/backfill → critique → demo script/MCP).
- The **moment provenance metadata is degenerate**: all 26 moments carry `chunk_index 0`, `event_range_start 0`, `event_range_end 28`, and the identical `topic_hint` (the session's opening message) — in a session with 570 normalized events. Moments from 06-22 16:00 (R8, brain self-assessment) claim the same 0–28 event range as the 06-19 opening commitment (R18). No moment can be traced to its actual transcript span, and any chronological ordering reconstructed from the stored ranges would be wrong for ~25 of 26 moments.
- Arc metadata is correspondingly unreliable (e.g., R22, a 15:31 critique finding, has `arc_role origin`; defensible per-arc, unverifiable given the flattened ranges).
- Transitions: 4 recorded, from/to statements match the real flow, but every `reason` field is empty.

## 6. Narrative/outcome claims with NO supporting transcript span — severity: **minor**

Nearly every claim has a span. The only unsupported-as-stated items are those already catalogued in class 2: "all 5 tools working" (3 demonstrated; 1 later; 1 never) and "5 observations…from the current session" (observations predate the current-session digest and largely concern another session's events). "Three bugs" is contradicted rather than unsupported. Everything else — 292 backfill [L1128], 0006 rename + 11 indexes [L1030–L1058], 283 tests + git-stash isolation [L909, L923–L926], spec/plan commits [L1247, L1414], 4 sessions/69 events [L1269] — checks out verbatim.

## 7. Confidence calibration — severity: **minor**

All 26 moments are marked **high**; all outcomes medium. Most highs are earned (verbatim quote + verifiable action). Should be downgraded:
- **R26 → low/medium**: "all 5 tools confirmed" is contradicted inside the same transcript [L1504].
- **R10 → medium**: composite of three timepoints (15:05 / 15:13 / 15:28); the "full loop" framing is the assistant's own victory lap.
- **R15 → medium**: fused quote from three messages across 26 minutes.
- **R24 → medium**: quote is verbatim [L165], but the significance ("Events → Memory → Brain hierarchy") misstates the articulated hierarchy, which was Events → Patterns → Memory → Scaffolds [L166].

## 8. What the digest got RIGHT — genuinely faithful

- **Verbatim quote capture is strong**: R2 "292 events backfilled…Now let's see them" [L1128]; R7 the two-`0004_` files diagnosis [L977]; R13 demo pivot [L1079]; R16 "lets start freeform" [L227]; R5 "REWRITE the current agentic documentation" [L170]; R17 moment-0/UUID discovery [L1085]; R25 Haiku-markdown discovery [L1142–L1148].
- **The bug narratives (the three it counted) are precisely right**, including root causes and fixes: source_id UUID→TEXT [L1095–L1100], JSON prompt fix [L1150], digest skip-instead-of-abort with "4 new sessions digested with 69 events" [L1260–L1269].
- **The honest self-assessment moment (R8)** — "the brain didn't help much…would have helped most if I had been a fresh agent" [L1509] — is arguably the session's most valuable insight and the digest caught it, with the correct significance (onboarding cold agents is the value prop).
- **Both critique subagents' key findings survive faithfully**: denormalized-copy + digest-time-timestamps flaw [L1363] and single-user reckoning "382 events across 14 sessions, all from one person" [L1362].
- **Stabilized/abandoned directions are all accurate**, including the org-brain/MCP multi-source commitment [L1410] and the two abandoned directions (rigid taxonomy, UUID source_id).
- **`ended_at` is exact; no lost tail**; the final 15 normalized events show the closing MCP Q&A and self-assessment were fully ingested.

---

## Severity summary

| Class | Severity | One-line justification |
|---|---|---|
| 1. Missed items | minor | Essentials present; 4th bug, index-layer decision, RAG requirement, API-key blocker omitted |
| 2. Invented/over-claimed | major | "All 5 tools confirmed" (3 tested), "three bugs" (four), observations mis-scoped to current session, one fused quote |
| 3. Agency | none | All attributions correct or defensible |
| 4. Multi-day handling | major | Tail intact and all sittings covered, but three sittings across 4 days rendered as one continuous arc; both gaps invisible |
| 5. Chronology/provenance | major | Prose order correct, but chunk_index/event_range/topic_hint are degenerate for all 26 moments (all 0/0–28/opening-message) |
| 6. Unsupported claims | minor | Only the class-2 items; everything else span-backed |
| 7. Confidence calibration | minor | Blanket "high"; R26 should be low, R10/R15/R24 medium |
| 8. Faithful captures | strong | Quotes, bug narratives, critiques, self-assessment, directions all accurate |
