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
});
