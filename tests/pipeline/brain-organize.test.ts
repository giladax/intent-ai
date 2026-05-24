import { describe, it, expect } from "vitest";
import {
  GraphPlanSchema,
  buildBrainOrganizePrompt,
  type ExistingSpec,
  type OrganizeSignals,
} from "../../src/llm/prompts/brain-organize.js";
import type { SpecFragment } from "../../src/llm/prompts/brain-extract.js";

// ── Helpers ─────────────────────────────────────────────────────────

function makeFragment(overrides: Partial<SpecFragment> = {}): SpecFragment {
  return {
    nameHint: "Test Fragment",
    insights: [
      {
        category: "structure",
        statement: "Components use a functional pipeline pattern",
        evidence: [{ reasoning: "implicit" }],
        confidence: 80,
      },
    ],
    fileRefs: [{ path: "src/pipeline/orchestrator.ts", role: "main runner" }],
    ...overrides,
  } as SpecFragment;
}

function makeExistingSpec(overrides: Partial<ExistingSpec> = {}): ExistingSpec {
  return {
    name: "Pipeline Architecture",
    summary: "How the pipeline processes sessions",
    insightCount: 5,
    fileList: ["src/pipeline/orchestrator.ts", "src/pipeline/moments.ts"],
    sessionCount: 3,
    daysSinceUpdate: 2,
    ...overrides,
  };
}

// ── Schema Tests ────────────────────────────────────────────────────

describe("GraphPlanSchema", () => {
  it("parses a well-formed GraphPlan", () => {
    const input = {
      assignments: [
        { fragmentIndex: 0, targetSpec: "Pipeline Architecture", action: "update", level: "root" },
        { fragmentIndex: 1, targetSpec: "New Topic", action: "create", level: "child", parentSpec: "Pipeline Architecture" },
      ],
      merges: [
        { specs: ["Spec A", "Spec B"], intoName: "Merged Spec", level: "root" },
      ],
      splits: [
        {
          spec: "Big Topic",
          into: [
            { name: "Sub A", insightIds: ["id1", "id2"] },
            { name: "Sub B", insightIds: ["id3"] },
          ],
        },
      ],
    };

    const result = GraphPlanSchema.parse(input);
    expect(result.assignments).toHaveLength(2);
    expect(result.merges).toHaveLength(1);
    expect(result.splits).toHaveLength(1);
    expect(result.assignments[0].action).toBe("update");
    expect(result.assignments[0].level).toBe("root");
    expect(result.assignments[1].parentSpec).toBe("Pipeline Architecture");
    expect(result.assignments[1].level).toBe("child");
  });

  it("applies defaults for empty merges and splits", () => {
    const input = {
      assignments: [
        { fragmentIndex: 0, targetSpec: "Some Spec", action: "create", level: "root" },
      ],
    };

    const result = GraphPlanSchema.parse(input);
    expect(result.assignments).toHaveLength(1);
    expect(result.merges).toEqual([]);
    expect(result.splits).toEqual([]);
  });

  it("handles minimal plan (assignments only)", () => {
    const input = {
      assignments: [
        { fragmentIndex: 0, targetSpec: "Spec A", action: "update", level: "root" },
        { fragmentIndex: 1, targetSpec: "Spec B", action: "update", level: "root" },
        { fragmentIndex: 2, targetSpec: "Spec C", action: "create", level: "child", parentSpec: "Spec A" },
      ],
    };

    const result = GraphPlanSchema.parse(input);
    expect(result.assignments).toHaveLength(3);
    expect(result.merges).toEqual([]);
    expect(result.splits).toEqual([]);
  });

  it("requires level field on assignments", () => {
    const input = {
      assignments: [
        { fragmentIndex: 0, targetSpec: "Spec A", action: "update" },
      ],
    };

    expect(() => GraphPlanSchema.parse(input)).toThrow();
  });

  it("preserves extra fields via passthrough", () => {
    const input = {
      assignments: [
        { fragmentIndex: 0, targetSpec: "Spec A", action: "update", level: "root", reasoning: "fits well" },
      ],
      rationale: "simple update",
    };

    const result = GraphPlanSchema.parse(input);
    expect((result as any).rationale).toBe("simple update");
    expect((result.assignments[0] as any).reasoning).toBe("fits well");
  });
});

// ── Prompt Builder Tests ────────────────────────────────────────────

describe("buildBrainOrganizePrompt", () => {
  it("includes existing specs and fragments", () => {
    const specs = [makeExistingSpec()];
    const fragments = [makeFragment()];
    const signals: OrganizeSignals = { sharedFileRatios: [] };

    const { system, user } = buildBrainOrganizePrompt(specs, fragments, signals);

    expect(system).toContain("2-level knowledge tree");
    expect(user).toContain("Pipeline Architecture");
    expect(user).toContain("Insights: 5");
    expect(user).toContain("Sessions: 3");
    expect(user).toContain("Test Fragment");
    expect(user).toContain("functional pipeline pattern");
  });

  it("includes shared file ratios", () => {
    const specs = [
      makeExistingSpec({ name: "Spec A" }),
      makeExistingSpec({ name: "Spec B" }),
    ];
    const fragments = [makeFragment()];
    const signals: OrganizeSignals = {
      sharedFileRatios: [{ specA: "Spec A", specB: "Spec B", ratio: 0.75 }],
    };

    const { user } = buildBrainOrganizePrompt(specs, fragments, signals);

    expect(user).toContain("Shared File Ratios");
    expect(user).toContain("Spec A");
    expect(user).toContain("Spec B");
    expect(user).toContain("75%");
  });

  it("handles cold start (no existing specs)", () => {
    const fragments = [makeFragment(), makeFragment({ nameHint: "Another Fragment" })];
    const signals: OrganizeSignals = { sharedFileRatios: [] };

    const { system, user } = buildBrainOrganizePrompt([], fragments, signals);

    expect(system).toContain("COLD START");
    expect(user).toContain("cold start");
    expect(user).toContain("None");
    expect(user).toContain("Fragment 0");
    expect(user).toContain("Fragment 1");
  });

  it("omits cold start note when specs exist", () => {
    const specs = [makeExistingSpec()];
    const fragments = [makeFragment()];
    const signals: OrganizeSignals = { sharedFileRatios: [] };

    const { system } = buildBrainOrganizePrompt(specs, fragments, signals);

    expect(system).not.toContain("COLD START");
  });

  it("lists fragment file refs", () => {
    const fragments = [
      makeFragment({
        fileRefs: [
          { path: "src/a.ts", role: "main" },
          { path: "src/b.ts", role: "helper" },
        ],
      }),
    ];
    const signals: OrganizeSignals = { sharedFileRatios: [] };

    const { user } = buildBrainOrganizePrompt([], fragments, signals);

    expect(user).toContain("src/a.ts");
    expect(user).toContain("src/b.ts");
  });
});
