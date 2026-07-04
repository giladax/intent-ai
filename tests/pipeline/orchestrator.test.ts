import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock("../../src/adapters/claude-code.js", () => ({
  parseClaudeCodeLog: vi.fn(),
}));

vi.mock("../../src/pipeline/classify.js", () => ({
  classifySession: vi.fn(),
}));

vi.mock("../../src/pipeline/understand/index.js", () => ({
  understand: vi.fn(),
}));

// Controllable duplicate-check query. Default: no existing row (not a duplicate).
const { mockSql } = vi.hoisted(() => ({
  mockSql: Object.assign(
    vi.fn(async () => [] as Array<{ id: string }>),
    { unsafe: vi.fn().mockResolvedValue([]) },
  ),
}));

vi.mock("../../src/storage/connection.js", () => ({
  getClient: vi.fn(() => mockSql),
  getDb: vi.fn(),
  closeDb: vi.fn(),
}));

vi.mock("../../src/storage/queries.js", () => ({
  storeSessionDigest: vi.fn(),
  emitEvents: vi.fn().mockResolvedValue([]),
  getSessionNarrative: vi.fn(),
  getSessionMoments: vi.fn(),
  getSessionTransitions: vi.fn(),
  getSessionOutcomes: vi.fn(),
  getSessionEndedAt: vi.fn(),
  deleteSessionDigest: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/pipeline/emit-events.js", () => ({
  buildSessionEvents: vi.fn().mockReturnValue([]),
}));

vi.mock("../../src/pipeline/classify-exchanges.js", () => ({
  classifyExchanges: vi.fn(async (exchanges: unknown[]) =>
    (exchanges as unknown[]).map(() => ({
      engagement: "active",
      intent: "acceptance",
      agency: "collaborative",
      candidateType: null,
    }))
  ),
}));

// Import after mocks
import { runPipeline } from "../../src/pipeline/orchestrator.js";
import { parseClaudeCodeLog } from "../../src/adapters/claude-code.js";
import { classifySession } from "../../src/pipeline/classify.js";
import { understand } from "../../src/pipeline/understand/index.js";
import {
  storeSessionDigest,
  emitEvents,
  getSessionNarrative,
  getSessionMoments,
  getSessionTransitions,
  getSessionOutcomes,
  getSessionEndedAt,
  deleteSessionDigest,
} from "../../src/storage/queries.js";

import type {
  RawDevEvent,
  SessionMoment,
  IntentTransition,
  AcceptedOutcome,
  SessionNarrative,
  SessionChunk,
  Sitting,
} from "../../src/adapters/types.js";

const mockedParse = vi.mocked(parseClaudeCodeLog);
const mockedClassify = vi.mocked(classifySession);
const mockedUnderstand = vi.mocked(understand);
const mockedStore = vi.mocked(storeSessionDigest);
const mockedEmitEvents = vi.mocked(emitEvents);
const mockedGetNarrative = vi.mocked(getSessionNarrative);
const mockedGetMoments = vi.mocked(getSessionMoments);
const mockedGetTransitions = vi.mocked(getSessionTransitions);
const mockedGetOutcomes = vi.mocked(getSessionOutcomes);
const mockedGetSessionEndedAt = vi.mocked(getSessionEndedAt);
const mockedDeleteSessionDigest = vi.mocked(deleteSessionDigest);

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

const fakeSittings: Sitting[] = [];
const fakeChunks: SessionChunk[] = [];

const fakeUnderstandResult = {
  sittings: fakeSittings,
  chunks: fakeChunks,
  moments: fakeMoments,
  transitions: fakeTransitions,
  outcomes: fakeOutcomes,
  narrative: { ...fakeNarrative },
};

// ── Tests ────────────────────────────────────────────────────────────

describe("runPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: duplicate-check query returns no rows (not already digested).
    mockSql.mockResolvedValue([]);
    mockedParse.mockResolvedValue(fakeRawEvents);
    mockedClassify.mockResolvedValue("narrative");
    mockedUnderstand.mockResolvedValue({ ...fakeUnderstandResult, narrative: { ...fakeNarrative } });
    mockedStore.mockResolvedValue({ stored: true });
    mockedGetSessionEndedAt.mockResolvedValue(null);
  });

  it("runs all pipeline steps in order and returns results", async () => {
    const result = await runPipeline("/fake/log.jsonl");

    // Verify each step was called
    expect(mockedParse).toHaveBeenCalledWith("/fake/log.jsonl");
    expect(mockedClassify).toHaveBeenCalledTimes(1);
    expect(mockedUnderstand).toHaveBeenCalledTimes(1);
    expect(mockedStore).toHaveBeenCalledTimes(1);

    // Verify call order: classify gets normalized events
    const classifyArgs = mockedClassify.mock.calls[0];
    expect(classifyArgs[0]).toBeInstanceOf(Array);
    expect(classifyArgs[0].length).toBeGreaterThan(0);

    // Verify understand gets normalized events, sessionId, shape, directives, topicShiftIds
    const understandArgs = mockedUnderstand.mock.calls[0];
    expect(understandArgs[0]).toBeInstanceOf(Array); // normalizedEvents
    expect(typeof understandArgs[1]).toBe("string"); // sessionId
    expect(understandArgs[2]).toBe("narrative"); // sessionShape
    expect(understandArgs[3]).toMatchObject({ promptSections: expect.any(Object) }); // directives
    expect(understandArgs[4]).toBeInstanceOf(Set); // topicShiftIds

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

  it("store failure → emitEvents is NOT called (I2 regression: no phantom events)", async () => {
    mockedStore.mockRejectedValue(new Error("DB unavailable"));

    await runPipeline("/fake/log.jsonl");

    // With store failure, digestStored = false → emitEvents must be skipped
    expect(mockedEmitEvents).not.toHaveBeenCalled();
  });

  it("store conflict (stored: false) → emitEvents is NOT called (I2 regression)", async () => {
    // Simulates the losing run in a concurrent digest: storeSessionDigest resolves
    // but returns { stored: false } (the ON CONFLICT DO NOTHING path).
    mockedStore.mockResolvedValue({ stored: false });

    await runPipeline("/fake/log.jsonl");

    expect(mockedEmitEvents).not.toHaveBeenCalled();
  });

  it("successful store → emitEvents IS called", async () => {
    mockedStore.mockResolvedValue({ stored: true });

    await runPipeline("/fake/log.jsonl");

    expect(mockedEmitEvents).toHaveBeenCalledTimes(1);
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
    // sittings are passed through from understand result
    expect(storeArgs.sittings).toEqual(fakeSittings);
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

  it("is idempotent — returns the stored digest without re-running the understand stage when log is unchanged", async () => {
    // Parse is called first now (before the duplicate check).
    // Duplicate-check query finds an existing session for this source hash,
    // and the stored endedAt matches the raw event max timestamp (no growth).
    mockSql.mockResolvedValue([{ id: "existing-session-1" }]);
    // storedEndedAt == maxTs → NOT grown
    mockedGetSessionEndedAt.mockResolvedValue(new Date("2026-05-20T10:01:00.000Z"));
    mockedGetNarrative.mockResolvedValue({ ...fakeNarrative, sessionId: "existing-session-1" });
    mockedGetMoments.mockResolvedValue(fakeMoments);
    mockedGetTransitions.mockResolvedValue(fakeTransitions);
    mockedGetOutcomes.mockResolvedValue(fakeOutcomes);

    const result = await runPipeline("/fake/already-done.jsonl");

    // Returned the stored digest...
    expect(result.sessionId).toBe("existing-session-1");
    expect(result.moments).toEqual(fakeMoments);
    expect(result.transitions).toEqual(fakeTransitions);
    expect(result.outcomes).toEqual(fakeOutcomes);

    // Parse IS called (happens before the duplicate check now)
    expect(mockedParse).toHaveBeenCalledTimes(1);
    // ...but the expensive understand stage was NOT re-run
    expect(mockedUnderstand).not.toHaveBeenCalled();
    expect(mockedStore).not.toHaveBeenCalled();
    // deleteSessionDigest was NOT called (not grown, no --force)
    expect(mockedDeleteSessionDigest).not.toHaveBeenCalled();
  });

  it("re-digests when the duplicate check errors (DB unreachable)", async () => {
    mockSql.mockRejectedValue(new Error("Connection refused"));

    const result = await runPipeline("/fake/log.jsonl");

    // Falls through to a normal digest run.
    expect(mockedParse).toHaveBeenCalledTimes(1);
    expect(mockedUnderstand).toHaveBeenCalledTimes(1);
    expect(result.narrative.summary).toBe("Developer added a Redis caching layer");
  });

  // ── Grown-log + force tests ────────────────────────────────────────

  it("re-digests a grown log — deletes stored digest and runs full pipeline", async () => {
    // findDigestedSession returns an existing id
    mockSql.mockResolvedValue([{ id: "existing-session-2" }]);
    // storedEndedAt is more than 60s before the raw-event max timestamp → grown
    mockedGetSessionEndedAt.mockResolvedValue(new Date("2026-05-20T09:00:00.000Z"));

    const result = await runPipeline("/fake/grown.jsonl");

    // deleteSessionDigest was called before re-digesting
    expect(mockedDeleteSessionDigest).toHaveBeenCalledWith("existing-session-2");
    // Full pipeline ran
    expect(mockedUnderstand).toHaveBeenCalledTimes(1);
    expect(mockedStore).toHaveBeenCalledTimes(1);
    expect(result.narrative.summary).toBe("Developer added a Redis caching layer");
  });

  it("unchanged log — returns stored digest, does NOT call deleteSessionDigest", async () => {
    mockSql.mockResolvedValue([{ id: "existing-session-3" }]);
    // storedEndedAt exactly matches → NOT grown (0ms difference)
    mockedGetSessionEndedAt.mockResolvedValue(new Date("2026-05-20T10:01:00.000Z"));
    mockedGetNarrative.mockResolvedValue({ ...fakeNarrative, sessionId: "existing-session-3" });
    mockedGetMoments.mockResolvedValue(fakeMoments);
    mockedGetTransitions.mockResolvedValue(fakeTransitions);
    mockedGetOutcomes.mockResolvedValue(fakeOutcomes);

    const result = await runPipeline("/fake/unchanged.jsonl");

    expect(result.sessionId).toBe("existing-session-3");
    expect(mockedDeleteSessionDigest).not.toHaveBeenCalled();
    expect(mockedUnderstand).not.toHaveBeenCalled();
  });

  it("--force flag — deletes stored digest and runs full pipeline even when log is unchanged", async () => {
    mockSql.mockResolvedValue([{ id: "existing-session-4" }]);
    // storedEndedAt matches — would normally be idempotent
    mockedGetSessionEndedAt.mockResolvedValue(new Date("2026-05-20T10:01:00.000Z"));

    const result = await runPipeline("/fake/log.jsonl", { force: true });

    // deleteSessionDigest called despite no growth
    expect(mockedDeleteSessionDigest).toHaveBeenCalledWith("existing-session-4");
    // Full pipeline ran
    expect(mockedUnderstand).toHaveBeenCalledTimes(1);
    expect(mockedStore).toHaveBeenCalledTimes(1);
    expect(result.narrative.summary).toBe("Developer added a Redis caching layer");
  });
});
