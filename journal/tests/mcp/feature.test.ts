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
  formatFeatureContextFull,
  formatFeatureOrientation,
  formatMomentList,
  formatMomentEvidence,
  formatSessionNarrative,
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

  // ── full format (depth:"full" / formatFeatureContextFull) ─────

  it("formatFeatureContext depth:full includes all sections", () => {
    const text = formatFeatureContext(ctx, "full");
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

  it("formatFeatureContextFull includes all sections", () => {
    const text = formatFeatureContextFull(ctx);
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

  it("formatFeatureContextFull renders key moments with evidence quotes and verification", () => {
    const text = formatFeatureContextFull(ctx);
    expect(text).toContain("## Key Moments");
    expect(text).toContain("Chose denormalized session context on events");
    expect(text).toContain("high, supported");
    expect(text).toContain('> "events are self-contained; feature_id is NOT a foreign key"');
    // low-confidence candidate is filtered out of the served context
    expect(text).not.toContain("moment m-low");
  });

  it("formatFeatureContextFull omits the Key Moments section when there are no candidates", () => {
    const text = formatFeatureContextFull({ ...ctx, momentCandidates: [] });
    expect(text).not.toContain("## Key Moments");
  });

  // ── orientation format (default) ──────────────────────────────

  it("formatFeatureContext defaults to orientation (terse)", () => {
    const text = formatFeatureContext(ctx);
    // orientation includes the feature name and id
    expect(text).toContain("Activity Event Backbone");
    expect(text).toContain("[id: f1]");
    // orientation includes the understanding verdict
    expect(text).toContain("Understanding:");
    expect(text).toContain("Events are self-contained");
    // orientation does NOT include the heavy markdown sections
    expect(text).not.toContain("## Current Understanding");
    expect(text).not.toContain("## Key Moments");
    expect(text).not.toContain("## Related Sessions");
  });

  it("formatFeatureOrientation includes constraints (≤3) and drill handles", () => {
    const text = formatFeatureOrientation(ctx);
    // constraints (≤3) are always shown
    expect(text).toContain("No enum/CHECK on category");
    expect(text).toContain("emitEvents wrapped in try/catch");
    // drill handles include moment and session counts
    expect(text).toContain("brain_moments");
    expect(text).toContain("brain_narrative");
    expect(text).toContain("brain_evidence");
    // ends with the full-context drill hint
    expect(text).toContain("brain_feature_context");
  });

  it("formatFeatureOrientation always shows ALL constraints regardless of count (bug fix: no ≤3 elision)", () => {
    const manyConstraints = {
      ...ctx,
      feature: {
        ...ctx.feature,
        constraints: ["c1", "c2", "c3", "c4", "c5", "c6"],
      },
    };
    const text = formatFeatureOrientation(manyConstraints);
    // all constraints must appear — the ≤3 elision rule was removed
    expect(text).toContain("· c1");
    expect(text).toContain("· c4");
    expect(text).toContain("· c6");
    // no count-only placeholder
    expect(text).not.toContain("— call brain_feature_context");
  });

  it("formatFeatureOrientation does not split decimal numbers in understanding verdict", () => {
    const decimalCtx = {
      ...ctx,
      feature: {
        ...ctx.feature,
        currentUnderstanding: "The fidelity score was ~7.7 hours of work. A second sentence follows.",
      },
      approvedObservations: [],
    };
    const text = formatFeatureOrientation(decimalCtx);
    // "7.7" must not be split across sentence slots — the number appears intact
    expect(text).toContain("7.7");
    // The understanding block should not garble "7" as a lone fragment
    expect(text).not.toMatch(/~7\. \d/);
  });

  it("formatFeatureOrientation omits drill handles when no moments or sessions", () => {
    const empty = { ...ctx, momentCandidates: [], relatedSessions: [] };
    const text = formatFeatureOrientation(empty);
    expect(text).not.toContain("brain_moments");
    expect(text).not.toContain("brain_narrative");
  });

  // ── drill tool formatters ──────────────────────────────────────

  it("formatMomentList renders terse moment entries with ids", () => {
    const moments = [
      momentRow({ id: "aaaa1111-0000-0000-0000-000000000001", statement: "Key decision made" }),
    ];
    const text = formatMomentList(moments);
    expect(text).toContain("Key decision made");
    expect(text).toContain("brain_evidence");
    expect(text).toContain("high");
    expect(text).toContain("supported");
  });

  it("formatMomentList returns empty message when no moments", () => {
    expect(formatMomentList([])).toContain("No moments");
  });

  it("formatMomentEvidence renders quotes with source refs", () => {
    const evidence = [
      {
        quote: "the key quote from the session",
        sourceType: "human_message",
        quoteType: "verbatim",
        sourceEventId: "ev-1234-5678",
      },
    ];
    const text = formatMomentEvidence("m1-id", "Some claim", evidence);
    expect(text).toContain("Some claim");
    expect(text).toContain("the key quote from the session");
    expect(text).toContain("verbatim");
    expect(text).toContain("human_message");
  });

  it("formatMomentEvidence handles no-evidence case", () => {
    const text = formatMomentEvidence("m1-id", "Some claim", []);
    expect(text).toContain("no stored evidence");
  });

  it("formatSessionNarrative renders summary and progression", () => {
    const n = {
      sessionId: "sess-abc-123",
      sessionShape: "narrative",
      summary: "Built the backbone with a unified events table",
      progression: ["Started with design", "Implemented schema"],
      discoveries: ["feature_id must stay non-FK"],
    };
    const text = formatSessionNarrative(n);
    expect(text).toContain("Built the backbone");
    expect(text).toContain("Started with design");
    expect(text).toContain("feature_id must stay non-FK");
  });

  // ── unchanged helpers ──────────────────────────────────────────

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
