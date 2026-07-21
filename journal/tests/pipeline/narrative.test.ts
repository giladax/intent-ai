import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  SessionMoment,
  IntentTransition,
  AcceptedOutcome,
} from "../../src/adapters/types.js";

// Mock the LLM client
vi.mock("../../src/llm/client.js", () => ({
  callSonnet: vi.fn(),
}));

import { generateNarrative } from "../../src/pipeline/narrative.js";
import { callSonnet } from "../../src/llm/client.js";

const mockedCallSonnet = vi.mocked(callSonnet);

// ── Helpers ──────────────────────────────────────────────────────────

function makeMoment(index: number): SessionMoment {
  return {
    id: `moment-${index}`,
    chunkId: "s1-chunk-0",
    type: "proposal",
    statement: `Moment ${index}`,
    significance: "high",
    agency: "developer",
    confidence: "high",
    topicFingerprint: "test-topic",
    relatedMomentIds: [],
    arcId: "test-arc",
    arcRole: "origin",
    evidence: [
      {
        quote: `Quote ${index}`,
        sourceEventId: `s1-${index}`,
        sourceType: "human_message",
        quoteType: "verbatim",
      },
    ],
  };
}

function makeTransition(): IntentTransition {
  return {
    id: "transition-0",
    sessionId: "s1",
    fromStatement: "Build auth",
    toStatement: "Debug auth CORS",
    reason: "CORS issue found",
    originMomentIds: ["moment-0"],
    arcId: "auth-arc",
    confidence: "high",
  };
}

function makeOutcome(): AcceptedOutcome {
  return {
    id: "outcome-0",
    sessionId: "s1",
    statement: "Auth middleware working",
    supportingMomentIds: ["moment-0", "moment-1"],
    supportingFiles: ["src/auth.ts"],
    confidence: "high",
  };
}

const llmNarrativeResponse = {
  sessionShape: "narrative",
  summary:
    "The developer built an auth middleware, encountered a CORS issue, and resolved it.",
  arcs: [
    {
      arcId: "auth-arc",
      title: "Auth middleware",
      summary: "Built and debugged the auth middleware",
      resolution: "completed",
      momentIds: [0, 1],
    },
  ],
  progression: [
    "Started by implementing auth middleware",
    "Discovered CORS headers were missing",
    "Fixed CORS and verified with tests",
  ],
  discoveries: ["CORS headers need explicit configuration"],
  stabilizedDirections: ["Using JWT-based auth with CORS support"],
  abandonedDirections: [],
};

// ── Tests ────────────────────────────────────────────────────────────

describe("generateNarrative", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls callSonnet once and returns a SessionNarrative", async () => {
    mockedCallSonnet.mockResolvedValue(llmNarrativeResponse);

    const moments = [makeMoment(0), makeMoment(1)];
    const transitions = [makeTransition()];
    const outcomes = [makeOutcome()];

    const result = await generateNarrative(
      moments,
      transitions,
      outcomes,
      "narrative",
    );

    expect(mockedCallSonnet).toHaveBeenCalledOnce();
    expect(result.sessionShape).toBe("narrative");
    expect(result.summary).toContain("auth middleware");
    expect(result.progression).toHaveLength(3);
    expect(result.discoveries).toHaveLength(1);
    expect(result.arcs).toHaveLength(1);
  });

  it("maps arc resolution from LLM format to domain format", async () => {
    mockedCallSonnet.mockResolvedValue(llmNarrativeResponse);

    const result = await generateNarrative(
      [makeMoment(0)],
      [],
      [],
      "narrative",
    );

    // "completed" from LLM maps to "resolved" in domain
    expect(result.arcs[0].resolution).toBe("resolved");
  });

  it("converts arc momentIds from indices to string IDs", async () => {
    mockedCallSonnet.mockResolvedValue(llmNarrativeResponse);

    const result = await generateNarrative(
      [makeMoment(0), makeMoment(1)],
      [],
      [],
      "narrative",
    );

    expect(result.arcs[0].momentIds).toEqual(["moment-0", "moment-1"]);
  });

  it("passes all data to the LLM prompt", async () => {
    mockedCallSonnet.mockResolvedValue(llmNarrativeResponse);

    const moments = [makeMoment(0)];
    const transitions = [makeTransition()];
    const outcomes = [makeOutcome()];

    await generateNarrative(moments, transitions, outcomes, "debugging");

    const [systemPrompt, userPrompt] = mockedCallSonnet.mock.calls[0];

    // System prompt should contain narrative instructions
    expect(systemPrompt).toContain("narrator");

    // User prompt should contain our data
    expect(userPrompt).toContain("debugging");
    expect(userPrompt).toContain("Moment 0");
    expect(userPrompt).toContain("Build auth");
    expect(userPrompt).toContain("Debug auth CORS");
    expect(userPrompt).toContain("Auth middleware working");
  });

  it("handles empty transitions and outcomes", async () => {
    mockedCallSonnet.mockResolvedValue({
      ...llmNarrativeResponse,
      arcs: [],
      progression: ["Explored the codebase"],
      discoveries: [],
      stabilizedDirections: [],
      abandonedDirections: [],
    });

    const result = await generateNarrative(
      [makeMoment(0)],
      [],
      [],
      "exploratory",
    );

    expect(result.arcs).toHaveLength(0);
    expect(result.progression).toHaveLength(1);
  });
});
