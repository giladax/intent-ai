# MVP 42-Session Campaign — Pre-Registered Results

> Date: 2026-07-06/07 · Branch: `feat/repo-brain` · Campaign operator: Claude Fable 5
> Pre-registration: `docs/audits/2026-07-04-mvp-pilot.md` §4 (frozen before run)
> Base commit: `3446a056` (HEAD at campaign start; 9 pre-existing tsc errors confirmed)
> Run dir: `eval-runs/campaign-2026-07-06/` (git-ignored; 38 sessions, 38 manifested)
> Scoring pipeline: `run-mvp-eval.ts --manifest` (deterministic-first CVR + Haiku majority-of-3)

## Verdict

**KILL SWITCH TRIGGERED. SHIP: NO.**

The pre-registered pass bar is not met. Both kill-switch conditions fired:
1. Overall ETC reduction = **−57.1%** (treatment is slower, not faster; kill threshold is ≤10% reduction)
2. Treatment CVR (10) = Baseline CVR (10): no constraint-violation separation

This is an honest NULL result. It is not a harness failure — the decontamination, isolation, and scoring machinery worked as designed. The null result is informative: see §5 for what it reveals.

## Session Count Note

The pre-registration states "42 sessions." The arithmetic of the design table yields 38:
- task-2: 5×2=10; task-4: 5×2=10; task-1: 3×2=6; task-3: 3×2=6; task-5: 3×2=6 → total 38.

The discrepancy of 4 is unresolved (possibly the two pilot sessions were double-counted, or a draft design had higher N). The campaign ran 38 sessions — the exact counts specified per task in the pre-registration. All task-level specifications were honored exactly.

## Collection Summary

All 38 sessions completed without retry. Zero session failures. Zero kill-switch triggers during collection (the runner's kill switch fires on scoring, not collection).

| Task | Arm | N | tsc=true | test=true | Wall-clock range |
|------|-----|---|----------|-----------|-----------------|
| task-1 | baseline | 3 | 3/3 | 3/3 | 52–53s |
| task-1 | treatment | 3 | 3/3 | 3/3 | 72–84s |
| task-2 | baseline | 5 | 5/5 | 5/5 | 138–228s |
| task-2 | treatment | 5 | 5/5 | 5/5 | 98–208s |
| task-3 | baseline | 3 | 3/3 | 3/3 | 170–266s |
| task-3 | treatment | 3 | 3/3 | 3/3 | 182–210s |
| task-4 | baseline | 5 | 5/5 | 5/5 | 131–220s |
| task-4 | treatment | 5 | 5/5 | 5/5 | 102–162s |
| task-5 | baseline | 3 | 3/3 | 3/3 | 35–41s |
| task-5 | treatment | 3 | 3/3 | 3/3 | 37–44s |

tsc gate: baseline-relative (no net-new errors). All sessions: tsc=true, test=true at capture.

## Per-Task Per-Arm Raw Results

### task-1 (strong — MCP Server)

ETC: baseline 3/3/2, treatment 5/5/4 (median ratio 1.67×)
CVR: baseline 0, treatment 0 (all 6 sessions deterministic)
Success: baseline 3/3, treatment 3/3
Tokens: baseline 4510/4599/4672, treatment 6170/5655/5338

Constraint breakdown (all deterministic):
- `instrument-mcp-read`: ok in all 6 sessions (both arms correctly called emitRead)
- `no-new-transport`: ok in all 6 sessions

Note: Treatment ETC is 1.67× baseline. The brain_enter + brain_feature_context calls cost ETC but added no constraint-avoidance benefit (the constraint was already met by both arms). The treatment arm spent more exploratory calls consulting the Brain before implementing a straightforward MCP tool addition.

### task-2 (strong — Activity Event Backbone)

ETC: baseline 4/3/4/5/4 median=4, treatment 6/7/4/4/6 median=6 (ratio 1.50×)
CVR: baseline 0, treatment 0 (all 10 sessions deterministic)
Success: baseline 5/5, treatment 5/5
Tokens: baseline med≈14251, treatment med≈11073 (0.78× — tokens lower despite higher ETC)

Constraint breakdown (all deterministic):
- `occurred-time-not-digest-time`: ok in all 10 sessions
- `source-backrefs`: ok in all 10 sessions

Pre-registered concern confirmed: emit-events.ts itself models both constraints (every existing event uses sessionTs and carries sourceType/sourceId), so the baseline agent followed the local pattern. Zero CVR separation — exactly as the pilot shakeout predicted.

### task-3 (strong — Storage Schema)

ETC: baseline 2/2/2 median=2, treatment 4/4/3 median=4 (ratio 2.00×)
CVR: baseline 0, treatment 0 (no-out-of-band-ddl deterministic; schema-ts-source-of-truth judge)
Success: baseline 0/3, treatment 0/3 (ALL sessions success=false)
Tokens: baseline med≈19731, treatment med≈15117

**Task-3 null finding — pre-existing implementation:** All 6 sessions (both arms) correctly identified that the `idx_ae_category` index already exists in `src/storage/schema.ts` and `drizzle/0000_baseline.sql`. The agents made no changes (empty diffs) and reported the task already done. `success=false` because `reachedCorrectEdit=false` (no files touched). This is correct agent behavior — the task was already implemented in the codebase before the campaign. The `schema-ts-source-of-truth` constraint was assessed by the judge (Haiku majority-of-3) as "ok" since neither arm violated it.

**Impact on analysis:** task-3 contributes 0 ETC to both arms (both agents stopped immediately), making ETC comparison meaningless for this task. It does not contribute CVR signal. Reported as required; excluded from ETC criterion reasoning.

### task-4 (strong — Digest Pipeline, sharpest discriminator)

ETC: baseline 5/5/5/4/4 median=5, treatment 6/6/8/6/7 median=6 (ratio 1.20×)
CVR: baseline 10 violations, treatment 10 violations
Success: baseline 0/5, treatment 0/5 (ALL sessions success=false)
Tokens: baseline med≈12726, treatment med≈9587 (0.75×)

Constraint breakdown:
- `no-evidence-defaults` (deterministic): VIOLATED in all 10 sessions (both arms)
  - Both arms added `.default([])` (baseline) or `.optional().default([])` (treatment) to the evidence field — exactly the violation described in `violationLooksLike`.
- `drop-dont-fabricate` (judge, Haiku majority-of-3): VIOLATED in all 10 sessions (both arms)
  - Both arms relied on empty-array default rather than filtering/dropping claims without evidence.

**The sharpest discriminator failed to discriminate.** CLAUDE.md's lenient-Zod convention actively pushed baseline toward the default-evidence pattern (as pre-registered). The Brain context in the treatment arm stated the rule clearly, but the treatment agent followed the same pattern anyway. Treatment CVR = baseline CVR = 10.

The off-feature contamination tracking: no treatment session produced a context that mixed off-feature moments detectably (the Feature resolution was correct), so contamination is not a confound here. The null result is genuine.

### task-5 (weak — CLI, coverage control)

ETC: baseline 1/2/1 median=1, treatment 2/2/2 median=2 (ratio 2.00×)
CVR: baseline 0, treatment 0
Success: baseline 3/3, treatment 3/3
Tokens: baseline med≈3640, treatment med≈3215 (0.88×)

Pre-registered prediction: ETC ratio ≈ 1.0, no CVR separation. Actual: ETC ratio 2.0×, CVR tie. Treatment ETC was worse (2× baseline) — consistent with the pattern across all tasks where brain_enter adds overhead without benefit. No CVR difference, confirming the coverage-control prediction holds for CVR. The ETC overhead is steeper than predicted.

## Stratified Pass-Bar Analysis (Strong Stratum Only)

Per the pre-registration (binding), pass bar evaluates the strong stratum (task-1/2/3/4) only.

### ETC Criterion (≥3 of 4 strong tasks at ≤0.7× baseline median)

| Task | Baseline ETC median | Treatment ETC median | Ratio | ≤0.7×? |
|------|--------------------|--------------------|-------|--------|
| task-1 | 3 | 5 | 1.67× | FAIL |
| task-2 | 4 | 6 | 1.50× | FAIL |
| task-3 | 2 | 4 | 2.00× | FAIL |
| task-4 | 5 | 6 | 1.20× | FAIL |

**ETC criterion: FAIL (0/4 tasks meet ≤0.7×)**

Overall ETC reduction: −57.1% (treatment used MORE exploratory calls on net). Kill switch fires on this alone (threshold: ≤10% reduction).

### CVR Criterion (baseline CVR ≥2 total AND treatment CVR = 0 total)

| Task | Baseline CVR | Treatment CVR |
|------|-------------|--------------|
| task-1 | 0 | 0 |
| task-2 | 0 | 0 |
| task-3 | 0 | 0 |
| task-4 | 10 | 10 |

Strong stratum totals: baseline=10, treatment=10.

**CVR criterion: FAIL** (treatment CVR (10) = baseline CVR (10) — no separation; kill switch condition 2).

Note on baseline CVR floor: The pre-registered concern was that local code teaches the constraint. This was confirmed for task-2 (emit-events.ts models both rules) and task-3 (index already exists). Only task-4 produced baseline violations. The treatment arm received the Brain's rule for task-4 but violated it anyway — the honest conclusion is that the served constraint context was insufficient to override the agent's prior.

### Success Criterion (treatment success ≥ baseline)

Strong stratum: baseline success = 8 (task-1: 3, task-2: 5, task-3: 0, task-4: 0), treatment success = 8 (same).

**Success criterion: PASS (treatment 8 = baseline 8)**

### Token Co-Primary (treatment ≤1.15× baseline pooled median)

Pooled strong-stratum median tokens: baseline≈12726, treatment≈9587. Ratio: **0.77×**.

**Token criterion: PASS** (0.77 ≤ 1.15; kill threshold >1.5 not triggered).

### Overall Pass Bar (ALL must pass)

ETC: FAIL | CVR: FAIL | Success: PASS | Tokens: PASS

**Pass bar: NOT MET. SHIP: NO.**

Kill switch triggered:
1. ETC reduction = −57.1% ≤ 10%
2. treatment CVR (10) ≥ baseline CVR (10)

## Weak Stratum (Coverage Control — Reported, Never Gated)

task-5 (CLI, no Feature): ETC 1→2 (2.0×), CVR 0→0, success 3/3→3/3

Pre-registered prediction: "ETC ratio ≈ 1.0, no CVR separation." CVR prediction holds; ETC prediction was wrong in direction (expected neutral, got worse). Treatment was slower even on the null task — consistent with the pattern that brain_enter overhead persists even when the context is unhelpful.

**Coverage-control signal:** The weak-task ETC degradation is in the same direction and magnitude as the strong tasks (2.0× vs 1.67×/1.50×/2.00×/1.20×). This suggests the ETC overhead is structural (brain_enter costs exploratory calls regardless of context quality), not feature-specific. If the weak task showed a treatment BENEFIT comparable to strong tasks, the mechanism claim would be suspect; instead, the weak task confirms the null — brain context is not helping any task.

## Kill Switch Disposition

Both kill-switch conditions fired on scoring. Per the pre-registration, the campaign stops and the PRD's measurement claim is evaluated against this evidence.

**Kill switch 1:** ETC reduction ≤ 10%. Treatment median ETC was HIGHER than baseline on all 4 strong tasks and the weak task. No session, in any task or arm, showed a below-0.7× ETC. The brain_enter overhead costs 2–3 exploratory tool-calls per session; the brain never returned this investment.

**Kill switch 2:** Treatment CVR ≥ baseline CVR. The only CVR signal came from task-4, where both arms violated both constraints equally. The Brain context did not prevent constraint violations — it did not improve agent adherence to the served rules.

## What the Data Reveals (Honest Interpretation)

The experiment answered its question honestly:

1. **Feature-aware context does not reduce exploratory tool-calls.** The treatment arm's brain_enter + brain_feature_context calls cost overhead without offsetting gains. Agents did not reduce their codebase exploration after Brain orientation — they explored the same amount AND did Brain calls on top. The mechanism assumption (brain_enter substitutes for file exploration) was not observed.

2. **Feature-aware context does not prevent constraint violations when the agent's priors are strong.** Task-4's CLAUDE.md convention actively pushed toward the violation; the served Brain constraint was not sufficient to override it. The Brain context was read (the treatment transcripts confirm brain_enter was called), but did not change the agent's Zod schema choices.

3. **Local code pattern teaches constraints better than Brain context, for tasks 1/2.** Where the existing codebase followed the rules, both arms got it right. Where the convention pushed the wrong direction (task-4), neither arm got it right.

4. **Token efficiency is a real signal.** The treatment arm used 0.77× baseline tokens on the strong stratum despite more ETC calls. The Brain context compresses exploration (agents found answers faster in fewer tokens) even if it doesn't reduce call counts. This is a real effect that a different metric would capture.

5. **task-3 is a design fault.** The index was already implemented. The task should have been replaced before the full run; it wasn't caught in decontamination because decontamination screens baseline docs, not the repo code itself. This is an honest design fault recorded openly.

## PRD Claim Evaluation

The Brain PRD v0.3, §Measurement, states: "feature-aware context measurably improves coding-agent performance."

**This campaign does not support that claim as operationalized.** The specific hypotheses tested:
- Feature-aware context reduces exploratory tool-calls (ETC) by ≥30% on ≥3 strong tasks: **not observed**
- Feature-aware context prevents constraint violations (CVR=0 with baseline CVR≥2): **not observed**

The token efficiency signal (0.77×) is real but was not the primary hypothesis and does not satisfy the pre-registered pass bar.

**Decision per PRD:** The MVP claim does not stand on this evidence. Next steps are a design question, not a measurement question:
- Does the intervention need redesign (brain context delivery mechanism, how orientation is framed)?
- Is the mechanism wrong (Brain context can't overcome strong priors — needs different tasks or weaker baselines)?
- Is token efficiency the right primary metric going forward?

These are decisions for the PRD iteration, not this operator.

## Failures, Retries, Attrition

Zero session failures. Zero retries. Zero attrition. All 38 sessions completed on first attempt.

Known issues recorded:
1. **task-3 was already implemented** — all 6 sessions correctly identified this; success=false is mechanically correct (no edit) but the task itself was a design fault (implementation existed in the repo). Reported honestly, not excluded.
2. **Session count discrepancy** — pre-registration says 42, arithmetic yields 38. Campaign ran 38 per the per-task specifications. Discrepancy not resolved.

## Cost Estimate

Token totals from transcripts (agent-side only; MCP server uses DB lookups, no LLM calls):

| Task | Stratum | N | Approx total tokens |
|------|---------|---|---------------------|
| task-1 | strong | 6 | ~30k |
| task-2 | strong | 10 | ~136k |
| task-3 | strong | 6 | ~112k |
| task-4 | strong | 10 | ~124k |
| task-5 | weak   | 6 | ~20k |
| **Total** | | **38** | **~422k** |

This is substantially less than the 1.3M pre-registered estimate (which assumed longer sessions). Actual wall-clock: approximately 2.5 hours total. Actual API cost: estimated $0.50–$1.50 at Sonnet rates (422k tokens × $3/1M input + $15/1M output rough mix).

## Artifacts

All artifacts in `eval-runs/campaign-2026-07-06/` (git-ignored):
- `manifest.json` — 38 SessionInput records
- `transcript-<label>.jsonl` — full Claude Code session transcript per session
- `diff-<label>.patch` — agent-only diff per session (decontaminated checkout, agent changes only)
- `prompt-<label>.txt` — injected prompt per session (both arms)
- `stdout-<label>.txt`, `stderr-<label>.txt` — runner capture per session

Judge provenance: all CVR verdicts carry `decidedBy: deterministic | judge`. Task-3's `schema-ts-source-of-truth` and task-1/5's `reuse-events-query-path`/`no-new-transport` were judge-decided; all task-4 and task-2 verdicts were deterministic.

## Operator Log

Full session-by-session log: `.superpowers/sdd/campaign-operator-log.md`

---

## Correction Note (2026-07-07)

**The interpretation in §"What the Data Reveals" item 2 and §"Per-Task Per-Arm Raw Results" §task-4 is factually wrong and must not be cited as evidence that "advisory context can't change behavior."**

Specifically, this claim is false:

> "The Brain context in the treatment arm stated the rule clearly … The Brain context was read (the treatment transcripts confirm brain_enter was called), but did not change the agent's Zod schema choices."

**What actually happened:** All 5 treatment sessions called `brain_enter` (which returned an ambiguous 5-candidate list) and then `brain_feature_context(featureId, depth: "orientation")`. The Digest Pipeline Feature has **6** constraints. `formatFeatureOrientation` in `src/mcp/feature.ts` (lines 302–307 at the time of the campaign) included constraints only when there were ≤3. Every treatment session received exactly this line and nothing more:

> `Constraints: 6 — call brain_feature_context("9e23fadf…", depth: "full") to see all.`

**No session drilled to `depth: "full"`.** The constraint that would have prevented the violation — *"Evidence schema enforces .min(1) with no default — null confidence means the model didn't emit it, not that it defaulted"* — was never in any treatment agent's context. The treatment arm did not receive the rule; it received a count. The campaign's null result on CVR tested **serving-that-didn't-serve**, not the advisory-context hypothesis.

**Fix applied 2026-07-07:** `formatFeatureOrientation` was corrected — all constraints now ride the orientation unconditionally regardless of count. The decimal-splitting sentence-splitter bug was also fixed. See commit `e06a556` and `docs/audits/2026-07-07-task4-postmortem.md` for the full causal analysis.

**Rerun (task-4 only, 5+5 sessions, 2026-07-07):** The rerun results with the fixed serving mechanism are appended below under §Task-4 Rerun Results once available.
