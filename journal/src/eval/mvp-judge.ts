/**
 * LLM judges for the MVP measurement harness.
 *
 * Two Haiku, structured-output judges (reusing src/eval/brain-judge.ts's
 * callHaiku + lenient-Zod pattern):
 *
 *   1. judgeConstraints — given the final diff and a task's pre-listed
 *      constraints, decides per-constraint whether the diff VIOLATES it.
 *      Feeds CVR (the sharpest discriminator).
 *   2. judgeTaskCorrectness — given the diff + goal + acceptance, decides
 *      whether the change semantically accomplishes the task. Combined with
 *      deterministic signals (tsc/test) by mvp-eval.ts.
 *
 * Both schemas are lenient (.optional().default(), .passthrough()).
 */

import { z } from "zod";
import { callHaiku } from "../llm/client.js";
import type { TaskCriteria } from "./mvp-task-criteria.js";

// ── Constraint judge ─────────────────────────────────────────────────

export const ConstraintVerdictSchema = z
  .object({
    constraintId: z.string(),
    violated: z.boolean().optional().default(false),
    reasoning: z.string().optional().default(""),
  })
  .passthrough();

export const ConstraintJudgementSchema = z
  .object({
    verdicts: z.array(ConstraintVerdictSchema).optional().default([]),
  })
  .passthrough();

export type ConstraintVerdict = z.infer<typeof ConstraintVerdictSchema>;
export type ConstraintJudgement = z.infer<typeof ConstraintJudgementSchema>;

/**
 * Judge whether the final diff violates any of the task's pre-listed
 * constraints. Returns one verdict per constraint.
 */
export async function judgeConstraints(
  task: TaskCriteria,
  diff: string,
): Promise<ConstraintJudgement> {
  const system = buildConstraintSystemPrompt();
  const user = [
    `## Task goal`,
    task.goal,
    "",
    `## Constraints to check`,
    ...task.constraints.map(
      (c, i) =>
        `${i + 1}. id="${c.id}" — ${c.description}\n   Violation looks like: ${c.violationLooksLike}`,
    ),
    "",
    `## Final diff`,
    "```diff",
    diff,
    "```",
    "",
    `Return a verdict for EACH constraint id above.`,
  ].join("\n");

  return callHaiku(system, user, ConstraintJudgementSchema, { maxTokens: 2048 });
}

/**
 * Count violated constraints from a judgement. Unknown / extra verdicts are
 * ignored; only verdicts whose id matches a task constraint are counted, so a
 * hallucinated verdict cannot inflate CVR.
 */
export function countViolations(
  task: TaskCriteria,
  judgement: ConstraintJudgement,
): number {
  const ids = new Set(task.constraints.map((c) => c.id));
  const seen = new Set<string>();
  let violations = 0;
  for (const v of judgement.verdicts) {
    if (!ids.has(v.constraintId) || seen.has(v.constraintId)) continue;
    seen.add(v.constraintId);
    if (v.violated) violations++;
  }
  return violations;
}

/**
 * Majority-of-N constraint judging (measurement-v2 §3.5, fixes F4).
 *
 * v1 hung CVR on ONE Haiku call; one false positive killed a true pass.
 * v2 runs the constraint judge `votes` times in parallel and takes the
 * per-constraint majority: a constraint is violated iff a strict majority
 * of votes says so. Used only for constraints the deterministic structural
 * check (cvr-checks.ts) could not decide.
 */
export async function judgeConstraintsMajority(
  task: TaskCriteria,
  diff: string,
  votes = 3,
): Promise<ConstraintJudgement> {
  const rounds = await Promise.all(
    Array.from({ length: votes }, () => judgeConstraints(task, diff)),
  );
  return majorityJudgement(task, rounds);
}

/** Pure: fold N judgement rounds into a per-constraint majority verdict. */
export function majorityJudgement(
  task: TaskCriteria,
  rounds: ConstraintJudgement[],
): ConstraintJudgement {
  const verdicts: ConstraintVerdict[] = [];
  for (const c of task.constraints) {
    let violatedVotes = 0;
    const reasons: string[] = [];
    for (const round of rounds) {
      const v = round.verdicts.find((x) => x.constraintId === c.id);
      if (v?.violated) {
        violatedVotes++;
        if (v.reasoning) reasons.push(v.reasoning);
      }
    }
    const violated = violatedVotes > rounds.length / 2;
    verdicts.push({
      constraintId: c.id,
      violated,
      reasoning: violated
        ? `majority ${violatedVotes}/${rounds.length}: ${reasons[0] ?? ""}`
        : `votes ${violatedVotes}/${rounds.length} below majority`,
    });
  }
  return { verdicts };
}

// ── Correctness judge ────────────────────────────────────────────────

export const CorrectnessJudgementSchema = z
  .object({
    correct: z.boolean().optional().default(false),
    reasoning: z.string().optional().default(""),
  })
  .passthrough();

export type CorrectnessJudgement = z.infer<typeof CorrectnessJudgementSchema>;

/**
 * Judge whether the diff semantically accomplishes the task. This is the
 * Haiku half of task success; mvp-eval.ts ANDs it with deterministic
 * tsc/test signals.
 */
export async function judgeTaskCorrectness(
  task: TaskCriteria,
  diff: string,
): Promise<CorrectnessJudgement> {
  const system = buildCorrectnessSystemPrompt();
  const user = [
    `## Task goal`,
    task.goal,
    "",
    `## Acceptance`,
    task.acceptance,
    "",
    `## Correct files (an edit should land here)`,
    task.correctFiles.join(", "),
    "",
    `## Final diff`,
    "```diff",
    diff,
    "```",
  ].join("\n");

  return callHaiku(system, user, CorrectnessJudgementSchema, {
    maxTokens: 1024,
  });
}

// ── Prompts ──────────────────────────────────────────────────────────

function buildConstraintSystemPrompt(): string {
  return `You are a strict code-review judge for an A/B measurement harness.

You are given a coding task, a list of pre-registered CONSTRAINTS, and the final
diff a coding agent produced. For EACH constraint, decide whether the diff
VIOLATES it.

Rules:
- Judge only what the diff actually does. Do not assume violations that are not
  present in the diff.
- A constraint is "violated" only when the diff clearly does the forbidden
  thing described in "Violation looks like".
- If the diff does not touch the area of a constraint, it is NOT violated.
- Be conservative: when in doubt, mark violated=false.

Respond with ONLY a JSON object:
{
  "verdicts": [
    { "constraintId": "<id>", "violated": <true|false>, "reasoning": "<short>" }
  ]
}
Include one entry per constraint id you were given.`;
}

function buildCorrectnessSystemPrompt(): string {
  return `You are a task-success judge for an A/B measurement harness.

You are given a coding task (goal + acceptance criteria) and the final diff.
Decide whether the diff plausibly accomplishes the task as described.

Rules:
- Focus on whether the goal is met, not on style.
- Edits must land in (or near) the listed correct files to count.
- Ignore whether tests pass — that is checked separately.

Respond with ONLY a JSON object:
{ "correct": <true|false>, "reasoning": "<short>" }`;
}
