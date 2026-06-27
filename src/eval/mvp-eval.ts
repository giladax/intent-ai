/**
 * MVP measurement A/B evaluation engine (Brain PRD v0.3, §Measurement harness).
 *
 * Two arms — `baseline` (Brain MCP disabled, repo docs only) and `treatment`
 * (Brain MCP enabled, agent calls brain.enter first) — over the 5 pre-registered
 * tasks, N runs each. We score each session into:
 *
 *   ETC — exploratory tool-calls to first correct edit (efficiency)
 *   CVR — constraint-violation count (the sharpest discriminator)
 *   success — task accomplished (tsc + targeted test + Haiku judge)
 *
 * then aggregate to per-task / per-arm stats and evaluate the PRE-REGISTERED
 * pass bar and kill switch. All functions here are deterministic and pure so
 * the harness mechanics can be unit-tested without any live A/B run.
 */

import type { TaskCriteria } from "./mvp-task-criteria.js";
import {
  computeETC,
  extractToolCallsFromFile,
  type EtcResult,
} from "./transcript-metrics.js";
import {
  judgeConstraints,
  countViolations,
  judgeTaskCorrectness,
} from "./mvp-judge.js";

export type Arm = "baseline" | "treatment";

/** Pre-registered pass-bar thresholds (PRD §Measurement harness). */
export const PASS_BAR = {
  /** treatment ETC must be <= this fraction of baseline ETC, per task */
  etcRatio: 0.7,
  /** ...on at least this many of the 5 tasks */
  etcTasksRequired: 3,
  /** baseline must show at least this many total violations for CVR=0 to mean something */
  baselineCvrFloor: 2,
} as const;

/** Kill-switch thresholds (PRD §Kill switch). */
export const KILL_SWITCH = {
  /** overall ETC reduction at or below this fraction => kill */
  minEtcReduction: 0.1,
} as const;

// ── Per-session input + score ────────────────────────────────────────

/**
 * One recorded A/B run. `transcriptPath` is the Claude Code session JSONL;
 * `diff` is the final working-tree diff; `tscPassed`/`testPassed` are the
 * deterministic acceptance signals captured by the runner.
 */
export interface SessionInput {
  taskId: string;
  arm: Arm;
  run: number;
  transcriptPath: string;
  diff: string;
  tscPassed: boolean;
  testPassed: boolean;
}

export interface SessionScore {
  taskId: string;
  arm: Arm;
  run: number;
  etc: number;
  reachedCorrectEdit: boolean;
  violations: number;
  success: boolean;
  etcDetail: EtcResult;
}

/**
 * Score a single recorded session: deterministic ETC + Haiku CVR/correctness.
 * Task success = reached a correct edit AND tsc passed AND targeted test
 * passed AND the correctness judge agrees.
 */
export async function scoreSession(
  task: TaskCriteria,
  input: SessionInput,
): Promise<SessionScore> {
  const toolCalls = await extractToolCallsFromFile(input.transcriptPath);
  const etcDetail = computeETC(toolCalls, task.correctFiles);

  const constraintJudgement = await judgeConstraints(task, input.diff);
  const violations = countViolations(task, constraintJudgement);

  const correctness = await judgeTaskCorrectness(task, input.diff);

  const success =
    etcDetail.reachedCorrectEdit &&
    input.tscPassed &&
    input.testPassed &&
    correctness.correct;

  return {
    taskId: input.taskId,
    arm: input.arm,
    run: input.run,
    etc: etcDetail.etc,
    reachedCorrectEdit: etcDetail.reachedCorrectEdit,
    violations,
    success,
    etcDetail,
  };
}

// ── Aggregation ──────────────────────────────────────────────────────

export interface TaskArmStats {
  taskId: string;
  arm: Arm;
  n: number;
  etcValues: number[];
  etcMedian: number;
  etcMin: number;
  etcMax: number;
  /** total violations across this task's runs in this arm */
  cvrTotal: number;
  successCount: number;
  successRate: number;
}

export interface ArmTotals {
  arm: Arm;
  cvrTotal: number;
  successCount: number;
  n: number;
}

export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Aggregate raw session scores into per-(task, arm) statistics. */
export function aggregate(scores: SessionScore[]): TaskArmStats[] {
  const groups = new Map<string, SessionScore[]>();
  for (const s of scores) {
    const key = `${s.taskId}::${s.arm}`;
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }

  const stats: TaskArmStats[] = [];
  for (const [key, list] of groups) {
    const [taskId, arm] = key.split("::") as [string, Arm];
    const etcValues = list.map((s) => s.etc);
    const successCount = list.filter((s) => s.success).length;
    stats.push({
      taskId,
      arm,
      n: list.length,
      etcValues,
      etcMedian: median(etcValues),
      etcMin: Math.min(...etcValues),
      etcMax: Math.max(...etcValues),
      cvrTotal: list.reduce((sum, s) => sum + s.violations, 0),
      successCount,
      successRate: list.length ? successCount / list.length : 0,
    });
  }
  return stats;
}

export function armTotals(stats: TaskArmStats[], arm: Arm): ArmTotals {
  const armStats = stats.filter((s) => s.arm === arm);
  return {
    arm,
    cvrTotal: armStats.reduce((sum, s) => sum + s.cvrTotal, 0),
    successCount: armStats.reduce((sum, s) => sum + s.successCount, 0),
    n: armStats.reduce((sum, s) => sum + s.n, 0),
  };
}

// ── Pass bar + kill switch ───────────────────────────────────────────

export interface TaskComparison {
  taskId: string;
  baselineEtcMedian: number;
  treatmentEtcMedian: number;
  /** treatment / baseline; Infinity if baseline is 0 and treatment > 0 */
  etcRatio: number;
  etcImproved: boolean;
  baselineCvr: number;
  treatmentCvr: number;
  baselineSuccess: number;
  treatmentSuccess: number;
}

export interface PassBarResult {
  perTask: TaskComparison[];
  etcImprovedTasks: string[];
  etcCriterionMet: boolean;
  cvrCriterionMet: boolean;
  successCriterionMet: boolean;
  /** overall median-ETC reduction: 1 - (treatmentMedian / baselineMedian) */
  overallEtcReduction: number;
  baselineCvrTotal: number;
  treatmentCvrTotal: number;
  baselineSuccessTotal: number;
  treatmentSuccessTotal: number;
  pass: boolean;
  killSwitch: { triggered: boolean; reasons: string[] };
}

/** ratio = treatment / baseline, with safe handling of zero baselines. */
function etcRatio(baseline: number, treatment: number): number {
  if (baseline === 0) return treatment === 0 ? 1 : Infinity;
  return treatment / baseline;
}

/**
 * Evaluate the pre-registered pass bar and kill switch over aggregated stats.
 *
 * Pass (ship) iff ALL of:
 *   - median ETC <= 0.7x baseline on >= 3/5 tasks
 *   - baseline CVR >= 2 total AND treatment CVR == 0 total
 *   - treatment success total >= baseline success total (no regression)
 *
 * Kill switch (do NOT ship) if ANY of:
 *   - overall ETC reduction <= 10%
 *   - treatment CVR >= baseline CVR
 *   - treatment success < baseline success
 */
export function evaluatePassBar(stats: TaskArmStats[]): PassBarResult {
  const taskIds = [...new Set(stats.map((s) => s.taskId))].sort();
  const byKey = new Map(stats.map((s) => [`${s.taskId}::${s.arm}`, s]));

  const perTask: TaskComparison[] = [];
  for (const taskId of taskIds) {
    const base = byKey.get(`${taskId}::baseline`);
    const treat = byKey.get(`${taskId}::treatment`);
    const baselineEtcMedian = base?.etcMedian ?? 0;
    const treatmentEtcMedian = treat?.etcMedian ?? 0;
    const ratio = etcRatio(baselineEtcMedian, treatmentEtcMedian);
    perTask.push({
      taskId,
      baselineEtcMedian,
      treatmentEtcMedian,
      etcRatio: ratio,
      etcImproved: ratio <= PASS_BAR.etcRatio,
      baselineCvr: base?.cvrTotal ?? 0,
      treatmentCvr: treat?.cvrTotal ?? 0,
      baselineSuccess: base?.successCount ?? 0,
      treatmentSuccess: treat?.successCount ?? 0,
    });
  }

  const etcImprovedTasks = perTask
    .filter((t) => t.etcImproved)
    .map((t) => t.taskId);
  const etcCriterionMet =
    etcImprovedTasks.length >= PASS_BAR.etcTasksRequired;

  const baseTotals = armTotals(stats, "baseline");
  const treatTotals = armTotals(stats, "treatment");

  const cvrCriterionMet =
    baseTotals.cvrTotal >= PASS_BAR.baselineCvrFloor &&
    treatTotals.cvrTotal === 0;

  const successCriterionMet =
    treatTotals.successCount >= baseTotals.successCount;

  // Overall ETC reduction from pooled medians across tasks.
  const baselineMedians = perTask.map((t) => t.baselineEtcMedian);
  const treatmentMedians = perTask.map((t) => t.treatmentEtcMedian);
  const pooledBaseline = median(baselineMedians);
  const pooledTreatment = median(treatmentMedians);
  const overallEtcReduction =
    pooledBaseline === 0 ? 0 : 1 - pooledTreatment / pooledBaseline;

  const pass = etcCriterionMet && cvrCriterionMet && successCriterionMet;

  // Kill switch
  const reasons: string[] = [];
  if (overallEtcReduction <= KILL_SWITCH.minEtcReduction) {
    reasons.push(
      `ETC reduction ${(overallEtcReduction * 100).toFixed(1)}% <= ${KILL_SWITCH.minEtcReduction * 100}%`,
    );
  }
  if (treatTotals.cvrTotal >= baseTotals.cvrTotal) {
    reasons.push(
      `treatment CVR (${treatTotals.cvrTotal}) >= baseline CVR (${baseTotals.cvrTotal})`,
    );
  }
  if (treatTotals.successCount < baseTotals.successCount) {
    reasons.push(
      `treatment success (${treatTotals.successCount}) < baseline success (${baseTotals.successCount})`,
    );
  }

  return {
    perTask,
    etcImprovedTasks,
    etcCriterionMet,
    cvrCriterionMet,
    successCriterionMet,
    overallEtcReduction,
    baselineCvrTotal: baseTotals.cvrTotal,
    treatmentCvrTotal: treatTotals.cvrTotal,
    baselineSuccessTotal: baseTotals.successCount,
    treatmentSuccessTotal: treatTotals.successCount,
    pass,
    killSwitch: { triggered: reasons.length > 0, reasons },
  };
}
