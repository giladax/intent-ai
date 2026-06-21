import { describe, it, expect } from "vitest";
import { buildSessionEvents } from "../../src/pipeline/emit-events.js";
import type {
  SessionMoment,
  IntentTransition,
  AcceptedOutcome,
  SessionNarrative,
} from "../../src/adapters/types.js";

describe("event backbone integration", () => {
  // Realistic test data simulating a typical session
  const moments: SessionMoment[] = [
    {
      id: "m1", chunkId: "c1", type: "proposal",
      statement: "AI proposed using middleware pattern for request validation",
      significance: "medium", agency: "ai", confidence: "high",
      topicFingerprint: "architecture", evidence: [],
    },
    {
      id: "m2", chunkId: "c1", type: "struggle",
      statement: "Developer struggled with circular dependency between auth and user modules",
      significance: "high", agency: "developer", confidence: "high",
      topicFingerprint: "auth", evidence: [],
    },
    {
      id: "m3", chunkId: "c2", type: "discovery",
      statement: "Discovered existing validation utility that handles most edge cases",
      significance: "medium", agency: "collaborative", confidence: "medium",
      topicFingerprint: "validation", evidence: [],
    },
    {
      id: "m4", chunkId: "c2", type: "breakthrough",
      statement: "Resolved circular dependency by extracting shared types to a separate module",
      significance: "high", agency: "collaborative", confidence: "high",
      topicFingerprint: "auth", evidence: [],
      arcId: "arc1", arcRole: "resolution",
    },
    {
      id: "m5", chunkId: "c2", type: "commitment",
      statement: "Committed to middleware-based validation with extracted type module",
      significance: "medium", agency: "developer", confidence: "high",
      topicFingerprint: "architecture", evidence: [],
    },
  ];

  const transitions: IntentTransition[] = [
    {
      id: "t1", sessionId: "s1",
      fromStatement: "Exploring validation approaches",
      toStatement: "Implementing middleware pattern",
      reason: "Middleware pattern fits existing codebase architecture",
      originMomentIds: ["m1", "m3"],
      confidence: "high",
    },
  ];

  const outcomes: AcceptedOutcome[] = [
    {
      id: "o1", sessionId: "s1",
      statement: "Validation middleware implemented with shared type module",
      supportingMomentIds: ["m4", "m5"],
      supportingFiles: ["src/middleware/validate.ts", "src/types/shared.ts"],
      confidence: "high",
    },
  ];

  const narrative: SessionNarrative = {
    sessionId: "s1",
    sessionShape: "narrative",
    summary: "Implemented request validation middleware, resolving a circular dependency along the way by extracting shared types",
    progression: [
      "Explored validation approaches",
      "Hit circular dependency between auth and user modules",
      "Discovered existing validation utility",
      "Resolved dependency issue with type extraction",
      "Committed to middleware pattern",
    ],
    discoveries: ["Existing validation utility covers most edge cases"],
    stabilizedDirections: ["Middleware-based validation", "Shared type module"],
    abandonedDirections: [],
    arcs: [
      {
        arcId: "arc1",
        title: "Circular dependency resolution",
        summary: "Auth-user circular dependency resolved via type extraction",
        momentIds: ["m2", "m4"],
        resolution: "resolved",
      },
    ],
  };

  const events = buildSessionEvents({
    sessionId: "s1",
    repo: "intent-ai",
    branch: "feat/validation",
    worktree: undefined,
    moments,
    transitions,
    outcomes,
    narrative,
  });

  it("produces the right total number of events", () => {
    // 1 narrative + 5 moments + 1 transition + 1 outcome = 8
    expect(events).toHaveLength(8);
  });

  it("every event has required fields", () => {
    for (const event of events) {
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.category).toBeTruthy();
      expect(event.actor).toBeTruthy();
      expect(event.summary.length, `Summary too short: "${event.summary}"`).toBeGreaterThan(10);
      expect(event.sessionId).toBe("s1");
      expect(event.repo).toBe("intent-ai");
      expect(event.branch).toBe("feat/validation");
    }
  });

  it("has exactly one narrative summary event", () => {
    const summaries = events.filter((e) => e.sourceType === "narrative");
    expect(summaries).toHaveLength(1);
    expect(summaries[0].summary).toContain("validation middleware");
  });

  it("no duplicate source IDs", () => {
    const sourceIds = events.filter((e) => e.sourceId).map((e) => e.sourceId);
    expect(new Set(sourceIds).size).toBe(sourceIds.length);
  });

  it("moment events preserve type and agency as category and actor", () => {
    const momentEvents = events.filter((e) => e.sourceType === "moment");
    expect(momentEvents).toHaveLength(5);

    const struggleEvent = momentEvents.find((e) => e.sourceId === "m2");
    expect(struggleEvent?.category).toBe("struggle");
    expect(struggleEvent?.actor).toBe("developer");

    const breakthroughEvent = momentEvents.find((e) => e.sourceId === "m4");
    expect(breakthroughEvent?.category).toBe("breakthrough");
    expect(breakthroughEvent?.actor).toBe("collaborative");
  });

  it("transition events contain from/to in summary", () => {
    const transitionEvents = events.filter((e) => e.sourceType === "transition");
    expect(transitionEvents).toHaveLength(1);
    expect(transitionEvents[0].summary).toContain("Exploring validation approaches");
    expect(transitionEvents[0].summary).toContain("Implementing middleware pattern");
  });

  it("outcome events carry files", () => {
    const outcomeEvents = events.filter((e) => e.sourceType === "outcome");
    expect(outcomeEvents).toHaveLength(1);
    expect(outcomeEvents[0].files).toContain("src/middleware/validate.ts");
    expect(outcomeEvents[0].files).toContain("src/types/shared.ts");
  });

  it("moment events carry topic fingerprint as tag", () => {
    const momentEvents = events.filter((e) => e.sourceType === "moment");
    for (const event of momentEvents) {
      expect(event.tags.length).toBeGreaterThan(0);
    }
    const authEvent = momentEvents.find((e) => e.sourceId === "m2");
    expect(authEvent?.tags).toContain("auth");
  });
});
