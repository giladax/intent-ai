/**
 * Digest-agent run.ts contract tests — mocked storage, no live DB or LLM.
 *
 * Covers:
 *  (C1-success) successful store → buildSessionEvents-derived events AND trace events emitted
 *  (C1-store-fail) store failure → neither session nor trace events emitted
 *  (I1-graph) runAgent stats.toolCalls entries include argsSummary
 *  (I1-truncation) argsSummary is truncated at 120 chars for large args
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { ChatResult } from "@langchain/core/outputs";

// ── Module mocks (must be before imports of mocked modules) ──────────────────

// Mock the CC log parser so we don't need a real file
vi.mock("../../src/adapters/claude-code.js", () => ({
  parseClaudeCodeLog: vi.fn().mockResolvedValue([
    { timestamp: "2026-07-04T10:00:00Z", type: "say", role: "user", uuid: "raw-0", text: "Do the thing" },
  ]),
}));

// Mock the pipeline orchestrator helpers
vi.mock("../../src/pipeline/orchestrator.js", () => ({
  findDigestedSession: vi.fn().mockResolvedValue(null),
  latestTimestamp: vi.fn().mockReturnValue(new Date("2026-07-04T11:00:00Z")),
  loadStoredDigest: vi.fn().mockResolvedValue(null),
  archiveRawSession: vi.fn(),
  getGitContext: vi.fn().mockReturnValue({ repo: "intent-ai", branch: "main" }),
}));

// Mock normalize — return minimal normalized events
vi.mock("../../src/pipeline/normalize.js", () => ({
  normalize: vi.fn().mockReturnValue([
    {
      id: "evt-0",
      sessionId: "test-session",
      timestamp: "2026-07-04T10:00:00Z",
      causalOrder: 0,
      category: "intent",
      actor: "user",
      content: { summary: "Do the thing", detail: "Do the thing now", filesAffected: [] },
      rawEventId: "raw-0",
    },
  ]),
}));

// Mock classify — always returns "narrative"
vi.mock("../../src/pipeline/classify.js", () => ({
  classifySession: vi.fn().mockResolvedValue("narrative"),
}));

// Mock sitting detection — return single sitting
vi.mock("../../src/pipeline/understand/sittings.js", () => ({
  detectSittings: vi.fn().mockReturnValue([
    {
      sittingIndex: 0,
      startedAt: "2026-07-04T10:00:00Z",
      endedAt: "2026-07-04T11:00:00Z",
      eventRange: [0, 0],
    },
  ]),
}));

// Mock storage — control storeSessionDigest and track emitEvents calls
const mockEmitEvents = vi.fn().mockResolvedValue(undefined);
const mockStoreSessionDigest = vi.fn();

vi.mock("../../src/storage/queries.js", () => ({
  storeSessionDigest: (...args: unknown[]) => mockStoreSessionDigest(...args),
  emitEvents: (...args: unknown[]) => mockEmitEvents(...args),
  deleteSessionDigest: vi.fn().mockResolvedValue(undefined),
  getSessionEndedAt: vi.fn().mockResolvedValue(null),
}));

// Track buildSessionEvents calls
const mockBuildSessionEvents = vi.fn().mockReturnValue([
  { category: "narrative", tags: [], actor: "system", summary: "Session summary", metadata: {}, sourceType: "narrative", timestamp: new Date() },
]);

vi.mock("../../src/pipeline/emit-events.js", () => ({
  buildSessionEvents: (...args: unknown[]) => mockBuildSessionEvents(...args),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { digestWithAgent } from "../../src/agents/digest/run.js";
import { runAgent } from "../../src/agents/core/run.js";
import type { AgentConfig } from "../../src/agents/core/types.js";
import { defineTool } from "../../src/agents/core/tool.js";

// ── Scripted fake model ───────────────────────────────────────────────────────

class ScriptedFakeChatModel extends BaseChatModel {
  private queue: AIMessage[];
  private callCount = 0;

  constructor(messages: AIMessage[]) {
    super({});
    this.queue = [...messages];
  }

  _llmType(): string { return "scripted-fake"; }
  _combineLLMOutput() { return []; }

  async _generate(
    _messages: BaseMessage[],
    _options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const idx = this.callCount;
    this.callCount++;
    const msg = this.queue[idx] ?? new AIMessage({ content: "fallback" });
    return {
      generations: [{ message: msg, text: typeof msg.content === "string" ? msg.content : "" }],
      llmOutput: {},
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bindTools(_tools: any[]): this { return this; }
}

function makeFinalOutputMsg(result: unknown): AIMessage {
  return new AIMessage({
    content: "",
    tool_calls: [{ id: "tc_final", name: "final_output", args: { result }, type: "tool_call" }],
  });
}

function makeToolCallMsg(toolName: string, args: Record<string, unknown>): AIMessage {
  return new AIMessage({
    content: "",
    tool_calls: [{ id: "tc1", name: toolName, args, type: "tool_call" }],
  });
}

// ── Valid digest output fixture ───────────────────────────────────────────────

const validDigestOutput = {
  moments: [
    {
      sittingIndex: 0,
      type: "commitment",
      statement: "Developer committed to implementing the feature",
      significance: "Sets the direction",
      agency: "developer",
      confidence: "high",
      topicFingerprint: "feature-implementation",
      evidence: [{ quote: "Do the thing now", eventIndex: 0, sourceType: "user" }],
    },
  ],
  transitions: [],
  outcomes: [],
  narrative: {
    sessionShape: "narrative",
    summary: "Developer committed to implementing a feature.",
    progression: ["Started with commitment"],
    discoveries: [],
    stabilizedDirections: ["feature-implementation"],
    abandonedDirections: [],
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("digest run.ts — event emission contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmitEvents.mockResolvedValue(undefined);
    mockBuildSessionEvents.mockReturnValue([
      { category: "narrative", tags: [], actor: "system", summary: "Session summary", metadata: {}, sourceType: "narrative", timestamp: new Date() },
    ]);
  });

  it("(C1-success) successful store → buildSessionEvents AND trace events emitted", async () => {
    mockStoreSessionDigest.mockResolvedValue({ stored: true });

    const fakeModel = new ScriptedFakeChatModel([
      makeFinalOutputMsg(validDigestOutput),
    ]);

    const result = await digestWithAgent("/fake/session.jsonl", { _modelOverride: fakeModel });

    // buildSessionEvents should be called with the session data
    expect(mockBuildSessionEvents).toHaveBeenCalledTimes(1);
    const sessionEventsCallArgs = mockBuildSessionEvents.mock.calls[0]![0] as {
      sessionId: string;
      repo?: string;
      moments: unknown[];
    };
    expect(sessionEventsCallArgs.sessionId).toBeTruthy();
    expect(sessionEventsCallArgs.repo).toBe("intent-ai");
    expect(Array.isArray(sessionEventsCallArgs.moments)).toBe(true);

    // emitEvents should be called at least twice:
    // once for session events, once for trace events
    expect(mockEmitEvents).toHaveBeenCalledTimes(2);

    // _eventsEmitted should be > 0
    expect(result._eventsEmitted).toBeGreaterThan(0);
  });

  it("(C1-store-fail) store failure → neither session events nor trace events emitted", async () => {
    mockStoreSessionDigest.mockRejectedValue(new Error("DB connection failed"));

    const fakeModel = new ScriptedFakeChatModel([
      makeFinalOutputMsg(validDigestOutput),
    ]);

    await digestWithAgent("/fake/session.jsonl", { _modelOverride: fakeModel });

    // buildSessionEvents should NOT be called when store failed
    expect(mockBuildSessionEvents).not.toHaveBeenCalled();
    // emitEvents should NOT be called when store failed
    expect(mockEmitEvents).not.toHaveBeenCalled();
  });

  it("(C1-store-conflict) store returns stored:false → neither events emitted", async () => {
    // stored: false means the session already existed (concurrency conflict)
    mockStoreSessionDigest.mockResolvedValue({ stored: false });

    const fakeModel = new ScriptedFakeChatModel([
      makeFinalOutputMsg(validDigestOutput),
    ]);

    const result = await digestWithAgent("/fake/session.jsonl", { _modelOverride: fakeModel });

    // No events should be emitted on conflict
    expect(mockBuildSessionEvents).not.toHaveBeenCalled();
    expect(mockEmitEvents).not.toHaveBeenCalled();
    expect(result._eventsEmitted).toBe(0);
  });

  // I1: argsSummary is captured in graph stats toolCalls
  it("(I1-graph) runAgent stats.toolCalls entries include argsSummary", async () => {
    const echoTool = defineTool({
      name: "echo_tool",
      description: "Echoes input.",
      schema: z.object({ msg: z.string() }),
      execute: async ({ msg }) => msg,
    });

    const OutputSchema = z.object({ answer: z.string() });
    const config: AgentConfig & { outputSchema: typeof OutputSchema } = {
      name: "test_agent",
      systemPrompt: "You are a test agent.",
      tools: [echoTool],
      maxTurns: 10,
      maxTokens: 100_000,
      outputSchema: OutputSchema,
    };

    const model = new ScriptedFakeChatModel([
      makeToolCallMsg("echo_tool", { msg: "hello world" }),
      makeFinalOutputMsg({ answer: "done" }),
    ]);

    const result = await runAgent(config, "test", model);

    expect(result.partial).toBe(false);
    expect(result.stats.toolCalls).toHaveLength(1);
    const tc = result.stats.toolCalls[0]!;
    expect(tc.name).toBe("echo_tool");
    expect(tc.argsSummary).toBeDefined();
    expect(typeof tc.argsSummary).toBe("string");
    // argsSummary should contain the args
    expect(tc.argsSummary).toContain("hello world");
  });

  // I1: long args are truncated to 120 chars in argsSummary
  it("(I1-truncation) argsSummary is truncated at 120 chars for large args", async () => {
    const bigTool = defineTool({
      name: "big_tool",
      description: "Tool with big args.",
      schema: z.object({ data: z.string() }),
      execute: async ({ data }) => `got ${data.length} chars`,
    });

    const OutputSchema = z.object({ answer: z.string() });
    const config: AgentConfig & { outputSchema: typeof OutputSchema } = {
      name: "test_agent",
      systemPrompt: "You are a test agent.",
      tools: [bigTool],
      maxTurns: 10,
      maxTokens: 100_000,
      outputSchema: OutputSchema,
    };

    const bigData = "x".repeat(200);
    const model = new ScriptedFakeChatModel([
      makeToolCallMsg("big_tool", { data: bigData }),
      makeFinalOutputMsg({ answer: "done" }),
    ]);

    const result = await runAgent(config, "test", model);

    expect(result.stats.toolCalls).toHaveLength(1);
    const tc = result.stats.toolCalls[0]!;
    // The raw JSON of { data: "x"*200 } is > 120 chars, so argsSummary must be truncated
    expect(tc.argsSummary.length).toBeLessThanOrEqual(120);
    expect(tc.argsSummary.endsWith("...")).toBe(true);
  });
});
