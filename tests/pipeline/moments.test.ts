import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionChunk } from "../../src/adapters/types.js";

// Mock the LLM client
vi.mock("../../src/llm/client.js", () => ({
  callSonnet: vi.fn(),
}));

import { detectMoments } from "../../src/pipeline/moments.js";
import { callSonnet } from "../../src/llm/client.js";

const mockedCallSonnet = vi.mocked(callSonnet);

// ── Helpers ──────────────────────────────────────────────────────────

function makeChunk(index: number): SessionChunk {
  return {
    id: `s1-chunk-${index}`,
    sessionId: "s1",
    chunkIndex: index,
    events: [
      {
        id: `s1-${index * 10}`,
        sessionId: "s1",
        timestamp: "2026-05-20T10:00:00.000Z",
        causalOrder: index * 10,
        category: "intent",
        actor: "user",
        content: {
          summary: `User intent in chunk ${index}`,
          detail: `Detailed user intent in chunk ${index}`,
        },
        rawEventId: `raw-${index * 10}`,
      },
      {
        id: `s1-${index * 10 + 1}`,
        sessionId: "s1",
        timestamp: "2026-05-20T10:01:00.000Z",
        causalOrder: index * 10 + 1,
        category: "action",
        actor: "ai",
        content: {
          summary: `AI action in chunk ${index}`,
          detail: `AI action detail in chunk ${index}`,
          filesAffected: [`src/file-${index}.ts`],
        },
        rawEventId: `raw-${index * 10 + 1}`,
      },
    ],
    topicHint: `topic-${index}`,
    filesInScope: [`src/file-${index}.ts`],
    eventRange: [index * 10, index * 10 + 1],
  };
}

const pass1Response = {
  moments: [
    {
      type: "proposal",
      statement: "Developer proposed using Redis for caching",
      significance: "high",
      agency: "developer",
      confidence: "high",
      topicFingerprint: "redis-caching",
      evidence: [
        {
          quote: "Let's use Redis for the caching layer",
          sourceType: "user",
          quoteType: "verbatim",
        },
      ],
    },
  ],
};

const pass2Response = {
  moments: [
    {
      type: "proposal",
      statement: "Developer proposed using Redis for caching",
      significance: "high",
      agency: "developer",
      confidence: "high",
      topicFingerprint: "redis-caching",
      evidence: [
        {
          quote: "Let's use Redis for the caching layer",
          sourceType: "user",
          quoteType: "verbatim",
        },
      ],
      arcId: "caching-setup",
      arcRole: "origin",
      relatedMomentIds: [],
    },
    {
      type: "commitment",
      statement: "Committed to Redis with TTL-based expiry",
      significance: "high",
      agency: "collaborative",
      confidence: "high",
      topicFingerprint: "redis-caching",
      evidence: [
        {
          quote: "TTL-based expiry makes sense here",
          sourceType: "ai",
          quoteType: "verbatim",
        },
      ],
      arcId: "caching-setup",
      arcRole: "resolution",
      relatedMomentIds: [0],
    },
  ],
};

// ── Tests ────────────────────────────────────────────────────────────

describe("detectMoments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls pass 1 once per chunk in parallel, then pass 2 once", async () => {
    const chunks = [makeChunk(0), makeChunk(1), makeChunk(2)];

    // First 3 calls are pass 1 (one per chunk), 4th call is pass 2
    mockedCallSonnet
      .mockResolvedValueOnce(pass1Response)
      .mockResolvedValueOnce(pass1Response)
      .mockResolvedValueOnce(pass1Response)
      .mockResolvedValueOnce(pass2Response);

    const result = await detectMoments(chunks, "narrative");

    // Pass 1: 3 calls (one per chunk) + Pass 2: 1 call = 4 total
    expect(mockedCallSonnet).toHaveBeenCalledTimes(4);

    // Result should match pass 2 output
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("proposal");
    expect(result[0].statement).toBe(
      "Developer proposed using Redis for caching",
    );
    expect(result[0].arcId).toBe("caching-setup");
    expect(result[0].arcRole).toBe("origin");
    expect(result[1].type).toBe("commitment");
    expect(result[1].relatedMomentIds).toEqual(["moment-0"]);
  });

  it("returns SessionMoment objects with correct structure", async () => {
    const chunks = [makeChunk(0)];

    mockedCallSonnet
      .mockResolvedValueOnce(pass1Response)
      .mockResolvedValueOnce(pass2Response);

    const result = await detectMoments(chunks, "debugging");

    const moment = result[0];
    expect(moment.id).toBe("moment-0");
    expect(moment.chunkId).toBe("s1-chunk-0");
    expect(moment.evidence).toHaveLength(1);
    expect(moment.evidence[0].quote).toBe(
      "Let's use Redis for the caching layer",
    );
    expect(moment.evidence[0].sourceType).toBe("human_message");
    expect(moment.confidence).toBe("high");
  });

  it("passes sessionShape to pass 1 prompts", async () => {
    const chunks = [makeChunk(0)];

    mockedCallSonnet
      .mockResolvedValueOnce(pass1Response)
      .mockResolvedValueOnce(pass2Response);

    await detectMoments(chunks, "exploratory");

    // First call is pass 1 — the user prompt should mention the session shape
    const [, userPrompt] = mockedCallSonnet.mock.calls[0];
    expect(userPrompt).toContain("exploratory");
  });
});
