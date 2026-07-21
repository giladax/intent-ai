/**
 * Core agent graph tests — scripted fake model, no live LLM.
 *
 * Covers:
 *  (a) happy path — tool calls then valid final output
 *  (b) turn cap → forced finalize
 *  (c) token cap → forced finalize
 *  (d) invalid output → bounce with errors → valid on repair 1
 *  (e) 3× invalid → partial: true with rawFinal
 *  (f) custom node returning repair text bounces
 *  (g) custom node returning null accepts
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  AIMessage,
  BaseMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  CallbackManagerForLLMRun,
} from "@langchain/core/callbacks/manager";
import { ChatResult } from "@langchain/core/outputs";
import { runAgent } from "../../src/agents/core/run.js";
import type { AgentConfig, CustomNode } from "../../src/agents/core/types.js";
import { defineTool } from "../../src/agents/core/tool.js";

// ── Scripted fake model ─────────────────────────────────────────────────────
//
// Each call pops the next AIMessage from the queue.
// bindTools returns `this` (tools ignored — the fake model controls its own
// output regardless of bound tools).
//
// recordedInputs: every BaseMessage[] passed to _generate is appended here,
// so tests can assert on message structure per call.

class ScriptedFakeChatModel extends BaseChatModel {
  private queue: AIMessage[];
  private callCount = 0;
  recordedInputs: BaseMessage[][] = [];

  constructor(messages: AIMessage[]) {
    super({});
    this.queue = [...messages];
  }

  _llmType(): string {
    return "scripted-fake";
  }

  _combineLLMOutput() {
    return [];
  }

  async _generate(
    messages: BaseMessage[],
    _options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    this.recordedInputs.push([...messages]);
    const idx = this.callCount;
    this.callCount++;
    const msg = this.queue[idx] ?? new AIMessage({ content: "fallback" });
    return {
      generations: [{ message: msg, text: typeof msg.content === "string" ? msg.content : "" }],
      llmOutput: {},
    };
  }

  // Allow bindTools — just return this (fake doesn't care about tool schemas)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bindTools(_tools: any[]): this {
    return this;
  }
}

// ── Helper — build a minimal AgentConfig ───────────────────────────────────

const OutputSchema = z.object({ answer: z.string() });

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig & { outputSchema: typeof OutputSchema } {
  return {
    name: "test_agent",
    systemPrompt: "You are a test agent.",
    tools: [],
    maxTurns: 10,
    maxTokens: 100_000,
    outputSchema: OutputSchema,
    ...overrides,
  };
}

// Helper to build a final_output AIMessage (what the model emits on finalize)
function makeFinalOutputMsg(result: unknown, usage?: { input_tokens: number; output_tokens: number; total_tokens: number }): AIMessage {
  return new AIMessage({
    content: "",
    tool_calls: [
      {
        id: "tc_final",
        name: "final_output",
        args: { result },
        type: "tool_call",
      },
    ],
    usage_metadata: usage,
  });
}

// Helper to build a tool-calling AIMessage
function makeToolCallMsg(toolName: string, args: Record<string, unknown>, id = "tc1", usage?: { input_tokens: number; output_tokens: number; total_tokens: number }): AIMessage {
  return new AIMessage({
    content: "",
    tool_calls: [{ id, name: toolName, args, type: "tool_call" }],
    usage_metadata: usage,
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("buildAgentGraph / runAgent", () => {
  // (a) Happy path: 2 tool calls then valid final output
  it("(a) happy path — tool calls then valid final output", async () => {
    const echoTool = defineTool({
      name: "echo_tool",
      description: "Echoes input.",
      schema: z.object({ msg: z.string() }),
      execute: async ({ msg }) => msg,
    });

    const config = makeConfig({ tools: [echoTool] });

    // Script: tool call 1, tool call 2, then final output
    const model = new ScriptedFakeChatModel([
      makeToolCallMsg("echo_tool", { msg: "hello" }, "tc1", { input_tokens: 10, output_tokens: 5, total_tokens: 15 }),
      makeToolCallMsg("echo_tool", { msg: "world" }, "tc2", { input_tokens: 10, output_tokens: 5, total_tokens: 15 }),
      makeFinalOutputMsg({ answer: "done" }, { input_tokens: 10, output_tokens: 5, total_tokens: 15 }),
    ]);

    const result = await runAgent(config, "test input", model);

    expect(result.partial).toBe(false);
    expect(result.output).toEqual({ answer: "done" });
    // 3 model calls = 3 turns
    expect(result.stats.turns).toBe(3);
    // 2 tool calls recorded
    expect(result.stats.toolCalls).toHaveLength(2);
    expect(result.stats.toolCalls[0].name).toBe("echo_tool");
    expect(result.stats.toolCalls[0].ms).toBeGreaterThanOrEqual(0);
    expect(result.stats.repairs).toBe(0);
    expect(result.stats.tokensUsed).toBe(45); // 3 × 15
  });

  // (b) Turn cap → forced finalize, partial only if final output invalid
  it("(b) turn cap → forced finalize, partial: false when final output valid", async () => {
    const config = makeConfig({ maxTurns: 2 }); // cap at 2 turns

    // Script: 2 tool calls (hits turn cap after 2nd), then final output
    // After 2 tool calls (turns=2), budget exhausted → budget_exhausted node
    // → call_model with final model → emits final_output
    const model = new ScriptedFakeChatModel([
      makeToolCallMsg("nonexistent_tool", { x: 1 }, "tc1"),
      makeToolCallMsg("nonexistent_tool", { x: 2 }, "tc2"),
      // call 3: after budget exhausted node, call_model called with finalModel
      makeFinalOutputMsg({ answer: "forced" }),
    ]);

    const result = await runAgent(config, "go", model);

    expect(result.partial).toBe(false);
    expect(result.output).toEqual({ answer: "forced" });
  });

  // (c) Token cap → forced finalize
  it("(c) token cap → forced finalize, partial: false when output valid", async () => {
    const config = makeConfig({ maxTokens: 20 }); // 20 token cap

    // First call: uses 25 tokens → over cap after first tool execution
    const model = new ScriptedFakeChatModel([
      makeToolCallMsg("nonexistent_tool", { x: 1 }, "tc1", {
        input_tokens: 15,
        output_tokens: 10,
        total_tokens: 25,
      }),
      // call 2: after budget exhausted
      makeFinalOutputMsg({ answer: "token-capped" }),
    ]);

    const result = await runAgent(config, "go", model);

    expect(result.partial).toBe(false);
    expect(result.output).toEqual({ answer: "token-capped" });
  });

  // (d) Invalid final output → bounce with errors visible → valid on repair 1
  it("(d) invalid output → bounce → valid on repair 1, repairs: 1", async () => {
    const config = makeConfig();

    // Script:
    //   call 1: emit final_output with wrong type (answer missing → invalid)
    //   call 2: after seeing validation errors, emit valid final_output
    const model = new ScriptedFakeChatModel([
      makeFinalOutputMsg({ wrong_field: 123 }), // invalid — answer missing
      makeFinalOutputMsg({ answer: "repaired" }), // valid after repair
    ]);

    const result = await runAgent(config, "fix it", model);

    expect(result.partial).toBe(false);
    expect(result.output).toEqual({ answer: "repaired" });
    expect(result.stats.repairs).toBe(1);

    // The repair call (index 1) must have received the validation-error text
    // so the model can correct its output.
    expect(model.recordedInputs.length).toBeGreaterThanOrEqual(2);
    const repairCallInputs = model.recordedInputs[1];
    const repairCallText = repairCallInputs
      .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
      .join("\n");
    expect(repairCallText).toMatch(/Output validation failed/i);

    // No recorded call should have a SystemMessage at index > 0 — mid-conversation
    // SystemMessages crash the Anthropic adapter.
    for (const callInputs of model.recordedInputs) {
      for (let i = 1; i < callInputs.length; i++) {
        expect(
          callInputs[i],
          `call inputs should not contain a SystemMessage at index ${i}`
        ).not.toBeInstanceOf(SystemMessage);
      }
    }
  });

  // (e) 3× invalid → partial: true with rawFinal
  it("(e) 3× invalid → partial: true, rawFinal set", async () => {
    const config = makeConfig();

    // All 3 calls produce invalid output (answer field missing)
    const badOutput = { wrong: "nope" };
    const model = new ScriptedFakeChatModel([
      makeFinalOutputMsg(badOutput),
      makeFinalOutputMsg(badOutput),
      makeFinalOutputMsg(badOutput),
    ]);

    const result = await runAgent(config, "fail always", model);

    expect(result.partial).toBe(true);
    expect(result.output).toBeNull();
    expect(result.rawFinal).toBeDefined();
    expect(typeof result.rawFinal).toBe("string");
    expect(result.stats.repairs).toBe(2); // MAX_REPAIRS
  });

  // (f) Custom node returning repair text bounces
  it("(f) custom node bounce → repairs: 1, valid on second attempt", async () => {
    let callCount = 0;
    const customNode: CustomNode = {
      name: "strict_check",
      check: async (output) => {
        callCount++;
        const o = output as { answer: string };
        if (o.answer === "bad") return "answer must not be 'bad'";
        return null;
      },
    };

    const config = makeConfig({ customNodes: [customNode] });

    const model = new ScriptedFakeChatModel([
      makeFinalOutputMsg({ answer: "bad" }), // passes Zod, fails custom node
      makeFinalOutputMsg({ answer: "good" }), // passes both
    ]);

    const result = await runAgent(config, "custom check", model);

    expect(result.partial).toBe(false);
    expect(result.output).toEqual({ answer: "good" });
    expect(result.stats.repairs).toBe(1);
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  // (g) Custom node returning null accepts
  it("(g) custom node returning null accepts output", async () => {
    const customNode: CustomNode = {
      name: "permissive_check",
      check: async () => null, // always accepts
    };

    const config = makeConfig({ customNodes: [customNode] });

    const model = new ScriptedFakeChatModel([
      makeFinalOutputMsg({ answer: "ok" }),
    ]);

    const result = await runAgent(config, "accept", model);

    expect(result.partial).toBe(false);
    expect(result.output).toEqual({ answer: "ok" });
    expect(result.stats.repairs).toBe(0);
  });
});
