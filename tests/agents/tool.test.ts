import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineTool, toLangChainTools, invokeToolContained } from "../../src/agents/core/tool.js";

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

  it("exposes the real ZodObject schema so .bindTools() sees correct parameter names", () => {
    // This is the schema-exposure regression test: proves the model would see
    // the actual parameter definitions, not a permissive passthrough.
    const def = defineTool({
      name: "schema_exposure_tool",
      description: "Tool with a known schema.",
      schema: z.object({ n: z.number(), label: z.string() }),
      execute: async ({ n }) => n,
    });

    const [lcTool] = toLangChainTools([def]);

    // The schema property on the LangChain tool must be the real ZodObject,
    // not a ZodRecord passthrough.
    const schema = (lcTool as unknown as { schema: unknown }).schema;
    expect(schema).toBeDefined();
    expect((schema as { constructor: { name: string } }).constructor.name).toBe("ZodObject");

    // shape must contain the actual parameter names
    const shape = (schema as { shape?: Record<string, unknown> }).shape;
    expect(shape).toBeDefined();
    expect("n" in (shape ?? {})).toBe(true);
    expect("label" in (shape ?? {})).toBe(true);
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

// ── invokeToolContained ─────────────────────────────────────────────────────

describe("invokeToolContained", () => {
  it("returns the tool's string result for valid input", async () => {
    const def = defineTool({
      name: "greet_tool",
      description: "Returns a greeting.",
      schema: z.object({ name: z.string() }),
      execute: async ({ name }) => `Hello, ${name}!`,
    });
    const [lcTool] = toLangChainTools([def]);
    const result = await invokeToolContained(lcTool, { name: "World" });
    expect(result).toBe("Hello, World!");
  });

  it("returns TOOL_ERROR when schema validation fails, does not throw", async () => {
    const def = defineTool({
      name: "strict_number_tool",
      description: "Requires a number.",
      schema: z.object({ value: z.number() }),
      execute: async ({ value }) => value,
    });
    const [lcTool] = toLangChainTools([def]);
    // Pass string instead of number — should trigger schema validation failure
    const result = await invokeToolContained(lcTool, { value: "not-a-number" });
    expect(typeof result).toBe("string");
    expect(result).toMatch(/^TOOL_ERROR:/);
  });

  it("returns TOOL_ERROR when execute() throws, does not throw into caller", async () => {
    const def = defineTool({
      name: "exploding_contained_tool",
      description: "Always throws.",
      schema: z.object({ x: z.string() }),
      execute: async () => {
        throw new Error("contained-kaboom");
      },
    });
    const [lcTool] = toLangChainTools([def]);
    const result = await invokeToolContained(lcTool, { x: "anything" });
    expect(typeof result).toBe("string");
    expect(result).toMatch(/^TOOL_ERROR:/);
    expect(result).toContain("contained-kaboom");
  });

  it("JSON.stringifies object results", async () => {
    const def = defineTool({
      name: "object_result_tool",
      description: "Returns an object.",
      schema: z.object({}),
      execute: async () => ({ key: "value", count: 42 }),
    });
    const [lcTool] = toLangChainTools([def]);
    const result = await invokeToolContained(lcTool, {});
    expect(typeof result).toBe("string");
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ key: "value", count: 42 });
  });
});
