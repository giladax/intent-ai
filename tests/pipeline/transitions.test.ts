import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionMoment } from "../../src/adapters/types.js";

// Mock the LLM client
vi.mock("../../src/llm/client.js", () => ({
  callSonnet: vi.fn(),
}));

import { detectTransitionsAndOutcomes } from "../../src/pipeline/transitions.js";
import { callSonnet } from "../../src/llm/client.js";

const mockedCallSonnet = vi.mocked(callSonnet);

// ── Helpers ──────────────────────────────────────────────────────────

function makeMoment(index: number, overrides?: Partial<SessionMoment>): SessionMoment {
  return {
    id: `moment-${index}`,
    chunkId: "s1-chunk-0",
    type: "proposal",
    statement: `Moment ${index} statement`,
    significance: "high",
    agency: "developer",
    confidence: "high",
    topicFingerprint: "test-topic",
    relatedMomentIds: [],
    arcId: "test-arc",
    arcRole: "origin",
    evidence: [
      {
        quote: `Evidence for moment ${index}`,
        sourceEventId: `s1-${index}`,
        sourceType: "human_message",
        quoteType: "verbatim",
      },
    ],
    ...overrides,
  };
}

const llmResponse = {
  transitions: [
    {
      fromStatement: "Implement auth middleware",
      toStatement: "Debug auth middleware CORS issue",
      reason: "Discovered CORS headers were missing during testing",
      triggeringMomentIndices: [1],
      arcId: "auth-middleware",
      confidence: "high" as const,
    },
  ],
  outcomes: [
    {
      statement: "Auth middleware with CORS support is working",
      supportingMomentIndices: [0, 2],
      filesAffected: ["src/middleware/auth.ts", "src/middleware/cors.ts"],
      confidence: "high" as const,
    },
  ],
};

// ── Tests ────────────────────────────────────────────────────────────

describe("detectTransitionsAndOutcomes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls callSonnet once and returns transitions + outcomes", async () => {
    mockedCallSonnet.mockResolvedValue(llmResponse);

    const moments = [makeMoment(0), makeMoment(1), makeMoment(2)];
    const result = await detectTransitionsAndOutcomes(moments, "session-123");

    expect(mockedCallSonnet).toHaveBeenCalledOnce();
    expect(result.transitions).toHaveLength(1);
    expect(result.outcomes).toHaveLength(1);
  });

  it("maps transitions to domain types with correct fields", async () => {
    mockedCallSonnet.mockResolvedValue(llmResponse);

    const moments = [makeMoment(0), makeMoment(1), makeMoment(2)];
    const result = await detectTransitionsAndOutcomes(moments, "session-123");

    const t = result.transitions[0];
    expect(t.id).toBe("transition-0");
    expect(t.sessionId).toBe("session-123");
    expect(t.fromStatement).toBe("Implement auth middleware");
    expect(t.toStatement).toBe("Debug auth middleware CORS issue");
    expect(t.reason).toContain("CORS");
    expect(t.originMomentIds).toEqual(["moment-1"]);
    expect(t.arcId).toBe("auth-middleware");
    expect(t.confidence).toBe("high");
  });

  it("maps outcomes to domain types with correct fields", async () => {
    mockedCallSonnet.mockResolvedValue(llmResponse);

    const moments = [makeMoment(0), makeMoment(1), makeMoment(2)];
    const result = await detectTransitionsAndOutcomes(moments, "session-123");

    const o = result.outcomes[0];
    expect(o.id).toBe("outcome-0");
    expect(o.sessionId).toBe("session-123");
    expect(o.statement).toBe("Auth middleware with CORS support is working");
    expect(o.supportingMomentIds).toEqual(["moment-0", "moment-2"]);
    expect(o.supportingFiles).toEqual([
      "src/middleware/auth.ts",
      "src/middleware/cors.ts",
    ]);
    expect(o.confidence).toBe("high");
  });

  it("passes moments data to the LLM prompt", async () => {
    mockedCallSonnet.mockResolvedValue({
      transitions: [],
      outcomes: [],
    });

    const moments = [
      makeMoment(0, { statement: "Started building the API layer" }),
    ];
    await detectTransitionsAndOutcomes(moments, "session-456");

    const [, userPrompt] = mockedCallSonnet.mock.calls[0];
    expect(userPrompt).toContain("Started building the API layer");
  });
});
