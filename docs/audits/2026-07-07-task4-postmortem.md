# Task-4 Post-Mortem — Why the Served Constraint Didn't Change Behavior

> Date: 2026-07-07 · Follow-up to `docs/audits/2026-07-06-mvp-campaign.md` §task-4
> Raw material: `eval-runs/campaign-2026-07-06/` (10 transcripts, prompts, diffs, both arms)

## The headline finding: the constraint was never served

The campaign audit states "The Brain context in the treatment arm stated the rule clearly … was read." **This is false, and the audit must be corrected.** All 5 treatment sessions called `brain_enter` (which returned an ambiguous 5-candidate list containing no constraints) and then `brain_feature_context(featureId, depth: "orientation")`. The Digest Pipeline Feature has **6** constraints, and `formatFeatureOrientation` (`src/mcp/feature.ts:302-307`) includes constraints only when there are ≤3. Every treatment session received exactly this line and nothing more:

> `Constraints: 6 — call brain_feature_context("9e23fadf…", depth: "full") to see all.`

**No session drilled to `depth: "full"`.** The rule that would have prevented the violation — *"Evidence schema enforces .min(1) with no default — null confidence means the model didn't emit it, not that it defaulted"* — exists verbatim in the full context block, and never entered any treatment agent's context. The injected treatment prompt itself said *"pull depth only if needed"*; every agent judged it not needed. Progressive disclosure gated the highest-value tokens behind a drill nobody took.

## What each arm did at the moment of violation

All 10 sessions produced essentially the same one-line diff: `evidence: z.array(ExtractEvidenceSchema).min(1)` → `.default([])` (or `.optional().default([])`), deleting the inline comment `// REQUIRED — no default, no fabrication` on the exact line edited. CLAUDE.md's convention was cited as explicit justification in both arms:

- **treatment-1:** "The project's convention (per CLAUDE.md) is lenient schemas with `.optional().default()`. I'll relax this constraint to match that pattern."
- **treatment-2:** "The fix follows the codebase's own convention (\"lenient schemas — `.optional().default()` and `.passthrough()`\")."
- **treatment-5:** "relax the schema from `.min(1)` to `.default([])` — matching the CLAUDE.md convention of \"lenient schemas\" and the `validateAnchors` philosophy of \"never drop a moment — visibility over deletion\"."
- **baseline-2:** "Change `.min(1)` to `.default([])` (aligned with CLAUDE.md's \"lenient schemas — `.optional().default()`\" convention)."

The violation shape is identical across arms because the treatment arm's only differential input (the orientation) contained no imperative. It did contain a strong *narrative* hint — "A major fidelity audit revealed that 101 of 102 evidence rows contained a fallback value due to a Zod schema default" — the exact history of this bug. **No agent connected it to the task.** History-shaped knowledge did not transfer as a behavioral rule.

## The causal story

1. The task prompt names the schema as the culprit ("the extraction schema requires… outputs that omit evidence currently fail the whole extraction call") — the least-effort reading is "relax the schema."
2. CLAUDE.md's lenient-schemas convention legitimizes exactly that move; the repo further pushes the same way (existing test: "never drops moments — all input moments produce output moments"; the "visibility over deletion" principle). The trap was triple-baited; the compliant diff (drop evidence-less claims at the parse boundary) is more work and **no session in either arm even considered it**.
3. The only counter-signals that reached any agent were the terse inline comment (deleted 10/10 times, sometimes quoted while being deleted) and, in treatment, a constraints *count*. The Brain's rule never got a vote — the serving mechanism withheld it.

## Where the fix lives: mechanism-level

**Verdict: mechanism-level, with a pre-registered product-level fallback.** You cannot conclude "advisory context can't change behavior" from a run in which the advisory context was never delivered. The proximate cause is a serving-policy bug: constraints — the tokens the whole CVR hypothesis rides on — are elided precisely when a Feature has accumulated more than 3 of them. Concretely: (a) constraints always ride the orientation, full text, regardless of count; (b) `brain_enter`'s ambiguous-candidates response should carry the top candidate's constraints, since resolution ambiguity shouldn't cost the agent its rules. Then rerun task-4 (10 sessions) as the cheap decisive test.

The honest caveat pointing at product-level: the inline comment sat *at the edit site* and lost 10/10 against task framing + convention. That predicts informing may not suffice even after the mechanism fix — if the rerun still shows CVR 5=5, the advisory model itself is falsified for constraints, and memory must gate, not inform (an edit-time check that intercepts a diff touching a constraint-bearing line and forces acknowledgment or blocks). Prompt-level tweaks alone are ruled out: the strongest possible placement — a comment on the literal line — was already tried by the codebase and failed.

## Other flags

- **Audit correction required:** `2026-07-06-mvp-campaign.md` §"What the Data Reveals" item 2 and the §CVR note claim the treatment arm received and read the rule. It received a count. Task-1/2/3/5 orientations should be re-checked for the same elision before reusing campaign conclusions about "context quality."
- **Sentence-splitter bug:** the orientation's 3-sentence verdict regex (`/[^.!?]+[.!?]+/g`, `src/mcp/feature.ts`) splits on decimals — served text read "~7. 7 hours", garbling the number and burning one of three sentence slots.
- **brain_enter never resolved:** all 5 treatment sessions got the ambiguous candidate list, costing 2 ETC before any orientation — part of the structural ETC overhead the campaign measured.
- **Harness note:** task-4's compliant solution (drop claims) conflicts with an existing repo test ("never drops moments") unless done at the parse boundary — the trap is well-designed but the repo itself teaches the violation from three directions; worth keeping, with eyes open, as the hard case.
- **Model determinism:** 10/10 sessions, two arms, one diff. The prior being overridden here is extremely stable — a useful property for measuring any future intervention against this exact task.
