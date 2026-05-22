import { describe, it, expect } from "vitest";
import { buildPass1Prompt } from "../../src/llm/prompts/moments.js";
import type {
  NormalizedDevEvent,
  SessionChunk,
  PipelineDirectives,
} from "../../src/adapters/types.js";

// ── Test Fixtures ────────────────────────────────────────────────────

function makeEvent(
  overrides: Partial<NormalizedDevEvent> & Pick<NormalizedDevEvent, "id" | "causalOrder" | "category" | "actor">,
): NormalizedDevEvent {
  return {
    sessionId: "test-session",
    timestamp: "2025-01-01T00:00:00Z",
    content: { summary: "test", detail: "test detail" },
    rawEventId: overrides.id,
    turnId: overrides.id,
    ...overrides,
  };
}

const threadedEvents: NormalizedDevEvent[] = [
  makeEvent({
    id: "ev-0",
    causalOrder: 0,
    category: "intent",
    actor: "user",
    content: { summary: "Add auth middleware", detail: "Add auth middleware to the API" },
    turnId: "u-001",
  }),
  makeEvent({
    id: "ev-1",
    causalOrder: 1,
    category: "proposal",
    actor: "ai",
    content: { summary: "I'll create an auth middleware", detail: "I'll create an auth middleware using JWT tokens" },
    turnId: "a-001",
    respondingTo: "ev-0",
  }),
  makeEvent({
    id: "ev-2",
    causalOrder: 2,
    category: "action",
    actor: "ai",
    content: {
      summary: "Tool: Edit on /src/middleware/auth.ts",
      detail: '{"file_path": "/src/middleware/auth.ts"}',
      filesAffected: ["/src/middleware/auth.ts"],
    },
    turnId: "a-001",
    respondingTo: "ev-0",
  }),
  makeEvent({
    id: "ev-3",
    causalOrder: 3,
    category: "intent",
    actor: "user",
    content: { summary: "ok looks good", detail: "ok looks good" },
    turnId: "u-002",
    respondingTo: "ev-2",
  }),
];

const testChunk: SessionChunk = {
  id: "chunk-0",
  sessionId: "test-session",
  chunkIndex: 0,
  events: threadedEvents,
  topicHint: "auth-middleware",
  filesInScope: ["/src/middleware/auth.ts"],
  eventRange: [0, 3],
};

const passiveDirectives: PipelineDirectives = {
  promptSections: {
    detectPassiveAcceptance: true,
    trackDelegation: false,
    detectIgnoredProposals: false,
    isLearningExchange: false,
  },
  exchangeSummary: {
    totalExchanges: 2,
    shortResponseCount: 1,
    questionCount: 0,
    reasoningCount: 0,
    newTopicCount: 0,
    ignoredProposals: [],
  },
};

const allDirectives: PipelineDirectives = {
  promptSections: {
    detectPassiveAcceptance: true,
    trackDelegation: true,
    detectIgnoredProposals: true,
    isLearningExchange: true,
  },
  exchangeSummary: {
    totalExchanges: 4,
    shortResponseCount: 3,
    questionCount: 2,
    reasoningCount: 0,
    newTopicCount: 0,
    ignoredProposals: ["Exchange at event 2: dev said 'ok' without addressing all options"],
  },
};

// ── Tests ────────────────────────────────────────────────────────────

describe("buildPass1Prompt — threaded format", () => {
  it("groups events into exchanges in the user prompt", () => {
    const { user } = buildPass1Prompt({
      chunk: testChunk,
      sessionShape: { shape: "narrative" },
    });

    // Should contain exchange markers
    expect(user).toContain("── Exchange ──");

    // First exchange: user message
    expect(user).toContain('[0] DEV: "Add auth middleware to the API"');

    // AI responses grouped under exchange
    expect(user).toContain("AI:");
    expect(user).toContain("I'll create an auth middleware using JWT tokens");
    expect(user).toContain("Edit /src/middleware/auth.ts");

    // Second exchange
    expect(user).toContain('[3] DEV: "ok looks good"');
  });

  it("renders tool actions with tool name and file path", () => {
    const { user } = buildPass1Prompt({
      chunk: testChunk,
      sessionShape: { shape: "narrative" },
    });

    // The action event should show tool name and file
    expect(user).toMatch(/Edit \/src\/middleware\/auth\.ts/);
  });

  it("works without directives (backwards compatible)", () => {
    const { system, user } = buildPass1Prompt({
      chunk: testChunk,
      sessionShape: { shape: "narrative" },
    });

    expect(system).toBeDefined();
    expect(user).toBeDefined();
    // No directive guidance should appear
    expect(system).not.toContain("Interaction Signals");
  });

  it("injects passive acceptance guidance when directive is set", () => {
    const { system } = buildPass1Prompt({
      chunk: testChunk,
      sessionShape: { shape: "narrative" },
      directives: passiveDirectives,
    });

    expect(system).toContain("Interaction Signals");
    expect(system).toContain("short developer responses");
    expect(system).toContain("passive acceptance");
    // Other directives should NOT be present
    expect(system).not.toContain("frequently defers decisions");
    expect(system).not.toContain("didn't fully address");
    expect(system).not.toContain("asking questions to understand");
  });

  it("injects all directive guidance when all flags are set", () => {
    const { system } = buildPass1Prompt({
      chunk: testChunk,
      sessionShape: { shape: "narrative" },
      directives: allDirectives,
    });

    expect(system).toContain("passive acceptance");
    expect(system).toContain("frequently defers decisions");
    expect(system).toContain("didn't fully address");
    expect(system).toContain("asking questions to understand");
  });

  it("renders standalone events before first intent as flat format", () => {
    const standaloneFirst: NormalizedDevEvent[] = [
      makeEvent({
        id: "ev-pre",
        causalOrder: 0,
        category: "reflection",
        actor: "ai",
        content: { summary: "Reading file", detail: "Reading configuration file" },
        turnId: "a-000",
      }),
      ...threadedEvents.map((e, i) => ({ ...e, causalOrder: i + 1 })),
    ];

    const chunk: SessionChunk = {
      ...testChunk,
      events: standaloneFirst,
    };

    const { user } = buildPass1Prompt({
      chunk,
      sessionShape: { shape: "narrative" },
    });

    // Standalone event should appear in flat format (AI/REFLECTION)
    expect(user).toContain("AI/REFLECTION");
    expect(user).toContain("Reading configuration file");

    // Exchange format should still be used for intent groups
    expect(user).toContain("── Exchange ──");
  });

  it("falls back to flat format when there are no intents", () => {
    const noIntents: NormalizedDevEvent[] = [
      makeEvent({
        id: "ev-a1",
        causalOrder: 0,
        category: "action",
        actor: "ai",
        content: { summary: "Tool: Bash", detail: "Running tests" },
        turnId: "a-001",
      }),
      makeEvent({
        id: "ev-a2",
        causalOrder: 1,
        category: "reflection",
        actor: "ai",
        content: { summary: "Tests passed", detail: "All 42 tests passed" },
        turnId: "a-001",
      }),
    ];

    const chunk: SessionChunk = {
      ...testChunk,
      events: noIntents,
    };

    const { user } = buildPass1Prompt({
      chunk,
      sessionShape: { shape: "narrative" },
    });

    // Should NOT have exchange markers
    expect(user).not.toContain("── Exchange ──");
    // Should use flat format
    expect(user).toContain("AI/ACTION");
  });
});
