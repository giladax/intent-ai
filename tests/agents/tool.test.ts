import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineTool, toLangChainTools } from "../../src/agents/core/tool.js";

// ── defineTool ──────────────────────────────────────────────────────────────

describe("defineTool", () => {
  it("returns the def unchanged for a valid tool", () => {
    const schema = z.object({ x: z.number() });
    const def = defineTool({
      name: "read_transcript_range",
      description: "Read a slice of the transcript by causal-order range.",
      schema,
      execute: async ({ x }) => x * 2,
    });
    expect(def.name).toBe("read_transcript_range");
    expect(def.description).toBe("Read a slice of the transcript by causal-order range.");
  });

  it("throws if name is not snake_case", () => {
    expect(() =>
      defineTool({
        name: "readTranscript",
        description: "Some description.",
        schema: z.object({}),
        execute: async () => {},
      })
    ).toThrow(/name must be snake_case/i);
  });

  it("throws if name has spaces", () => {
    expect(() =>
      defineTool({
        name: "read transcript",
        description: "Some description.",
        schema: z.object({}),
        execute: async () => {},
      })
    ).toThrow(/name must be snake_case/i);
  });

  it("throws if description is empty", () => {
    expect(() =>
      defineTool({
        name: "valid_name",
        description: "",
        schema: z.object({}),
        execute: async () => {},
      })
    ).toThrow(/description must be non-empty/i);
  });

  it("throws if description is whitespace only", () => {
    expect(() =>
      defineTool({
        name: "valid_name",
        description: "   ",
        schema: z.object({}),
        execute: async () => {},
      })
    ).toThrow(/description must be non-empty/i);
  });
});

// ── toLangChainTools ────────────────────────────────────────────────────────

describe("toLangChainTools", () => {
  it("wraps a valid tool and executes it", async () => {
    const def = defineTool({
      name: "double_number",
      description: "Doubles a number.",
      schema: z.object({ value: z.number() }),
      execute: async ({ value }) => value * 2,
    });

    const [lcTool] = toLangChainTools([def]);
    // LangChain tools accept string or object input
    const result = await lcTool.invoke({ value: 5 });
    // The result should be the serialized output
    expect(result).toContain("10");
  });

  it("returns TOOL_ERROR string when input fails Zod parse, does not throw", async () => {
    const def = defineTool({
      name: "strict_tool",
      description: "Requires a number.",
      schema: z.object({ value: z.number() }),
      execute: async ({ value }) => value,
    });

    const [lcTool] = toLangChainTools([def]);
    // Pass bad input — string instead of number
    const result = await lcTool.invoke({ value: "not-a-number" } as unknown as { value: number });
    expect(typeof result).toBe("string");
    expect(result).toMatch(/^TOOL_ERROR:/);
  });

  it("returns TOOL_ERROR string when execute() throws, does not throw into caller", async () => {
    const def = defineTool({
      name: "exploding_tool",
      description: "Always throws.",
      schema: z.object({ x: z.string() }),
      execute: async () => {
        throw new Error("kaboom");
      },
    });

    const [lcTool] = toLangChainTools([def]);
    const result = await lcTool.invoke({ x: "anything" });
    expect(typeof result).toBe("string");
    expect(result).toMatch(/^TOOL_ERROR:/);
    expect(result).toContain("kaboom");
  });

  it("preserves tool name and description on the LangChain tool", () => {
    const def = defineTool({
      name: "list_tool_events",
      description: "Lists tool events in a span.",
      schema: z.object({ start: z.number(), end: z.number() }),
      execute: async () => [],
    });

    const [lcTool] = toLangChainTools([def]);
    expect(lcTool.name).toBe("list_tool_events");
    expect(lcTool.description).toBe("Lists tool events in a span.");
  });

  it("converts multiple defs to independent tools", () => {
    const defs = [
      defineTool({ name: "tool_a", description: "First.", schema: z.object({}), execute: async () => "a" }),
      defineTool({ name: "tool_b", description: "Second.", schema: z.object({}), execute: async () => "b" }),
    ];
    const lcTools = toLangChainTools(defs);
    expect(lcTools).toHaveLength(2);
    expect(lcTools[0].name).toBe("tool_a");
    expect(lcTools[1].name).toBe("tool_b");
  });
});
