# Consolidation — Iteration 0

> Synthesis lead pass over 38 triage verdicts on prior-planning docs, judged against **Brain PRD v0.3** (`docs/prd.md`) and `docs/future-knowledge.md`.
> Date: 2026-06-27 · Branch: `feat/repo-brain`

---

## 1. Summary

**Status counts (38 docs):** `supersede` 13 · `extract` 8 · `mixed` 17.

The corpus is the full paper trail of the May–June 2026 build: the execution-memory bootstrap, causal threading, the Topic/Insight/Card "knowledge graph" era, four dashboard redesigns, the observe-channel daemon, the chromosome eval framework, and the activity-event backbone. Almost all of it **shipped** — the code exists — so these docs are historical records, not open plans. What v0.3 **supersedes is the framing**, not the engineering: PRD v0.3 retires Topic/Insight/Card-as-atom in favor of **Feature-as-node**, and redefines the MVP as a *measured* (ETC/CVR A/B) feature-aware agent-context loop. Net: the substrate survives almost entirely; the vocabulary and the "what's next" of every doc is rewritten. Only **2 of 38** docs are worth keeping as living reference; the rest archive after their backlog and observations are harvested below.

---

## 2. Status Table

| Path | Title | Status | One-line rationale |
|---|---|---|---|
| docs/checkpoint-1-review.md | Checkpoint 1 Review (Tasks 1–5) | supersede | Code review of early pipeline; all 15 tasks now done, framing replaced by v0.3. |
| docs/chromosome-designs.md | Chromosome Designs: Context Composition | extract | Pre-MVP exploration; Hybrid Router + token tradeoffs worth preserving. |
| docs/DEMO.md | Intent-AI Demo Script | supersede | Keyed to pre-v0.3 `brain_file_context`/topic framing; needs full rewrite. |
| docs/digest-comparison-layer0.md | Digest Comparison: Before/After Layer 0 | extract | Layer 0 shipped; four "still missing" pipeline gaps are live backlog. |
| docs/handoffs/2026-05-23-code-changes-brain-graph.md | Versioned Knowledge from Code+Sessions | extract | "Brain has commits" doctrine superseded; Known Issues are live debt. |
| docs/handoffs/2026-05-23-repo-brain-session-2.md | Topic synthesis vertical slice | mixed | Synthesis substrate live; Topic→Feature re-key is core MVP work. |
| docs/handoffs/2026-05-23-successor-prompt.md | Successor Prompt (repo-brain) | mixed | Topic-centric priorities reframed; design decisions confirmed by PRD. |
| docs/handoffs/2026-05-24-brain-cards-and-search.md | Brain Cards & Search Model (S4) | supersede | Card/Gen2B/spec-hierarchy maps to no surviving v0.3 object. |
| docs/handoffs/2026-05-24-brain-cards-search-sidebar.md | Cards, Search, Sidebar (S4) | mixed | Infra foundational; BrainCard-as-atom superseded by Feature. |
| docs/handoffs/2026-05-24-brain-quality-pipeline.md | Three-Node Synthesis + EDD Judge | mixed | extract→organize→write pipeline live; must re-target Topic→Feature. |
| docs/handoffs/2026-05-24-dashboard-and-brain-quality.md | Dashboard + Topic Quality | supersede | Topic-quality direction fully superseded; built work historical. |
| docs/handoffs/2026-05-24-repo-brain-session-3.md | Topic Synthesis & Dashboard Redesign | mixed | "Mental model not changelog" principle + gaps still actionable. |
| docs/handoffs/2026-05-24-successor-prompt.md | Brain Session 3 Successor Prompt | mixed | Session-digest quality work foundational; topic pipeline is debt. |
| docs/handoffs/2026-05-25-mcp-dedup-cards.md | MCP, Dedup, Cards UI (S5) | mixed | MCP/dedup live; Card/Topic framing superseded, write-side net-new. |
| docs/plans/2026-05-21-execution-memory.md | Execution Memory Bootstrap Plan | supersede | All 15 tasks implemented; mission superseded by v0.3. |
| docs/plans/2026-05-22-causal-threading.md | Causal Threading & Interaction Analysis | supersede | All 5 tasks shipped; pure implementation history. |
| docs/plans/2026-05-23-repo-brain.md | Repo Brain Implementation Plan | mixed | Phases 1–3 shipped; dashboard work needs Feature re-frame. |
| docs/plans/2026-05-24-brain-cards.md | Brain Cards Implementation Plan | supersede | `brain_cards` table not in trimmed MVP object set. |
| docs/plans/2026-05-24-brain-mcp-navigation.md | Brain MCP Card Navigation | mixed | All 6 tasks done; tool surface is a Feature-migration target. |
| docs/plans/2026-05-24-brain-quality.md | Brain Quality Redesign (3-node topic) | mixed | Pipeline pattern + judge reusable; topic-tree target superseded. |
| docs/plans/2026-05-24-dashboard-shadcn-redesign.md | Dashboard shadcn Redesign | supersede | Executed; dashboard outgrew the plan. |
| docs/plans/2026-05-24-dashboard-split-view.md | Dashboard Split View | mixed | Layout skeleton live; content layer needs Feature re-key. |
| docs/plans/2026-05-30-observe-channel.md | Observe Channel Plan | supersede | All 12 tasks shipped; live-suggestions deferred to future-knowledge. |
| docs/plans/2026-06-05-brain-learning-layer.md | Brain Learning Layer (patterns→skills) | supersede | Skill synthesis explicitly deferred; Topic-centric. |
| docs/plans/2026-06-22-activity-event-backbone.md | Activity Event Backbone Plan | supersede | All 12 tasks implemented; backbone is live substrate. |
| docs/skills-v1.1-proposals.md | Skills v1.1 Improvement Proposals | extract | Principles absorbed into CLAUDE.md; one new skill + 2 edits live. |
| docs/specs/2026-05-30-observe-channel-phase1.md | Observe Channel Phase 1 | extract | Daemon built; dashboard UI tasks unbuilt, deferred P3. |
| docs/superpowers/specs/2026-05-21-execution-memory-design.md | Execution Memory Design Spec | mixed | **Best reference for chunking/two-pass merge rules in the repo.** |
| docs/superpowers/specs/2026-05-22-causal-threading-design.md | Layer 0: Causal Threading | supersede | Every component shipped; implementation history. |
| docs/superpowers/specs/2026-05-22-chromosome-framework.md | Chromosome Framework | extract | Infra built; Gen 1+ campaign and topologies real backlog. |
| docs/superpowers/specs/2026-05-22-edd-strategy.md | EDD Strategy (Chromosome + Judge) | mixed | Scaffolding built; 17-variant experiment never run. |
| docs/superpowers/specs/2026-05-22-layer1-pipeline-redesign.md | Layer 1 Pipeline Redesign | extract | DAG shipped; 5 quality/cost improvements still actionable. |
| docs/superpowers/specs/2026-05-23-repo-brain-design.md | Repo Brain Design Spec | mixed | P0 substrate live; Topic→Feature shift, taxonomy reusable. |
| docs/superpowers/specs/2026-05-24-brain-cards-search-design.md | Brain Cards & Search Model | mixed | Card ontology superseded; star-search + inheritance reusable. |
| docs/superpowers/specs/2026-05-24-brain-quality-design.md | LLM-Native Spec Graph | extract | Topic tree incompatible; 3-node pipeline + judge reusable. |
| docs/superpowers/specs/2026-05-24-dashboard-redesign.md | Dashboard Redesign: Split View | mixed | UX patterns sound; Topic-scoped nav superseded. |
| docs/superpowers/specs/2026-06-05-brain-learning-layer-design.md | Patterns, Skills, Scaffold Export | supersede | Topic-centric; deferred to future-knowledge Agent Intelligence. |
| docs/superpowers/specs/2026-06-21-activity-event-backbone-design.md | Activity Event Backbone Design | mixed | **Canonical backbone spec, frozen, cited by CLAUDE.md.** |

---

## 3. Keep

Two truth docs anchor the tree and are not in the triage set:
- **`docs/prd.md`** — Brain PRD v0.3. The current source of truth.
- **`docs/future-knowledge.md`** — the consciously-deferred hypotheses.

Of the 38 triaged docs, **keep exactly 2** as living reference (everything else is harvested-then-archived):

| Path | Why keep |
|---|---|
| `docs/superpowers/specs/2026-05-21-execution-memory-design.md` | The **only** prose reference for the chunking heuristics (5-min pause, 70% file-cluster shift, 80-event cap, 3-event overlap) and the two-pass moment-detection merge rules. This knowledge lives nowhere else; the code implements it but does not explain it. Mark its "Non-Goals / explore REPL / product framing" sections as superseded by v0.3. |
| `docs/superpowers/specs/2026-06-21-activity-event-backbone-design.md` | The **canonical, frozen** design for `activity_events` — freeform categories, denormalization, observation layer. Explicitly referenced by CLAUDE.md and cited as "Exists" in PRD v0.3. The schema-design half is current truth; only the "memory = topics/insights/skills" apex framing is superseded. |

Rationale: code is the source of truth for *what is built*; we only keep docs that explain *why/how* in a way the code cannot. Everything else is either fully shipped (read the code) or fully reframed (read the PRD).

---

## 4. Supersede & Archive

Move the remaining **36 docs** to `docs/archive/` (structure preserved). All backlog tasks and durable observations are already harvested into §5 and §6 below, so archiving loses nothing actionable. Each is superseded by **PRD v0.3 (`docs/prd.md`)** and/or **the current codebase** (for the fully-shipped plans/specs).

**Human-gated — do NOT run automatically.** Review, then execute:

```sh
# Run from repo root: /Users/giladkoch/dev/intent-ai
mkdir -p docs/archive/handoffs docs/archive/plans docs/archive/specs docs/archive/superpowers/specs

git mv docs/checkpoint-1-review.md                        docs/archive/checkpoint-1-review.md
git mv docs/chromosome-designs.md                         docs/archive/chromosome-designs.md
git mv docs/DEMO.md                                       docs/archive/DEMO.md
git mv docs/digest-comparison-layer0.md                   docs/archive/digest-comparison-layer0.md
git mv docs/skills-v1.1-proposals.md                      docs/archive/skills-v1.1-proposals.md

git mv docs/handoffs/2026-05-23-code-changes-brain-graph.md    docs/archive/handoffs/2026-05-23-code-changes-brain-graph.md
git mv docs/handoffs/2026-05-23-repo-brain-session-2.md        docs/archive/handoffs/2026-05-23-repo-brain-session-2.md
git mv docs/handoffs/2026-05-23-successor-prompt.md            docs/archive/handoffs/2026-05-23-successor-prompt.md
git mv docs/handoffs/2026-05-24-brain-cards-and-search.md      docs/archive/handoffs/2026-05-24-brain-cards-and-search.md
git mv docs/handoffs/2026-05-24-brain-cards-search-sidebar.md  docs/archive/handoffs/2026-05-24-brain-cards-search-sidebar.md
git mv docs/handoffs/2026-05-24-brain-quality-pipeline.md      docs/archive/handoffs/2026-05-24-brain-quality-pipeline.md
git mv docs/handoffs/2026-05-24-dashboard-and-brain-quality.md docs/archive/handoffs/2026-05-24-dashboard-and-brain-quality.md
git mv docs/handoffs/2026-05-24-repo-brain-session-3.md        docs/archive/handoffs/2026-05-24-repo-brain-session-3.md
git mv docs/handoffs/2026-05-24-successor-prompt.md            docs/archive/handoffs/2026-05-24-successor-prompt.md
git mv docs/handoffs/2026-05-25-mcp-dedup-cards.md            docs/archive/handoffs/2026-05-25-mcp-dedup-cards.md

git mv docs/plans/2026-05-21-execution-memory.md          docs/archive/plans/2026-05-21-execution-memory.md
git mv docs/plans/2026-05-22-causal-threading.md          docs/archive/plans/2026-05-22-causal-threading.md
git mv docs/plans/2026-05-23-repo-brain.md                docs/archive/plans/2026-05-23-repo-brain.md
git mv docs/plans/2026-05-24-brain-cards.md               docs/archive/plans/2026-05-24-brain-cards.md
git mv docs/plans/2026-05-24-brain-mcp-navigation.md      docs/archive/plans/2026-05-24-brain-mcp-navigation.md
git mv docs/plans/2026-05-24-brain-quality.md             docs/archive/plans/2026-05-24-brain-quality.md
git mv docs/plans/2026-05-24-dashboard-shadcn-redesign.md docs/archive/plans/2026-05-24-dashboard-shadcn-redesign.md
git mv docs/plans/2026-05-24-dashboard-split-view.md      docs/archive/plans/2026-05-24-dashboard-split-view.md
git mv docs/plans/2026-05-30-observe-channel.md           docs/archive/plans/2026-05-30-observe-channel.md
git mv docs/plans/2026-06-05-brain-learning-layer.md      docs/archive/plans/2026-06-05-brain-learning-layer.md
git mv docs/plans/2026-06-22-activity-event-backbone.md   docs/archive/plans/2026-06-22-activity-event-backbone.md

git mv docs/specs/2026-05-30-observe-channel-phase1.md    docs/archive/specs/2026-05-30-observe-channel-phase1.md

git mv docs/superpowers/specs/2026-05-22-causal-threading-design.md      docs/archive/superpowers/specs/2026-05-22-causal-threading-design.md
git mv docs/superpowers/specs/2026-05-22-chromosome-framework.md         docs/archive/superpowers/specs/2026-05-22-chromosome-framework.md
git mv docs/superpowers/specs/2026-05-22-edd-strategy.md                 docs/archive/superpowers/specs/2026-05-22-edd-strategy.md
git mv docs/superpowers/specs/2026-05-22-layer1-pipeline-redesign.md     docs/archive/superpowers/specs/2026-05-22-layer1-pipeline-redesign.md
git mv docs/superpowers/specs/2026-05-23-repo-brain-design.md            docs/archive/superpowers/specs/2026-05-23-repo-brain-design.md
git mv docs/superpowers/specs/2026-05-24-brain-cards-search-design.md    docs/archive/superpowers/specs/2026-05-24-brain-cards-search-design.md
git mv docs/superpowers/specs/2026-05-24-brain-quality-design.md         docs/archive/superpowers/specs/2026-05-24-brain-quality-design.md
git mv docs/superpowers/specs/2026-05-24-dashboard-redesign.md           docs/archive/superpowers/specs/2026-05-24-dashboard-redesign.md
git mv docs/superpowers/specs/2026-06-05-brain-learning-layer-design.md  docs/archive/superpowers/specs/2026-06-05-brain-learning-layer-design.md
```

> Note: `docs/superpowers/specs/2026-05-21-execution-memory-design.md` and `docs/superpowers/specs/2026-06-21-activity-event-backbone-design.md` are intentionally **not** in this block — they are Kept (§3).

---

## 5. MVP Backlog (seeded) — Iteration 1 work queue

Deduped across all 38 docs, grouped by `prdArea` (MVP first), ordered by priority within each group. Bracketed tags cite the strongest source doc(s). This is the canonical work queue.

### MVP — P1 (the write-path + measurement; the real net-new of v0.3)

1. **feature_files join + `brain.enter()` resolver.** Add `feature_files(feature_id, glob, file_path)`, longest-glob-wins; `brain.enter(file|task)` returns the **candidate list** on 0 or >1 match (no silent guessing). Bootstrap the map from `feature_sessions` affected files, then human-correct. *[successor-prompt, repo-brain-design, mcp-navigation, mcp-dedup, brain-cards-search-sidebar]*
2. **`featureContext()` assembler** (re-key `brain_file_context` on Feature). Return feature summary · current understanding · constraints · relevant files · related sessions · known unknowns · agent instructions; preserve constraint-first filtering; inherit constraint-class observations from parent features. *[session-2, mcp-navigation, mcp-dedup, brain-cards-search-design]*
3. **Feature understanding fields.** Add `currentUnderstanding` / `constraints` / `knownUnknowns` to `features` (Week-1 = `description` + approved Observations, assembled). *[successor-prompt]*
4. **Write-side MCP tools.** `brain.reportObservation()` · `brain.reportUnknown()` · `brain.rateContext()` · `brain.proposeKnowledgeDelta()`, stored as `activity_events` with **`feature_id` attached**. *[successor-prompt, mcp-dedup, backbone-design]*
5. **Pending-observation approval UI.** Dashboard review queue: list pending `activity_events` → approve / reject / edit → promote into Current Understanding. *[session-2, mcp-dedup, repo-brain-plan, dashboard-split-view, dashboard-redesign]*
6. **Measurement harness (ETC/CVR A/B).** Recompose `src/eval/{fitness,brain-judge,runner}.ts` + `tests/eval/` into the two-arm harness; encode the 5 `TaskCriteria`, ETC extraction from session JSONL, CVR check, pre-registered pass bar. **This is the proof, not a demo.** *[brain-quality-plan, repo-brain-plan, PRD §Measurement harness]*
7. **Re-key brain synthesis pipeline Topic→Feature.** Wire classify → scoped context assembly per Feature → Sonnet synthesize Current Understanding (connects the today-independent `brain-relevance` + `brain-synthesis` / three-node extract→organize→write). Embed "mental model, not changelog" in the write prompt. *[session-2, successor-prompt, brain-quality-pipeline, repo-brain-session-3]*
8. **Dashboard Feature views.** Feature detail panel (current understanding · constraints · known-unknowns · evidence sessions · click-through) + feature↔file map management UI; migrate Topic/Insight vocabulary to Feature. *[repo-brain-plan, dashboard-split-view]*
9. **`brain.search()` star-pattern + `brain.trace()` Feature-scoped.** Star search across feature name · current understanding · observation summaries · file paths, rank by multi-path hit count + recency (supersedes naive `ask-intent`); `brain.trace()` returns session moments/decisions that shaped a Feature, with co-file discovery. *[brain-cards-search-design, brain-learning-layer-plan, mcp-navigation]*
10. **Archive topic hierarchy migration.** Drop/retire `parent_topic_id` (`drizzle/0004_brain_hierarchy.sql`) so the topic tree stops competing with the Feature graph. *[brain-quality-plan]*

### MVP — P2 (quality, hygiene, supporting infra)

- **Replace `chunk.ts` regex topic-shift with Haiku** structured-output call (CLAUDE.md anti-pattern). *[code-changes-brain-graph]*
- **Duplicate session prevention** — skip already-digested JSONL paths. *[code-changes-brain-graph]*
- **Promote winning eval organism** `{1b, 2f, 3c, 4a}` as orchestrator default. *[code-changes-brain-graph]*
- **Dedupe observations at synthesis/write time** (token Dice + containment, threshold 0.7); port `applyGraphPlan` merge/split discipline to overlapping Observations under a Feature. *[brain-cards-search-sidebar, brain-quality-pipeline]*
- **Replace `brain-judge.ts` 5 dimensions** with Feature-quality dims (intent_clarity, constraint_surfacing, alignment_readiness, unknown_coverage). *[brain-quality-pipeline, brain-quality-design]*
- **Haiku arc-style condensation** for Current Understanding text ("what we wanted / built / know now") — no raw session-summary dumps. *[brain-cards-and-search, brain-cards-search-sidebar]*
- **Narrative/moments prompt quality pass** — reduce robotic framing, add "why it mattered"; sessions are now implementation-evidence. *[repo-brain-session-3, successor-prompt-may24]*
- **Adopt insight-category taxonomy** (structure/decision/constraint/behavior/risk/interface) as recommended Observation tag vocabulary in emit/observe prompts. *[repo-brain-design]*
- **Pre-computation pipeline node** (`src/pipeline/precompute.ts`: agency, candidate-type, fingerprint, notable quotes) + simplified moments prompt consuming `EnrichedExchange` + `collectFiles` regression test. *[layer1-pipeline-redesign, chromosome-framework allele 3c]*
- **Fix digest UI flow ordering** (discover → undigested count → digest → auto-rediscover → picker). *[brain-cards-search-sidebar]*
- **`pg_isready` timeout** in `src/cli/infra.ts` (avoid infinite hang). *[checkpoint-1]*
- **Audit/deprecate `brain-classify` / `brain-sync` CLI** (old topic model, confusing alongside Feature). *[successor-prompt-may24]*
- **Run EDD baseline for `emit-events`** (accuracy, completeness, summary searchability, metadata richness). *[backbone-design]*
- **DEMO rewrite for v0.3** — `brain.enter()`/`featureContext()`, observation-approval beat, ETC/CVR punchline (keep three-act arc). *[DEMO]*
- **`writing-plans` skill: "Eval Fixture Tasks" section** — Task 0 = capture 3–5 real fixtures + grading criteria before implementation. *[skills-v1.1]*
- **Migrate MCP unit tests** (formatCard/parseTopic/fuzzyScore) to Feature-scoped equivalents. *[mcp-navigation]*

### P2-alignment (Knowledge Delta + evidence layer prep)

- **Mutation tracking / Knowledge Delta** — record created/updated/deprecated per BrainVersion; reuse `BrainMutation` diff schema; surface reviewable delta in approval UI. *[session-2, repo-brain-session-3, repo-brain-design]*
- **Populate `brain_versions.commit_sha`** with HEAD on every `brain`/`digest`/`brain-export` run; expose drift flag in `brain.enter`. *[mcp-dedup, dashboard-redesign, brain-cards-search-design]*
- **`activity_events` embeddings** — pgvector `vector(1536)` + HNSW (replace TEXT placeholder), then hybrid RAG retrieval (structured filter → embedding re-rank) for `brain.search`/`featureContext`. *[backbone-design]*
- **Adapt three-node pipeline + `applyGraphPlan`** (merge→split→create→update, cycle detection, file-overlap merge signal) to Feature mutations. *[brain-quality, brain-quality-design]*
- **Surface navigation/pitfall signals** in `featureContext()` ("where to look" / "watch out for"). *[brain-learning-layer-plan]*
- **Reconcile daemon HTTP-hook path vs write-side MCP** — decide single observation-reporting path; auto-digest on SessionEnd; replace NDJSON sink with direct `activity_events` writes. *[observe-channel-plan, observe-channel-phase1]*
- **Apply chromosome isolation methodology to `featureContext` assembler** (file scope, session window, observation weighting as chromosomes). *[edd-strategy]*
- **`chunk.ts` micro-chunk guards** — min-file-count on file-cluster-shift, post-chunk merge pass for <6-event chunks. *[checkpoint-1]*

### P3 (pipeline depth, eval campaigns, hardening)

- **Moment confidence discrimination** — critic/re-ranking pass so not every moment scores "high"; surface causal-threading behavioral directives into moments/events; pass full causal evidence into transitions/narrative. *[digest-comparison, code-changes-brain-graph]*
- **Narrative/moments critic loop** (Haiku validates Sonnet, max 2 revisions) + Topology C; Topology R routed pipeline (Haiku single-call for janitorial/<50-event sessions). *[layer1, chromosome-framework]*
- **Run Gen 1 + 17-variant chromosome experiments** on existing `run-gen0.ts`/`run-learn.ts` infra; log to LangSmith. *[chromosome-framework, edd-strategy]*
- **Hybrid Router** for moment-detection context composition (D for diffs, A passive, B-subset challenges, C header). *[chromosome-designs]*
- **Parameterize `queryEvents` WHERE clauses** (remove SQL string interpolation before any external exposure). *[activity-backbone-plan]*
- **Self-monitoring observation signals** — zero-event sessions, vague summaries, near-duplicate clusters, events never referenced by observations. *[backbone-design]*
- **Document two-pass merge rules inline** in `src/pipeline/moments.ts`; audit session-shape prompt variants. *[execution-memory-design]*

### future-knowledge (do NOT build in MVP — promote into PRD when the bet is next)

- Knowledge Deltas as first-class versioned history · understanding/feature timeline. *[successor-prompt, dashboard-split-view]*
- Skill approval lifecycle (draft→approved→validated, 3+ session gate) · auto-`AGENTS.md`/scaffold generation. *[brain-learning-layer]*
- Layer 1 lenses/schema (session-type-aware moment prompts). *[causal-threading-design]*
- Live-session prompt suggestions + daemon MCP live-state exposure. *[observe-channel-phase1]*
- Code breadcrumb format decision (inline vs companion `.brain.md`) — decide, defer build. *[brain-quality-pipeline]*
- Standalone "Pipeline Design Patterns" skill. *[skills-v1.1]*

---

## 6. Brain Observations to Promote (durable team memory)

Deduped, evidence-grounded principles worth committing to MEMORY.md:

1. **Schema constraints > prompt instructions.** Forcing structure in Zod (`level:root|child`, required fields) reliably propagates where five prompt variants failed. *(already in MEMORY — keep canonical)*
2. **Feature-as-node is a re-key, not a rewrite.** Topic synthesis (`brain-relevance` + `brain-synthesis`, three-node extract→organize→write, BrainVersion chain, GraphPlan) is the live engine; v0.3 changes the *primary node* and connects classify↔synthesize, it does not throw the engine away.
3. **The MVP net-new is the write path.** Read path is ~80% built (`brain_file_context`, eval infra, session digestion). The work is observe→approve→improve + re-keying context on Feature + the ETC/CVR harness — *not* brain plumbing.
4. **CVR is the sharpest discriminator.** Constraint-violation rate measures the *unique* value of feature context (right constraint at the right moment), not generic retrieval speed — protect it as the primary kill-switch metric.
5. **Pre-compute deterministically, let the LLM be an editor.** Classify structurally first (agency, candidate-type, fingerprint, file overlap); the LLM confirms/overrides. Cuts moment-detection from ~10 tasks to 2. Codify as a pipeline convention.
6. **Behavioral metadata is signal-dense per token; code diffs are unfakeable ground truth.** Engagement/initiative labels and CHANGE/REDIRECT/STRUGGLE diffs detect moments at ~60–100 tok/exchange vs ~375 for raw dialogue.
7. **Events are self-contained (denormalized, freeform category/tags, no enum/CHECK).** This is load-bearing for the write-side MCP path and is now a CLAUDE.md anti-pattern — preserve when adding `feature_id`.
8. **`brain_versions.commit_sha` is empty everywhere** — a real gap confirmed independently by three docs and the PRD. Brain has no code-version anchor today.
9. **Mental model, not changelog.** Every synthesized understanding must answer "what do I need to think about to work safely here?" not "what changed recently?"
10. **Star search before vector search.** Multi-path hit scoring (path + summary + observations) is cheap, deterministic, dependency-free, and the right first `brain.search` implementation.
11. **Sessions are private, brain is shared; brain evolves through versions, never regenerated.** Load-bearing separation; maps to Knowledge Deltas.
12. **Two-pass moment detection merge rules + chunking heuristics live only in one doc** (`execution-memory-design.md`) — knowledge fragility risk; mirror into code comments.

---

## 7. Recommendations for Iteration 1 — parallel worktree workstreams

Run **four** isolated worktree workstreams. They are deliberately decoupled by data boundary so they can land in parallel and converge at the harness.

**WS-A · Write path + MCP re-key (critical path).** P1 items 1–4 + 7 + 9: `feature_files` + `brain.enter` resolver, `featureContext()`, Feature understanding fields, write-side MCP tools (feature_id-attached), brain synthesis Topic→Feature, star-search `brain.search`/`brain.trace`. This is the spine of the v0.3 MVP. *Owner: strongest backend.*

**WS-B · Approval UI + Feature dashboard.** P1 items 5 + 8 + 10: pending-observation review queue, Feature detail panel, feature↔file map management UI, Topic→Feature vocabulary migration, retire `parent_topic_id`. Reuses the existing split-view/shadcn skeleton. Depends on WS-A's write-side schema contract only (coordinate the `activity_events` pending shape early). *Owner: frontend/full-stack.*

**WS-C · Measurement harness (the proof).** P1 item 6 standalone: encode 5 `TaskCriteria`, ETC extraction from session JSONL, CVR check, A/B runner, pre-registered pass bar + kill switch. **Build this in parallel from day 1** — per the repo's own EDD principle, the harness must exist before WS-A/B are declared "done," and a goal phrased "prove" cannot fail without it. Fully independent of A/B until the treatment arm runs. *Owner: eval-minded engineer.*

**WS-D · Pipeline hygiene (background, low-coupling).** Selected MVP-P2: `chunk.ts` regex→Haiku, duplicate-session prevention, promote winning organism, `pg_isready` timeout, observation dedup. These touch the digestion pipeline that feeds Feature evidence; they improve the substrate WS-A synthesizes from and carry near-zero merge conflict with A/B/C. *Owner: rotating / smallest slices.*

Sequencing note: WS-A and WS-C are the must-haves; WS-B is the human-gate that makes the loop real; WS-D raises evidence quality but must not block the harness. Hold all P2-alignment/P3 items (Knowledge Delta, embeddings, chromosome campaigns) until the ETC/CVR bar is met — do not build ontology ahead of the proof.
