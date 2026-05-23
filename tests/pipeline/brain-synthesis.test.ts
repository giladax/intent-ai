import { describe, it, expect } from "vitest";
import {
  BrainSynthesisOutputSchema,
  buildBrainSynthesisPrompt,
  type BrainSynthesisInput,
} from "../../src/llm/prompts/brain-synthesis.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeInput(overrides?: Partial<BrainSynthesisInput>): BrainSynthesisInput {
  return {
    sessionNarrative: {
      summary: "Implemented caching layer with Redis",
      arcs: [{ title: "Redis integration", resolution: "completed" }],
      abandonedDirections: ["Considered Memcached but rejected"],
    },
    moments: [
      {
        id: "m-001",
        type: "decision",
        statement: "Chose Redis over Memcached for caching",
        agency: "developer",
        significance: "high",
      },
      {
        id: "m-002",
        type: "implementation",
        statement: "Added cache invalidation on write",
        agency: "collaborative",
        significance: "medium",
      },
    ],
    outcomes: [
      { statement: "Redis caching integrated", files: ["src/cache.ts", "src/config.ts"] },
    ],
    filesTouched: ["src/cache.ts", "src/config.ts", "src/index.ts"],
    ...overrides,
  };
}

// ── Schema Tests ─────────────────────────────────────────────────────

describe("BrainSynthesisOutputSchema", () => {
  it("parses well-formed topic JSON", () => {
    const raw = {
      topics: [
        {
          name: "Caching Layer",
          summary: "Redis-based caching for query results",
          insights: [
            {
              category: "decision",
              statement: "Redis chosen over Memcached for TTL support",
              evidence: [{ momentId: "m-001", reasoning: "explicit comparison" }],
              confidence: 90,
            },
          ],
          fileRefs: [{ path: "src/cache.ts", role: "cache implementation" }],
          relatedTopics: ["Database"],
        },
      ],
    };

    const result = BrainSynthesisOutputSchema.parse(raw);
    expect(result.topics).toHaveLength(1);
    expect(result.topics[0].name).toBe("Caching Layer");
    expect(result.topics[0].insights).toHaveLength(1);
    expect(result.topics[0].insights[0].category).toBe("decision");
    expect(result.topics[0].insights[0].confidence).toBe(90);
    expect(result.topics[0].fileRefs[0].path).toBe("src/cache.ts");
  });

  it("handles insights as object grouped by category", () => {
    const raw = {
      topics: [
        {
          name: "Pipeline",
          insights: {
            structure: [
              {
                statement: "Two-pass moment detection",
                evidence: [{ momentId: "m-001", reasoning: "stated in arc" }],
                confidence: 85,
              },
            ],
            decision: ["Chose Sonnet for reasoning"],
          },
        },
      ],
    };

    const result = BrainSynthesisOutputSchema.parse(raw);
    const insights = result.topics[0].insights;
    expect(insights).toHaveLength(2);
    expect(insights[0].category).toBe("structure");
    expect(insights[0].statement).toBe("Two-pass moment detection");
    expect(insights[1].category).toBe("decision");
    expect(insights[1].statement).toBe("Chose Sonnet for reasoning");
    // String insight gets default confidence
    expect(insights[1].confidence).toBe(80);
  });

  it("applies defaults for missing optional fields", () => {
    const raw = {
      topics: [
        {
          name: "Minimal Topic",
          insights: [
            { category: "behavior", statement: "Retries on failure" },
          ],
        },
      ],
    };

    const result = BrainSynthesisOutputSchema.parse(raw);
    const topic = result.topics[0];
    expect(topic.summary).toBe("");
    expect(topic.fileRefs).toEqual([]);
    expect(topic.relatedTopics).toEqual([]);
    expect(topic.insights[0].confidence).toBe(80);
    expect(topic.insights[0].evidence).toEqual([{ reasoning: "implicit" }]);
  });

  it("handles string evidence by wrapping it", () => {
    const raw = {
      topics: [
        {
          name: "Test",
          insights: [
            {
              category: "risk",
              statement: "Fragile parsing",
              evidence: "moment m-001 showed brittleness",
              confidence: 70,
            },
          ],
        },
      ],
    };

    const result = BrainSynthesisOutputSchema.parse(raw);
    expect(result.topics[0].insights[0].evidence).toEqual([
      { reasoning: "moment m-001 showed brittleness" },
    ]);
  });

  it("falls back from 'description' to 'summary' and 'files' to 'fileRefs'", () => {
    const raw = {
      topics: [
        {
          name: "Aliased Fields",
          description: "A topic with description instead of summary",
          insights: [{ category: "structure", statement: "Component X" }],
          files: [{ path: "src/x.ts", role: "entry" }],
        },
      ],
    };

    const result = BrainSynthesisOutputSchema.parse(raw);
    expect(result.topics[0].summary).toBe("A topic with description instead of summary");
    expect(result.topics[0].fileRefs).toEqual([{ path: "src/x.ts", role: "entry" }]);
  });
});

// ── Prompt Builder Tests ─────────────────────────────────────────────

describe("buildBrainSynthesisPrompt", () => {
  it("includes moments and session narrative in prompt", () => {
    const input = makeInput();
    const { system, user } = buildBrainSynthesisPrompt(input);

    expect(system).toContain("CODEBASE knowledge");
    expect(user).toContain("Redis");
    expect(user).toContain("[m-001]");
    expect(user).toContain("[m-002]");
    expect(user).toContain("Chose Redis over Memcached");
    expect(user).toContain("src/cache.ts");
    expect(user).toContain("Considered Memcached but rejected");
  });

  it("includes existing topics section when provided", () => {
    const input = makeInput({
      existingTopics: [
        {
          name: "Database",
          summary: "Postgres-based storage",
          insights: [{ category: "structure", statement: "Uses Drizzle ORM" }],
        },
      ],
    });

    const { user } = buildBrainSynthesisPrompt(input);
    expect(user).toContain("Existing Brain State");
    expect(user).toContain("Database");
    expect(user).toContain("Uses Drizzle ORM");
  });

  it("omits existing topics section when none provided", () => {
    const input = makeInput({ existingTopics: undefined });
    const { user } = buildBrainSynthesisPrompt(input);
    expect(user).not.toContain("Existing Brain State");
  });
});
