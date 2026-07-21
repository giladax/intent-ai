import { describe, it, expect } from "vitest";
import {
  ConstraintJudgementSchema,
  countViolations,
} from "../../src/eval/mvp-judge.js";
import { task2DiscoveryEvents } from "../../src/eval/mvp-task-criteria.js";

describe("ConstraintJudgementSchema (lenient)", () => {
  it("defaults verdicts to [] when missing", () => {
    const parsed = ConstraintJudgementSchema.parse({});
    expect(parsed.verdicts).toEqual([]);
  });

  it("defaults per-verdict violated/reasoning and passes through extras", () => {
    const parsed = ConstraintJudgementSchema.parse({
      verdicts: [{ constraintId: "x", extra: "kept" }],
      note: "kept",
    });
    expect(parsed.verdicts[0].violated).toBe(false);
    expect(parsed.verdicts[0].reasoning).toBe("");
    expect((parsed.verdicts[0] as Record<string, unknown>).extra).toBe("kept");
    expect((parsed as Record<string, unknown>).note).toBe("kept");
  });
});

describe("countViolations", () => {
  const task = task2DiscoveryEvents; // constraints: occurred-time-not-digest-time, source-backrefs

  it("counts only violated verdicts matching a task constraint id", () => {
    const j = ConstraintJudgementSchema.parse({
      verdicts: [
        { constraintId: "occurred-time-not-digest-time", violated: true },
        { constraintId: "source-backrefs", violated: false },
      ],
    });
    expect(countViolations(task, j)).toBe(1);
  });

  it("ignores hallucinated constraint ids (cannot inflate CVR)", () => {
    const j = ConstraintJudgementSchema.parse({
      verdicts: [
        { constraintId: "made-up-id", violated: true },
        { constraintId: "occurred-time-not-digest-time", violated: true },
      ],
    });
    expect(countViolations(task, j)).toBe(1);
  });

  it("dedupes repeated verdicts for the same constraint", () => {
    const j = ConstraintJudgementSchema.parse({
      verdicts: [
        { constraintId: "source-backrefs", violated: true },
        { constraintId: "source-backrefs", violated: true },
      ],
    });
    expect(countViolations(task, j)).toBe(1);
  });

  it("returns 0 when nothing violated", () => {
    const j = ConstraintJudgementSchema.parse({
      verdicts: task.constraints.map((c) => ({ constraintId: c.id, violated: false })),
    });
    expect(countViolations(task, j)).toBe(0);
  });
});

describe("majorityJudgement (fixes F4 — one Haiku vote decided CVR)", () => {
  const task = task2DiscoveryEvents;
  const round = (a: boolean, b: boolean) =>
    ConstraintJudgementSchema.parse({
      verdicts: [
        { constraintId: "occurred-time-not-digest-time", violated: a, reasoning: a ? "wall clock" : "" },
        { constraintId: "source-backrefs", violated: b },
      ],
    });

  it("a single dissenting vote cannot flip a clean verdict", async () => {
    const { majorityJudgement } = await import("../../src/eval/mvp-judge.js");
    const j = majorityJudgement(task, [round(true, false), round(false, false), round(false, false)]);
    expect(j.verdicts.find((v) => v.constraintId === "occurred-time-not-digest-time")!.violated).toBe(false);
  });

  it("2/3 votes violate → violated", async () => {
    const { majorityJudgement } = await import("../../src/eval/mvp-judge.js");
    const j = majorityJudgement(task, [round(true, false), round(true, false), round(false, false)]);
    expect(j.verdicts.find((v) => v.constraintId === "occurred-time-not-digest-time")!.violated).toBe(true);
    expect(j.verdicts.find((v) => v.constraintId === "source-backrefs")!.violated).toBe(false);
  });

  it("missing verdicts in a round count as not-violated votes", async () => {
    const { majorityJudgement } = await import("../../src/eval/mvp-judge.js");
    const empty = ConstraintJudgementSchema.parse({});
    const j = majorityJudgement(task, [round(true, true), empty, empty]);
    for (const v of j.verdicts) expect(v.violated).toBe(false);
  });

  it("emits exactly one verdict per task constraint", async () => {
    const { majorityJudgement } = await import("../../src/eval/mvp-judge.js");
    const j = majorityJudgement(task, [round(false, false)]);
    expect(j.verdicts.map((v) => v.constraintId).sort()).toEqual(
      task.constraints.map((c) => c.id).sort(),
    );
  });
});
