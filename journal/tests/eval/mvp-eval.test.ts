import { describe, it, expect } from "vitest";
import {
  median,
  aggregate,
  armTotals,
  evaluatePassBar,
  PASS_BAR,
  KILL_SWITCH,
  type SessionScore,
  type Arm,
} from "../../src/eval/mvp-eval.js";
import { mvpTasks } from "../../src/eval/mvp-task-criteria.js";

// ── median ───────────────────────────────────────────────────────────

describe("median", () => {
  it("odd length picks the middle", () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it("even length averages the two middles", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("empty is 0", () => {
    expect(median([])).toBe(0);
  });
});

// ── score builder ────────────────────────────────────────────────────

function score(
  taskId: string,
  arm: Arm,
  run: number,
  etc: number,
  violations: number,
  success: boolean,
): SessionScore {
  return {
    taskId,
    arm,
    run,
    etc,
    reachedCorrectEdit: success,
    violations,
    success,
    etcDetail: {
      etc,
      reachedCorrectEdit: success,
      firstCorrectEditIndex: success ? 0 : -1,
      totalExploratory: etc,
      totalToolCalls: etc,
    },
  };
}

// ── aggregate ────────────────────────────────────────────────────────

describe("aggregate", () => {
  it("groups by (task, arm) and computes median/min/max/cvr/success", () => {
    const scores = [
      score("task-1", "baseline", 1, 10, 1, true),
      score("task-1", "baseline", 2, 6, 1, true),
      score("task-1", "baseline", 3, 8, 0, false),
    ];
    const stats = aggregate(scores);
    expect(stats).toHaveLength(1);
    const s = stats[0];
    expect(s.etcMedian).toBe(8);
    expect(s.etcMin).toBe(6);
    expect(s.etcMax).toBe(10);
    expect(s.cvrTotal).toBe(2);
    expect(s.successCount).toBe(2);
    expect(s.n).toBe(3);
  });

  it("armTotals sums across tasks", () => {
    const scores = [
      score("task-1", "treatment", 1, 3, 0, true),
      score("task-2", "treatment", 1, 4, 1, false),
    ];
    const totals = armTotals(aggregate(scores), "treatment");
    expect(totals.cvrTotal).toBe(1);
    expect(totals.successCount).toBe(1);
    expect(totals.n).toBe(2);
  });
});

// ── pass bar: full SHIP scenario ─────────────────────────────────────

/**
 * Build a 5-task × 2-arm × N=3 score set where treatment clearly wins:
 * baseline ETC ~10, treatment ETC ~3 (<=0.7x on all tasks), baseline CVR=5,
 * treatment CVR=0, equal success.
 */
function shipScores(): SessionScore[] {
  const scores: SessionScore[] = [];
  for (const task of mvpTasks) {
    for (let run = 1; run <= 3; run++) {
      // baseline: high ETC, occasional violations
      scores.push(score(task.id, "baseline", run, 10, run === 1 ? 1 : 0, true));
      // treatment: low ETC, zero violations
      scores.push(score(task.id, "treatment", run, 3, 0, true));
    }
  }
  return scores;
}

describe("evaluatePassBar — SHIP scenario", () => {
  const v = evaluatePassBar(aggregate(shipScores()));

  it("ETC criterion met (all 5 tasks <= 0.7x)", () => {
    expect(v.etcImprovedTasks.length).toBe(5);
    expect(v.etcCriterionMet).toBe(true);
    for (const t of v.perTask) expect(t.etcRatio).toBeLessThanOrEqual(PASS_BAR.etcRatio);
  });

  it("CVR criterion met (baseline>=2, treatment=0)", () => {
    expect(v.baselineCvrTotal).toBeGreaterThanOrEqual(PASS_BAR.baselineCvrFloor);
    expect(v.treatmentCvrTotal).toBe(0);
    expect(v.cvrCriterionMet).toBe(true);
  });

  it("success criterion met and overall pass", () => {
    expect(v.successCriterionMet).toBe(true);
    expect(v.pass).toBe(true);
  });

  it("kill switch not triggered", () => {
    expect(v.killSwitch.triggered).toBe(false);
  });
});

// ── pass bar: kill-switch scenarios ──────────────────────────────────

describe("evaluatePassBar — kill switches", () => {
  it("fails ETC + triggers kill switch when treatment barely improves", () => {
    const scores: SessionScore[] = [];
    for (const task of mvpTasks) {
      for (let run = 1; run <= 3; run++) {
        scores.push(score(task.id, "baseline", run, 10, 1, true));
        scores.push(score(task.id, "treatment", run, 9.5, 0, true)); // ~5% reduction
      }
    }
    const v = evaluatePassBar(aggregate(scores));
    expect(v.etcCriterionMet).toBe(false);
    expect(v.pass).toBe(false);
    expect(v.killSwitch.triggered).toBe(true);
    expect(v.killSwitch.reasons.some((r) => r.includes("ETC reduction"))).toBe(true);
    expect(v.overallEtcReduction).toBeLessThanOrEqual(KILL_SWITCH.minEtcReduction);
  });

  it("triggers kill switch when treatment CVR >= baseline CVR", () => {
    const scores: SessionScore[] = [];
    for (const task of mvpTasks) {
      for (let run = 1; run <= 3; run++) {
        scores.push(score(task.id, "baseline", run, 10, 0, true));
        scores.push(score(task.id, "treatment", run, 3, 1, true)); // treatment worse on CVR
      }
    }
    const v = evaluatePassBar(aggregate(scores));
    expect(v.killSwitch.triggered).toBe(true);
    expect(v.killSwitch.reasons.some((r) => r.includes("treatment CVR"))).toBe(true);
    // CVR criterion also fails (treatment != 0)
    expect(v.cvrCriterionMet).toBe(false);
    expect(v.pass).toBe(false);
  });

  it("triggers kill switch when treatment success regresses", () => {
    const scores: SessionScore[] = [];
    for (const task of mvpTasks) {
      for (let run = 1; run <= 3; run++) {
        scores.push(score(task.id, "baseline", run, 10, 1, true));
        scores.push(score(task.id, "treatment", run, 3, 0, run === 1)); // fewer successes
      }
    }
    const v = evaluatePassBar(aggregate(scores));
    expect(v.successCriterionMet).toBe(false);
    expect(v.killSwitch.triggered).toBe(true);
    expect(v.killSwitch.reasons.some((r) => r.includes("treatment success"))).toBe(true);
    expect(v.pass).toBe(false);
  });

  it("CVR criterion fails when baseline CVR below floor even if treatment=0", () => {
    const scores: SessionScore[] = [];
    for (const task of mvpTasks) {
      for (let run = 1; run <= 3; run++) {
        scores.push(score(task.id, "baseline", run, 10, 0, true)); // baseline CVR=0
        scores.push(score(task.id, "treatment", run, 3, 0, true));
      }
    }
    const v = evaluatePassBar(aggregate(scores));
    expect(v.baselineCvrTotal).toBe(0);
    expect(v.cvrCriterionMet).toBe(false); // floor not met -> CVR signal meaningless
    expect(v.pass).toBe(false);
  });
});

// ── stratified pass bar (Day-2 review binding condition) ─────────────

describe("evaluateStratifiedPassBar", () => {
  it("gates on the strong stratum only; weak reported separately", async () => {
    const { evaluateStratifiedPassBar } = await import("../../src/eval/mvp-eval.js");
    const strata = new Map(
      mvpTasks.map((t) => [t.id, t.treatmentStratum] as const),
    );
    const scores: SessionScore[] = [];
    for (const task of mvpTasks) {
      for (let run = 1; run <= 3; run++) {
        scores.push(score(task.id, "baseline", run, 10, run === 1 ? 1 : 0, true));
        // treatment wins on strong tasks, does NOTHING on the weak task —
        // exactly the expected coverage boundary
        const treatEtc = task.treatmentStratum === "strong" ? 3 : 10;
        scores.push(score(task.id, "treatment", run, treatEtc, 0, true));
      }
    }
    const v = evaluateStratifiedPassBar(aggregate(scores), strata);

    // strong stratum passes even though the weak task moved 0%
    expect(v.strongTaskIds).toHaveLength(4);
    expect(v.weakTaskIds).toEqual(["task-5"]);
    expect(v.strong.etcCriterionMet).toBe(true);
    expect(v.strong.pass).toBe(true);
    expect(v.strong.killSwitch.triggered).toBe(false);

    // an UNstratified evaluation of the same scores would have been dragged
    // by the weak task's null effect — that dilution is what stratification
    // removes; the weak result stays visible
    expect(v.weak).not.toBeNull();
    expect(v.weak!.etcImprovedTasks).toHaveLength(0);
  });

  it("token ratio is null when no usage was captured, computed when present", async () => {
    const { evaluateStratifiedPassBar, TOKEN_BAR } = await import("../../src/eval/mvp-eval.js");
    const strata = new Map(
      mvpTasks.map((t) => [t.id, t.treatmentStratum] as const),
    );
    const noTokens = evaluateStratifiedPassBar(aggregate(shipScores()), strata);
    expect(noTokens.tokenRatio).toBeNull();
    expect(noTokens.tokenCriterionMet).toBeNull();

    const withTokens: SessionScore[] = shipScores().map((s) => ({
      ...s,
      tokens: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        total: s.arm === "baseline" ? 1000 : 1100, // ratio 1.1 <= 1.15
      },
    }));
    const v = evaluateStratifiedPassBar(aggregate(withTokens), strata);
    expect(v.tokenRatio).toBeCloseTo(1.1);
    expect(v.tokenCriterionMet).toBe(true);
    expect(v.tokenKillTriggered).toBe(false);
    expect(TOKEN_BAR.maxTokenRatio).toBe(1.15);
  });
});
