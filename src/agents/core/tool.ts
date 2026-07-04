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
 * Converts AgentToolDef array to LangChain StructuredToolInterface array.
 *
 * Each tool is built with the REAL def.schema so that .bindTools() exposes
 * the correct JSON schema (parameter names, types) to the model.
 *
 * Error containment is NOT provided here — use invokeToolContained() in the
 * graph's execute_tools node instead of calling lcTool.invoke() directly.
 */
export function toLangChainTools(defs: AgentToolDef[]): StructuredToolInterface[] {
  return defs.map((def) => {
    return tool(
      async (input: unknown): Promise<string> => {
        const result = await def.execute(input as never);
        if (typeof result === "string") return result;
        return JSON.stringify(result);
      },
      {
        name: def.name,
        description: def.description,
        // Use the real schema so .bindTools() sends correct input_schema to the model.
        schema: def.schema as z.ZodObject<z.ZodRawShape>,
      }
    ) as unknown as StructuredToolInterface;
  });
}

/**
 * Invokes a LangChain tool with full error containment.
 *
 * This is the function the graph's execute_tools node should call instead of
 * lcTool.invoke() directly. It catches:
 *   - LangChain's ToolInputParsingException (schema mismatch before the handler runs)
 *   - Any exception thrown by execute()
 *   - Non-string results are JSON.stringified
 *
 * Never throws. Returns either the tool's string output or "TOOL_ERROR: <message>".
 */
export async function invokeToolContained(
  t: StructuredToolInterface,
  input: unknown
): Promise<string> {
  try {
    const result = await t.invoke(input as never);
    if (typeof result === "string") return result;
    return JSON.stringify(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `TOOL_ERROR: ${msg}`;
  }
}
