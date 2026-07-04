import { describe, it, expect } from "vitest";
import {
  globToRegExp,
  normalizePath,
  matchingRows,
  resolveFeature,
  resolveTask,
  scoreFeaturesForTask,
  formatCandidates,
  formatFeatureContext,
  buildAgentInstructions,
  fileMatchesPatterns,
  selectKeyMoments,
} from "../../src/mcp/feature.js";
import type {
  FeatureRecord,
  FeatureFileRow,
  FeatureContextData,
  FeatureMomentRow,
} from "../../src/storage/queries.js";

function feature(over: Partial<FeatureRecord> & { id: string; name: string }): FeatureRecord {
  return {
    description: "",
    currentUnderstanding: null,
    constraints: [],
    knownUnknowns: [],
    ...over,
  };
}

describe("globToRegExp", () => {
  it("matches ** across directory separators", () => {
    expect(globToRegExp("src/**").test("src/mcp/server.ts")).toBe(true);
    expect(globToRegExp("src/**").test("src/a.ts")).toBe(true);
    expect(globToRegExp("src/**").test("other/a.ts")).toBe(false);
  });

  it("* does not cross a directory separator", () => {
    expect(globToRegExp("src/*.ts").test("src/server.ts")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/mcp/server.ts")).toBe(false);
  });

  it("escapes regex metacharacters in literals", () => {
    expect(globToRegExp("src/a.b.ts").test("src/a.b.ts")).toBe(true);
    expect(globToRegExp("src/a.b.ts").test("src/axbxts")).toBe(false);
  });
});

describe("normalizePath", () => {
  it("strips leading ./ and /", () => {
    expect(normalizePath("./src/a.ts")).toBe("src/a.ts");
    expect(normalizePath("/src/a.ts")).toBe("src/a.ts");
  });
});

describe("matchingRows", () => {
  const rows: FeatureFileRow[] = [
    { featureId: "f-broad", glob: "src/**", filePath: null },
    { featureId: "f-narrow", glob: "src/mcp/**", filePath: null },
    { featureId: "f-exact", glob: null, filePath: "src/mcp/server.ts" },
  ];

  it("returns all matching rows with specificity = pattern length", () => {
    const matches = matchingRows("src/mcp/server.ts", rows);
    const ids = matches.map((m) => m.featureId).sort();
    expect(ids).toEqual(["f-broad", "f-exact", "f-narrow"]);
  });

  it("matches exact file_path by suffix too", () => {
    const matches = matchingRows("/abs/repo/src/mcp/server.ts", [
      { featureId: "f-exact", glob: null, filePath: "src/mcp/server.ts" },
    ]);
    expect(matches.map((m) => m.featureId)).toEqual(["f-exact"]);
  });
});

describe("resolveFeature (longest-glob-wins)", () => {
  const rows: FeatureFileRow[] = [
    { featureId: "f-broad", glob: "src/**", filePath: null },
    { featureId: "f-narrow", glob: "src/mcp/**", filePath: null },
  ];

  it("picks the Feature with the longest matching glob", () => {
    const res = resolveFeature("src/mcp/server.ts", rows);
    expect(res.featureId).toBe("f-narrow");
    expect(res.candidateIds).toEqual(["f-narrow"]);
  });

  it("returns candidates (no winner) on a tie across Features", () => {
    const tie: FeatureFileRow[] = [
      { featureId: "a", glob: "src/mcp/**", filePath: null },
      { featureId: "b", glob: "src/mcp/**", filePath: null },
    ];
    const res = resolveFeature("src/mcp/server.ts", tie);
    expect(res.featureId).toBeUndefined();
    expect(res.candidateIds.sort()).toEqual(["a", "b"]);
  });

  it("returns empty candidate list on 0 matches", () => {
    const res = resolveFeature("docs/readme.md", rows);
    expect(res.featureId).toBeUndefined();
    expect(res.candidateIds).toEqual([]);
  });

  it("a single broad match still resolves", () => {
    const res = resolveFeature("src/cli/index.ts", rows);
    expect(res.featureId).toBe("f-broad");
  });
});

describe("resolveTask", () => {
  const features = [
    feature({ id: "1", name: "Activity Event Backbone", description: "denormalized events table" }),
    feature({ id: "2", name: "MCP Server", description: "exposes brain to agents" }),
    feature({ id: "3", name: "Pipeline Orchestration", description: "digest sessions" }),
  ];

  it("returns a single match when one Feature clearly wins", () => {
    const res = resolveTask("add a tool to the MCP server", features);
    expect(res.feature?.id).toBe("2");
  });

  it("returns candidates when nothing matches above threshold", () => {
    const res = resolveTask("xyzzy nonexistent topic", features);
    expect(res.feature).toBeUndefined();
    expect(Array.isArray(res.candidates)).toBe(true);
  });

  it("scoreFeaturesForTask ranks by name overlap", () => {
    const scored = scoreFeaturesForTask("activity event", features);
    expect(scored[0].feature.id).toBe("1");
  });
});

describe("fileMatchesPatterns", () => {
  it("matches a repo-relative glob against an absolute corpus path", () => {
    expect(
      fileMatchesPatterns("/Users/dev/intent-ai/src/mcp/server.ts", ["src/mcp/**"]),
    ).toBe(true);
  });

  it("matches exact repo-relative paths", () => {
    expect(fileMatchesPatterns("src/storage/queries.ts", ["src/storage/queries.ts"])).toBe(true);
  });

  it("does not match unrelated paths", () => {
    expect(fileMatchesPatterns("/abs/repo/docs/prd.md", ["src/mcp/**"])).toBe(false);
  });
});

function momentRow(over: Partial<FeatureMomentRow> & { id: string }): FeatureMomentRow {
  return {
    sessionId: "s1",
    statement: `moment ${over.id}`,
    type: "discovery",
    confidence: "high",
    verification: "supported",
    occurredAt: new Date("2026-07-01T10:00:00Z"),
    quote: "a real anchored quote",
    files: [],
    ...over,
  };
}

describe("selectKeyMoments", () => {
  it("keeps only high/medium confidence moments with an evidence quote", () => {
    const picked = selectKeyMoments(
      [
        momentRow({ id: "hi" }),
        momentRow({ id: "med", confidence: "medium" }),
        momentRow({ id: "low", confidence: "low" }),
        momentRow({ id: "noquote", quote: null }),
      ],
      [],
    );
    expect(picked.map((m) => m.id).sort()).toEqual(["hi", "med"]);
  });

  it("prefers moments whose files overlap the feature's patterns", () => {
    const picked = selectKeyMoments(
      [
        momentRow({ id: "elsewhere", files: ["/repo/docs/prd.md"] }),
        momentRow({ id: "on-feature", files: ["/repo/src/mcp/server.ts"] }),
      ],
      ["src/mcp/**"],
      1,
    );
    expect(picked.map((m) => m.id)).toEqual(["on-feature"]);
  });

  it("ranks high confidence above medium, and demotes contradicted moments", () => {
    const picked = selectKeyMoments(
      [
        momentRow({ id: "med", confidence: "medium" }),
        momentRow({ id: "hi-contradicted", verification: "contradicted" }),
        momentRow({ id: "hi-supported" }),
      ],
      [],
    );
    expect(picked[0].id).toBe("hi-supported");
    expect(picked[picked.length - 1].id).toBe("hi-contradicted");
  });

  it("breaks score ties by recency (newest first) and caps at limit", () => {
    const picked = selectKeyMoments(
      [
        momentRow({ id: "old", occurredAt: new Date("2026-06-01T00:00:00Z") }),
        momentRow({ id: "new", occurredAt: new Date("2026-07-03T00:00:00Z") }),
        momentRow({ id: "mid", occurredAt: new Date("2026-06-15T00:00:00Z") }),
      ],
      [],
      2,
    );
    expect(picked.map((m) => m.id)).toEqual(["new", "mid"]);
  });
});

describe("formatting", () => {
  const ctx: FeatureContextData = {
    feature: feature({
      id: "f1",
      name: "Activity Event Backbone",
      description: "Unified events table.",
      currentUnderstanding: "Events are self-contained.",
      constraints: ["No enum/CHECK on category", "emitEvents wrapped in try/catch"],
      knownUnknowns: ["Should embeddings use pgvector?"],
    }),
    relevantFiles: ["src/storage/queries.ts", "src/storage/schema.ts"],
    relatedSessions: [
      { id: "s1", shape: "narrative", summary: "Built the backbone", role: "primary", startedAt: null },
    ],
    approvedObservations: [
      { id: "o1", category: "observation:decision", summary: "Chose freeform categories", reviewStatus: "approved", timestamp: new Date() },
    ],
    reportedUnknowns: [
      { id: "o2", category: "observation:unknown", summary: "How to dedupe?", reviewStatus: "pending", timestamp: new Date() },
    ],
    momentCandidates: [
      momentRow({
        id: "m1",
        statement: "Chose denormalized session context on events",
        confidence: "high",
        verification: "supported",
        quote: "events are self-contained; feature_id is NOT a foreign key",
        files: ["/repo/src/storage/schema.ts"],
      }),
      momentRow({ id: "m-low", confidence: "low" }),
    ],
  };

  it("formatFeatureContext includes all sections", () => {
    const text = formatFeatureContext(ctx);
    expect(text).toContain("# Feature: Activity Event Backbone");
    expect(text).toContain("## Current Understanding");
    expect(text).toContain("Chose freeform categories");
    expect(text).toContain("## Constraints");
    expect(text).toContain("No enum/CHECK on category");
    expect(text).toContain("## Relevant Files");
    expect(text).toContain("## Related Sessions");
    expect(text).toContain("## Known Unknowns");
    expect(text).toContain("How to dedupe?");
    expect(text).toContain("## Agent Instructions");
  });

  it("formatFeatureContext renders key moments with evidence quotes and verification", () => {
    const text = formatFeatureContext(ctx);
    expect(text).toContain("## Key Moments");
    expect(text).toContain("Chose denormalized session context on events");
    expect(text).toContain("high, supported");
    expect(text).toContain('> "events are self-contained; feature_id is NOT a foreign key"');
    // low-confidence candidate is filtered out of the served context
    expect(text).not.toContain("moment m-low");
  });

  it("formatFeatureContext omits the Key Moments section when there are no candidates", () => {
    const text = formatFeatureContext({ ...ctx, momentCandidates: [] });
    expect(text).not.toContain("## Key Moments");
  });

  it("buildAgentInstructions leads with constraints", () => {
    const instr = buildAgentInstructions(ctx);
    expect(instr).toContain("Respect these constraints");
    expect(instr).toContain("No enum/CHECK on category");
  });

  it("formatCandidates lists ids for picking", () => {
    const text = formatCandidates([ctx.feature], "file: x.ts");
    expect(text).toContain("[id: f1]");
    expect(text).toContain("brain_feature_context");
  });

  it("formatCandidates handles the empty (no-match) case", () => {
    const text = formatCandidates([], "file: docs/x.md");
    expect(text).toContain("No Feature matched");
  });
});
