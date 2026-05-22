import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock("../../src/adapters/claude-code.js", () => ({
  parseClaudeCodeLog: vi.fn(),
}));

vi.mock("../../src/pipeline/classify.js", () => ({
  classifySession: vi.fn(),
}));

vi.mock("../../src/pipeline/moments.js", () => ({
  detectMoments: vi.fn(),
}));

vi.mock("../../src/pipeline/transitions.js", () => ({
  detectTransitionsAndOutcomes: vi.fn(),
}));

vi.mock("../../src/pipeline/narrative.js", () => ({
  generateNarrative: vi.fn(),
}));

vi.mock("../../src/storage/queries.js", () => ({
  storeSessionDigest: vi.fn(),
}));

// Import after mocks
import { runPipeline } from "../../src/pipeline/orchestrator.js";
import { parseClaudeCodeLog } from "../../src/adapters/claude-code.js";
import { classifySession } from "../../src/pipeline/classify.js";
import { detectMoments } from "../../src/pipeline/moments.js";
import { detectTransitionsAndOutcomes } from "../../src/pipeline/transitions.js";
import { generateNarrative } from "../../src/pipeline/narrative.js";
import { storeSessionDigest } from "../../src/storage/queries.js";

import type {
  RawDevEvent,
  SessionMoment,
  IntentTransition,
  AcceptedOutcome,
  SessionNarrative,
} from "../../src/adapters/types.js";

const mockedParse = vi.mocked(parseClaudeCodeLog);
const mockedClassify = vi.mocked(classifySession);
const mockedMoments = vi.mocked(detectMoments);
const mockedTransitions = vi.mocked(detectTransitionsAndOutcomes);
const mockedNarrative = vi.mocked(generateNarrative);
const mockedStore = vi.mocked(storeSessionDigest);

// ── Test Data ───────────────────────────────────────────────────────

const fakeRawEvents: RawDevEvent[] = [
  {
    id: "evt-1",
    source: "claude-code",
    timestamp: "2026-05-20T10:00:00.000Z",
    type: "conversation_turn",
    raw: { message: { content: "Hello" } },
  },
  {
    id: "evt-2",
    source: "claude-code",
    timestamp: "2026-05-20T10:01:00.000Z",
    type: "ai_response",
    raw: { message: { content: [{ type: "text", text: "Hi there" }] } },
  },
];

const fakeMoments: SessionMoment[] = [
  {
    id: "moment-0",
    chunkId: "chunk-0",
    type: "proposal",
    statement: "Developer proposed caching",
    significance: "high",
    agency: "developer",
    confidence: "high",
    topicFingerprint: "caching",
    relatedMomentIds: [],
    arcId: "arc-1",
    arcRole: "origin",
    evidence: [
      {
        quote: "Let's add caching",
        sourceEventId: "evt-1",
        sourceType: "human_message",
        quoteType: "verbatim",
      },
    ],
  },
];

const fakeTransitions: IntentTransition[] = [
  {
    id: "transition-0",
    sessionId: "test-session",
    fromStatement: "No caching",
    toStatement: "Redis caching",
    reason: "Performance",
    originMomentIds: ["moment-0"],
    confidence: "high",
  },
];

const fakeOutcomes: AcceptedOutcome[] = [
  {
    id: "outcome-0",
    sessionId: "test-session",
    statement: "Added Redis caching layer",
    supportingMomentIds: ["moment-0"],
    supportingFiles: ["src/cache.ts"],
    confidence: "high",
  },
];

const fakeNarrative: SessionNarrative = {
  sessionId: "",
  sessionShape: "narrative",
  summary: "Developer added a Redis caching layer",
  progression: ["Proposed caching", "Implemented Redis"],
  discoveries: ["TTL-based expiry works well"],
  stabilizedDirections: ["Redis for caching"],
  abandonedDirections: [],
  arcs: [
    {
      arcId: "arc-1",
      title: "Caching Implementation",
      summary: "Built Redis caching",
      momentIds: ["moment-0"],
      resolution: "resolved",
    },
  ],
};

// ── Tests ────────────────────────────────────────────────────────────

describe("runPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockedParse.mockResolvedValue(fakeRawEvents);
    mockedClassify.mockResolvedValue("narrative");
    mockedMoments.mockResolvedValue(fakeMoments);
    mockedTransitions.mockResolvedValue({
      transitions: fakeTransitions,
      outcomes: fakeOutcomes,
    });
    mockedNarrative.mockResolvedValue({ ...fakeNarrative });
    mockedStore.mockResolvedValue(undefined);
  });

  it("runs all pipeline steps in order and returns results", async () => {
    const result = await runPipeline("/fake/log.jsonl");

    // Verify each step was called
    expect(mockedParse).toHaveBeenCalledWith("/fake/log.jsonl");
    expect(mockedClassify).toHaveBeenCalledTimes(1);
    expect(mockedMoments).toHaveBeenCalledTimes(1);
    expect(mockedTransitions).toHaveBeenCalledTimes(1);
    expect(mockedNarrative).toHaveBeenCalledTimes(1);
    expect(mockedStore).toHaveBeenCalledTimes(1);

    // Verify call order: classify gets normalized events
    const classifyArgs = mockedClassify.mock.calls[0];
    expect(classifyArgs[0]).toBeInstanceOf(Array);
    expect(classifyArgs[0].length).toBeGreaterThan(0);

    // Verify moments gets chunks and shape
    const momentsArgs = mockedMoments.mock.calls[0];
    expect(momentsArgs[0]).toBeInstanceOf(Array); // chunks
    expect(momentsArgs[1]).toBe("narrative"); // shape

    // Verify transitions gets moments and sessionId
    const transitionsArgs = mockedTransitions.mock.calls[0];
    expect(transitionsArgs[0]).toEqual(fakeMoments);
    expect(typeof transitionsArgs[1]).toBe("string"); // sessionId

    // Verify narrative gets all inputs
    const narrativeArgs = mockedNarrative.mock.calls[0];
    expect(narrativeArgs[0]).toEqual(fakeMoments);
    expect(narrativeArgs[1]).toEqual(fakeTransitions);
    expect(narrativeArgs[2]).toEqual(fakeOutcomes);
    expect(narrativeArgs[3]).toBe("narrative");

    // Verify result structure
    expect(result.sessionId).toBeDefined();
    expect(result.narrative.summary).toBe("Developer added a Redis caching layer");
    expect(result.moments).toEqual(fakeMoments);
    expect(result.transitions).toEqual(fakeTransitions);
    expect(result.outcomes).toEqual(fakeOutcomes);
  });

  it("sets sessionId on the narrative", async () => {
    const result = await runPipeline("/fake/log.jsonl");
    expect(result.narrative.sessionId).toBe(result.sessionId);
  });

  it("still returns results if database write fails", async () => {
    mockedStore.mockRejectedValue(new Error("Connection refused"));

    const result = await runPipeline("/fake/log.jsonl");

    // Pipeline should still return results
    expect(result.narrative.summary).toBe("Developer added a Redis caching layer");
    expect(result.moments).toEqual(fakeMoments);
  });

  it("stores session digest with correct data", async () => {
    const result = await runPipeline("/fake/log.jsonl");

    expect(mockedStore).toHaveBeenCalledTimes(1);

    const storeArgs = mockedStore.mock.calls[0][0];
    expect(storeArgs.sessionId).toBe(result.sessionId);
    expect(storeArgs.sourceType).toBe("claude-code");
    expect(storeArgs.sourcePath).toBe("/fake/log.jsonl");
    expect(storeArgs.sessionShape).toBe("narrative");
    expect(storeArgs.rawEvents).toEqual(fakeRawEvents);
    expect(storeArgs.moments).toEqual(fakeMoments);
    expect(storeArgs.transitions).toEqual(fakeTransitions);
    expect(storeArgs.outcomes).toEqual(fakeOutcomes);
    expect(storeArgs.narrative.sessionId).toBe(result.sessionId);
  });

  it("passes correct timestamps from raw events", async () => {
    await runPipeline("/fake/log.jsonl");

    const storeArgs = mockedStore.mock.calls[0][0];
    expect(storeArgs.startedAt).toEqual(new Date("2026-05-20T10:00:00.000Z"));
    expect(storeArgs.endedAt).toEqual(new Date("2026-05-20T10:01:00.000Z"));
  });

  it("propagates parse errors", async () => {
    mockedParse.mockRejectedValue(new Error("File not found"));
    await expect(runPipeline("/missing/log.jsonl")).rejects.toThrow("File not found");
  });

  it("propagates LLM step errors", async () => {
    mockedClassify.mockRejectedValue(new Error("LLM call failed after 3 retries"));
    await expect(runPipeline("/fake/log.jsonl")).rejects.toThrow("LLM call failed");
  });
});
