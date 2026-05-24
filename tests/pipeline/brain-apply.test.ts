import { describe, it, expect } from "vitest";
import { normalizeName, detectCycles, buildParentMap } from "../../src/pipeline/brain-apply.js";
import type { GraphPlan } from "../../src/llm/prompts/brain-organize.js";

describe("normalizeName", () => {
  it("lowercases the name", () => {
    expect(normalizeName("Pipeline Architecture")).toBe("pipeline architecture");
  });

  it("trims whitespace", () => {
    expect(normalizeName("  foo  ")).toBe("foo");
  });

  it("handles both lowercase and trim together", () => {
    expect(normalizeName("  Pipeline Architecture  ")).toBe("pipeline architecture");
  });

  it("handles empty string", () => {
    expect(normalizeName("")).toBe("");
  });
});

describe("detectCycles", () => {
  it("passes with no cycles", () => {
    const map = new Map<string, string>();
    map.set("b", "a");
    map.set("c", "b");
    expect(() => detectCycles(map)).not.toThrow();
  });

  it("throws on A→B→A cycle", () => {
    const map = new Map<string, string>();
    map.set("a", "b");
    map.set("b", "a");
    expect(() => detectCycles(map)).toThrow(/circular parent reference/i);
  });

  it("throws on A→B→C→A cycle", () => {
    const map = new Map<string, string>();
    map.set("a", "b");
    map.set("b", "c");
    map.set("c", "a");
    expect(() => detectCycles(map)).toThrow(/circular parent reference/i);
  });

  it("passes when parents are null (root nodes)", () => {
    // Root nodes don't appear in the parent map at all
    const map = new Map<string, string>();
    expect(() => detectCycles(map)).not.toThrow();
  });

  it("passes with multiple independent chains", () => {
    const map = new Map<string, string>();
    map.set("b", "a");
    map.set("d", "c");
    map.set("e", "c");
    expect(() => detectCycles(map)).not.toThrow();
  });
});

describe("buildParentMap", () => {
  it("builds parent map from assignments", () => {
    const plan: GraphPlan = {
      assignments: [
        { fragmentIndex: 0, targetSpec: "Child Spec", action: "create", parentSpec: "Root Spec" },
        { fragmentIndex: 1, targetSpec: "Another Child", action: "create", parentSpec: "Root Spec" },
        { fragmentIndex: 2, targetSpec: "No Parent", action: "update" },
      ],
      merges: [],
      splits: [],
    };

    const map = buildParentMap(plan);
    expect(map.get("child spec")).toBe("root spec");
    expect(map.get("another child")).toBe("root spec");
    expect(map.has("no parent")).toBe(false);
  });

  it("builds parent map from merges", () => {
    const plan: GraphPlan = {
      assignments: [],
      merges: [
        { specs: ["A", "B"], intoName: "Merged", parentSpec: "Root" },
      ],
      splits: [],
    };

    const map = buildParentMap(plan);
    expect(map.get("merged")).toBe("root");
  });

  it("builds parent map from splits with parentSpec", () => {
    const plan: GraphPlan = {
      assignments: [],
      merges: [],
      splits: [
        {
          spec: "Big Topic",
          into: [
            { name: "Sub A", insightIds: ["1"] },
            { name: "Sub B", insightIds: ["2"] },
          ],
          parentSpec: "Root",
        },
      ],
    };

    const map = buildParentMap(plan);
    expect(map.get("sub a")).toBe("root");
    expect(map.get("sub b")).toBe("root");
  });

  it("handles splits without parentSpec (no implicit parent)", () => {
    const plan: GraphPlan = {
      assignments: [],
      merges: [],
      splits: [
        {
          spec: "Big Topic",
          into: [
            { name: "Sub A", insightIds: ["1"] },
          ],
        },
      ],
    };

    const map = buildParentMap(plan);
    // No parentSpec means no parent mapping
    expect(map.has("sub a")).toBe(false);
  });

  it("combines parents from all plan sections", () => {
    const plan: GraphPlan = {
      assignments: [
        { fragmentIndex: 0, targetSpec: "Feature X", action: "create", parentSpec: "Root" },
      ],
      merges: [
        { specs: ["Old A", "Old B"], intoName: "Merged", parentSpec: "Root" },
      ],
      splits: [
        {
          spec: "Big",
          into: [{ name: "Part 1", insightIds: [] }],
          parentSpec: "Root",
        },
      ],
    };

    const map = buildParentMap(plan);
    expect(map.get("feature x")).toBe("root");
    expect(map.get("merged")).toBe("root");
    expect(map.get("part 1")).toBe("root");
    expect(map.size).toBe(3);
  });

  it("normalizes names (case-insensitive, trimmed)", () => {
    const plan: GraphPlan = {
      assignments: [
        { fragmentIndex: 0, targetSpec: "  Pipeline  ", action: "create", parentSpec: "  ROOT  " },
      ],
      merges: [],
      splits: [],
    };

    const map = buildParentMap(plan);
    expect(map.get("pipeline")).toBe("root");
  });
});
