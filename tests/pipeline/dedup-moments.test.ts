import { describe, it, expect } from "vitest";
import { dedupMoments } from "../../src/pipeline/dedup-moments.js";
import type { SessionChunk } from "../../src/adapters/types.js";
import type { Pass1Moment } from "../../src/llm/prompts/moments.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeMoment(overrides: Partial<Pass1Moment> = {}): Pass1Moment {
  return {
    type: overrides.type ?? "proposal",
    statement: overrides.statement ?? "A moment",
    significance: overrides.significance ?? "It matters",
    agency: overrides.agency ?? "developer",
    confidence: overrides.confidence ?? "high",
    topicFingerprint: overrides.topicFingerprint ?? "general",
    evidence: overrides.evidence ?? [
      {
        quote: "some quote",
        sourceEventId: "ev-1",
        sourceType: "user" as const,
        quoteType: "verbatim" as const,
      },
    ],
  };
}

function makeChunk(index: number): SessionChunk {
  return {
    id: `s1-chunk-${index}`,
    sessionId: "s1",
    chunkIndex: index,
    events: [],
    topicHint: `topic-${index}`,
    filesInScope: [],
    eventRange: [index * 10, index * 10 + 9],
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("dedupMoments", () => {
  it("removes duplicate moments with same sourceEventId in adjacent chunks", () => {
    const momentA = makeMoment({
      statement: "First version",
      confidence: "medium",
      evidence: [{ quote: "q", sourceEventId: "ev-5", sourceType: "user" as const, quoteType: "verbatim" as const }],
    });
    const momentB = makeMoment({
      statement: "Better version",
      confidence: "high",
      evidence: [
        { quote: "q1", sourceEventId: "ev-5", sourceType: "user" as const, quoteType: "verbatim" as const },
        { quote: "q2", sourceEventId: "ev-6", sourceType: "ai" as const, quoteType: "verbatim" as const },
      ],
    });

    const result = dedupMoments(
      [
        { chunkIndex: 0, moments: [momentA] },
        { chunkIndex: 1, moments: [momentB] },
      ],
      [makeChunk(0), makeChunk(1)],
    );

    // momentB has more evidence + higher confidence, so momentA should be removed
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0].chunkIndex).toBe(0);
    expect(result.removed[0].moment.statement).toBe("First version");

    // Only momentB should remain
    expect(result.moments[0].moments).toHaveLength(0);
    expect(result.moments[1].moments).toHaveLength(1);
    expect(result.moments[1].moments[0].statement).toBe("Better version");
  });

  it("does NOT dedup moments in non-adjacent chunks", () => {
    const moment = makeMoment({
      evidence: [{ quote: "q", sourceEventId: "ev-5", sourceType: "user" as const, quoteType: "verbatim" as const }],
    });

    const result = dedupMoments(
      [
        { chunkIndex: 0, moments: [moment] },
        { chunkIndex: 2, moments: [moment] }, // gap — not adjacent
      ],
      [makeChunk(0), makeChunk(2)],
    );

    expect(result.removed).toHaveLength(0);
  });

  it("detects contradictions: same event, different agency", () => {
    const momentDev = makeMoment({
      agency: "developer",
      evidence: [{ quote: "q", sourceEventId: "ev-10", sourceType: "user" as const, quoteType: "verbatim" as const }],
    });
    const momentAI = makeMoment({
      agency: "ai",
      evidence: [{ quote: "q", sourceEventId: "ev-10", sourceType: "ai" as const, quoteType: "verbatim" as const }],
    });

    const result = dedupMoments(
      [
        { chunkIndex: 0, moments: [momentDev] },
        { chunkIndex: 1, moments: [momentAI] },
      ],
      [makeChunk(0), makeChunk(1)],
    );

    expect(result.contradictions).toHaveLength(1);
    expect(result.contradictions[0].eventId).toBe("ev-10");
    expect(result.contradictions[0].entries).toHaveLength(2);
    expect(result.contradictions[0].entries[0].agency).toBe("developer");
    expect(result.contradictions[0].entries[1].agency).toBe("ai");
  });

  it("flags boundary merges for adjacent chunks with same topicFingerprint", () => {
    const momentA = makeMoment({
      topicFingerprint: "auth-setup",
      evidence: [{ quote: "q", sourceEventId: "ev-1", sourceType: "user" as const, quoteType: "verbatim" as const }],
    });
    const momentB = makeMoment({
      topicFingerprint: "auth-setup",
      evidence: [{ quote: "q", sourceEventId: "ev-2", sourceType: "user" as const, quoteType: "verbatim" as const }],
    });

    const result = dedupMoments(
      [
        { chunkIndex: 0, moments: [momentA] },
        { chunkIndex: 1, moments: [momentB] },
      ],
      [makeChunk(0), makeChunk(1)],
    );

    expect(result.boundaryMerges).toHaveLength(1);
    expect(result.boundaryMerges[0].topicFingerprint).toBe("auth-setup");
    expect(result.boundaryMerges[0].chunkA).toBe(0);
    expect(result.boundaryMerges[0].chunkB).toBe(1);
  });

  it("ignores 'general' topicFingerprint for boundary merges", () => {
    const momentA = makeMoment({ topicFingerprint: "general" });
    const momentB = makeMoment({ topicFingerprint: "general" });

    const result = dedupMoments(
      [
        { chunkIndex: 0, moments: [momentA] },
        { chunkIndex: 1, moments: [momentB] },
      ],
      [makeChunk(0), makeChunk(1)],
    );

    expect(result.boundaryMerges).toHaveLength(0);
  });

  it("passes through moments with no overlaps unchanged", () => {
    const m1 = makeMoment({
      statement: "Moment 1",
      evidence: [{ quote: "q1", sourceEventId: "ev-1", sourceType: "user" as const, quoteType: "verbatim" as const }],
    });
    const m2 = makeMoment({
      statement: "Moment 2",
      evidence: [{ quote: "q2", sourceEventId: "ev-2", sourceType: "user" as const, quoteType: "verbatim" as const }],
    });

    const result = dedupMoments(
      [
        { chunkIndex: 0, moments: [m1] },
        { chunkIndex: 1, moments: [m2] },
      ],
      [makeChunk(0), makeChunk(1)],
    );

    expect(result.removed).toHaveLength(0);
    expect(result.moments[0].moments).toHaveLength(1);
    expect(result.moments[1].moments).toHaveLength(1);
  });

  it("handles empty pass1 results", () => {
    const result = dedupMoments([], []);

    expect(result.moments).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.boundaryMerges).toHaveLength(0);
    expect(result.contradictions).toHaveLength(0);
  });

  it("handles chunks with no moments", () => {
    const result = dedupMoments(
      [
        { chunkIndex: 0, moments: [] },
        { chunkIndex: 1, moments: [] },
      ],
      [makeChunk(0), makeChunk(1)],
    );

    expect(result.moments).toHaveLength(2);
    expect(result.moments[0].moments).toHaveLength(0);
    expect(result.moments[1].moments).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });
});
