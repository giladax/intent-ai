/**
 * Digest agent contract tests — fake model, no live LLM.
 *
 * Covers:
 *  (a) valid output maps to SessionMoments with anchored evidence
 *  (b) unanchored-heavy fake output triggers the repair bounce (validate_anchors_and_repair)
 *  (c) agent-trace events have correct sourceType/sessionId
 *  (d) mapped moments carry anchor-shaped evidence and sitting-derived chunkIds
 *  (e) moment ids follow the moment-N pattern
 *  (f) buildPseudoChunksPerSitting produces chunks with correct event ranges
 */

import { describe, it, expect } from "vitest";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { ChatResult } from "@langchain/core/outputs";
import {
  buildDigestAgentConfig,
  buildPseudoChunksPerSitting,
  mapAgentOutputToPipelineResult,
  buildAgentTraceEvents,
} from "../../src/agents/digest/agent.js";
import { DigestAgentOutputSchema } from "../../src/agents/digest/output-schema.js";
import type { NormalizedDevEvent, Sitting } from "../../src/adapters/types.js";
import { runAgent } from "../../src/agents/core/run.js";

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

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeNormalizedEvents(count: number, sessionId = "test-session"): NormalizedDevEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `evt-${i}`,
    sessionId,
    timestamp: new Date(Date.UTC(2026, 6, 4, 10, i, 0)).toISOString(),
    causalOrder: i,
    category: (i % 2 === 0 ? "intent" : "proposal") as NormalizedDevEvent["category"],
    actor: (i % 2 === 0 ? "user" : "ai") as NormalizedDevEvent["actor"],
    content: {
      summary: `event ${i} summary`,
      detail: `event ${i} detail — real content here for anchoring purposes`,
      filesAffected: [],
    },
    rawEventId: `raw-${i}`,
    respondingTo: undefined,
    turnId: `turn-${Math.floor(i / 2)}`,
  }));
}

function makeSittings(events: NormalizedDevEvent[]): Sitting[] {
  return [{
    sittingIndex: 0,
    startedAt: events[0]!.timestamp,
    endedAt: events[events.length - 1]!.timestamp,
    eventRange: [0, events.length - 1],
  }];
}

function makeValidAgentOutput(_events: NormalizedDevEvent[]): object {
  return {
    moments: [
      {
        sittingIndex: 0,
        type: "commitment",
        statement: "Developer committed to implementing the feature",
        significance: "Sets the direction for the session",
        agency: "developer",
        confidence: "high",
        topicFingerprint: "feature-implementation",
        evidence: [
          { quote: "event 0 detail", eventIndex: 0, sourceType: "user" },
        ],
      },
    ],
    transitions: [],
    outcomes: [],
    narrative: {
      sessionShape: "narrative",
      summary: "Developer committed to implementing a feature and executed it.",
      progression: ["Started with commitment", "Executed the plan"],
      discoveries: [],
      stabilizedDirections: ["feature-implementation"],
      abandonedDirections: [],
    },
  };
}

function makeUnanchoredAgentOutput(): object {
  return {
    moments: [
      {
        sittingIndex: 0,
        type: "commitment",
        statement: "Moment with bad evidence",
        significance: "",
        agency: "developer",
        confidence: null,
        topicFingerprint: "general",
        evidence: [
          { quote: "this quote does not exist in any event", eventIndex: 9999, sourceType: "user" },
          { quote: "another fabricated quote", eventIndex: 9998, sourceType: "ai" },
          { quote: "third fabricated quote", eventIndex: 9997, sourceType: "ai" },
          { quote: "fourth fabricated quote", eventIndex: 9996, sourceType: "ai" },
        ],
      },
    ],
    transitions: [],
    outcomes: [],
    narrative: {
      sessionShape: "narrative",
      summary: "Test summary.",
      progression: [],
      discoveries: [],
      stabilizedDirections: [],
      abandonedDirections: [],
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("digest agent contracts", () => {
  it("(a) valid output maps to SessionMoments with anchored evidence", () => {
    const events = makeNormalizedEvents(10);
    const sittings = makeSittings(events);
    const validOutput = makeValidAgentOutput(events);
    const parsed = DigestAgentOutputSchema.parse(validOutput);

    const { moments, chunks } = mapAgentOutputToPipelineResult(
      parsed,
      "test-session",
      sittings,
      events,
      "narrative",
    );

    expect(moments).toHaveLength(1);
    expect(moments[0]!.id).toBe("moment-0");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.id).toBe("pseudo-sitting-0");

    // Evidence should be anchored — quote "event 0 detail" is in event 0
    const ev = moments[0]!.evidence[0] as unknown as { anchored: boolean };
    expect(ev.anchored).toBe(true);
  });

  it("(b) validate_anchors_and_repair bounces when >30% evidence is unanchored", async () => {
    const events = makeNormalizedEvents(10);
    const sittings = makeSittings(events);
    const config = buildDigestAgentConfig({
      normalizedEvents: events,
      sittings,
      sessionShape: "narrative",
    });

    const unanchored = makeUnanchoredAgentOutput();
    const valid = makeValidAgentOutput(events);

    const model = new ScriptedFakeChatModel([
      makeFinalOutputMsg(unanchored),
      makeFinalOutputMsg(valid),
    ]);

    const result = await runAgent(config, "Analyze the session.", model);

    expect(result.stats.repairs).toBeGreaterThan(0);
    expect(result.partial).toBe(false);
    expect(result.output).toBeTruthy();
  });

  it("(c) buildAgentTraceEvents produces correct sourceType and sessionId", () => {
    const sessionId = "test-session-id";
    const toolCalls = [
      { name: "read_transcript_range", ms: 12 },
      { name: "list_tool_events", ms: 5 },
    ];
    const stats = { turns: 3, tokensUsed: 1500, toolCalls, repairs: 0 };

    const events = buildAgentTraceEvents(sessionId, toolCalls, stats);

    expect(events).toHaveLength(3);

    const toolCallEvents = events.filter((e) => e.category === "agent:tool-call");
    expect(toolCallEvents).toHaveLength(2);
    for (const e of toolCallEvents) {
      expect(e.sourceType).toBe("agent-trace");
      expect(e.sessionId).toBe(sessionId);
    }

    const runEvent = events.find((e) => e.category === "agent:run");
    expect(runEvent).toBeTruthy();
    expect(runEvent!.sourceType).toBe("agent-trace");
    expect(runEvent!.sessionId).toBe(sessionId);
    expect(runEvent!.metadata["turns"]).toBe(3);
    expect(runEvent!.metadata["tokensUsed"]).toBe(1500);
  });

  it("(d) mapped moments carry anchor-shaped evidence and sitting-derived chunkIds", () => {
    const events = makeNormalizedEvents(10);
    const sittings = makeSittings(events);
    const validOutput = makeValidAgentOutput(events);
    const parsed = DigestAgentOutputSchema.parse(validOutput);

    const { moments } = mapAgentOutputToPipelineResult(
      parsed,
      "test-session",
      sittings,
      events,
      "narrative",
    );

    expect(moments[0]!.chunkId).toBe("pseudo-sitting-0");
    const anchor = moments[0]!.evidence[0] as unknown as { anchored: boolean; eventIndex: number | null };
    expect(typeof anchor.anchored).toBe("boolean");
  });

  it("(e) moment ids follow the moment-N pattern", () => {
    const events = makeNormalizedEvents(10);
    const sittings = makeSittings(events);
    const output = DigestAgentOutputSchema.parse({
      moments: [
        {
          sittingIndex: 0,
          type: "commitment",
          statement: "First",
          significance: "",
          agency: "developer",
          confidence: null,
          topicFingerprint: "general",
          evidence: [{ quote: "event 0 detail", eventIndex: 0, sourceType: "ai" }],
        },
        {
          sittingIndex: 0,
          type: "discovery",
          statement: "Second",
          significance: "",
          agency: "ai",
          confidence: "high",
          topicFingerprint: "general",
          evidence: [{ quote: "event 1 detail", eventIndex: 1, sourceType: "ai" }],
        },
      ],
      transitions: [],
      outcomes: [],
      narrative: {
        sessionShape: "narrative",
        summary: "Test",
        progression: [],
        discoveries: [],
        stabilizedDirections: [],
        abandonedDirections: [],
      },
    });

    const { moments } = mapAgentOutputToPipelineResult(output, "sess", sittings, events, "narrative");

    expect(moments[0]!.id).toBe("moment-0");
    expect(moments[1]!.id).toBe("moment-1");
  });

  it("(f) buildPseudoChunksPerSitting produces chunks with correct event ranges", () => {
    const events = makeNormalizedEvents(10);
    const sittings: Sitting[] = [
      { sittingIndex: 0, startedAt: events[0]!.timestamp, endedAt: events[4]!.timestamp, eventRange: [0, 4] },
      { sittingIndex: 1, startedAt: events[5]!.timestamp, endedAt: events[9]!.timestamp, eventRange: [5, 9] },
    ];

    const chunks = buildPseudoChunksPerSitting(sittings, events);

    expect(chunks.size).toBe(2);
    const c0 = chunks.get(0)!;
    const c1 = chunks.get(1)!;
    expect(c0.eventRange).toEqual([0, 4]);
    expect(c0.events).toHaveLength(5);
    expect(c1.eventRange).toEqual([5, 9]);
    expect(c1.events).toHaveLength(5);
  });

  // I1: argsSummary present in buildAgentTraceEvents summaries
  it("(g) buildAgentTraceEvents includes argsSummary in tool-call event summaries", () => {
    const sessionId = "test-session-i1";
    const toolCalls = [
      { name: "read_transcript_range", ms: 12, argsSummary: '{"start":0,"end":10}' },
      { name: "list_tool_events", ms: 5, argsSummary: "{}" },
    ];
    const stats = { turns: 2, tokensUsed: 800, toolCalls, repairs: 0 };

    const events = buildAgentTraceEvents(sessionId, toolCalls, stats);
    const toolCallEvents = events.filter((e) => e.category === "agent:tool-call");

    expect(toolCallEvents[0]!.summary).toBe('read_transcript_range({"start":0,"end":10}) 12ms');
    expect(toolCallEvents[1]!.summary).toBe("list_tool_events({}) 5ms");
  });

  // I1: long argsSummary is truncated to 120 chars in the stored field
  it("(h) buildAgentTraceEvents argsSummary survives in metadata", () => {
    const sessionId = "test-session-i1b";
    const longArgs = "x".repeat(130);
    const toolCalls = [{ name: "big_tool", ms: 1, argsSummary: longArgs }];
    const stats = { turns: 1, tokensUsed: 100, toolCalls, repairs: 0 };

    const events = buildAgentTraceEvents(sessionId, toolCalls, stats);
    const tc = events.find((e) => e.category === "agent:tool-call")!;
    expect(tc.metadata["argsSummary"]).toBe(longArgs);
  });

  // M3: zero-moment output triggers repair from the custom node
  it("(i) validate_anchors_and_repair bounces when output has zero moments", async () => {
    const events = makeNormalizedEvents(10);
    const sittings = makeSittings(events);
    const config = buildDigestAgentConfig({
      normalizedEvents: events,
      sittings,
      sessionShape: "narrative",
    });

    const zeroMomentOutput = {
      moments: [],
      transitions: [],
      outcomes: [],
      narrative: {
        sessionShape: "narrative",
        summary: "Empty session.",
        progression: [],
        discoveries: [],
        stabilizedDirections: [],
        abandonedDirections: [],
      },
    };
    const valid = makeValidAgentOutput(events);

    const model = new ScriptedFakeChatModel([
      makeFinalOutputMsg(zeroMomentOutput),
      makeFinalOutputMsg(valid),
    ]);

    const result = await runAgent(config, "Analyze the session.", model);

    // First attempt (zero moments) should have triggered a repair
    expect(result.stats.repairs).toBeGreaterThan(0);
    // Second attempt (valid) should produce non-partial output with moments
    expect(result.partial).toBe(false);
    expect(result.output).toBeTruthy();
    const out = result.output as { moments: unknown[] };
    expect(out.moments.length).toBeGreaterThan(0);
  });

  // M4: buildAgentTraceEvents passes git context to events
  it("(j) buildAgentTraceEvents includes git context on events when provided", () => {
    const sessionId = "test-session-m4";
    const toolCalls = [{ name: "read_transcript_range", ms: 5, argsSummary: "{}" }];
    const stats = { turns: 1, tokensUsed: 200, toolCalls, repairs: 0 };
    const gitCtx = { repo: "intent-ai", branch: "feat/repo-brain", worktree: undefined };

    const events = buildAgentTraceEvents(sessionId, toolCalls, stats, gitCtx);

    for (const e of events) {
      expect(e.repo).toBe("intent-ai");
      expect(e.branch).toBe("feat/repo-brain");
    }
  });
});
