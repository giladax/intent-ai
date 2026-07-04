/**
 * Core LangGraph agent loop.
 *
 * Topology:
 *   call_model
 *     ├── (has tool_calls) → execute_tools → budget_guard → call_model
 *     └── (no tool_calls)  → finalize
 *           ├── (valid + custom nodes pass) → END
 *           ├── (invalid or custom bounce, repairs < MAX_REPAIRS) → call_model
 *           └── (repairs exhausted) → END (partial: true)
 */

import {
  Annotation,
  END,
  MessagesAnnotation,
  START,
  StateGraph,
  type CompiledStateGraph,
} from "@langchain/langgraph";
import { type BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { invokeToolContained, toLangChainTools } from "./tool.js";
import type { AgentConfig, AgentResult } from "./types.js";

// ── Re-export CustomNode so graph.ts owns the full interface ────────────────

export interface CustomNode {
  name: string;
  /**
   * Runs after outputSchema validation passes.
   * Returns null to accept, or repair instructions (string) to bounce back to
   * the model.
   */
  check: (output: unknown, state: AgentState) => Promise<string | null>;
}

// ── AgentState ──────────────────────────────────────────────────────────────

const GraphAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  turns: Annotation<number>({
    reducer: (a, b) => a + b,
    default: () => 0,
  }),
  tokensUsed: Annotation<number>({
    reducer: (a, b) => a + b,
    default: () => 0,
  }),
  output: Annotation<unknown>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  repairs: Annotation<number>({
    reducer: (a, b) => a + b,
    default: () => 0,
  }),
  // Internal flag: set to true when budget exhausted so finalize knows
  budgetExhausted: Annotation<boolean>({
    reducer: (_a, b) => b,
    default: () => false,
  }),
  // Accumulated tool call stats for AgentResult.stats
  toolCallStats: Annotation<{ name: string; ms: number }[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
});

export type AgentState = typeof GraphAnnotation.State;

// ── Constants ───────────────────────────────────────────────────────────────

const MAX_REPAIRS = 2;
const FINAL_OUTPUT_TOOL = "final_output";
const BUDGET_NUDGE =
  "budget exhausted — produce your final structured output now";

// ── Graph builder ───────────────────────────────────────────────────────────

/**
 * Build and compile the agent graph.
 *
 * @param config   AgentConfig driving the loop
 * @param modelOverride  Optional fake/stub model for tests (skips ChatAnthropic)
 */
export function buildAgentGraph(
  config: AgentConfig & { outputSchema: z.ZodType },
  modelOverride?: BaseChatModel
): CompiledStateGraph<
  typeof GraphAnnotation.State,
  typeof GraphAnnotation.Update,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  any,
  any,
  any
> {
  const lcTools = toLangChainTools(config.tools);

  // ── Model with tools bound ────────────────────────────────────────────────

  const baseModel: BaseChatModel =
    modelOverride ??
    new ChatAnthropic({
      model: config.model ?? "claude-sonnet-4-6",
      maxTokens: config.maxTokens,
    });

  // bindTools is declared optional on BaseChatModel but always present on
  // ChatAnthropic and our ScriptedFakeChatModel; assert it's defined.
  if (typeof baseModel.bindTools !== "function") {
    throw new Error("Model must implement bindTools()");
  }

  // Model used for normal turns (tools bound)
  const modelWithTools = baseModel.bindTools(lcTools);

  // Build a forced-tool-choice model for the finalize pass.
  // We construct a "final_output" tool from the outputSchema so the model
  // must call it with the validated output.
  const finalOutputSchema = z.object({
    result: config.outputSchema,
  });
  const finalOutputLCTool = toLangChainTools([
    {
      name: FINAL_OUTPUT_TOOL,
      description:
        "Emit your final structured output. Call this tool exactly once with your answer.",
      schema: finalOutputSchema,
      execute: async (input: unknown) => JSON.stringify(input),
    },
  ])[0]!;

  // Model forced to call final_output (no other tools)
  const finalModel = baseModel.bindTools([finalOutputLCTool], {
    tool_choice: FINAL_OUTPUT_TOOL,
  });

  // ── Nodes ─────────────────────────────────────────────────────────────────

  // call_model — main LLM turn
  async function callModelNode(state: AgentState) {
    const isBudgetExhausted = state.budgetExhausted;

    // Choose which model to run:
    // - If budget was just exhausted, use the final model (forced tool choice)
    // - Otherwise use normal model with tools
    const model = isBudgetExhausted ? finalModel : modelWithTools;

    const messagesForModel = buildMessagesForModel(state, config, isBudgetExhausted);
    const response = await model.invoke(messagesForModel);

    const aiMsg = response as AIMessage;
    const usage = aiMsg.usage_metadata;
    const newTokens = usage
      ? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
      : 0;

    return {
      messages: [aiMsg],
      turns: 1,
      tokensUsed: newTokens,
    };
  }

  // execute_tools — run all tool calls from the last AI message
  async function executeToolsNode(state: AgentState) {
    const lastMsg = state.messages[state.messages.length - 1] as AIMessage;
    const toolCalls = lastMsg.tool_calls ?? [];

    const toolMap = new Map(lcTools.map((t) => [t.name, t]));
    const toolMessages: ToolMessage[] = [];
    const newStats: { name: string; ms: number }[] = [];

    for (const tc of toolCalls) {
      const t = toolMap.get(tc.name);
      const start = Date.now();
      let content: string;
      if (t) {
        content = await invokeToolContained(t, tc.args);
      } else {
        content = `TOOL_ERROR: unknown tool "${tc.name}"`;
      }
      newStats.push({ name: tc.name, ms: Date.now() - start });
      toolMessages.push(
        new ToolMessage({ tool_call_id: tc.id ?? tc.name, content })
      );
    }

    return {
      messages: toolMessages,
      toolCallStats: newStats,
    };
  }

  // finalize — demand structured output and validate
  async function finalizeNode(state: AgentState) {
    const lastMsg = state.messages[state.messages.length - 1];

    // Check if the last AI message called the final_output tool
    let rawOutput: unknown = null;
    let rawFinalStr: string | undefined;

    const aiMsg = lastMsg as AIMessage;
    const finalToolCall = aiMsg.tool_calls?.find(
      (tc) => tc.name === FINAL_OUTPUT_TOOL
    );

    if (finalToolCall) {
      // The model called final_output — extract the result field
      const args = finalToolCall.args as { result?: unknown };
      rawOutput = args?.result ?? args;
      rawFinalStr = JSON.stringify(rawOutput);
    } else if (typeof aiMsg.content === "string" && aiMsg.content.trim()) {
      // Fallback: model returned text (shouldn't happen with forced tool choice,
      // but handle gracefully)
      rawFinalStr = aiMsg.content.trim();
      try {
        rawOutput = JSON.parse(rawFinalStr);
      } catch {
        rawOutput = rawFinalStr;
      }
    } else {
      rawFinalStr = JSON.stringify(rawOutput);
    }

    // Validate against outputSchema
    const parseResult = config.outputSchema.safeParse(rawOutput);
    if (!parseResult.success) {
      // Zod v4 uses .issues (not .errors) on ZodError
      const issues = parseResult.error.issues ?? [];
      const errors = issues
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join("; ");

      if (state.repairs >= MAX_REPAIRS) {
        // Exhausted repair budget — return partial
        return {
          output: { __partial: true, __rawFinal: rawFinalStr },
        };
      }

      // Bounce: append validation errors as a human message so model can repair.
      // Must be HumanMessage — SystemMessage mid-conversation crashes the
      // Anthropic adapter ("System messages are only permitted as the first
      // passed message"). budgetExhausted also acts as the finalize-mode sentinel
      // so call_model skips tool routing and goes straight to finalModel.
      return {
        messages: [
          new HumanMessage(
            `Output validation failed (repair attempt ${state.repairs + 1}/${MAX_REPAIRS}). Errors: ${errors}. Please call the final_output tool again with corrected data.`
          ),
        ],
        repairs: 1,
        output: null,
        budgetExhausted: true, // finalize-mode sentinel: skip tool routing, use finalModel
      };
    }

    // Validation passed — run custom nodes sequentially
    let validatedOutput: unknown = parseResult.data;
    const customNodes = config.customNodes ?? [];

    for (const cn of customNodes) {
      const bounceMsg = await cn.check(validatedOutput, state);
      if (bounceMsg !== null) {
        // Custom node wants a repair
        if (state.repairs >= MAX_REPAIRS) {
          return {
            output: { __partial: true, __rawFinal: rawFinalStr },
          };
        }
        // Must be HumanMessage — SystemMessage mid-conversation crashes the
        // Anthropic adapter. budgetExhausted also acts as finalize-mode sentinel.
        return {
          messages: [
            new HumanMessage(
              `Custom node "${cn.name}" requires repair (attempt ${state.repairs + 1}/${MAX_REPAIRS}): ${bounceMsg}. Please call the final_output tool again with corrected data.`
            ),
          ],
          repairs: 1,
          output: null,
          budgetExhausted: true,
        };
      }
    }

    // All checks passed
    return {
      output: validatedOutput,
    };
  }

  // ── Routing functions ─────────────────────────────────────────────────────

  function routeAfterCallModel(state: AgentState): string {
    const lastMsg = state.messages[state.messages.length - 1] as AIMessage;

    // If last message is the final_output tool call (from finalize-directed call_model),
    // go to finalize
    const hasFinalOutput = lastMsg.tool_calls?.some(
      (tc) => tc.name === FINAL_OUTPUT_TOOL
    );
    if (hasFinalOutput) return "finalize";

    // Normal tool calls → execute
    if (lastMsg.tool_calls && lastMsg.tool_calls.length > 0) {
      return "execute_tools";
    }

    // No tool calls → finalize
    return "finalize";
  }

  function routeAfterBudgetGuard(state: AgentState): string {
    const turnsExhausted = state.turns >= config.maxTurns;
    const tokensExhausted = state.tokensUsed >= config.maxTokens;

    if (turnsExhausted || tokensExhausted) {
      // Budget exhausted — mark it and go back to call_model for final pass
      return "budget_exhausted";
    }
    return "call_model";
  }

  function routeAfterFinalize(state: AgentState): string {
    const out = state.output as
      | { __partial?: boolean; __rawFinal?: string }
      | null
      | undefined;
    if (out && out.__partial) {
      return END;
    }
    if (out === null) {
      // Bounce back for repair (repairs counter already incremented)
      return "call_model";
    }
    return END;
  }

  // ── Assemble graph ────────────────────────────────────────────────────────

  const graph = new StateGraph(GraphAnnotation)
    .addNode("call_model", callModelNode)
    .addNode("execute_tools", executeToolsNode)
    .addNode("budget_guard", budgetGuardNode)
    .addNode("finalize", finalizeNode)
    .addNode("budget_exhausted", budgetExhaustedNode)
    .addEdge(START, "call_model")
    .addConditionalEdges("call_model", routeAfterCallModel, [
      "execute_tools",
      "finalize",
    ])
    .addEdge("execute_tools", "budget_guard")
    .addConditionalEdges("budget_guard", routeAfterBudgetGuard, [
      "call_model",
      "budget_exhausted",
    ])
    .addEdge("budget_exhausted", "call_model")
    .addConditionalEdges("finalize", routeAfterFinalize, ["call_model", END]);

  return graph.compile();
}

// ── Helper nodes (defined outside for clarity) ────────────────────────────

function budgetGuardNode(_state: AgentState) {
  // Pure routing — no state mutation here, routing is in the conditional edge
  return {};
}

function budgetExhaustedNode(_state: AgentState) {
  // Mark budget exhausted so call_model uses finalModel on next pass.
  // Must be HumanMessage — SystemMessage mid-conversation crashes the
  // Anthropic adapter ("System messages are only permitted as the first
  // passed message"). budgetExhausted also acts as the finalize-mode sentinel
  // for repair bounces in finalizeNode, not only literal budget exhaustion.
  return {
    budgetExhausted: true,
    messages: [new HumanMessage(BUDGET_NUDGE)],
  };
}

// ── Message assembly ──────────────────────────────────────────────────────

function buildMessagesForModel(
  state: AgentState,
  config: AgentConfig,
  _isBudgetExhausted: boolean
) {
  // Check if system prompt is already in messages
  const hasSystem = state.messages.some((m) => m._getType() === "system");

  if (!hasSystem) {
    return [new SystemMessage(config.systemPrompt), ...state.messages];
  }
  return state.messages;
}

// ── Type patch: keep CustomNode in types.ts in sync ───────────────────────
// The CustomNode interface in types.ts is a stub; the full interface lives here.
// Re-export it so consumers import from graph.ts:
export type { AgentConfig, AgentResult };
