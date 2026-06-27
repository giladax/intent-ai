import { describe, it, expect } from "vitest";
import {
  ConstraintJudgementSchema,
  countViolations,
} from "../../src/eval/mvp-judge.js";
import { task2StruggleEvent } from "../../src/eval/mvp-task-criteria.js";

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
  const task = task2StruggleEvent; // constraints: category-freeform-no-enum, emit-in-try-catch

  it("counts only violated verdicts matching a task constraint id", () => {
    const j = ConstraintJudgementSchema.parse({
      verdicts: [
        { constraintId: "category-freeform-no-enum", violated: true },
        { constraintId: "emit-in-try-catch", violated: false },
      ],
    });
    expect(countViolations(task, j)).toBe(1);
  });

  it("ignores hallucinated constraint ids (cannot inflate CVR)", () => {
    const j = ConstraintJudgementSchema.parse({
      verdicts: [
        { constraintId: "made-up-id", violated: true },
        { constraintId: "category-freeform-no-enum", violated: true },
      ],
    });
    expect(countViolations(task, j)).toBe(1);
  });

  it("dedupes repeated verdicts for the same constraint", () => {
    const j = ConstraintJudgementSchema.parse({
      verdicts: [
        { constraintId: "emit-in-try-catch", violated: true },
        { constraintId: "emit-in-try-catch", violated: true },
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
