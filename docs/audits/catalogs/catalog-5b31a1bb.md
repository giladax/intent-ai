# Fidelity Audit — Session 5b31a1bb (digest 7de88ef3)

Auditor: transcript `/Users/giladkoch/dev/intent-ai/.intent/audit/transcript-5b31a1bb.txt` (2953 lines, L1–L1128 event refs) vs digest `/Users/giladkoch/dev/intent-ai/.intent/audit/digest-5b31a1bb.txt`.

Session structure notes: no `/clear` boundaries and no compaction summaries appear in the transcript. Two significant sidechains: (a) async Agent `a44655485b6531900` — the observability-design agent whose result arrives as a task-notification [L221]; (b) Workflow `wwoskcx5s` — the parallel Journal build [L500–L515]. Two user interrupts: [L935] and [L1102]. Several background Bash tasks (`bcymoxfze`, `b2otqvmc6`, etc.) during the design pass.

---

## Class 1 — Decisions/pivots/discoveries the digest MISSED

**Severity: MAJOR** — two genuine discoveries with product consequences and one real pivot trigger are absent.

1. **The "session evidence evaporates" discovery.** [L96] the developer asked: "redefine what we should we could also not dogfood and use other repos i created with claude on my machine". The AI checked the machine [L102–L112] and found [L119]: "only intent-ai (9 session logs) and telegram (1 log, from May 30) have any Claude Code history left … Claude Code purges transcripts after ~30 days … (This is itself a product finding worth writing down: session evidence *evaporates*. Continuous capture — your daemon — isn't a nice-to-have, it's the only way the evidence corpus exists at all.)" This finding changed the PRD (two-repo design, story-time seeding, [L215] "That evaporation fact is now in the PRD as the argument for continuous capture"). The digest has **no moment, no discovery, no mention** of dogfood-vs-other-repos or the retention finding. This is arguably the sharpest discovery of the whole session.

2. **The emit-events chronology bug.** The design subagent surfaced, and the AI relayed as "One real bug surfaced during design" [L707]: "`emit-events.ts` stamps all events at digest time, so intra-session chronology is currently destroyed." [L692, L707]. Directly relevant to the digestion pipeline itself; absent from digest discoveries.

3. **The real trigger of the whole-app redesign.** [L801] developer: "Are you happy with the rest of the ui? I want you to redesign" — the AI began the app-wide redesign in response to *this* [L804 ff.], before the [L938] clarification the digest quotes. The digest's pivot moment (RECORD 3) anchors on the later clarification and drops L801 entirely (see Class 3).

4. Minor misses: the AI's four announced decisions on the design doc's open questions [L509] ("map at read time, never backfill", "stamp, don't guess", "miss-driven map edits exempt from the human gate", "granularity deferred"); the second-stage test fix after `vi.hoisted` [L477] (see Class 2); the developer interrupts [L935], [L1102].

## Class 2 — Moments INVENTED or OVER-CLAIMED

**Severity: MINOR** — nothing is invented; two statements over-claim.

1. **RECORD 16 (breakthrough, vi.mock)** over-claims the fix. Digest: switching to `vi.hoisted` "unblocked the failing tests." Transcript: after the `vi.hoisted` edit [L464] the suite **still failed** — [L469] "Test Files 1 failed | 3 passed … Tests 2 failed | 44 passed". The actual unblock was a *second* change, making the mock defensive (`vi.fn(async () => ["id"])`) [L477], after which 7/7 passed [L488]. The quoted diagnosis "Classic `vi.mock` hoisting issue — fixing with `vi.hoisted`" [L463] is verbatim-real, but the causal claim compresses two fixes into one and credits the wrong one. "Breakthrough" is also generous for a routine test-mock repair.

2. **Narrative summary** "began with an AI-initiated diagnosis … before any code was touched." The developer dispatched a review handoff [L15] whose first line demands exactly this: "Read the primary sources and reach your own conclusions … find where they're wrong" [L28]. The *conclusion* was the AI's; the *diagnosis task* was commissioned. Mild inflation of AI initiative.

3. **Abandoned direction 2** — the phase-1 Journal UI "superseded by the editorial redesign rather than shipped as-is": it *was* shipped as-is (committed `0f1956d` [L548]) and redesigned ~15 minutes later. Small over-statement.

## Class 3 — Wrong AGENCY attribution

**Severity: MAJOR** — one clear inversion, one shading.

1. **"the AI identified this without being prompted" (narrative discovery 3) is false.** The developer prompted it directly at [L801]: "Are you happy with the rest of the ui? I want you to redesign". The AI's admission — "no, I wasn't happy with the rest — the Journal had made it worse by contrast, one editorial page inside a default-shadcn wireframe" [L1081] — is a *reply to that question* (and comes in the wrap-up message *after* the redesign was already committed as `7cb65c5` [L1076]). RECORD 3's significance ("AI self-critiques and acts on it") repeats the same inversion. The developer initiated the full-app redesign; the digest credits AI self-critique.

2. **RECORD 7 ("AI proposed 'The Journal'")** — the Journal concept was produced by the *dispatched design subagent* [L686–L692], not the session's AI, which relayed it while crediting "the designer" [L703] ("The designer explicitly rejected my handoff's 'lanes' framing"). Within a developer/ai taxonomy "ai" is defensible, but the statement erases the delegation structure the session itself was careful about.

3. RECORD 13 phrasing ("Developer committed to fixing the PRD and spec, doing a critical Brain API review") reads as if the developer would do the work; actual [L129]: "I want **you** to fix the prd, spec and be critical to the brain api." Agency label (developer decision) is right; the statement wording is off.

## Class 4 — Lost session tail or wrong span

**Severity: NONE.**

- `started_at` 2026-07-03 10:58:32.393 matches the first user event [L8] exactly.
- `ended_at` 2026-07-03 12:46:31.234 matches the final assistant message [L1118] "Handoff written and committed — … (`ceddbc0`)" exactly; normalized event 397 (reflection) is that message.
- After L1118 only empty `<queue-operation>` markers at 12:48:38 [L1127–L1128] — no content lost.

## Class 5 — Chronology errors

**Severity: MINOR.**

1. RECORD 3 anchors the redesign pivot on the [L938] clarification ("I mean do you see the I want the entire app in the style you did the jurnal") when the redesign actually began after [L801]; and it frames the AI admission as *preceding* the extension when the quoted admission [L1081] came after commit `7cb65c5`.
2. RECORD 16's two-step fix compressed into one step (see Class 2).
3. Structural: **all 17 moments carry identical provenance** — `chunk_index 0`, `event_range_start 0`, `event_range_end 12`, and the same `topic_hint` (the review-handoff path) — for a 398-event session. The digest preserves no per-moment location; internal ordering is unrecoverable from the stored rows. Not a narrative error, but a fidelity-infrastructure defect.

## Class 6 — Narrative/outcome claims with NO supporting span

**Severity: MINOR.**

- All six OUTCOMES are supported by commits in the transcript: `a6ef2b1` 590 ins/5 files [L284]; `1002c16` 535 ins/6 files [L496]; `0f1956d` 2154 ins/14 files [L548]; `1ac8554` [L790]; `7cb65c5` 902 ins/11 files [L1076]; `ceddbc0` [L1116].
- The only unsupported-as-worded claims are the two initiative claims already counted in Classes 2/3 ("AI-initiated diagnosis"; "identified without being prompted").
- Note the outcomes describe *committed code*, all unit-tested but — per the AI's own handoff [L1118] — "nothing has touched a real database"; the outcome statements don't over-claim runtime validation, so this is acceptable.
- Transitions: all three have **empty `reason` fields** — a completeness gap, not an infidelity.

## Class 7 — Confidence calibration, per-moment (all 17 marked HIGH)

| # | Moment (abbrev.) | Warranted | Why |
|---|---|---|---|
| 1 | Committed instrumentation (6 files, 535 ins) then launched 2-Opus+Sonnet workflow | **high** | Verbatim: [L496] "6 files changed, 535 insertions"; [L509] "two opus builders … sonnet verifier"; agent_count 3 [L515] |
| 2 | Committed ink & paper, 396 tests, all five pages, 11 files/902 ins | **high (edge)** | [L1076] exact stats; [L1063] 396 tests. "All five pages" is the AI's own framing (4 pages + shell) — loose but sourced |
| 3 | Pivot: dev asked entire app in journal style; AI admitted unhappiness | **medium** | Quotes real ([L938], [L1081]) but wrong anchor (true pivot [L801]) and admission postdates the work — the causal story is wrong |
| 4 | Verifier verdict green, no fix stage, 396 tests, 26-error baseline | **high** | [L520] verbatim verdict; [L518] "no fix stage triggered"; [L539] |
| 5 | Dev gating: "evals correction … only if these 2 are sound" | **high** | [L96] verbatim (typo normalized) |
| 6 | Docs commit, 590 insertions, 5 files | **high** | [L284] verbatim |
| 7 | AI proposed "The Journal" | **medium** | Content accurate [L686–L692] but proposed by the dispatched subagent, relayed by the session AI [L703] |
| 8 | AI concluded eval "will very likely return an inconclusive result" | **high** | [L87] verbatim; genuinely the session's origin moment |
| 9 | "Recommend, i trust you… incremental and not crippled" | **high** | [L241] verbatim (truncates "how can we make this clean") |
| 10 | Dev asked for "fable to create and assess the ui … beautiful highly intuitive … slick design" | **high** | [L562] verbatim |
| 11 | Editorial redesign, Newsreader/spine/red-ink, 396 tests, `1ac8554` | **high** | [L617] css comment verbatim; [L786], [L790] |
| 12 | Journal phase 1 commit, 2154 ins/14 files | **high** | [L548] verbatim |
| 13 | Dev committed to PRD/spec fix + API review + observability handoff | **high (edge)** | [L129] quote real; wording implies developer does the fixing — statement slightly mis-worded, decision agency correct |
| 14 | PRD assessed "~80% yes", MVP Goal + measurement "not sound" | **high** | [L119] verbatim |
| 15 | MCP self-instrumentation across four legacy read tools + provenance + rating fix | **high** | [L296–L376]: overview/search/get/traverse instrumented; `rating` → `.int().min(1).max(5)` [L372]; sessionId provenance [L366–L375] |
| 16 | vi.mock hoisting fixed with vi.hoisted, "unblocked the failing tests" | **medium/low** | Diagnosis quote real [L463] but tests still failed after it [L469]; real unblock was the defensive-mock edit [L477]→[L488]. Causal claim wrong |
| 17 | Handoff requested + cron-with-debounce feature captured, committed | **high** | [L1087], [L1106] verbatim ("denounce"), [L1116] `ceddbc0` |

**Severity: MAJOR** — not because most moments are wrong (13–14 of 17 genuinely warrant high), but because the channel is degenerate: 17/17 high with zero variance, while at least three moments (3, 7, 16) warrant medium or lower. A confidence field that never says "medium" for a compressed-causality claim or a mis-anchored pivot carries no information. (Ironically, transitions and outcomes are all "medium" — uniform within each type, suggesting per-type defaults rather than per-item judgment.)

## Class 8 — What the digest got RIGHT

**Verdict for this class: mostly faithful, and impressively so on hard facts.**

- **Every commit hash, file count, insertion count, and test count is verbatim-correct**: `a6ef2b1`/590/5, `1002c16`/535/6, `0f1956d`/2154/14, `1ac8554`, `7cb65c5`/902/11, `ceddbc0`; 362→396 tests used in the right places; the 26-error tsc baseline [L450, L539].
- **Every direct quote checks out** against the transcript (L87, L96, L119, L129, L241, L463, L520, L562, L617, L938/L1081, L1106) with only benign normalization ("correection", "jurnal", "denounce [debounce]").
- The narrative's arc — review verdict → gating (PRD/spec before evals) → docs sprint → instrumentation → parallel Journal build → editorial redesign → whole-app redesign → handoff with cron requirement — is the true arc, in the right order.
- Stabilized directions (Journal as river; mcp:<tool> events; ink-and-paper as design system; PRD→spec→evals gating) are all real and all stated in the transcript.
- Abandoned direction 1 (v1 eval design set aside for measurement v2) is exactly right.
- Session span is exact to the millisecond at both ends.

---

## Severity summary

| Class | Severity | One-line justification |
|---|---|---|
| 1. Missed | **major** | The session's sharpest discovery (session-log evaporation → PRD change) and a real pipeline bug (emit-events chronology destruction) are absent |
| 2. Invented/over-claimed | **minor** | Nothing invented; RECORD 16 credits the wrong fix; narrative inflates AI initiative twice |
| 3. Wrong agency | **major** | "AI identified this without being prompted" inverts [L801]; the Journal concept was a subagent's, not the session AI's |
| 4. Lost tail/span | **none** | ended_at matches final message [L1118] exactly; only empty queue-ops follow |
| 5. Chronology | **minor** | Pivot anchored on the later clarification [L938] instead of [L801]; degenerate 0–12 event ranges on all 17 moments |
| 6. Unsupported claims | **minor** | All outcomes commit-backed; only the initiative claims lack spans |
| 7. Confidence calibration | **major** | 17/17 high with zero variance; moments 3, 7, 16 warrant medium or lower |
| 8. Got right | — | Hashes, stats, quotes, arc, span: all verified correct |

**Overall fidelity verdict: mostly faithful on facts, uncalibrated on judgment.** The digest is a reliable record of *what was committed and said* and an unreliable record of *who initiated what, what fixed what, and how sure it should be* — plus it silently dropped the session's best discovery.
