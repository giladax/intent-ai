# Digestion v2 — Topology Proposal

**Date:** 2026-07-04 · **Status:** proposal (design only, no implementation) — revised same day against the owner reframe ("digestion is the receiver of events — sessions, but also Jira/Slack — and it updates the brain")
**Inputs:** [owner reframe](../../../.superpowers/sdd/digestion-v2-reframe.md) · [fidelity report](../../audits/2026-07-04-digest-fidelity-report.md) · [understanding-stage rewrite](2026-07-04-understanding-stage-rewrite-design.md) · [agents-core design](2026-07-04-agents-core-design.md) · [digestion-zoom design](2026-07-04-digestion-zoom-design.md) · `.intent/audit/rewrite-{salvage,contracts}.md` · `docs/prd.md` §Integrations · code as of `801849a`

**Grounding measurement (new, taken for this proposal).** Rendered transcript size of the four audited sessions through the production `renderChunkEvents`:

| Session | Events | Rendered chars | ~Tokens |
|---|---|---|---|
| 20f5efec (large, 10.5h) | 1,025 | 221,089 | **~58k** |
| b9ab1a0c (3 sittings / 4 days) | 570 | 208,816 | ~55k |
| 5b31a1bb (medium) | 398 | 117,903 | ~31k |
| d73d5190 (short) | 40 | 9,140 | ~2.4k |

**Every session in the corpus — including the 10.5-hour monster — fits in a single 200k context window with >100k tokens to spare.** The 80-event chunk cap, the 3-event overlap, parallel per-chunk extraction, and "the agent must fetch transcript slices through tools because it can't hold the session" are all fossils of a context-window constraint that no longer exists. That fact drives everything below — and it generalizes: sessions are the *densest* source the brain will ever receive. If the worst coding session fits in one window, every other source (a Jira ticket's history, a Slack thread, a PRD revision) fits trivially.

---

## 0. Digestion is the brain's receiver

The topology below is **not a session feature**. It is the brain's ingestion boundary — the receiver through which *any* source's evidence becomes brain updates. Its contract:

- **In:** a normalized stream of **evidence events** from any source. Today: Claude Code sessions — the first and by far the highest-density source. Later, through adapters: Codex/Copilot sessions, Jira transitions, Slack threads, PRD revisions — the PRD's standing capture list. The PRD already names the mechanism: *"an adapter emitting `integration:<source>` events into the journal — a new correspondent writing into the same journal, not a bolted-on system"* (`docs/prd.md` §Integrations).
- **Out:** brain updates, **uniformly, regardless of source**, in exactly two shapes (§4 defines both):
  1. **River events** — journal-native `ActivityEvent`s stamped at **occurred-time**, anchored to the evidence that produced them.
  2. **Proposed understanding deltas** — Feature/alignment candidates that pass through **one gate** (the review lifecycle) before they become accepted understanding. No source writes understanding directly.

This forces a split that runs through the whole proposal:

- **Receiver core (source-agnostic):** episode structure, the incremental-commit reading loop, anchored claims, rolling narrative, validation gates, the brain-update contract. Knows nothing about transcripts, tickets, or threads — only `EvidenceEvent`s.
- **Source adapters (source-specific):** parsing, normalization, rendering density, episode detection tuned to the source's cadence, source-native claim vocabulary and corroboration rules, source tools, and the projection into any source-specific storage. The entire deterministic groundwork of today's pipeline (`parse → normalize → detectSittings → classifySession`) is the **session adapter**.

**Volume is an adapter property, not a topology property.** A Slack thread is a burst of dozens of events; a coding session is thousands. Same receiving topology, different density — the receiver's full-read primary path (§2) is *easier* for every later source than for its first one.

**Why design for this now rather than retrofit at P2:** multi-source is the point of the product. Intent sources (Jira, PRD, Slack decisions) vs implementation sources (sessions, code) are the two evidence classes whose comparison — alignment, within a Feature — is the differentiator. A receiver that can only read transcripts would have to be rebuilt exactly when the moat work starts.

**Terminology.** The core's time unit is the **episode**: a gap-delimited span of activity in any evidence stream. **"Sitting" remains the session adapter's name for its episodes** (and the `sittings` table keeps its name); this document uses *episode* wherever the concept is core and *sitting* wherever it is session-specific.

---

## 1. Diagnosis — what in v1 still carries the old frame

The rewrite fixed *provenance mechanics* and the v1 agent fixed *process rigidity*. Neither touched the frame. Six inheritances remain, all verified in current code:

**D1 — Moments are the sole atom; everything else is a re-projection.**
`transitions.ts` and `narrative.ts` consume *only* moments — a projection of a projection (already flagged in agents-core §"inherited critique", still shipped). The v1 agent output schema (`src/agents/digest/output-schema.ts`) reproduces the same four legacy shapes in one blob. Causal structure has no first-class home: `moment_relations`, `transition_moments`, `outcome_files`, `narrative_arcs` are all written-never-read (rewrite-contracts §2); `relatedMomentIds` is returned as `[]` by every reader. The domain model records *that things happened*, not *why one thing led to another* — which is exactly the nuance the owner says is "completely lost because we are so narrow."

**D2 — Chunks serve storage, not understanding.**
The v1 agent doesn't read in chunks — yet it *fabricates* them: `buildPseudoChunksPerSitting` (`src/agents/digest/agent.ts:143`) invents `pseudo-sitting-N` chunks purely so `validateAnchors` and the `moments.chunk_id` FK have something to point at. A pseudo-structure invented to satisfy a storage column is the definition of the old frame surviving. Sittings are real time structure; chunks are a prompt-batching artifact that leaked into the schema.

**D3 — The "rolling notes" are prompt-only, and the notes are discarded.**
The v1 graph (`src/agents/core/graph.ts`) has no sitting loop and no notes in state — "work sitting-by-sitting, keep running working notes" lives only in the system prompt. The state carries `messages, turns, tokens, output, repairs` — no scratchpad, no per-sitting checkpoint. The approved rolling-narrative amendment (`sittingNarratives` persisted as `digest:sitting` events) is **absent from `DigestAgentOutputSchema`** — designed, not implemented. The narrative-in-progress the owner wants kept is still being thrown away.

**D4 — Verification is asked for in the prompt but destroyed at the output boundary.**
The prompt says "check `list_tool_events` before asserting confirmation/breakthrough/execution moments" — woven verification, correct instinct. But `mapAgentOutputToPipelineResult` hardcodes `verification: null` (`agent.ts:239`) and the output schema has no field for it. The agent arm can do the check and has nowhere to record the verdict. (The pipeline arm keeps verify as a separate post-hoc stage over a 4,000-char window of the — possibly wrong — chunk.)

**D5 — The final-blob synthesis.**
Everything the v1 agent learned across up to 40 turns must be reconstructed in one `final_output` tool call at the end, from conversational memory, farthest from the evidence it cites. Every repair bounce regenerates the *entire* blob (drift risk + token waste). This is the same "one LLM emission carries all upstream data" shape the rewrite's one design rule was written to kill — it survived by moving from pipeline stages into the agent's last turn.

**D6 — The receiver is welded to its first source.**
Everything from parser to storage assumes a CC transcript: the agent runner calls `renderChunkEvents` directly, the output schema *is* the digest-table shape, and there is no seam where a second source could enter without duplicating the entire path. The PRD's capture list (Codex/Copilot, Jira, Slack, PRD revisions) has no doorway. Tolerable while sessions were the only source; the reframe (§0) makes it a design defect to fix *in the topology now*, not retrofit at P2.

Also inherited: model-emitted confidence (saturated at ≥95% high on three independent runs — A5 fail; E2's derived-confidence fix is designed but not run), and single per-session `sessionShape` (a 10-hour session is not one genre).

---

## 2. Candidate topologies

All three candidates share the non-negotiables: deterministic groundwork (`parse → normalize → detectSittings → classifySession` — per §0, this is the **session adapter**, and everything downstream of the normalized `EvidenceStream` must be source-agnostic), `validateAnchors` in code, occurred-time from anchors, additive-only schema, `PipelineResult` for callers, idempotent + grown-log transactional replace, fidelity eval as referee. Each candidate is judged twice: as a session digester, and as the brain's receiver (does its shape assume transcript-ness, or does it receive evidence generally?).

### Candidate A — Full-read, incremental-commit receiver (recommended)

**Frame:** the receiver is a *reader with a pen*, not a synthesizer. The whole rendered evidence stream is injected up front (it fits — for sessions today, and a fortiori for every sparser source later). The agent reads chronologically and **commits findings as it reads** via recording tools; deterministic code accumulates the record; the final LLM output is only the thin stream-level synthesis. "LLMs judge; code carries" taken to its agentic conclusion: no finding is ever re-emitted after the turn that produced it. Nothing in this frame is transcript-specific — "read the evidence in order, commit anchored judgments while the region is hot" applies to a ticket history exactly as to a session.

**LangGraph sketch** (extends the existing core loop; same `StateGraph`, new tools + thinner finalize). Core tool names below; the session adapter binds them to session vocabulary (`record_claim` → `record_moment`, `record_episode_narrative` → sitting narratives):

```
State = { messages, turns, tokensUsed, repairs, budgetExhausted, toolCallStats,
          record: { claims: RecordedClaim[],              // accumulated by tools
                    episodeNarratives: EpisodeNarrative[],//   (session: moments,
                    edges: CausalEdge[],                  //    sitting narratives)
                    amendments: Amendment[] },
          windowCursor: number }                          // overflow mode only

START → inject_evidence              [deterministic: episode-annotated full render of
                                      the EvidenceStream (session adapter: sitting-
                                      annotated transcript), or first window if overflow]
      → call_model
          ├─ tool calls → execute_tools → budget_guard → call_model
          │     core tools:    record_claim · record_episode_narrative · record_edge
          │                    amend_claim · retract_claim
          │     adapter tools: peek_raw_event · git_log_window   (session adapter;
          │                    each adapter may register its own source tools)
          └─ no tool calls → coverage_gate
coverage_gate [code, no LLM; adapter-parameterized rules]
          ├─ overflow & stream remains → advance_window → call_model
          ├─ gaps found (episode uncovered, opening intent missing,
          │   claim without required corroboration) → bounce → call_model
          └─ complete → finalize      [1 LLM turn: narrative synthesis from
                                       episodeNarratives + record, by reference]
      → assemble                      [code: record → brain-update contract (§4)
                                       + adapter projection (session: PipelineResult,
                                       digest tables)]
      → END
```

**The recording tools are the load-bearing change.** In the session binding, `record_claim` is exposed to the model as `record_moment` (the audited-good moment taxonomy is the session adapter's claim vocabulary). It validates *at commit time*, in the tool executor:
- anchor check (`validateAnchors` against the sitting's event range — quote ⊆ event text, index in range) → failure returns immediately in the tool result: `"evidence[0] unanchored: quote not found at [412]; nearest match [409]"`. Repair is *local and immediate* — one moment, while the region is still hot in context — not a whole-blob bounce at the end.
- claim-typed moments (`confirmation | breakthrough | execution`) **require** a `citedToolEvents: number[]` field pointing at action/result events, plus the agent's `verification` verdict (`supported | contradicted`); code validates the cited events exist and are action/result category. Verification is woven into reading, and it finally has a place to be recorded (fixes D4). (This is the session adapter's instance of the core's generic rule: *an adapter declares which claim kinds require corroboration and what counts as corroborating evidence* — a Jira adapter's "decision" claim citing the authoring comment is the same mechanism.)
- `confidence` is **not** an input — derived in code (E2's design, promoted to the contract): anchored + supported → high; anchored → medium; any unanchored evidence → low. Structurally cannot saturate.
- occurred-time from first anchored event, at commit.

`record_episode_narrative(episodeIndex, summary, openThreads[])` — in the session binding, the sitting narrative — is demanded by the coverage gate at each episode boundary — the rolling narrative is *forced by topology*, not requested by prompt. Persisted per digestion-zoom Part A as the `digest:sitting` event summary + new nullable columns on `sittings` (§5). `record_edge(fromMomentId, toMomentId, kind: caused | superseded | resolved | resumed)` lets causal structure accumulate where it is observed. `amend_moment`/`retract_moment` handle the honest failure mode of committing early and learning better later (the audit agents did exactly this); amendments are kept, not overwritten — the digester's own change-of-mind is part of the trace.

**Domain atoms:** moments remain the primary atom (the taxonomy is audited-good), but they stop being the *sole* atom: **sitting narratives** and **causal edges** become first-class recorded objects. Transitions and outcomes become *deterministic derivations*: transitions from `pivot`/`rejection` moments + `superseded` edges; outcomes from `supported` execution/confirmation moments (+ their `filesAffected`). Tables still written, readers untouched, two Sonnet calls and one whole re-projection failure class deleted. (Gated by experiment V2-E3 — if derivation measurably loses recall vs. the LLM calls, keep the calls.)

**Narrative accumulation:** rolling by construction — sitting narratives are written *during* the read of each sitting, from the full read (sub-moment texture included), then `finalize` composes the session narrative from sitting narratives + moment record *by reference*. Auditable per sitting against its event range.

**Long-session traversal:** single window is the *primary* path, justified: (i) measured — the worst real session is ~58k tokens rendered, 29% of the window; (ii) the known failure of long contexts is degraded *retrieval from the middle* at answer time — incremental commit sidesteps it because each judgment is made while its region is proximal, never reconstructed from distance; (iii) chronology (F8) is trivially preserved by a chronological read; (iv) prompt caching makes a growing single conversation cheap — each turn re-reads the transcript from cache at ~10% input price. **Overflow strategy** (render > ~120k tokens, leaving headroom for turns): the same graph flips to rolling — `advance_window` drops the oldest transcript segment from `messages` and injects the next sitting-group; the carried context is **the accumulated record itself** (recorded moments + sitting narratives + open threads), not an ad-hoc scratchpad. The notes that carry state across windows are the same objects that get stored — nothing is discarded (fixes D3 at the root).

**Cost estimate** (Sonnet, prompt-cached):
- short (2.4k render): 3–6 turns ≈ pipeline's 8–10 calls, cheaper in tokens.
- medium (31k): 8–15 turns; ≈ pipeline's ~22 calls; cached input keeps token cost at or below pipeline (which pays full price for 17 disjoint extract prompts).
- large (58k): 15–25 turns vs pipeline's observed ~35–40 calls. One full-price 58k read + ~20 cache-read turns + outputs ≈ **at or under pipeline cost, well under the 2× envelope**; the two deleted transitions/outcomes calls partially fund the recording turns.

(Cost envelopes are per-adapter, judged against that adapter's own baseline — this table is the session adapter's. A Jira ticket or Slack thread is tens of events → 2–4 turns → pennies; sparse sources never stress the envelope.)

**What A cannot do well:**
- Sessions whose signal hides below the render's truncation (actions cut at 200 chars, ok-results at 120) — mitigated by `peek_raw_event`, but the agent must think to look.
- Genuinely overflow sessions run the degraded rolling path — the window strategy is only *mostly* dead.
- Wall-clock: sequential by design; no parallel speedup (acceptable: digestion is a background daemon job).
- Early-commit wrong: a moment recorded in sitting 1 may be recontextualized by sitting 5; `amend/retract` covers it but adds protocol the model must actually use — a fidelity-precision risk to watch in the experiment.
- Cross-session structure (resumed *sessions*, not sittings) — out of scope for any per-stream receiver run; consolidation agent's job.

**Adapter vs. core — the reframe re-examination.** What in A as first drafted assumed transcript-ness, and what receives evidence generally:

| Component (as sketched above) | Lives in | Why |
|---|---|---|
| `parse → normalize → render` (`renderChunkEvents` incl. its truncation/density choices) | **session adapter** | produces the `EvidenceStream` (§4); density is a source property |
| `detectSittings` (gap threshold tuned to coding cadence) | **session adapter** | the adapter's episode detector; core consumes `Episode[]` |
| `classifySession` (genre priors for the prompt) | **session adapter** | genres are source vocabulary |
| `inject_evidence` | **core** | takes any rendered `EvidenceStream` |
| `call_model` loop, `budget_guard`, repair bounces | **core** | unchanged from `core/graph.ts` |
| `record_claim` (+ commit-time anchor validation, derived confidence, occurred-time stamping) | **core** | claim vocabulary + corroboration rules are **adapter config**; session binds it as `record_moment` with the moment taxonomy |
| `record_episode_narrative` | **core** | session binds it as the sitting narrative |
| `record_edge`, `amend_claim`/`retract_claim` | **core** | causality and change-of-mind are source-independent |
| `validateAnchors` (quote ⊆ `EvidenceEvent.text`, index in episode range) | **core** | one signature for all sources |
| `peek_raw_event`, `git_log_window` | **session adapter tools** | raw-pointer follow + implementation-source enrichment; adapters register their own |
| `coverage_gate` | **core, adapter-parameterized** | episode coverage and anchor validity are core rules; claim-corroboration requirements come from the adapter |
| `finalize` (narrative synthesis by reference) | **core** | composes from episode narratives + record |
| `assemble` | **core contract + adapter projection** | core emits river events + understanding deltas (§4); the session adapter additionally projects to `PipelineResult` and the digest tables |
| Cost table, overflow threshold | **per-adapter parameters** | invariants stated against each adapter's baseline |

**Where a Jira or Slack adapter plugs in — zero core changes.** Concretely, so the boundary is checkable rather than aspirational:

- **Jira ticket** — `EvidenceStream{ sourceType: 'jira', streamId: ticket key, evidenceClass: 'intent' }`; events = created / comments / transitions / field changes, each rendered to text with the actor and occurred-time. **Episode** = a burst of ticket activity delimited by dormancy (same gap detector shape, different threshold — a ticket "sits" for days, not minutes). **Evidence anchor** = `(eventIndex, quote)` where the quote is drawn from a comment or description revision — the identical `validateAnchors` check. **Claims** = adapter vocabulary such as `scope-change | decision | requirement-added | priority-shift`, with the adapter's corroboration rule ("`decision` must cite the transition event or the authoring comment"). **Episode narrative** = what changed on this ticket in this burst, and why. Outputs: `integration:jira:*` river events at the transition's occurred-time + **intent-classed** understanding deltas through the same gate.
- **Slack thread** — stream = the thread; usually a single episode; claims = `decision | question-opened | question-resolved`; anchor quotes drawn from message text; outputs = `integration:slack:*` river events + intent-classed deltas.

Both are so sparse that the receiver's full-read primary path is trivially satisfied and overflow mode may never trigger for them. And this is where the product thesis lands: once a Jira adapter emits intent-classed deltas and the session adapter emits implementation-classed ones, **alignment is a query over what one receiver produced from both sides** — not a new system.

### Candidate B — Thread-following reader

**Frame:** follow causality, not the clock. A cheap skim builds a thread map from developer-intent events + sitting structure; the agent then follows each thread across the session, reading only windows relevant to that thread, emitting thread objects with first-class causal edges.

```
START → skim                 [1 Sonnet call over intents+sittings render (~5–10k tok):
                              threads[] = {label, seedEvents[], suspectedSpan}]
      → plan                 [code: order threads, assign windows]
      → follow_thread (×N, sequential or Send-parallel)
              loop: read_transcript_range(window) → record_moment/record_edge
              exits with thread {status: resolved|abandoned|open, momentIds, edges}
      → chronology_merge     [code: sort all recorded moments by anchor time;
                              detect cross-thread interleavings]
      → weave_residue        [1 call: events touched by no thread — the texture check]
      → finalize             [narrative from threads + chronology]
```

**Atoms:** the **thread** is the primary atom; moments are entries in threads; edges are native (a thread *is* an edge chain). Narrative accumulates per-thread, then merges. Verification woven per-thread (a thread-follower naturally reads outcome events for its own thread). Long sessions traverse *cheaply per thread* — you never hold the whole session, only each thread's windows.

**Cost:** skim 1 + (5–12 threads × 2–5 reads/records) + residue + finalize ≈ **25–60 calls**, with overlapping windows read multiple times across threads. Highest of the three; parallel `Send` recovers wall-clock but not tokens.

**What B cannot do well:**
- **Chronology is reconstructed, not preserved** — F8 regression risk is structural; the journal's axis is time and this topology fights it.
- Threads missed by the skim are never followed — under-extraction (F6) moves from "narrow windows" to "narrow thread map"; the residue pass is a patch on a structural hole.
- Off-thread texture (explorations that never crystallized) is exactly what falls between threads.
- Sitting narratives are unnatural (a thread crosses sittings); the rolling-narrative amendment doesn't compose with it.
- Most complex to build and to eval-attribute (which knob failed: skim, follow, merge?).

**Verdict:** the right *shape* for a **cross-stream consolidation agent** (threads spanning sessions are precisely what Feature-lens understanding needs) — wrong shape for the per-stream receiver whose product surface is a timeline. The reframe sharpens this: the threads that matter most are **cross-source** — a PRD claim → the sessions that implemented it — which is the alignment comparison itself, and it runs *over the river the receiver filled*, downstream of ingestion, not at it. Keep the `record_edge` atom from A so B's future consumer inherits real edges.

### Candidate C — v1 rolling-sitting agent (baseline candidate)

The shipped design: fetch-via-tools reader, prompt-directed sitting order, notes in prose, one final blob, `validate_anchors_and_repair` at the end. Graph as in `core/graph.ts` today.

**Atoms:** moments only (D1 intact). **Narrative:** final blob (D3/D5 intact until the sittingNarratives amendment is implemented). **Verification:** prompted, unrecordable (D4). **Traversal:** agent chooses reads under `maxTurns 40 / 400k tokens`.

**Cost:** bounded by budget; retrieval turns compete with judgment turns — a large session spends half its budget re-fetching what A holds in cache.

**What C cannot do well:** the agent sees only what it asks for — under-extraction of texture is structural (you don't search for what you don't suspect); whole-blob repair; end-of-run synthesis distance; working notes discarded. Against the reframe it is D6 embodied: transcript-fetch tools, digest-blob output schema, no seam for a second source. Its virtue is that it exists and is contract-clean. **Role: control arm, not destination.**

---

## 3. Recommendation

**Build Candidate A — full-read incremental-commit — as digestion v2, keeping C as the experimental control and deferring B's thread-following to the consolidation agent (while shipping B's edge atom inside A).**

Reasoning against the owner's forces, one by one:
- *"Narrow windows lose narrative and nuance"* — A deletes windows for every session that fits (all of them, today) and reads the arc whole; the 80-event cap and 3-event overlap die with the pipeline arm.
- *"Concerned by the moment-only lens"* — sitting narratives and causal edges become first-class recorded objects written from the read, not projected from moments; transitions/outcomes stop being LLM re-projections.
- *"Proper agentic search and reasoning; search and analysis are not so different"* — A keeps the agent loop, tools, and judgment; it removes only the *retrieval tax*. The audit agents that outperformed the pipeline held transcripts and took notes as they read — A is that method, formalized.
- *Journal as product surface* — every recorded object is anchored and occurred-time-stamped at commit; `digest:sitting` events make the digestion structure river-native; the agent's recording trace *is* the zoom view's fourth lane.
- *"Digestion is the receiver of events — sessions, but also Jira/Slack — updating the brain"* — A's reading loop is source-agnostic by construction once the adapter/core split (§0, re-examination table above) is enforced: adapters own parse/render/episodes/vocabulary; the core owns commit, validation, narrative, and the brain-update contract (§4). The Jira/Slack plug-in sketch requires zero core changes — the receiver is designed for its second source before the second source exists.

**Build order note:** v2 is built *as* the receiver core + the session adapter — not as a session digester to be split later. The boundary is a code boundary from day one: core modules (`src/agents/core/`, growing into the receiver) must not import from the session adapter (`src/adapters/cc*`, `src/agents/digest/`); the session adapter depends on the core, never the reverse. Enforced in review plus a cheap import-boundary lint check.

**Migration path from v1 (what survives):**

| Survives as-is | Modified | Deleted (after promotion) |
|---|---|---|
| `core/graph.ts` loop, budget guard, repair bounce | `AgentState` + `record` annotation; `coverage_gate` node replaces blob-shaped custom node | pipeline `extract.ts`/`weave.ts`/`verify.ts`/`transitions.ts`(LLM)/`narrative.ts`(moment-only path) |
| `core/tool.ts`, `run.ts`, `tools/git.ts` | `tools/transcript.ts`: `peek_raw_event` added; range/search kept for overflow mode | `chunk.ts` as a *reading* structure (kept only as storage span backfill, see §5) |
| `validateAnchors`, `detectSittings`, groundwork, `renderChunkEvents` | `output-schema.ts` shrinks to narrative + session decisions; new `RecordedMoment`/`CausalEdge`/`SittingNarrative` schemas | `buildPseudoChunksPerSitting`, `mapAgentOutputToPipelineResult` (replaced by `assemble`) |
| Storage contracts, `storeSessionDigest`, idempotency + grown-log replace, `PipelineResult` | `emit-events.ts` gains sitting-narrative + edge events | 3-event overlap, `dedup-moments` (nothing to dedup without overlap) |

New code is concentrated in: recording tools (+ their commit-time validators), `coverage_gate`, `advance_window`, `assemble`, derived transitions/outcomes. The graph shape change is small; the contract change is the point. Everything in the "survives as-is" and "modified" columns sorts cleanly into the §0 split — the loop/tools/validators land in the receiver core, the groundwork/render/genre/git pieces land in the session adapter — so the migration *is* the boundary-drawing exercise.

**Pre-registered experiments (one dimension each; referee `run-fidelity.ts`; experiment set `d73d5190` + `5b31a1bb`, full set incl. `20f5efec` + `b9ab1a0c --force` before promotion; results in `.claude/skills/agents/experiments/`):**

- **V2-E1 (context composition):** v1 agent, unchanged topology, but transcript injected up front instead of fetch-via-tools. *Expected:* catalog recall ↑ (esp. F6 texture items: b9ab1a0c's 0/5), turns ↓. Isolates "holding the session" from everything else.
- **V2-E2 (topology):** incremental-commit tools + coverage gate + thin finalize, on whichever context arm won E1. *Expected:* precision violations stay 0 while moment count stays sane; anchored% ↑ (commit-time repair); chronology errors 0; verification recorded ≠ null on claim moments. Isolates "commit-as-you-read" from "full read".
- **V2-E3 (contract):** derived confidence + derived transitions/outcomes vs model-emitted. *Expected:* calibration flips to INFORMATIVE (cannot saturate); recall/precision unchanged; −2 Sonnet calls. (Absorbs old E2.)
- **E1b control (kept from agents-core):** pipeline shape, sitting-sized chunks, zero overlap, carried moment-header — still the honest control that separates window-size from agenthood. Run once alongside V2-E1.
- **Boundary check (structural, not an LLM experiment):** the adapter/core split cannot be eval-scored until a second source exists, so it is verified two ways instead: (i) the import-boundary lint (core never imports session-adapter modules) passes on every experiment branch; (ii) at each design change, the Jira adapter sketch in §2 must remain implementable with zero core diffs — a paper re-derivation, minutes of work, done as part of experiment review. All V2-E* experiments run through the session adapter; their referees and baselines are unchanged by the reframe.
- **Promotion bar (unchanged from agents-core, restated):** v2 ≥ pipeline on every provenance check, strictly better on catalog recall, no precision/agency regression, full set, ≤3× pipeline token cost (expected: ≤1×) — then v2 becomes the default digest path and the pipeline understand-arm is excised.

Fidelity-eval additions required first (cheap, deterministic): score *chronology* (recorded moment order vs anchor-time order), *sitting-narrative coverage* (every sitting has one), *verification-recorded rate* on claim moments, and *edge validity* (edges reference stored moments). The catalogs already contain the ground truth for the first.

---

## 4. The brain-update contract (source-generic, additive-only)

What every adapter feeds the receiver, and what the receiver hands the brain — names and field sketches. Nothing here requires a schema migration to exist: the output shapes ride structures the brain already has; the session digest tables are the session adapter's private specialization on top.

### 4.1 Input: `EvidenceStream` / `EvidenceEvent`

The receiver core reads nothing else. Adapters produce this from whatever the source gives them:

```ts
interface EvidenceEvent {
  index: number;               // position in the stream — the anchor target
  occurredAt: Date;            // source timestamp — becomes river occurred-time
  actor: string;               // 'user' | 'assistant' | 'jira:gilad' | 'slack:@dana' …
  kind: string;                // source-freeform: 'user-message' | 'tool-result' |
                               //   'jira:transition' | 'slack:message' | 'prd:revision'
  text: string;                // the rendered text — anchor quotes must be ⊆ this
  refs?: string[];             // files / artifact ids / URLs touched
  raw?: { sourceType: string; sourceId: string };   // peek pointer for adapter tools
}

interface Episode {            // core time unit; adapter detects, core consumes
  index: number;
  startEvent: number;          // inclusive EvidenceEvent index range
  endEvent: number;
  gapBeforeMs?: number;
}

interface EvidenceStream {
  sourceType: string;          // 'cc-session' | 'jira' | 'slack' | 'prd' …
  streamId: string;            // session id / ticket key / thread ts / doc id
  evidenceClass: 'implementation' | 'intent' | 'mixed';
  events: EvidenceEvent[];     // chronological
  episodes: Episode[];         // adapter-detected gap structure (session: sittings)
}
```

An **anchor** is the core's one provenance primitive, for every source: `{ eventIndex: number; quote: string }`, validated in code — quote ⊆ `events[eventIndex].text`, index within the episode under read. This is `validateAnchors` with the transcript assumption removed; nothing about it changes for sessions.

### 4.2 Output 1: river events

**`RiverEvent` = the existing `ActivityEvent`** (`src/adapters/types.ts`) — it was already designed source-generic (freeform `category`, `sourceType`/`sourceId` pointer, denormalized context) and needs **no changes**. The receiver adds guarantees, not fields:

- `timestamp` is **occurred-time** — the `occurredAt` of the first anchored evidence event, never digestion wall-clock;
- anchors travel in `metadata` (`{ anchors: [{eventIndex, quote}], streamId }`);
- `category` is namespaced by source: `session:*` / `digest:*` today, `integration:jira:*`, `integration:slack:*` later — exactly the PRD's `integration:<source>` convention.

### 4.3 Output 2: proposed understanding deltas — through one gate

```ts
interface UnderstandingDelta {
  kind: 'feature-evidence' | 'observation' | 'alignment-candidate';
  featureHint?: string;        // proposed Feature link — a hint, never authoritative
  claim: string;               // the assertion being proposed
  evidenceClass: 'intent' | 'implementation';
  anchors: Anchor[];           // ≥1, code-validated at commit
  corroboration?: Anchor[];    // required for claim kinds the adapter marks as needing it
  confidence: 'high' | 'medium' | 'low';   // DERIVED in code (§2 rule) — never model-emitted
  status: 'proposed';          // enters the one gate: pending → approved | rejected
  sourceType: string;
  streamId: string;
}
```

**The one gate:** deltas ride `activity_events` with `reviewStatus` (`pending | approved | rejected`) — the review lifecycle the observation layer already uses; `brain_propose_knowledge_delta` (MCP, deferred per F7) is the agent-side entrance to the *same* gate, not a second path. No adapter, no matter the source, writes accepted understanding directly. A dedicated `understanding_deltas` table is a later **additive** move if query patterns demand it (open question 7).

### 4.4 The session digest tables are the session adapter's specialization

| Generic (core contract) | Session adapter's shape |
|---|---|
| `Episode` | `sittings` row (table name kept) |
| `RecordedClaim` (adapter vocabulary + corroboration rule) | `moments` row (taxonomy = the claim vocabulary; `citedToolEvents` = the corroboration rule) |
| `Anchor` | `moment_evidence` row |
| Episode narrative | `sittings.summary` / `sittings.open_threads` + `digest:sitting` river event |
| `CausalEdge` | `moment_relations` row (+ `kind`) |
| Adapter-derived projections | `transitions` / `outcomes` (deterministic derivation, V2-E3) |
| Adapter result envelope | `PipelineResult` for existing callers |

`assemble` runs in two layers: the **core layer** emits river events + understanding deltas per this contract; the **adapter layer** additionally projects the record into the tables above. A Jira adapter has no moments and no `PipelineResult` — its adapter layer is just the river/delta emission plus whatever thin bookkeeping it needs. That asymmetry is the design working, not a gap.

---

## 5. Domain-model deltas (additive only) — session adapter

These are the **session adapter's** storage specialization of the §4 contract. The generic contract itself needs no migration (river events and deltas ride `activity_events` + `reviewStatus` as they exist today).

```sql
-- 1. Sitting narratives (rolling narrative persisted; D3)
ALTER TABLE sittings ADD COLUMN summary text;            -- 2–4 sentences, written from the read
ALTER TABLE sittings ADD COLUMN open_threads jsonb;      -- [{label, status}] carried forward
-- also emitted as digest:sitting activity events (zoom Part A), summary = this summary

-- 2. Causal edges become real (D1) — REUSE moment_relations (written-never-read today):
--    start writing agent-recorded edges with relation kinds; ADD the missing reader.
ALTER TABLE moment_relations ADD COLUMN kind text;       -- caused|superseded|resolved|resumed
                                                          -- (existing enum col kept; kind is the
                                                          --  v2 vocabulary, nullable for old rows)
-- getSessionMoments() starts joining moment_relations → relatedMomentIds finally non-empty.
-- No new table; the dead table becomes alive instead of excised.

-- 3. Moments: sitting becomes the home structure; chunk_id kept for compat (D2)
ALTER TABLE moments ADD COLUMN sitting_id uuid REFERENCES sittings(id) ON DELETE SET NULL;
ALTER TABLE moments ADD COLUMN amended_by uuid REFERENCES moments(id); -- amend/retract chain
ALTER TABLE moments ADD COLUMN retracted boolean;        -- nullable; true = digester retracted
-- chunk_id population in v2: one backfill chunk row per sitting (real event ranges, real
-- spans — not pseudo): existing readers (getChunkEvents, zoom chunk lane) keep working;
-- new readers use sitting_id. Chunks stop being a reading unit and become a stored span.

-- 4. Evidence: tool citations for claim moments (D4)
ALTER TABLE moment_evidence ADD COLUMN cited_for text;   -- null | 'verification'
-- verification verdict already has moments.verification (nullable) — v2 finally writes it
-- on the agent arm.

-- 5. Digest run bookkeeping — no new table; rides digest:run events (zoom Part A),
--    metadata gains { arm: 'v2', windowMode: 'single'|'rolling', turns, cacheReadTokens }.
```

No existing column changes; every reader keeps working; all new fields nullable. `transitions`/`outcomes` tables unchanged — v2 writes them from the deterministic derivation (V2-E3), same shapes.

---

## 6. Open questions for the owner

1. **Transitions/outcomes derivation:** may V2-E3 *replace* the two LLM calls with deterministic derivation if fidelity holds (tables/readers unchanged), or must both arms coexist behind a flag until a promotion-grade comparison? Forks how much of the old pipeline survives.
2. **Amendment semantics in the river:** when the digester retracts/amends a moment mid-read, do the superseded versions surface in the Journal (honest process, noisier river) or only in the zoom view (clean river, provenance one click deeper)? Forks emit-events and the zoom spec.
3. **Overflow threshold ownership:** single-window applies up to ~120k rendered tokens (all current sessions qualify at ≤58k). Is a *degraded-mode marker* on rolling-window digests (visible in `digest:run` and zoom) acceptable, or must rolling mode meet the identical fidelity bar before v2 ships? Forks the promotion criteria.
4. **Fate of the fixed pipeline post-promotion:** excise entirely (agents-core says retire), or keep a no-LLM `--dry-run`-style deterministic skeleton (sittings + rendered river only) as the API-key-less fallback? Forks the deletion list and CLAUDE.md.
5. **Cost envelope reconciliation:** this brief says justify beyond ~2× of ~12 calls/session, but the shipped pipeline already spends 35–40 Sonnet calls on large sessions and agents-core pre-registered ≤3× *pipeline* cost. Which baseline governs v2's promotion? (A is expected ≤1× pipeline, so this likely never binds — but it should be unambiguous before the experiments are scored. Per §4, envelopes for later adapters are set against their own baselines when those adapters are proposed.)
6. **Second-source adapter timing:** is a thin read-only Jira **or** Slack adapter (one project / one channel) worth building shortly after v2 promotion as a *boundary proof* — cheap, since the streams are tiny and the receiver core is shared — or does the second source wait for P2 intent-ingestion proper? Forks whether the adapter/core boundary stays a lint rule + paper exercise or gets a living test; also forks how soon the first intent-classed deltas (and thus the first real alignment queries) exist.
7. **Delta gate mechanics:** should proposed understanding deltas keep riding `activity_events` + `reviewStatus` (today's observation gate — zero migration), or get a dedicated `understanding_deltas` table at v2 time (additive, better queryability, one more surface)? Forks §4.3 and the review UI's read path.
