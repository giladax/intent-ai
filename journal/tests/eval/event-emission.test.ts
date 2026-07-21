import { describe, it, expect } from "vitest";
import { eventEmissionCriteria } from "./event-emission-criteria.js";
import { buildSessionEvents } from "../../src/pipeline/emit-events.js";
import type {
  SessionMoment,
  IntentTransition,
  AcceptedOutcome,
  SessionNarrative,
} from "../../src/adapters/types.js";

function makeNarrative(summary: string): SessionNarrative {
  return {
    sessionId: "s1",
    sessionShape: "narrative",
    summary,
    progression: ["step 1", "step 2"],
    discoveries: ["found something"],
    stabilizedDirections: ["decided on approach"],
    abandonedDirections: [],
    arcs: [],
  };
}

function makeMoment(
  id: string,
  type: string,
  statement: string,
): SessionMoment {
  return {
    id,
    chunkId: "c1",
    type: type as SessionMoment["type"],
    statement,
    significance: "medium",
    agency: "ai",
    confidence: "medium",
    topicFingerprint: "test",
    relatedMomentIds: [],
    evidence: [],
  };
}

function makeTransition(id: string): IntentTransition {
  return {
    id,
    sessionId: "s1",
    fromStatement: "Research approaches for authentication",
    toStatement: "Implement JWT middleware solution",
    reason: "Found suitable library",
    originMomentIds: ["m1"],
    confidence: "high",
  };
}

function makeOutcome(id: string): AcceptedOutcome {
  return {
    id,
    sessionId: "s1",
    statement: "JWT middleware implemented with full test coverage",
    supportingMomentIds: ["m1"],
    supportingFiles: ["src/auth/jwt.ts"],
    confidence: "high",
  };
}

// Test fixtures matching criteria
const fixtures = {
  "typical-session": {
    sessionId: "s1",
    repo: "intent-ai",
    branch: "feat/auth",
    moments: [
      makeMoment(
        "m1",
        "struggle",
        "Agent struggled with circular imports in the auth module",
      ),
      makeMoment(
        "m2",
        "discovery",
        "Found existing JWT helper utility in the shared utils directory",
      ),
      makeMoment(
        "m3",
        "commitment",
        "Decided to implement middleware pattern for auth validation",
      ),
    ],
    transitions: [makeTransition("t1")],
    outcomes: [makeOutcome("o1")],
    narrative: makeNarrative(
      "Implemented auth middleware with JWT validation and comprehensive tests",
    ),
  },
  "empty-session": {
    sessionId: "s1",
    repo: "intent-ai",
    branch: "main",
    moments: [],
    transitions: [],
    outcomes: [],
    narrative: makeNarrative(
      "Quick session with no significant moments detected",
    ),
  },
};

describe("event emission quality", () => {
  for (const criteria of eventEmissionCriteria) {
    describe(criteria.name, () => {
      const fixture = fixtures[criteria.name as keyof typeof fixtures];
      const events = buildSessionEvents(fixture);

      it(`produces at least ${criteria.expectations.minEvents} events`, () => {
        expect(events.length).toBeGreaterThanOrEqual(
          criteria.expectations.minEvents,
        );
      });

      if (criteria.expectations.mustHaveSummaryEvent) {
        it("includes a session summary event", () => {
          const summaries = events.filter(
            (e) => e.sourceType === "narrative",
          );
          expect(summaries).toHaveLength(1);
        });
      }

      it("moment count within expected range", () => {
        const momentEvents = events.filter(
          (e) => e.sourceType === "moment",
        );
        const [min, max] = criteria.expectations.momentCountRange;
        expect(
          momentEvents.length,
          `expected ${min}-${max} moments, got ${momentEvents.length}`,
        ).toBeGreaterThanOrEqual(min);
        expect(momentEvents.length).toBeLessThanOrEqual(max);
      });

      if (criteria.expectations.noVagueSummaries) {
        it("no vague summaries", () => {
          for (const event of events) {
            expect(
              event.summary.length,
              `Vague summary: "${event.summary}"`,
            ).toBeGreaterThanOrEqual(criteria.expectations.summaryMinLength);
          }
        });
      }

      if (criteria.expectations.allEventsHaveSessionId) {
        it("all events have sessionId", () => {
          for (const event of events) {
            expect(
              event.sessionId,
              `Event missing sessionId: ${event.summary}`,
            ).toBeTruthy();
          }
        });
      }

      if (criteria.expectations.noDuplicateSourceIds) {
        it("no duplicate source IDs", () => {
          const sourceIds = events
            .filter((e) => e.sourceId)
            .map((e) => e.sourceId);
          expect(new Set(sourceIds).size).toBe(sourceIds.length);
        });
      }
    });
  }
});
