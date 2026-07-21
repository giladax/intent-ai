import { describe, it, expect } from "vitest";
import {
  deriveConfidence,
  applyDerivedConfidence,
} from "../../../src/pipeline/understand/derive-confidence.js";
import type { SessionMoment, EvidenceAnchor } from "../../../src/adapters/types.js";

// ── Helpers ───────────────────────────────────────────────────────────

function makeAnchor(
  anchored: boolean,
  sourceType: EvidenceAnchor["sourceType"] = "ai",
): EvidenceAnchor {
  return {
    quote: "some quote",
    eventIndex: 1,
    anchored,
    sourceType,
  };
}

function makeMoment(
  overrides: Partial<SessionMoment> = {},
): SessionMoment {
  return {
    id: "m0",
    chunkId: "c0",
    type: "proposal",
    statement: "A test moment",
    significance: "matters",
    agency: "developer",
    confidence: "high", // will be overwritten by derive
    topicFingerprint: "test",
    relatedMomentIds: [],
    evidence: [],
    occurredAt: null,
    verification: null,
    ...overrides,
  };
}

// ── Tests: deriveConfidence ───────────────────────────────────────────

describe("deriveConfidence", () => {
  it("returns 'low' when evidence is empty", () => {
    const m = makeMoment({ evidence: [] });
    expect(deriveConfidence(m)).toBe("low");
  });

  it("returns 'low' when all evidence is unanchored", () => {
    const m = makeMoment({
      evidence: [
        makeAnchor(false, "ai"),
        makeAnchor(false, "user"),
      ] as unknown as SessionMoment["evidence"],
    });
    expect(deriveConfidence(m)).toBe("low");
  });

  it("returns 'medium' when there is ≥1 anchored evidence but none from user", () => {
    const m = makeMoment({
      evidence: [
        makeAnchor(true, "ai"),
        makeAnchor(false, "user"),
      ] as unknown as SessionMoment["evidence"],
    });
    expect(deriveConfidence(m)).toBe("medium");
  });

  it("returns 'medium' when there is ≥1 anchored tool_output evidence (not user)", () => {
    const m = makeMoment({
      evidence: [
        makeAnchor(true, "tool_output"),
      ] as unknown as SessionMoment["evidence"],
    });
    expect(deriveConfidence(m)).toBe("medium");
  });

  it("returns 'high' when ≥1 anchored evidence with sourceType 'user'", () => {
    const m = makeMoment({
      evidence: [
        makeAnchor(true, "user"),
      ] as unknown as SessionMoment["evidence"],
    });
    expect(deriveConfidence(m)).toBe("high");
  });

  it("returns 'high' for user-sourced anchor even when other evidence is unanchored", () => {
    const m = makeMoment({
      evidence: [
        makeAnchor(false, "ai"),
        makeAnchor(true, "user"),
      ] as unknown as SessionMoment["evidence"],
    });
    expect(deriveConfidence(m)).toBe("high");
  });

  it("returns 'high' when verification === 'supported' (regardless of evidence)", () => {
    const m = makeMoment({
      verification: "supported",
      evidence: [] as unknown as SessionMoment["evidence"],
    });
    expect(deriveConfidence(m)).toBe("high");
  });

  it("returns 'high' when verification === 'supported' even with only unanchored ai evidence", () => {
    const m = makeMoment({
      verification: "supported",
      evidence: [
        makeAnchor(false, "ai"),
      ] as unknown as SessionMoment["evidence"],
    });
    expect(deriveConfidence(m)).toBe("high");
  });

  it("verification 'contradicted' does not trigger high — falls through to evidence rules", () => {
    // contradicted + no anchored evidence → low
    const m = makeMoment({
      verification: "contradicted",
      evidence: [] as unknown as SessionMoment["evidence"],
    });
    expect(deriveConfidence(m)).toBe("low");
  });

  it("verification 'contradicted' caps at low even with anchored USER evidence — saying it doesn't make it true", () => {
    // the developer said "I committed the fix" (anchored user quote) but tool
    // events contradict it — must be low, never high
    const m = makeMoment({
      verification: "contradicted",
      evidence: [
        makeAnchor(true, "user"),
      ] as unknown as SessionMoment["evidence"],
    });
    expect(deriveConfidence(m)).toBe("low");
  });

  it("verification 'unverified' does not trigger high — falls through to evidence rules", () => {
    // unverified + anchored ai → medium
    const m = makeMoment({
      verification: "unverified",
      evidence: [
        makeAnchor(true, "ai"),
      ] as unknown as SessionMoment["evidence"],
    });
    expect(deriveConfidence(m)).toBe("medium");
  });

  it("treats legacy Evidence items (no anchored field) as not anchored", () => {
    // Legacy Evidence has no `anchored` field; should produce 'low'
    const legacyEvidence = [
      { quote: "something", sourceEventId: "e1", sourceType: "human_message", quoteType: "verbatim" },
    ] as unknown as SessionMoment["evidence"];
    const m = makeMoment({ evidence: legacyEvidence });
    expect(deriveConfidence(m)).toBe("low");
  });
});

// ── Tests: applyDerivedConfidence ─────────────────────────────────────

describe("applyDerivedConfidence", () => {
  it("returns a new array (non-mutating)", () => {
    const moments = [makeMoment()];
    const result = applyDerivedConfidence(moments);
    expect(result).not.toBe(moments);
    expect(result[0]).not.toBe(moments[0]);
  });

  it("overwrites model-emitted 'high' with derived 'low' when no anchored evidence", () => {
    const moments = [
      makeMoment({ confidence: "high", evidence: [] }),
    ];
    const result = applyDerivedConfidence(moments);
    expect(result[0]!.confidence).toBe("low");
  });

  it("produces 'medium' for anchored ai evidence", () => {
    const moments = [
      makeMoment({
        confidence: "low",
        evidence: [makeAnchor(true, "ai")] as unknown as SessionMoment["evidence"],
      }),
    ];
    const result = applyDerivedConfidence(moments);
    expect(result[0]!.confidence).toBe("medium");
  });

  it("produces 'high' for anchored user evidence", () => {
    const moments = [
      makeMoment({
        confidence: "low",
        evidence: [makeAnchor(true, "user")] as unknown as SessionMoment["evidence"],
      }),
    ];
    const result = applyDerivedConfidence(moments);
    expect(result[0]!.confidence).toBe("high");
  });

  it("produces 'high' for verification === 'supported'", () => {
    const moments = [
      makeMoment({
        confidence: "low",
        verification: "supported",
        evidence: [] as unknown as SessionMoment["evidence"],
      }),
    ];
    const result = applyDerivedConfidence(moments);
    expect(result[0]!.confidence).toBe("high");
  });

  it("processes all moments — none dropped", () => {
    const moments = [
      makeMoment({ id: "m0" }),
      makeMoment({ id: "m1", evidence: [makeAnchor(true, "user")] as unknown as SessionMoment["evidence"] }),
      makeMoment({ id: "m2", verification: "supported" }),
    ];
    const result = applyDerivedConfidence(moments);
    expect(result).toHaveLength(3);
    expect(result[0]!.confidence).toBe("low");
    expect(result[1]!.confidence).toBe("high");
    expect(result[2]!.confidence).toBe("high");
  });

  it("preserves all other fields unchanged", () => {
    const m = makeMoment({
      id: "m-preserve",
      statement: "preserved statement",
      significance: "sig",
      agency: "collaborative",
      verification: null,
      evidence: [],
    });
    const result = applyDerivedConfidence([m]);
    const out = result[0]!;
    expect(out.id).toBe("m-preserve");
    expect(out.statement).toBe("preserved statement");
    expect(out.agency).toBe("collaborative");
    expect(out.verification).toBeNull();
  });
});
