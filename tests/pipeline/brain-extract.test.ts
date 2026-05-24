import { describe, it, expect } from "vitest";
import {
  SpecFragmentOutputSchema,
  buildBrainExtractPrompt,
  type BrainExtractInput,
} from "../../src/llm/prompts/brain-extract.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeInput(overrides?: Partial<BrainExtractInput>): BrainExtractInput {
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

describe("SpecFragmentOutputSchema", () => {
  it("parses well-formed fragment JSON", () => {
    const raw = {
      fragments: [
        {
          nameHint: "Caching Layer",
          insights: [
            {
              category: "decision",
              statement: "Redis chosen over Memcached for TTL support",
              evidence: [{ momentId: "m-001", reasoning: "explicit comparison" }],
              confidence: 90,
            },
          ],
          fileRefs: [{ path: "src/cache.ts", role: "cache implementation" }],
        },
      ],
    };

    const result = SpecFragmentOutputSchema.parse(raw);
    expect(result.fragments).toHaveLength(1);
    expect(result.fragments[0].nameHint).toBe("Caching Layer");
    expect(result.fragments[0].insights).toHaveLength(1);
    expect(result.fragments[0].insights[0].category).toBe("decision");
    expect(result.fragments[0].insights[0].confidence).toBe(90);
    expect(result.fragments[0].fileRefs[0].path).toBe("src/cache.ts");
  });

  it("handles insights as object grouped by category", () => {
    const raw = {
      fragments: [
        {
          nameHint: "Pipeline",
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

    const result = SpecFragmentOutputSchema.parse(raw);
    const insights = result.fragments[0].insights;
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
      fragments: [
        {
          nameHint: "Minimal Fragment",
          insights: [
            { category: "behavior", statement: "Retries on failure" },
          ],
        },
      ],
    };

    const result = SpecFragmentOutputSchema.parse(raw);
    const fragment = result.fragments[0];
    expect(fragment.fileRefs).toEqual([]);
    expect(fragment.insights[0].confidence).toBe(80);
    expect(fragment.insights[0].evidence).toEqual([{ reasoning: "implicit" }]);
  });

  it("handles string evidence by wrapping it", () => {
    const raw = {
      fragments: [
        {
          nameHint: "Test",
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

    const result = SpecFragmentOutputSchema.parse(raw);
    expect(result.fragments[0].insights[0].evidence).toEqual([
      { reasoning: "moment m-001 showed brittleness" },
    ]);
  });

  it("falls back from 'name' to 'nameHint' and 'files' to 'fileRefs'", () => {
    const raw = {
      fragments: [
        {
          name: "Aliased Fragment",
          insights: [{ category: "structure", statement: "Component X" }],
          files: [{ path: "src/x.ts", role: "entry" }],
        },
      ],
    };

    const result = SpecFragmentOutputSchema.parse(raw);
    expect(result.fragments[0].nameHint).toBe("Aliased Fragment");
    expect(result.fragments[0].fileRefs).toEqual([{ path: "src/x.ts", role: "entry" }]);
  });
});

// ── Prompt Builder Tests ─────────────────────────────────────────────

describe("buildBrainExtractPrompt", () => {
  it("includes moments and narrative in prompt", () => {
    const input = makeInput();
    const { system, user } = buildBrainExtractPrompt(input);

    expect(system).toContain("CODEBASE knowledge");
    expect(user).toContain("Redis");
    expect(user).toContain("[m-001]");
    expect(user).toContain("[m-002]");
    expect(user).toContain("Chose Redis over Memcached");
    expect(user).toContain("src/cache.ts");
    expect(user).toContain("Considered Memcached but rejected");
  });

  it("does NOT include existingTopics section", () => {
    const input = makeInput();
    const { user } = buildBrainExtractPrompt(input);
    expect(user).not.toContain("Existing Brain State");
    expect(user).not.toContain("existingTopics");
    expect(user).not.toContain("relatedTopics");
  });
});
