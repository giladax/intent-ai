import { describe, it, expect } from "vitest";
import { generateCard } from "../../src/brain/cards.js";

const BASE_INSIGHTS = [
  { category: "structure", statement: "Uses layered pipeline", confidence: 0.9 },
  { category: "decision", statement: "ESM imports required", confidence: 0.85 },
  { category: "constraint", statement: "Postgres on port 5433", confidence: 0.8 },
  { category: "behavior", statement: "Haiku for classification", confidence: 0.75 },
  { category: "risk", statement: "LLM latency at scale", confidence: 0.7 },
  { category: "interface", statement: "Zod output validation", confidence: 0.65 },
];

describe("generateCard", () => {
  it("generates a card with all fields from a full spec", () => {
    const card = generateCard({
      name: "Pipeline",
      level: "spec",
      summary: "The pipeline ingests Claude Code logs and produces execution memory.",
      insights: BASE_INSIGHTS,
      fileRefs: [
        { path: "src/pipeline/orchestrator.ts", role: "entry" },
        { path: "src/adapters/types.ts", role: "types" },
      ],
      parent: "Core",
      children: ["normalize", "classify"],
      related: ["LLM", "Storage"],
      sessions: ["sess-1", "sess-2"],
      versionId: "v1",
    });

    expect(card.name).toBe("Pipeline");
    expect(card.level).toBe("spec");
    expect(card.parent).toBe("Core");
    expect(card.children).toEqual(["normalize", "classify"]);
    expect(card.related).toEqual(["LLM", "Storage"]);
    expect(card.sessions).toEqual(["sess-1", "sess-2"]);
    expect(card.versionId).toBe("v1");
    expect(card.files).toEqual([
      "src/pipeline/orchestrator.ts",
      "src/adapters/types.ts",
    ]);
    expect(card.summary).toContain("pipeline");
  });

  it("truncates long summaries to ~150 words", () => {
    const longSummary = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const card = generateCard({
      name: "Long",
      level: "area",
      summary: longSummary,
      insights: [],
      sessions: [],
    });

    const wordCount = card.summary.replace(/\.\.\.$/, "").trim().split(/\s+/).length;
    expect(wordCount).toBeLessThanOrEqual(150);
    expect(card.summary.endsWith("...")).toBe(true);
  });

  it("does not truncate summaries at or under 150 words", () => {
    const shortSummary = Array.from({ length: 150 }, (_, i) => `word${i}`).join(" ");
    const card = generateCard({
      name: "Short",
      level: "area",
      summary: shortSummary,
      insights: [],
      sessions: [],
    });

    expect(card.summary.endsWith("...")).toBe(false);
    expect(card.summary).toBe(shortSummary);
  });

  it("selects top 5 insights by confidence", () => {
    const card = generateCard({
      name: "Test",
      level: "spec",
      summary: "A spec.",
      insights: BASE_INSIGHTS,
      sessions: [],
    });

    expect(card.insights.length).toBeLessThanOrEqual(5);
    // Top insight by confidence should be present
    expect(card.insights.some((i) => i.statement === "Uses layered pipeline")).toBe(true);
    // Lowest confidence insight may be excluded
    expect(card.insights.every((i) => i.statement !== "Zod output validation")).toBe(true);
  });

  it("deduplicates identical insight statements", () => {
    const duplicateInsights = [
      { category: "structure", statement: "Duplicate statement", confidence: 0.9 },
      { category: "structure", statement: "Duplicate statement", confidence: 0.8 },
      { category: "decision", statement: "Unique statement", confidence: 0.7 },
    ];

    const card = generateCard({
      name: "Dedup",
      level: "spec",
      summary: "Dedup test.",
      insights: duplicateInsights,
      sessions: [],
    });

    const statements = card.insights.map((i) => i.statement);
    const uniqueStatements = new Set(statements);
    expect(statements.length).toBe(uniqueStatements.size);
  });

  it("limits to 2 insights per category", () => {
    const manyStructure = [
      { category: "structure", statement: "Point A", confidence: 0.9 },
      { category: "structure", statement: "Point B", confidence: 0.85 },
      { category: "structure", statement: "Point C", confidence: 0.8 },
      { category: "structure", statement: "Point D", confidence: 0.75 },
    ];

    const card = generateCard({
      name: "Category",
      level: "spec",
      summary: "Category test.",
      insights: manyStructure,
      sessions: [],
    });

    const structureInsights = card.insights.filter((i) => i.category === "structure");
    expect(structureInsights.length).toBeLessThanOrEqual(2);
  });

  it("handles empty/missing optional fields with sensible defaults", () => {
    const card = generateCard({
      name: "Minimal",
      level: "area",
      summary: "Minimal spec.",
      insights: [],
      sessions: [],
    });

    expect(card.name).toBe("Minimal");
    expect(card.level).toBe("area");
    expect(card.summary).toBe("Minimal spec.");
    expect(card.insights).toEqual([]);
    expect(card.sessions).toEqual([]);
    expect(card.files).toBeUndefined();
    expect(card.parent).toBeUndefined();
    expect(card.children).toBeUndefined();
    expect(card.related).toBeUndefined();
    expect(card.versionId).toBeUndefined();
    expect(card.path).toBeUndefined();
    expect(card.exports).toBeUndefined();
  });

  it("extracts file paths from fileRefs correctly", () => {
    const card = generateCard({
      name: "Files",
      level: "spec",
      summary: "File refs test.",
      insights: [],
      fileRefs: [
        { path: "src/foo.ts", role: "entry" },
        { path: "src/bar.ts", role: "helper" },
        { path: "src/baz.ts", role: "types" },
      ],
      sessions: [],
    });

    expect(card.files).toEqual(["src/foo.ts", "src/bar.ts", "src/baz.ts"]);
  });

  it("handles file-level cards with path and exports", () => {
    const card = generateCard({
      name: "src/brain/cards.ts",
      level: "file",
      summary: "Card generation.",
      insights: [],
      path: "src/brain/cards.ts",
      exports: ["generateCard"],
      sessions: ["sess-1"],
    });

    expect(card.level).toBe("file");
    expect(card.path).toBe("src/brain/cards.ts");
    expect(card.exports).toEqual(["generateCard"]);
  });

  it("handles null parent and path gracefully", () => {
    const card = generateCard({
      name: "Root",
      level: "area",
      summary: "Root area.",
      insights: [],
      parent: null,
      path: null,
      sessions: [],
    });

    expect(card.parent).toBeNull();
    expect(card.path).toBeNull();
  });
});
