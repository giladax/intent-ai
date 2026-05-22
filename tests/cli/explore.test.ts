import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  SessionNarrative,
  SessionMoment,
  IntentTransition,
  AcceptedOutcome,
} from "../../src/adapters/types.js";

// Mock the storage queries
vi.mock("../../src/storage/queries.js", () => ({
  getMostRecentSession: vi.fn(),
  getSessionNarrative: vi.fn(),
  getSessionMoments: vi.fn(),
  getSessionTransitions: vi.fn(),
  getSessionOutcomes: vi.fn(),
  getChunkEvents: vi.fn(),
}));

import {
  getMostRecentSession,
  getSessionNarrative,
  getSessionMoments,
  getSessionTransitions,
  getSessionOutcomes,
} from "../../src/storage/queries.js";
import {
  buildSystemPrompt,
  findMatchingMoment,
  loadDigest,
} from "../../src/cli/explore.js";
import type { SessionDigest } from "../../src/cli/explore.js";

const mockedGetMostRecentSession = vi.mocked(getMostRecentSession);
const mockedGetSessionNarrative = vi.mocked(getSessionNarrative);
const mockedGetSessionMoments = vi.mocked(getSessionMoments);
const mockedGetSessionTransitions = vi.mocked(getSessionTransitions);
const mockedGetSessionOutcomes = vi.mocked(getSessionOutcomes);

// ── Helpers ──────────────────────────────────────────────────────────

function makeNarrative(overrides?: Partial<SessionNarrative>): SessionNarrative {
  return {
    sessionId: "test-session",
    sessionShape: "narrative",
    summary: "A session about building an auth service",
    progression: ["Started with middleware", "Moved to dedicated service"],
    discoveries: ["User tokens need per-user scope"],
    stabilizedDirections: ["Auth service pattern"],
    abandonedDirections: ["Middleware-based auth"],
    arcs: [
      {
        arcId: "arc-1",
        title: "Auth Architecture",
        summary: "Evolved from middleware to service",
        momentIds: ["moment-1", "moment-2"],
        resolution: "resolved",
      },
    ],
    ...overrides,
  };
}

function makeMoment(index: number, overrides?: Partial<SessionMoment>): SessionMoment {
  return {
    id: `moment-${index}`,
    chunkId: `chunk-${index}`,
    type: "proposal",
    statement: `Moment ${index} statement`,
    significance: "Important decision point",
    agency: "developer",
    confidence: "high",
    topicFingerprint: `topic-${index}`,
    relatedMomentIds: [],
    arcId: "arc-1",
    arcRole: "origin",
    evidence: [
      {
        quote: `"Let's do it this way" — moment ${index}`,
        sourceEventId: `event-${index}`,
        sourceType: "human_message",
        quoteType: "verbatim",
      },
    ],
    ...overrides,
  };
}

function makeTransition(index: number): IntentTransition {
  return {
    id: `transition-${index}`,
    sessionId: "test-session",
    fromStatement: `Old approach ${index}`,
    toStatement: `New approach ${index}`,
    reason: `Discovered limitation ${index}`,
    originMomentIds: [`moment-${index}`],
    arcId: "arc-1",
    confidence: "high",
  };
}

function makeOutcome(index: number): AcceptedOutcome {
  return {
    id: `outcome-${index}`,
    sessionId: "test-session",
    statement: `Outcome ${index} accepted`,
    supportingMomentIds: [`moment-${index}`],
    supportingFiles: [`src/auth-service-${index}.ts`],
    confidence: "high",
  };
}

function makeDigest(): SessionDigest {
  return {
    sessionId: "test-session",
    narrative: makeNarrative(),
    moments: [
      makeMoment(1, {
        statement: "Developer rejected TypeScript strict mode proposal",
        topicFingerprint: "typescript-config",
        type: "rejection",
        agency: "developer",
      }),
      makeMoment(2, {
        statement: "Auth moved from middleware to dedicated service",
        topicFingerprint: "auth-architecture",
        type: "pivot",
        agency: "developer",
      }),
      makeMoment(3, {
        statement: "Database schema finalized with user table",
        topicFingerprint: "database-schema",
        type: "commitment",
        agency: "collaborative",
      }),
    ],
    transitions: [makeTransition(1)],
    outcomes: [makeOutcome(1)],
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("explore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loadDigest", () => {
    it("loads narrative, moments, transitions, and outcomes", async () => {
      const narrative = makeNarrative();
      const moments = [makeMoment(1), makeMoment(2)];
      const transitions = [makeTransition(1)];
      const outcomes = [makeOutcome(1)];

      mockedGetSessionNarrative.mockResolvedValue(narrative);
      mockedGetSessionMoments.mockResolvedValue(moments);
      mockedGetSessionTransitions.mockResolvedValue(transitions);
      mockedGetSessionOutcomes.mockResolvedValue(outcomes);

      const digest = await loadDigest("test-session");

      expect(digest.sessionId).toBe("test-session");
      expect(digest.narrative).toEqual(narrative);
      expect(digest.moments).toEqual(moments);
      expect(digest.transitions).toEqual(transitions);
      expect(digest.outcomes).toEqual(outcomes);
    });

    it("throws if narrative is missing", async () => {
      mockedGetSessionNarrative.mockResolvedValue(null);
      mockedGetSessionMoments.mockResolvedValue([]);
      mockedGetSessionTransitions.mockResolvedValue([]);
      mockedGetSessionOutcomes.mockResolvedValue([]);

      await expect(loadDigest("missing-session")).rejects.toThrow(
        "has no narrative",
      );
    });

    it("warns but succeeds if no moments exist", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      mockedGetSessionNarrative.mockResolvedValue(makeNarrative());
      mockedGetSessionMoments.mockResolvedValue([]);
      mockedGetSessionTransitions.mockResolvedValue([]);
      mockedGetSessionOutcomes.mockResolvedValue([]);

      const digest = await loadDigest("test-session");

      expect(digest.moments).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("no moments detected"),
      );

      warnSpy.mockRestore();
    });
  });

  describe("buildSystemPrompt", () => {
    it("includes narrative summary in system prompt", () => {
      const digest = makeDigest();
      const prompt = buildSystemPrompt(digest);

      expect(prompt).toContain("A session about building an auth service");
    });

    it("includes arc details", () => {
      const digest = makeDigest();
      const prompt = buildSystemPrompt(digest);

      expect(prompt).toContain("Auth Architecture");
      expect(prompt).toContain("resolved");
      expect(prompt).toContain("Evolved from middleware to service");
    });

    it("includes moment details with evidence", () => {
      const digest = makeDigest();
      const prompt = buildSystemPrompt(digest);

      expect(prompt).toContain("Developer rejected TypeScript strict mode proposal");
      expect(prompt).toContain("Agency: developer");
      expect(prompt).toContain("rejection");
    });

    it("includes transitions", () => {
      const digest = makeDigest();
      const prompt = buildSystemPrompt(digest);

      expect(prompt).toContain("Old approach 1");
      expect(prompt).toContain("New approach 1");
      expect(prompt).toContain("Discovered limitation 1");
    });

    it("includes outcomes with files", () => {
      const digest = makeDigest();
      const prompt = buildSystemPrompt(digest);

      expect(prompt).toContain("Outcome 1 accepted");
      expect(prompt).toContain("src/auth-service-1.ts");
    });

    it("includes rules section", () => {
      const digest = makeDigest();
      const prompt = buildSystemPrompt(digest);

      expect(prompt).toContain("Answer based on the evidence");
      expect(prompt).toContain("agency field");
      expect(prompt).toContain("drill into");
    });

    it("shows correct counts", () => {
      const digest = makeDigest();
      const prompt = buildSystemPrompt(digest);

      expect(prompt).toContain("Moments (3 total)");
      expect(prompt).toContain("Transitions (1)");
      expect(prompt).toContain("Outcomes (1)");
      expect(prompt).toContain("Arcs (1)");
    });
  });

  describe("findMatchingMoment", () => {
    const moments = makeDigest().moments;

    it("matches by statement keyword", () => {
      const result = findMatchingMoment("TypeScript", moments);
      expect(result).not.toBeNull();
      expect(result!.id).toBe("moment-1");
    });

    it("matches by topicFingerprint", () => {
      const result = findMatchingMoment("auth-architecture", moments);
      expect(result).not.toBeNull();
      expect(result!.id).toBe("moment-2");
    });

    it("matches case-insensitively", () => {
      const result = findMatchingMoment("typescript", moments);
      expect(result).not.toBeNull();
      expect(result!.id).toBe("moment-1");
    });

    it("returns null when no match found", () => {
      const result = findMatchingMoment("nonexistent topic xyz", moments);
      expect(result).toBeNull();
    });

    it("uses word scoring for fuzzy matches", () => {
      const result = findMatchingMoment("database schema", moments);
      expect(result).not.toBeNull();
      expect(result!.id).toBe("moment-3");
    });

    it("prefers best match when multiple moments match", () => {
      // "middleware" appears in moment-2's statement
      const result = findMatchingMoment("middleware", moments);
      expect(result).not.toBeNull();
      expect(result!.id).toBe("moment-2");
    });
  });
});
