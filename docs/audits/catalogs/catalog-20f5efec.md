# Digest Fidelity Audit — Session 20f5efec (digest row 2d7090ab)

Digest created 2026-07-03 15:36:27; claims session window 12:48:38 → 15:33:30.
Raw transcript runs 12:48:38 → 23:14:19 (~7h41m beyond the digest's claimed end).
Root mechanism of the tail loss: the session **digested itself mid-flight** — `digest --last 3` was launched at 15:33:37 [L1343] while the session was live; idempotency then blocked re-digestion forever ("⚠ Session already digested (2d7090ab…). Returning stored digest." [L2421]). This is the exact "resumed-session tail loss" hole the session itself later named [L2436–L2442].

**Structural note (/clear, sidechains, compaction):** the session opens with a `/clear` at 12:48:38 [L6]; the digest correctly anchors `started_at` there and ingests the `/clear` + local-command caveat as its first two normalized events (harmless noise). No `(sidechain)` subagent transcripts and no compaction summaries exist anywhere in this transcript — so there was nothing of that kind to mishandle. Verdict on boundary handling within its window: correct.

---

## 1. Decisions/pivots/discoveries MISSED (within the covered window, 12:48–15:33)

Severity: **minor** — the load-bearing decisions in-window are captured; what's missing is design-thinking substance a teammate could partly recover from the handoff docs.

- **The full UI design review (13:55, [L769])** — "the four inventions" of the Journal (Pulse-as-sentence, time spine, three-ink semantics, review-as-marginalia), the shadcn coupling analysis, and the **provenance-footnotes idea** ("Every understanding line gets a superscript that resolves to the session/observation that taught it"). The digest keeps only the shallow artifact of this review (App.tsx shadcn count = 7, moment 8) and drops the ideas that later became PRD-level direction.
- **The B2B resolution (14:28, [L788])** — "**editorial as brand, utilitarian as behavior**", keyboard-driven review queue, ⌘K palette, undo toast, repo-scoping + actor-attribution as "table stakes". The digest captures the developer's constraint (moment 1) but none of the agreed synthesis. Its stabilized_direction 4 actually distorts it (see §6).
- **The cron flip-flop (14:58–14:59)** — AI first said "Not yet… **Doing it now**" [L941], began scouting the daemon [L942–L950], then reversed: "Understood — cron digestion goes to the successor" [L964]. The digest presents only a static "gap discovered" (moment 4); the commit-then-defer reversal is lost.
- **Doc mutations in-window** — successor handoff and measurement-v2 spec were edited to stop instructing "apply drizzle/0007" [L577, L598]; deferred-workstream sections were written into the handoff at 15:33–15:34 [L1348–L1358]. Not represented in moments or outcomes.

## 2. Moments INVENTED or OVER-CLAIMED

Severity: **major** — one fabricated mechanism, two over-claimed "root cause" verdicts, and degenerate provenance metadata.

- **Moment 6 (execution, `3a16a11e`)** — *"first edit targeted the wrong location in the file"* is **fabricated**. The transcript shows the first Edit failed with a tooling error: `"File has not been read yet. Read it first before writing to it."` [L438]. The AI then read the file [L442] and applied the **identical** edit successfully [L446]. No wrong location was ever involved. The statement also invents "the field persisted despite an earlier edit attempt" — there was no earlier applied attempt.
- **Moment 2 (discovery, `06741274`)** — significance claims *"Root cause identified: Docker image pulls were failing due to host CLI socket issues"*. The transcript [L828] shows this as a working hypothesis at 14:38; the actual root cause found 27 minutes later was **disk at 100% wedging the VM** [L1022, L1033]. The digest even contains the superseding discovery (moment 12) yet still labels the superseded hypothesis "root cause identified", high confidence.
- **Moment 14 (discovery, `9d2690b9`)** — significance: *"Colima VM was broken, **not Docker Desktop**"*. The "not Docker Desktop" clause appears nowhere in the transcript, and is backwards as a diagnosis: Docker Desktop was separately failing to boot [L586–L596] and was later found **stealing port 5433** [L1276, moment 20]. The digest asserts an exculpation the session later refuted.
- **Provenance metadata is degenerate across all 20 moments** — every moment claims `chunk_index 0, event_range 0–79`, and `topic_hint` = the handoff file path, while the normalized stream reaches causal_order **581** (digest's own event sample). Moments from hour 3 (e.g. port conflict, 15:30) cannot live in events 0–79. The chunk-attribution fields are decorative/false.
- Narrative summary — *"The session **closed** with the developer articulating an agent-first, B2B-utilitarian product direction"* — false even for its own window (the window closed with web-server smoke tests and handoff edits, 15:33–15:34 [L1334–L1358]); catastrophically false against the real session, which ran 7.7 more hours.

## 3. Wrong AGENCY attribution

Severity: **none/minor** — attribution is broadly correct.

- Developer commitments (moments 1, 7, 17) are verbatim user text [L779, L795, L215] — correct.
- AI-attributed infra discoveries (12, 16, 18, 20) match transcript actors — correct.
- Only quibble: **moment 4** (`2bf53374`) is typed `discovery`, agency `developer`, but its statement is a fused two-voice quote — the developer's *question* [L937] plus the AI's *admission* ("it's workstream #2 … I haven't built it" [L941]). The discovered content (the gap) was surfaced by the AI; "developer" fits the question, not the discovery.

## 4. Lost session tail (15:33 → 23:14)

Severity: **critical** — ~7.7 hours containing the session's largest decisions, builds, and reversals; several digest claims are silently falsified by it.

What the digest misses, in order:
1. **15:40–15:44** — "Snapshot for me": headless-Chrome screenshots of the live Journal delivered; digestion of 3 sessions completed (59 moments, 89 events; and the on-screen irony: this session's digest = "17 moments, all high-confidence" [L1411, L1426]).
2. **17:44–18:02 — The Correspondence (major feature built)**: always-live chat dock rebuilt from scratch — `ChatDockProvider`/`ChatDock`, `TalkLayer` (`data-talk` attributes; j/k navigation; pinnable page elements), `/api/chat` `contextItems` server-side resolver, **old ChatPanel deleted**, verified end-to-end with a live pinned event [L1662] and playwright screenshots. Entirely absent from the digest.
3. **18:04–18:07 — journal-as-product pivot (the biggest product decision of the day)**: developer rejects tree/Notion scaffolding outright [L1761]; settled reframe — river primary, Features are lenses, comments-as-events, hybrid search as front door, Slack as correspondent; recorded to handoff and persistent memory. This *supersedes* parts of what the digest presents as current direction.
4. **19:14–19:27** — successor handoff rewritten clean (agentic-handoffs skill) and **PRD amended to v0.3.1** (Principle 2 rewritten, 2a added, Journal-as-served-surface section, MCP manage tier, graph-viz permanently rejected).
5. **20:26–20:32** — "cutting the excess fat": stale handoffs archived, CLAUDE.md truth pass, Topic-subsystem excision scoped as a kill-list.
6. **22:10–22:29 — "Do it"**: **seven commits land** (`d1304f9`…`35ff943`): four snapshot commits, then **Topic subsystem excised (~4,300 LOC)** — `src/brain/`, pipeline synthesizers, CLI commands, MCP topic tools (`brain_search` re-keyed onto Features), 10 server endpoints, 5 UI components; journal-first App shell; **cron digestion with configurable epochs actually BUILT and live** (`/api/digest/schedule`, `.intent/digest-schedule.json`, scheduler's first automatic pass digested a 4th session [L2337]). New verification baselines: **311 tests / 16 tsc errors** — invalidating the digest's "26-error baseline with all 396 tests green" as current state, and **directly contradicting** digest discovery 7 / progression 8 ("the cron digest … is unbuilt").
7. **23:01–23:12** — eval-first strategy ("the river is its own answer key", trap-question groundedness suite) committed to the handoff [`1092339`]; then the developer names **digest quality itself as a blind spot** → digest-fidelity audit handoff written, **PRD v0.3.2**, and `archiveRawSession` implemented (raw logs preserved to `.intent/raw-sessions/`, re-copied as logs grow) [`801849a`].

A teammate reading only the digest would believe: no commits exist, cron digestion is unbuilt, the Topic subsystem still stands, the PRD is at v0.3, the test baseline is 396/26, and no chat feature exists. All six beliefs are wrong by end of day.

## 5. Chronology errors

Severity: **minor** — one real ordering inversion inside an otherwise well-ordered arc.

- Progression items 7→8 place the developer's product direction **after** the Docker/Postgres resolution ("…29 tables live… **then** the developer articulated an agent-first, B2B-utilitarian direction"). In the transcript the direction messages came at 14:27 [L779], 14:31 [L795], 14:58 [L937] — squarely **during** the infra battle; the resolution came at 15:25–15:32 [L1214–L1322]. The narrative summary repeats the inversion ("The session closed with the developer articulating…").
- The infra sub-sequence itself (broken colima → disk 100% → overlay2 → port conflict → clean restart) matches transcript order exactly — good.

## 6. Narrative/outcome claims with NO supporting span

Severity: **minor** — small unsupported details, no whole-cloth events.

- Outcome 1: *"Scrapped broken **7-migration** chain"* — the chain was 8 files, 0000–0007 [L31]; digest's own narrative says "8-migration" twice. Internal contradiction; "7" has no support.
- Stabilized direction 4: *"framed for B2B utilitarian use **rather than human UI aesthetics**"* — the transcript's settled position was the opposite of an either/or: "editorial as brand, utilitarian as behavior… The ink language stays as the skin" [L788]. The "rather than" framing is unsupported and misrepresents the resolution.
- All three transitions have **empty `reason` fields** — the causal connective the schema exists to carry is absent.
- Moment 15's mechanism ("reads journal order, not timestamp sort") is a garbled compression of the real finding: the migrator reads files in journal order but **applies only when `lastDbMigration.created_at < entry.when`** — a timestamp comparison — so out-of-order `when` values silently skip 0004/0005 [L207]. Direction of the claim survives; the mechanism as stated does not match [L590 §1].

## 7. Confidence calibration

Severity: **major** — "high" is assigned by fluency, not by evidence class; the session's own closing audit names this ("confidence calibration collapse… the field is decorative" [L2442]).

Of 20 moments: 17 high, 3 medium, 0 low.

Warranted **high** (verbatim quotes or machine-verifiable outputs): 1, 7, 17 (user quotes); 5 (HTTP 200), 11 (df output), 12 (df output), 13 (tsc/vitest counts), 16 (overlay2 error string), 18 (CONNECTED string), 19 (build error + git checkout), 10 (executed actions), 9 (pivot, explicit in [L401]).

Should be downgraded:
- **2 → low**: superseded hypothesis presented as root cause (§2).
- **14 → medium**: contains the invented "not Docker Desktop" clause.
- **15 → medium**: garbled mechanism (§6).
- **4 → medium**: fused two-voice quote, mislabeled type.
- **20 → high is defensible** (lsof evidence [L1276] supports the port-thief diagnosis) but the "classic IPv6 half-open forward" clause is unverified AI pattern-matching; medium-high.
- **6 (already medium) → low/exclude**: its causal story is fabricated (§2).

Pattern: every *interpretive/diagnostic* moment got the same "high" as raw tool-output moments. Confidence carries no information.

## 8. What the digest got RIGHT

Within its window, the core narrative is genuinely faithful — this is a truncation failure far more than a hallucination failure.

- **The migration critique and clean-slate turn**: discovery framing ("The handoff's 'single most important next step' treats the migration as a formality. It isn't.") is verbatim [L207]; the developer's authorization quote (moment 17) is near-verbatim [L215] (only the typo "mifration" normalized). turning_point placement is exactly right.
- **The infra saga**: broken colima [L678] → disk 100% [L1022] → 12G cache purge, 100%→97%, 16Gi [L1042–L1046] → overlay2 "too many levels of symbolic links" [L1153] → Docker Desktop squatting 5433 (lsof `com.docke … *:5433 LISTEN` [L1276]) → quit Desktop, clean colima restart, `CONNECTED: PostgreSQL 16.14`, 29 tables [L1322–L1330]. Every quoted error string checks out; the causal chain is in correct order.
- **BrainCardView reversal** (moment 19): matches [L509–L521] exactly, including the sibling-relative-import cause and git restore.
- **parent_topic_id**: the NULL-mask → full-removal pivot (moment 9) is a faithful capture of [L397–L403] ("Cleaner to remove the field entirely rather than fake NULL" is verbatim); abandoned_directions both accurate.
- **Verification numbers**: 26 tsc errors / 396 tests [L504], 12 indexes [L1332], HTTP 200 + project row [L1335] — all correct *as of 15:33*.
- **Boundary handling**: `/clear` start anchored correctly; no sidechains/compaction existed to mishandle.

---

## Severity summary

| Class | Severity | One-line justification |
|---|---|---|
| 1. Missed in-window decisions | minor | Load-bearing decisions captured; design-review substance and the cron flip-flop dropped |
| 2. Invented/over-claimed | major | Fabricated edit-failure mechanism (moment 6), two false "root cause" verdicts, degenerate chunk metadata on all 20 moments |
| 3. Agency | none | Attribution correct throughout; one fused-quote quibble |
| 4. Lost tail | **critical** | 7.7h, 7 commits, product pivot, 4,300-LOC excision, cron feature built — digest's "unbuilt cron" and "396/26 baseline" are falsified |
| 5. Chronology | minor | Product direction inverted to after infra resolution; infra arc itself correctly ordered |
| 6. Unsupported claims | minor | "7-migration", "rather than human UI aesthetics", empty transition reasons |
| 7. Confidence calibration | major | 17/20 high; interpretive diagnoses scored identically to machine-verified facts; ≥5 should drop |
| 8. Faithful captures | — | Within-window core narrative, quotes, error strings, and numbers are accurate |

**Overall verdict:** Within its 12:48–15:33 window the digest is a mostly faithful, occasionally over-confident compression (one fabricated mechanism, two over-claimed diagnoses). As a record of the session it is **critically unfaithful by omission**: it silently freezes a live session at 35% of its duration and asserts as open ("cron unbuilt", uncommitted tree, Topic subsystem alive) what the lost tail closed. The failure is architectural — self-digestion mid-flight + idempotent early-return — and the session itself diagnosed and partially mitigated it (raw archival, `801849a`) hours after this digest was frozen.
