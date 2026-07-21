import { describe, it, expect } from "vitest";
import type {
  SessionMoment,
  IntentTransition,
  AcceptedOutcome,
  SessionNarrative,
} from "../../src/adapters/types.js";
import { buildSessionEvents } from "../../src/pipeline/emit-events.js";

const sessionContext = {
  sessionId: "s1",
  repo: "intent-ai",
  branch: "feat/auth",
  worktree: undefined,
};

function makeNarrative(overrides?: Partial<SessionNarrative>): SessionNarrative {
  return {
    sessionId: "s1",
    sessionShape: "narrative",
    summary: "Implemented auth middleware with JWT validation",
    progression: ["started with research", "built middleware"],
    discoveries: ["found existing helper"],
    stabilizedDirections: ["JWT approach"],
    abandonedDirections: [],
    arcs: [],
    ...overrides,
  } as SessionNarrative;
}

describe("buildSessionEvents", () => {
  it("emits a session summary event from narrative", () => {
    const events = buildSessionEvents({
      ...sessionContext,
      moments: [],
      transitions: [],
      outcomes: [],
      narrative: makeNarrative(),
    });

    const summaryEvents = events.filter((e) => e.sourceType === "narrative");
    expect(summaryEvents).toHaveLength(1);
    expect(summaryEvents[0].summary).toContain("auth middleware");
    expect(summaryEvents[0].sessionId).toBe("s1");
    expect(summaryEvents[0].repo).toBe("intent-ai");
    expect(summaryEvents[0].branch).toBe("feat/auth");
    expect(summaryEvents[0].category).toBe("narrative");
    expect(summaryEvents[0].actor).toBe("system");
  });

  it("emits one event per moment", () => {
    const moments: SessionMoment[] = [
      {
        id: "m1",
        chunkId: "c1",
        type: "struggle",
        statement: "Agent struggled with circular imports in auth module",
        significance: "high",
        agency: "ai",
        confidence: "high",
        topicFingerprint: "auth",
        relatedMomentIds: [],
        evidence: [],
      },
      {
        id: "m2",
        chunkId: "c1",
        type: "discovery",
        statement: "Found existing JWT helper in utils",
        significance: "medium",
        agency: "collaborative",
        confidence: "medium",
        topicFingerprint: "auth",
        relatedMomentIds: [],
        evidence: [],
      },
    ];

    const events = buildSessionEvents({
      ...sessionContext,
      moments,
      transitions: [],
      outcomes: [],
      narrative: makeNarrative(),
    });

    const momentEvents = events.filter((e) => e.sourceType === "moment");
    expect(momentEvents).toHaveLength(2);
    expect(momentEvents[0].summary).toContain("circular imports");
    expect(momentEvents[0].sourceId).toBe("m1");
    expect(momentEvents[0].actor).toBe("ai");
    expect(momentEvents[0].category).toBe("struggle");
    expect(momentEvents[0].tags).toContain("auth");
  });

  it("emits one event per transition", () => {
    const transitions: IntentTransition[] = [
      {
        id: "t1",
        sessionId: "s1",
        fromStatement: "Research auth approaches",
        toStatement: "Implement JWT middleware",
        reason: "Found JWT library",
        originMomentIds: ["m1"],
        confidence: "high",
      },
    ];

    const events = buildSessionEvents({
      ...sessionContext,
      moments: [],
      transitions,
      outcomes: [],
      narrative: makeNarrative(),
    });

    const transitionEvents = events.filter((e) => e.sourceType === "transition");
    expect(transitionEvents).toHaveLength(1);
    expect(transitionEvents[0].summary).toContain("Research auth approaches");
    expect(transitionEvents[0].summary).toContain("Implement JWT middleware");
    expect(transitionEvents[0].category).toBe("transition");
  });

  it("emits one event per outcome with files", () => {
    const outcomes: AcceptedOutcome[] = [
      {
        id: "o1",
        sessionId: "s1",
        statement: "JWT middleware implemented and tested",
        supportingMomentIds: ["m1"],
        supportingFiles: ["src/auth/jwt.ts"],
        confidence: "high",
      },
    ];

    const events = buildSessionEvents({
      ...sessionContext,
      moments: [],
      transitions: [],
      outcomes,
      narrative: makeNarrative(),
    });

    const outcomeEvents = events.filter((e) => e.sourceType === "outcome");
    expect(outcomeEvents).toHaveLength(1);
    expect(outcomeEvents[0].files).toContain("src/auth/jwt.ts");
    expect(outcomeEvents[0].category).toBe("outcome");
  });

  it("all events carry session context", () => {
    const moments: SessionMoment[] = [
      {
        id: "m1",
        chunkId: "c1",
        type: "discovery",
        statement: "Found something interesting",
        significance: "low",
        agency: "ai",
        confidence: "low",
        topicFingerprint: "test",
        relatedMomentIds: [],
        evidence: [],
      },
    ];

    const events = buildSessionEvents({
      ...sessionContext,
      moments,
      transitions: [],
      outcomes: [],
      narrative: makeNarrative(),
    });

    for (const event of events) {
      expect(event.sessionId).toBe("s1");
      expect(event.repo).toBe("intent-ai");
      expect(event.branch).toBe("feat/auth");
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.summary.length).toBeGreaterThan(5);
    }
  });

  it("handles empty session (only summary event)", () => {
    const events = buildSessionEvents({
      ...sessionContext,
      moments: [],
      transitions: [],
      outcomes: [],
      narrative: makeNarrative(),
    });

    expect(events).toHaveLength(1);
    expect(events[0].sourceType).toBe("narrative");
  });

  // ── Timestamp / occurredAt / sessionEndedAt tests ──────────────────

  it("moment event timestamp uses occurredAt when present", () => {
    const occurredAt = "2026-05-20T09:15:00.000Z";
    const moment: SessionMoment = {
      id: "m-ts",
      chunkId: "c1",
      type: "discovery",
      statement: "Found something",
      significance: "medium",
      agency: "ai",
      confidence: "medium",
      topicFingerprint: "auth",
      relatedMomentIds: [],
      evidence: [],
      occurredAt,
    };

    const events = buildSessionEvents({
      ...sessionContext,
      moments: [moment],
      transitions: [],
      outcomes: [],
      narrative: makeNarrative(),
    });

    const momentEvent = events.find((e) => e.sourceType === "moment");
    expect(momentEvent).toBeDefined();
    expect(momentEvent!.timestamp).toEqual(new Date(occurredAt));
  });

  it("moment event timestamp falls back to new Date() when occurredAt is absent", () => {
    const before = Date.now();
    const moment: SessionMoment = {
      id: "m-nots",
      chunkId: "c1",
      type: "discovery",
      statement: "Found something else",
      significance: "medium",
      agency: "ai",
      confidence: "medium",
      topicFingerprint: "auth",
      relatedMomentIds: [],
      evidence: [],
      // occurredAt deliberately omitted
    };

    const events = buildSessionEvents({
      ...sessionContext,
      moments: [moment],
      transitions: [],
      outcomes: [],
      narrative: makeNarrative(),
    });

    const momentEvent = events.find((e) => e.sourceType === "moment");
    expect(momentEvent).toBeDefined();
    const after = Date.now();
    expect(momentEvent!.timestamp.getTime()).toBeGreaterThanOrEqual(before);
    expect(momentEvent!.timestamp.getTime()).toBeLessThanOrEqual(after);
  });

  it("narrative event uses sessionEndedAt when provided", () => {
    const sessionEndedAt = new Date("2026-05-20T11:00:00.000Z");

    const events = buildSessionEvents({
      ...sessionContext,
      moments: [],
      transitions: [],
      outcomes: [],
      narrative: makeNarrative(),
      sessionEndedAt,
    });

    const narrativeEvent = events.find((e) => e.sourceType === "narrative");
    expect(narrativeEvent).toBeDefined();
    expect(narrativeEvent!.timestamp).toEqual(sessionEndedAt);
  });

  it("transition event uses sessionEndedAt when provided", () => {
    const sessionEndedAt = new Date("2026-05-20T11:00:00.000Z");
    const transitions: IntentTransition[] = [
      {
        id: "t-ts",
        sessionId: "s1",
        fromStatement: "A",
        toStatement: "B",
        reason: "reasons",
        originMomentIds: [],
        confidence: "medium",
      },
    ];

    const events = buildSessionEvents({
      ...sessionContext,
      moments: [],
      transitions,
      outcomes: [],
      narrative: makeNarrative(),
      sessionEndedAt,
    });

    const transitionEvent = events.find((e) => e.sourceType === "transition");
    expect(transitionEvent).toBeDefined();
    expect(transitionEvent!.timestamp).toEqual(sessionEndedAt);
  });

  it("moment with empty occurredAt string emits with a valid Date (NaN guard)", () => {
    const moment: SessionMoment = {
      id: "m-nan-empty",
      chunkId: "c1",
      type: "discovery",
      statement: "Something happened",
      significance: "low",
      agency: "ai",
      confidence: "low",
      topicFingerprint: "test",
      relatedMomentIds: [],
      evidence: [],
      occurredAt: "",
    };

    const events = buildSessionEvents({
      ...sessionContext,
      moments: [moment],
      transitions: [],
      outcomes: [],
      narrative: makeNarrative(),
    });

    const momentEvent = events.find((e) => e.sourceType === "moment");
    expect(momentEvent).toBeDefined();
    // Must NOT throw and must be a valid Date
    expect(momentEvent!.timestamp).toBeInstanceOf(Date);
    expect(Number.isNaN(momentEvent!.timestamp.getTime())).toBe(false);
    // Calling toISOString() must not throw
    expect(() => momentEvent!.timestamp.toISOString()).not.toThrow();
  });

  it("moment with garbage occurredAt string emits with a valid Date (NaN guard)", () => {
    const moment: SessionMoment = {
      id: "m-nan-garbage",
      chunkId: "c1",
      type: "struggle",
      statement: "Something broke",
      significance: "high",
      agency: "ai",
      confidence: "medium",
      topicFingerprint: "test",
      relatedMomentIds: [],
      evidence: [],
      occurredAt: "garbage-not-a-date",
    };

    const events = buildSessionEvents({
      ...sessionContext,
      moments: [moment],
      transitions: [],
      outcomes: [],
      narrative: makeNarrative(),
    });

    const momentEvent = events.find((e) => e.sourceType === "moment");
    expect(momentEvent).toBeDefined();
    expect(momentEvent!.timestamp).toBeInstanceOf(Date);
    expect(Number.isNaN(momentEvent!.timestamp.getTime())).toBe(false);
    expect(() => momentEvent!.timestamp.toISOString()).not.toThrow();
  });

  it("narrative/transition/outcome timestamps fall back to new Date() when sessionEndedAt not provided", () => {
    const before = Date.now();

    const transitions: IntentTransition[] = [
      {
        id: "t-fb",
        sessionId: "s1",
        fromStatement: "A",
        toStatement: "B",
        reason: "reasons",
        originMomentIds: [],
        confidence: "medium",
      },
    ];

    const events = buildSessionEvents({
      ...sessionContext,
      moments: [],
      transitions,
      outcomes: [],
      narrative: makeNarrative(),
      // sessionEndedAt omitted
    });

    const after = Date.now();

    for (const e of events) {
      expect(e.timestamp.getTime()).toBeGreaterThanOrEqual(before);
      expect(e.timestamp.getTime()).toBeLessThanOrEqual(after);
    }
  });
});
