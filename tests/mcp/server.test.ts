import { describe, it, expect } from "vitest";
import { formatCard, parseTopic, fuzzyScore, type TopicNode } from "../../src/mcp/server.js";

describe("formatCard", () => {
  it("produces structured card with all sections", () => {
    const node: TopicNode = {
      name: "Pipeline Orchestration",
      slug: "pipeline-orchestration",
      summary: "The pipeline orchestrator transforms CC logs into structured SessionNarrative outputs.",
      parent: null,
      children: ["Database Infrastructure", "Moment Detection"],
      related: ["Brain Versioning"],
      insights: [
        { category: "structure", statement: "Two-model strategy: Haiku for classification, Sonnet for detection." },
        { category: "constraint", statement: "Must use streaming API." },
        { category: "decision", statement: "CC logs chosen over git diffs." },
        { category: "behavior", statement: "Single process, no IPC." },
      ],
      files: ["src/pipeline/orchestrator.ts", "src/cli/digest.ts", "src/llm/client.ts"],
      sessions: [{ date: "May 21", summary: "Built v2 from scratch", moments: 13 }],
      fullMarkdown: "",
    };

    const card = formatCard(node);
    expect(card).toContain("### Pipeline Orchestration");
    expect(card).not.toContain("↑"); // no parent
    expect(card).toContain("2 sub-specs");
    expect(card).toContain("3 files");
    expect(card).toContain("[structure]");
    expect(card).toContain("[constraint]");
    expect(card).toContain("[decision]");
    expect(card).not.toContain("[behavior]"); // max 3 categories
    expect(card).toContain("Database Infrastructure");
  });

  it("shows parent for child nodes", () => {
    const node: TopicNode = {
      name: "Database Infrastructure",
      slug: "database-infrastructure",
      summary: "Postgres + Drizzle ORM storage layer.",
      parent: "Pipeline Orchestration",
      children: [],
      related: [],
      insights: [{ category: "constraint", statement: "pgvector required." }],
      files: ["drizzle.config.ts"],
      sessions: [],
      fullMarkdown: "",
    };

    const card = formatCard(node);
    expect(card).toContain("↑ Pipeline Orchestration");
    expect(card).not.toContain("sub-specs");
  });
});

describe("fuzzyScore", () => {
  it("returns 1.0 for exact substring match", () => {
    expect(fuzzyScore("pipeline", "The pipeline orchestrator")).toBe(1.0);
  });

  it("returns partial score for word overlap", () => {
    const score = fuzzyScore("moment detection", "detecting moments in sessions");
    expect(score).toBeGreaterThan(0); // partial match via token containment
    // Exact substring match
    expect(fuzzyScore("pipeline", "The pipeline orchestrator")).toBe(1.0);
  });

  it("returns 0 for no match", () => {
    expect(fuzzyScore("banana", "pipeline orchestrator")).toBe(0);
  });
});

describe("parseTopic", () => {
  it("extracts parent from breadcrumb", () => {
    const md = `# Child Topic\n\n> Parent: [Pipeline Orchestration](pipeline-orchestration.md)\n\nSome summary here.`;
    const node = parseTopic("child-topic", md);
    expect(node.parent).toBe("Pipeline Orchestration");
    expect(node.name).toBe("Child Topic");
    expect(node.summary).toBe("Some summary here.");
  });

  it("extracts insights by category", () => {
    const md = `# Test\n\nSummary text.\n\n## constraint\n\n- Must use streaming.\n- No SQLite.\n\n## decision\n\n- Chose Postgres.`;
    const node = parseTopic("test", md);
    expect(node.insights).toHaveLength(3);
    expect(node.insights[0]).toEqual({ category: "constraint", statement: "Must use streaming." });
    expect(node.insights[2]).toEqual({ category: "decision", statement: "Chose Postgres." });
  });

  it("extracts children from breadcrumb", () => {
    const md = `# Root\n\n> Children: [Child A](child-a.md), [Child B](child-b.md)\n\nRoot summary.`;
    const node = parseTopic("root", md);
    expect(node.children).toEqual(["Child A", "Child B"]);
  });
});
