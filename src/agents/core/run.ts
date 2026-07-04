/**
 * runAgent — invoke the compiled agent graph and return a typed AgentResult.
 *
 * This is the primary entry point for all agents built on this core.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { buildAgentGraph } from "./graph.js";
import type { AgentConfig, AgentResult } from "./types.js";

/**
 * Run an agent to completion given a text input.
 *
 * @param config        AgentConfig including required outputSchema
 * @param input         The initial user message
 * @param modelOverride Optional model stub (for tests, skips ChatAnthropic)
 */
export async function runAgent<T>(
  config: AgentConfig & { outputSchema: z.ZodType<T> },
  input: string,
  modelOverride?: BaseChatModel
): Promise<AgentResult<T>> {
  const graph = buildAgentGraph(config, modelOverride);

  const finalState = await graph.invoke({
    messages: [new HumanMessage(input)],
  });

  // Extract output — check for __partial sentinel
  const rawOutput = finalState.output as
    | { __partial?: boolean; __rawFinal?: string }
    | T
    | null;

  let output: T | null = null;
  let partial = false;
  let rawFinal: string | undefined;

  if (rawOutput && typeof rawOutput === "object" && (rawOutput as { __partial?: boolean }).__partial) {
    partial = true;
    output = null;
    rawFinal = (rawOutput as { __partial?: boolean; __rawFinal?: string }).__rawFinal;
  } else if (rawOutput !== null && rawOutput !== undefined) {
    output = rawOutput as T;
    partial = false;
  } else {
    // null output with no partial flag — shouldn't happen, treat as partial
    partial = true;
    output = null;
  }

  const stats: AgentResult<T>["stats"] = {
    turns: finalState.turns,
    tokensUsed: finalState.tokensUsed,
    toolCalls: finalState.toolCallStats,
    repairs: finalState.repairs,
  };

  if (partial) {
    return { output, partial, stats, rawFinal };
  }

  return { output, partial, stats };
}
