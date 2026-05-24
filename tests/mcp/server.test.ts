import { describe, it, expect } from "vitest";
import { formatCard, parseTopic, fuzzyScore, TopicNode } from "../../src/mcp/server.js";

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
