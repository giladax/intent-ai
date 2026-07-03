# Measurement v2 — ETC/CVR A/B Design (corrected)

> Status: accepted design · Date: 2026-07-03 · Supersedes the §Measurement harness design embedded in PRD v0.3 as of 2026-06-27 and the experimental *design* (not the scoring code) of commit `c7fab1e`.
> Companion: [`docs/prd.md`](../prd.md) §Measurement harness (binding rules), [`2026-07-03-brain-api-review.md`](./2026-07-03-brain-api-review.md).

## 1. What v1 got right (keep)

- Pre-registered pass bar + kill switch (`src/eval/mvp-eval.ts` — `PASS_BAR`, `KILL_SWITCH`, `evaluatePassBar`).
- Deterministic ETC extraction from session JSONL via the same adapter we digest with (`src/eval/transcript-metrics.ts`).
- `TaskCriteria` as hand-authored ground truth written before any run.
- Median + min/max reporting, per-(task × arm) aggregation.
- The insight that **CVR is the sharpest discriminator** — protect it.

The scoring math is reusable as-is. Everything below fixes the *design* it scores.

## 2. Why v1 was invalid (five findings)

| # | Finding | Evidence | Effect |
|---|---------|----------|--------|
| F1 | **Answer-in-prompt.** Tasks 2 & 4's discriminating constraints are verbatim in CLAUDE.md (freeform `category`/try-catch in §How-To and §Anti-Patterns; `.optional().default()` in §Conventions). CLAUDE.md is injected into **every baseline session's prompt** — not merely findable. | `mvp-task-criteria.ts:82,88,138` vs CLAUDE.md | Baseline CVR floor (≥2) structurally unreachable → pass bar cannot be met regardless of treatment quality. |
| F2 | **Answer-in-repo.** `src/eval/mvp-task-criteria.ts` is committed to the repo both arms explore; the answer key is greppable by task id. | commit `c7fab1e` | Contaminates both arms in either direction. |
| F3 | **Asymmetric exploration accounting.** `EXPLORATORY_TOOLS` excludes `mcp__intent-brain__*`; treatment agents swap Greps for brain calls at zero ETC cost. | `transcript-metrics.ts:21-30` | ETC measures *which tool namespace* explored, not how much exploration happened. |
| F4 | **CVR=0 hinges on one Haiku call.** All violations are judged by a single LLM pass over the diff; one false positive kills a true pass, one false negative fakes one. | `mvp-judge.ts` via `scoreSession` | The sharpest metric is also the most fragile. |
| F5 | **Hypothesis mismatch.** Treatment context (features, constraints, understanding) is hand-authored, so a pass proves "telling the agent the answer helps" — not that Brain can derive the answer. | PRD v0.3 Week-1 design ("manual feature management") | Even a clean pass would not derisk the product claim. |

Plus one process finding: **live collection was a stub owned by nobody** (`run-mvp-eval.ts:44` — `collectSession` throws). The mechanics that make it an experiment were the unbuilt 20%.

## 3. v2 design

### 3.1 Arms (unchanged in spirit)

- **Baseline:** Claude Code + `CLAUDE.md` + `.repo/brain.md`, Brain MCP disabled.
- **Treatment:** identical checkout + task, Brain MCP enabled, agent instructed to call `brain_enter(file|task)` first.
- Held constant: model, system prompt (minus the MCP toggle), temperature, base commit, permission mode.

### 3.2 Repos (two-repo design)

| Repo | Role | Precondition |
|---|---|---|
| `intent-ai` | Primary. Hard mode — strong baseline docs. | Fresh DB via `drizzle/0000_baseline.sql` (the legacy 0000–0007 chain was rebuilt 2026-07-03; wipe the old volume with `docker compose down -v` first); digest surviving sessions; seed Features; run the observe→approve loop to produce approved Observations. |
| `story-time` | Generalization arm. Representative mode — real CLAUDE.md (154 lines), no answer key, no harness. | Seed 5–10 real working sessions first (prior logs purged by ~30-day retention), digest them, then same loop. |

### 3.3 Provenance rule (fixes F5)

Treatment context must be **assembled, not authored**:

1. Sessions are digested normally (`digest`).
2. Observations arrive via the pipeline, `observe-events`, or agent write-tools — and are **human-approved** in the review UI.
3. `features.constraints` / `current_understanding` / `known_unknowns` may only contain lines that cite a session id or an approved observation id. A pre-run audit script verifies every line has provenance; hand-typed lines fail the audit and the run is invalid.
4. Feature *names* and the file↔Feature map remain manual (the PRD is explicit that resolution is a manual lookup — that's allowed; the *content* is not).

### 3.4 Task selection (fixes F1)

A candidate constraint is valid iff:

- It is real (violating it would genuinely be wrong in this repo), **and**
- `grep -i` of its key terms over **everything the baseline receives** (CLAUDE.md, `.repo/brain.md`, and any doc auto-injected into context) produces no statement of the rule, **and**
- It exists as an approved, session-derived Observation in Brain (per §3.3).

The natural source: mine approved Observations for constraints that *never made it into the docs* — that gap is exactly the product's value proposition, and it makes task selection honest by construction. v1's five tasks are retired; tasks 1/3/5's constraint *classes* (follow-the-pattern, no-joins, two-store-sync) remain good templates.

Task criteria live in this repo but are **excluded from the eval checkout** (§3.6).

### 3.5 Metrics (fixes F3, F4)

- **ETC v2** — information-gathering tool calls before first correct edit. `EXPLORATORY_TOOLS` gains every `mcp__intent-brain__*` read tool (`brain_enter`, `brain_search`, `brain_feature_context`, `brain_file_context`, legacy topic reads). Write tools (`brain_report_*`, `brain_rate_context`) don't count — they're not information-gathering.
- **Tokens-to-completion (co-primary)** — total input+output tokens from the session JSONL usage records. Catches "the served context is huge" — a 30% ETC win at 2× tokens is not a win.
- **CVR v2** — per constraint, a **deterministic structural check first** (regex/AST over the final diff is structural parsing — allowed by the repo's own anti-pattern rule):
  - enum/CHECK class → diff adds `pgEnum|CHECK|ALTER TABLE .* category`
  - try/catch class → new `emitEvents` call site not enclosed in try/catch (AST walk)
  - no-joins class → diff adds `innerJoin|leftJoin|JOIN` on the touched query path
  - pattern-following / two-store-sync classes → structural heuristic + **Haiku judge as tie-breaker only**, N=3 votes, majority
- **Success** — unchanged: reached correct edit ∧ `tsc --noEmit` ∧ targeted test ∧ correctness judge.
- **Self-report** (`brain_rate_context`) — recorded, plotted, **never feeds the pass bar** (same-model sycophancy).

### 3.6 Decontamination (fixes F2)

Each run executes in a fresh worktree at a pinned base commit with `src/eval/mvp-*`, `run-mvp-eval.ts`, and this spec **removed from the working tree** before the agent starts. Task prompts are injected at runtime, never read from disk.

### 3.7 Live collection (the unowned long pole, now owned)

Runner responsibilities per (task × arm × run):

1. Create decontaminated worktree at the pinned commit; `npm install` cache shared.
2. Launch headless Claude Code (`claude -p "<task goal>"`) with `--mcp-config` present (treatment) or absent (baseline); fixed model + permission mode.
3. On exit: record transcript JSONL path (from `~/.claude/projects/`), `git diff` of the worktree, `tsc --noEmit` result, targeted test result.
4. Append a `SessionInput` row to the manifest — the existing `run-mvp-eval.ts --manifest` scoring path then works unchanged.
5. Emit an `activity_event` per run (category `eval:run`) so eval runs appear on the Brain timeline.

### 3.8 Sample size & reporting

- N=5 per (task × arm) on the two sharpest-constraint tasks; N=3 on the rest → 42 sessions/repo.
- Report medians + **all raw values**; claim directional consistency (how many tasks moved the right way), not statistical significance. If the effect needs a t-test to see, it does not clear a 0.7× bar.

### 3.9 Pass bar & kill switch (pre-registered)

Ship iff **all**, per repo: median ETC ≤ 0.7× baseline on ≥3/5 tasks · baseline CVR ≥ 2 ∧ treatment CVR = 0 · treatment success ≥ baseline · treatment tokens ≤ 1.15× baseline.

Kill iff **any**: overall ETC reduction ≤ 10% · treatment CVR ≥ baseline · treatment success < baseline · treatment tokens > 1.5× baseline.

The primary repo (`intent-ai`) gates shipping; the generalization arm (`story-time`) gates the *claim* — a pass on intent-ai alone is reported as "works on a well-documented repo it was built in," nothing more.

## 4. Execution order

1. Apply `drizzle/0007` · seed Features on intent-ai · run **one** live treatment session end-to-end before building anything else.
2. Digest + approve loop until Features carry provenance-clean content (§3.3 audit passes).
3. Re-draw 5 tasks under §3.4; hold outside eval checkout.
4. Patch `transcript-metrics.ts` (ETC v2, tokens) + deterministic CVR checks; keep `evaluatePassBar` shape, add token criterion.
5. Build the runner (§3.7). 6. Seed story-time sessions in parallel. 7. Run, report, decide.

## 5. Open questions

- Does `claude -p` headless mode give deterministic-enough permission behavior for unattended runs, or do runs need `--permission-mode acceptEdits` + a sandbox?
- Minimum approved-observation count per Feature before its context is worth serving (guess: ≥3) — measure, don't assume.
- Whether the story-time seeding sessions bias the task set (the person seeding also picks tasks) — mitigate by drawing tasks from a third person or from story-time's issue list if one exists.
