import { describe, it, expect } from "vitest";
import {
  WrittenSpecSchema,
  buildBrainWritePrompt,
  type SpecWriteInput,
} from "../../src/llm/prompts/brain-write.js";
import type { SpecFragment } from "../../src/llm/prompts/brain-extract.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeFragment(overrides: Partial<SpecFragment> = {}): SpecFragment {
  return {
    nameHint: "Pipeline Architecture",
    insights: [
      {
        category: "structure",
        statement: "Orchestrator runs each pipeline step as a pure function",
        evidence: [{ momentId: "m-001", reasoning: "stated in arc" }],
        confidence: 90,
      },
    ],
    fileRefs: [{ path: "src/pipeline/orchestrator.ts", role: "main runner" }],
    ...overrides,
  } as SpecFragment;
}

function makeInput(overrides: Partial<SpecWriteInput> = {}): SpecWriteInput {
  return {
    specName: "Pipeline Architecture",
    fragments: [makeFragment()],
    treeContext: {},
    ...overrides,
  };
}

// ── Schema Tests ─────────────────────────────────────────────────────

describe("WrittenSpecSchema", () => {
  it("parses well-formed written spec JSON", () => {
    const raw = {
      name: "Pipeline Architecture",
      summary: "The pipeline transforms Claude Code logs into execution memory through a series of pure function steps.",
      insights: [
        {
          category: "structure",
          statement: "Each pipeline step is a pure function — no classes, no shared state",
          evidence: [{ momentId: "m-001", reasoning: "explicit in CLAUDE.md conventions" }],
          confidence: 95,
        },
        {
          category: "decision",
          statement: "Sonnet is used for reasoning steps, Haiku for classification",
          evidence: [{ momentId: "m-002", reasoning: "cost-quality tradeoff" }],
          confidence: 88,
        },
      ],
      fileRefs: [
        { path: "src/pipeline/orchestrator.ts", role: "end-to-end runner" },
        { path: "src/adapters/types.ts", role: "shared domain types" },
      ],
    };

    const result = WrittenSpecSchema.parse(raw);
    expect(result.name).toBe("Pipeline Architecture");
    expect(result.summary).toContain("execution memory");
    expect(result.insights).toHaveLength(2);
    expect(result.insights[0].category).toBe("structure");
    expect(result.insights[1].category).toBe("decision");
    expect(result.fileRefs).toHaveLength(2);
    expect(result.fileRefs[0].path).toBe("src/pipeline/orchestrator.ts");
  });

  it("handles insights as object grouped by category", () => {
    const raw = {
      name: "Caching Layer",
      summary: "Redis-backed cache with TTL and invalidation on write.",
      insights: {
        structure: [
          {
            statement: "Cache wraps all DB reads in read-through pattern",
            evidence: [{ momentId: "m-010", reasoning: "implementation detail" }],
            confidence: 85,
          },
        ],
        constraint: ["Cache TTL must not exceed 5 minutes for consistency"],
      },
      fileRefs: [],
    };

    const result = WrittenSpecSchema.parse(raw);
    expect(result.insights).toHaveLength(2);
    expect(result.insights[0].category).toBe("structure");
    expect(result.insights[0].statement).toContain("read-through");
    expect(result.insights[1].category).toBe("constraint");
    expect(result.insights[1].statement).toContain("5 minutes");
    expect(result.insights[1].confidence).toBe(80); // default for string insights
  });

  it("applies defaults for missing optional fields", () => {
    const raw = {
      name: "Minimal Spec",
      insights: [
        { category: "behavior", statement: "Retries on transient failures" },
      ],
    };

    const result = WrittenSpecSchema.parse(raw);
    expect(result.summary).toBe("");
    expect(result.fileRefs).toEqual([]);
    expect(result.insights[0].confidence).toBe(80);
    expect(result.insights[0].evidence).toEqual([{ reasoning: "implicit" }]);
  });

  it("uses description alias for summary", () => {
    const raw = {
      name: "Aliased Spec",
      description: "This is the summary written as description by the LLM.",
      insights: [{ category: "structure", statement: "Has a structure" }],
      fileRefs: [],
    };

    const result = WrittenSpecSchema.parse(raw);
    expect(result.summary).toBe("This is the summary written as description by the LLM.");
  });

  it("uses files alias for fileRefs", () => {
    const raw = {
      name: "Aliased FileRefs Spec",
      summary: "A spec where the LLM used 'files' instead of 'fileRefs'.",
      insights: [{ category: "interface", statement: "Exposes REST API" }],
      files: [
        { path: "src/web/server.ts", role: "HTTP server" },
        "src/web/routes.ts",
      ],
    };

    const result = WrittenSpecSchema.parse(raw);
    expect(result.fileRefs).toHaveLength(2);
    expect(result.fileRefs[0].path).toBe("src/web/server.ts");
    expect(result.fileRefs[0].role).toBe("HTTP server");
    expect(result.fileRefs[1].path).toBe("src/web/routes.ts");
    expect(result.fileRefs[1].role).toBe(""); // string path gets empty role
  });

  it("parses written spec with patterns", () => {
    const raw = {
      name: "Pipeline",
      summary: "Core pipeline system",
      insights: { structure: [{ statement: "two-pass", confidence: 80 }] },
      fileRefs: [{ path: "src/pipeline/orchestrator.ts", role: "core" }],
      patterns: [{
        type: "request",
        statement: "agents ask how to add pipeline nodes",
        frequency: 3,
        confidence: "high",
        fileAssociations: ["orchestrator.ts", "types.ts"],
        evidence: [{ sessionId: "s1", momentId: "m1" }],
      }],
    };
    const result = WrittenSpecSchema.parse(raw);
    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0].type).toBe("request");
  });

  it("defaults patterns to empty array", () => {
    const raw = {
      name: "Pipeline",
      summary: "Core pipeline",
      insights: { structure: [{ statement: "test", confidence: 80 }] },
      fileRefs: [],
    };
    const result = WrittenSpecSchema.parse(raw);
    expect(result.patterns).toEqual([]);
  });

  it("parses written spec with candidateSkills", () => {
    const raw = {
      name: "Pipeline",
      summary: "Core pipeline",
      insights: { structure: [{ statement: "test", confidence: 80 }] },
      fileRefs: [],
      patterns: [],
      candidateSkills: [{
        name: "Add Pipeline Node",
        description: "Steps to add a new processing node",
        steps: [
          { order: 1, instruction: "Create src/pipeline/<name>.ts", files: ["src/pipeline/"] },
          { order: 2, instruction: "Add types to types.ts", files: ["src/adapters/types.ts"] },
        ],
        pitfalls: ["Don't forget to wire into orchestrator.ts"],
        files: ["src/pipeline/", "src/adapters/types.ts", "src/pipeline/orchestrator.ts"],
        evidence: [{ sessionId: "s1", momentId: "m1" }],
      }],
    };
    const result = WrittenSpecSchema.parse(raw);
    expect(result.candidateSkills).toHaveLength(1);
    expect(result.candidateSkills[0].steps).toHaveLength(2);
    expect(result.candidateSkills[0].name).toBe("Add Pipeline Node");
  });

  it("defaults candidateSkills to empty array", () => {
    const raw = {
      name: "Pipeline",
      summary: "Core pipeline",
      insights: { structure: [{ statement: "test", confidence: 80 }] },
      fileRefs: [],
    };
    const result = WrittenSpecSchema.parse(raw);
    expect(result.candidateSkills).toEqual([]);
  });

  it("does NOT include relatedTopics field", () => {
    const raw = {
      name: "No Related Topics",
      summary: "This spec should not have relatedTopics.",
      insights: [{ category: "decision", statement: "Stand-alone decision" }],
      fileRefs: [],
    };

    const result = WrittenSpecSchema.parse(raw);
    // relatedTopics is not part of WrittenSpecSchema
    expect((result as any).relatedTopics).toBeUndefined();
  });
});

// ── Prompt Builder Tests ─────────────────────────────────────────────

describe("buildBrainWritePrompt", () => {
  it("includes spec name and fragments in prompt", () => {
    const input = makeInput();
    const { system, user } = buildBrainWritePrompt(input);

    expect(system).toContain("LIVING DESIGN DOCUMENT");
    expect(user).toContain("Pipeline Architecture");
    expect(user).toContain("Orchestrator runs each pipeline step");
    expect(user).toContain("src/pipeline/orchestrator.ts");
    expect(user).toContain("m-001");
  });

  it("includes tree context with parent spec", () => {
    const input = makeInput({
      specName: "Moment Detection",
      treeContext: {
        parentSpec: {
          name: "Pipeline Architecture",
          summary: "The pipeline transforms CC logs into execution memory.",
        },
        childSpecs: [],
      },
    });

    const { user } = buildBrainWritePrompt(input);

    expect(user).toContain("Tree Context");
    expect(user).toContain("Parent Spec");
    expect(user).toContain("Pipeline Architecture");
    expect(user).toContain("transforms CC logs into execution memory");
  });

  it("includes tree context with child specs", () => {
    const input = makeInput({
      specName: "Pipeline Architecture",
      treeContext: {
        childSpecs: ["Moment Detection", "Narrative Generation", "Session Digest"],
      },
    });

    const { user } = buildBrainWritePrompt(input);

    expect(user).toContain("Tree Context");
    expect(user).toContain("Child Specs");
    expect(user).toContain("Moment Detection");
    expect(user).toContain("Narrative Generation");
    expect(user).toContain("Session Digest");
  });

  it("includes both parent and child specs in tree context", () => {
    const input = makeInput({
      specName: "Digestion Pipeline",
      treeContext: {
        parentSpec: { name: "System Overview", summary: "Top-level architecture." },
        childSpecs: ["Moment Detection", "Transition Analysis"],
      },
    });

    const { user } = buildBrainWritePrompt(input);

    expect(user).toContain("Parent Spec");
    expect(user).toContain("System Overview");
    expect(user).toContain("Child Specs");
    expect(user).toContain("Moment Detection");
    expect(user).toContain("Transition Analysis");
  });

  it("includes existing content when updating", () => {
    const input = makeInput({
      existingContent: {
        summary: "Existing summary of the pipeline concept.",
        insights: [
          { category: "structure", statement: "Uses functional pipeline pattern" },
          { category: "decision", statement: "No classes, only exported functions" },
        ],
      },
    });

    const { user } = buildBrainWritePrompt(input);

    expect(user).toContain("Existing Spec Content");
    expect(user).toContain("Existing summary of the pipeline concept.");
    expect(user).toContain("Uses functional pipeline pattern");
    expect(user).toContain("No classes, only exported functions");
  });

  it("omits existing content section when creating new spec", () => {
    const input = makeInput({
      existingContent: undefined,
    });

    const { user } = buildBrainWritePrompt(input);

    expect(user).not.toContain("Existing Spec Content");
    expect(user).not.toContain("Evolve This");
  });

  it("includes all fragments with insights and evidence", () => {
    const input = makeInput({
      fragments: [
        makeFragment({ nameHint: "Fragment Alpha" }),
        makeFragment({
          nameHint: "Fragment Beta",
          insights: [
            {
              category: "constraint",
              statement: "Must use port 5433, not 5432",
              evidence: [{ momentId: "m-099", reasoning: "docker-compose sets port explicitly" }],
              confidence: 100,
            },
          ],
        }),
      ],
    });

    const { user } = buildBrainWritePrompt(input);

    expect(user).toContain("Fragment Alpha");
    expect(user).toContain("Fragment Beta");
    expect(user).toContain("Must use port 5433");
    expect(user).toContain("m-099");
    expect(user).toContain("docker-compose sets port explicitly");
  });

  it("omits tree context section when treeContext is empty", () => {
    const input = makeInput({ treeContext: {} });

    const { user } = buildBrainWritePrompt(input);

    expect(user).not.toContain("Tree Context");
  });
});
