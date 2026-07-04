import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import type { AgentToolDef } from "./types.js";

// Snake_case validation: only lowercase letters, digits, and underscores; must not start with digit.
const SNAKE_CASE_RE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

/**
 * Identity function + validation.
 * Validates name is snake_case and description is non-empty.
 * Throws a descriptive error for invalid definitions.
 */
export function defineTool<I, O>(def: AgentToolDef<I, O>): AgentToolDef<I, O> {
  if (!SNAKE_CASE_RE.test(def.name)) {
    throw new Error(
      `defineTool: name must be snake_case (got "${def.name}"). Use lowercase letters, digits, and underscores only.`
    );
  }
  if (!def.description || !def.description.trim()) {
    throw new Error(
      `defineTool: description must be non-empty (tool "${def.name}" has an empty description).`
    );
  }
  return def;
}

/**
 * A passthrough schema used as the LangChain-facing schema.
 * We pass any object through to LangChain without validation at the boundary,
 * then apply the real AgentToolDef schema inside the tool body.
 * This lets us contain Zod parse errors as tool-result strings rather than
 * letting LangChain throw a ToolInputParsingException into the graph.
 */
const passthroughSchema = z.record(z.string(), z.unknown());

/**
 * Converts AgentToolDef array to LangChain StructuredToolInterface array.
 *
 * Error containment:
 * - Zod parse failure → returns "TOOL_ERROR: <message>" string (never throws)
 * - execute() throw   → returns "TOOL_ERROR: <message>" string (never throws)
 *
 * The graph loop sees a tool-result message and continues normally.
 */
export function toLangChainTools(defs: AgentToolDef[]): StructuredToolInterface[] {
  return defs.map((def) => {
    return tool(
      async (input: Record<string, unknown>): Promise<string> => {
        // Apply the real schema — Zod v4 safeParseAsync
        const parsed = await def.schema.safeParseAsync(input);
        if (!parsed.success) {
          // Zod v4 error: use .message or prettify if available
          const err = parsed.error;
          const msg = err?.message ?? String(err);
          return `TOOL_ERROR: ${msg}`;
        }

        // execute with contained errors
        try {
          const result = await def.execute(parsed.data);
          if (typeof result === "string") return result;
          return JSON.stringify(result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return `TOOL_ERROR: ${msg}`;
        }
      },
      {
        name: def.name,
        description: def.description,
        // Use the passthrough schema at the LangChain boundary so parse errors
        // are never thrown by LangChain before reaching our handler.
        schema: passthroughSchema,
      }
    ) as unknown as StructuredToolInterface;
  });
}
