import { describe, it, expect } from "vitest";
import { applyWeaveDecisions } from "../../../src/pipeline/understand/weave.js";
import type { ExtractedMoment, SessionChunk, EvidenceAnchor } from "../../../src/adapters/types.js";
import type { z } from "zod";
import type { WeaveOutputSchema } from "../../../src/llm/prompts/understand/weave.js";

// ── Helpers ───────────────────────────────────────────────────────────

type WeaveDecision = z.infer<typeof WeaveOutputSchema>["decisions"][number];

function makeChunk(chunkIndex: number, id?: string): SessionChunk {
  return {
    id: id ?? `chunk-${chunkIndex}`,
    sessionId: "s1",
    chunkIndex,
    events: [],
    topicHint: "test",
    filesInScope: [],
    eventRange: [0, 10],
  };
}

function makeAnchor(overrides: Partial<EvidenceAnchor> = {}): EvidenceAnchor {
  return {
    quote: "some quote",
    eventIndex: 1,
    anchored: true,
    sourceType: "ai",
    ...overrides,
  };
}

function makeExtracted(
  id: string,
  chunkIndex: number,
  overrides: Partial<ExtractedMoment> = {},
): ExtractedMoment {
  return {
    id,
    chunkIndex,
    type: "proposal",
    statement: `statement for ${id}`,
    significance: `significance for ${id}`,
    agency: "developer",
    confidence: "high",
    topicFingerprint: "general",
    evidence: [makeAnchor({ quote: `quote from ${id}` })],
    occurredAt: "2026-07-04T10:00:00Z",
    ...overrides,
  };
}

// Fixtures: 2 chunks, 3 extracted moments
const chunks: SessionChunk[] = [
  makeChunk(0, "chunk-0"),
  makeChunk(1, "chunk-1"),
];

const m0 = makeExtracted("c0-m0", 0, {
  evidence: [makeAnchor({ quote: "anchor-0a", eventIndex: 1, anchored: true })],
  occurredAt: "2026-07-04T10:01:00Z",
});
const m1 = makeExtracted("c0-m1", 0, {
  evidence: [makeAnchor({ quote: "anchor-1a", eventIndex: 2, anchored: false })],
  occurredAt: "2026-07-04T10:02:00Z",
});
const m2 = makeExtracted("c1-m0", 1, {
  evidence: [makeAnchor({ quote: "anchor-2a", eventIndex: 5, anchored: true })],
  occurredAt: "2026-07-04T10:05:00Z",
});

const extracted: ExtractedMoment[] = [m0, m1, m2];

// ── Tests: applyWeaveDecisions ────────────────────────────────────────

describe("applyWeaveDecisions", () => {
  it("keep: preserves evidence verbatim from the extracted moment", () => {
    const decisions: WeaveDecision[] = [
      { action: "keep", momentIds: ["c0-m0"], arcId: "arc-1", arcRole: "origin", relatedTo: [] },
      { action: "keep", momentIds: ["c0-m1"], arcId: "arc-1", arcRole: "development", relatedTo: [] },
      { action: "keep", momentIds: ["c1-m0"], arcId: "arc-1", arcRole: "resolution", relatedTo: [] },
    ];

    const result = applyWeaveDecisions(decisions, extracted, chunks);
    const kept = result.find((r) => r.id === "moment-0")!;

    expect(kept).toBeDefined();
    // Evidence carried verbatim as EvidenceAnchor[]
    expect(kept.evidence).toEqual(m0.evidence);
  });

  it("keep: assigns chunkId from chunks array by chunkIndex", () => {
    const decisions: WeaveDecision[] = [
      { action: "keep", momentIds: ["c0-m0"], arcId: "general", arcRole: "development", relatedTo: [] },
      { action: "keep", momentIds: ["c0-m1"], arcId: "general", arcRole: "development", relatedTo: [] },
      { action: "keep", momentIds: ["c1-m0"], arcId: "general", arcRole: "development", relatedTo: [] },
    ];

    const result = applyWeaveDecisions(decisions, extracted, chunks);

    const moment0 = result.find((r) => r.id === "moment-0")!;
    const moment2 = result.find((r) => r.id === "moment-2")!;

    expect(moment0.chunkId).toBe("chunk-0");
    expect(moment2.chunkId).toBe("chunk-1");
  });

  it("merge: unions evidence in id order and uses decision.statement", () => {
    const decisions: WeaveDecision[] = [
      {
        action: "merge",
        momentIds: ["c0-m0", "c0-m1"],
        arcId: "arc-merge",
        arcRole: "origin",
        relatedTo: [],
        statement: "combined statement from merge",
      },
      { action: "keep", momentIds: ["c1-m0"], arcId: "arc-merge", arcRole: "resolution", relatedTo: [] },
    ];

    const result = applyWeaveDecisions(decisions, extracted, chunks);

    expect(result).toHaveLength(2);
    const merged = result.find((r) => r.statement === "combined statement from merge")!;
    expect(merged).toBeDefined();

    // Evidence should be union of m0.evidence + m1.evidence in order
    expect(merged.evidence).toEqual([...m0.evidence, ...m1.evidence]);
  });

  it("merge: falls back to primary.statement when no decision.statement provided", () => {
    const decisions: WeaveDecision[] = [
      {
        action: "merge",
        momentIds: ["c0-m0", "c0-m1"],
        arcId: "general",
        arcRole: "development",
        relatedTo: [],
        // no statement
      },
      { action: "keep", momentIds: ["c1-m0"], arcId: "general", arcRole: "development", relatedTo: [] },
    ];

    const result = applyWeaveDecisions(decisions, extracted, chunks);
    const merged = result.find((r) => r.chunkId === "chunk-0")!;

    // Falls back to primary (m0) statement
    expect(merged.statement).toBe(m0.statement);
  });

  it("drop: excluded from output", () => {
    const decisions: WeaveDecision[] = [
      { action: "keep", momentIds: ["c0-m0"], arcId: "general", arcRole: "development", relatedTo: [] },
      { action: "drop", momentIds: ["c0-m1"], reason: "too vague" },
      { action: "keep", momentIds: ["c1-m0"], arcId: "general", arcRole: "development", relatedTo: [] },
    ];

    const result = applyWeaveDecisions(decisions, extracted, chunks);

    expect(result).toHaveLength(2);
    // Verify none of the result moments carry m1's evidence
    const hasM1Evidence = result.some((r) =>
      r.evidence.some((e) => (e as EvidenceAnchor).quote === "anchor-1a"),
    );
    expect(hasM1Evidence).toBe(false);
  });

  it("missing id: implicit keep with arc 'general'", () => {
    // Only cover c0-m0 and c0-m1; c1-m0 is not in any decision
    const decisions: WeaveDecision[] = [
      { action: "keep", momentIds: ["c0-m0"], arcId: "general", arcRole: "development", relatedTo: [] },
      { action: "keep", momentIds: ["c0-m1"], arcId: "general", arcRole: "development", relatedTo: [] },
    ];

    const result = applyWeaveDecisions(decisions, extracted, chunks);

    // c1-m0 should still appear in output
    expect(result).toHaveLength(3);
    const implicitKept = result.find((r) =>
      r.evidence.some((e) => (e as EvidenceAnchor).quote === "anchor-2a"),
    )!;
    expect(implicitKept).toBeDefined();
    expect(implicitKept.arcId).toBe("general");
  });

  it("unknown id in decisions: ignored with no crash", () => {
    const decisions: WeaveDecision[] = [
      { action: "keep", momentIds: ["c0-m0"], arcId: "general", arcRole: "development", relatedTo: [] },
      // "c9-m99" does not exist in extracted
      { action: "keep", momentIds: ["c9-m99"], arcId: "general", arcRole: "development", relatedTo: [] },
      { action: "keep", momentIds: ["c0-m1"], arcId: "general", arcRole: "development", relatedTo: [] },
      { action: "keep", momentIds: ["c1-m0"], arcId: "general", arcRole: "development", relatedTo: [] },
    ];

    // Should not throw
    let result!: ReturnType<typeof applyWeaveDecisions>;
    expect(() => {
      result = applyWeaveDecisions(decisions, extracted, chunks);
    }).not.toThrow();

    // Unknown id is ignored — only 3 real moments in output
    expect(result).toHaveLength(3);
  });

  it("relatedTo: resolves to final SessionMoment ids (moment-N)", () => {
    // m0 (c0-m0) will be moment-0; m1 (c0-m1) will be moment-1; m2 (c1-m0) will be moment-2
    // Decision says c0-m0 is related to c1-m0
    const decisions: WeaveDecision[] = [
      { action: "keep", momentIds: ["c0-m0"], arcId: "general", arcRole: "development", relatedTo: ["c1-m0"] },
      { action: "keep", momentIds: ["c0-m1"], arcId: "general", arcRole: "development", relatedTo: [] },
      { action: "keep", momentIds: ["c1-m0"], arcId: "general", arcRole: "development", relatedTo: [] },
    ];

    const result = applyWeaveDecisions(decisions, extracted, chunks);

    // Find moment that originated from c0-m0
    const m0result = result.find((r) =>
      r.evidence.some((e) => (e as EvidenceAnchor).quote === "anchor-0a"),
    )!;
    expect(m0result).toBeDefined();

    // The related id should be the final "moment-N" id of c1-m0
    expect(m0result.relatedMomentIds).toHaveLength(1);
    // It should be a "moment-N" style id
    expect(m0result.relatedMomentIds[0]).toMatch(/^moment-\d+$/);

    // Find the moment that originated from c1-m0 and verify its final id matches
    const m2result = result.find((r) =>
      r.evidence.some((e) => (e as EvidenceAnchor).quote === "anchor-2a"),
    )!;
    expect(m0result.relatedMomentIds[0]).toBe(m2result.id);
  });

  it("single-id merge: treated as keep (not a crash)", () => {
    const decisions: WeaveDecision[] = [
      {
        action: "merge",
        momentIds: ["c0-m0"], // only one id — should be treated as keep
        arcId: "general",
        arcRole: "development",
        relatedTo: [],
        statement: "should be ignored in favour of keep behaviour",
      },
      { action: "keep", momentIds: ["c0-m1"], arcId: "general", arcRole: "development", relatedTo: [] },
      { action: "keep", momentIds: ["c1-m0"], arcId: "general", arcRole: "development", relatedTo: [] },
    ];

    const result = applyWeaveDecisions(decisions, extracted, chunks);

    // Should produce 3 moments without crashing
    expect(result).toHaveLength(3);
    const single = result.find((r) =>
      r.evidence.some((e) => (e as EvidenceAnchor).quote === "anchor-0a"),
    )!;
    expect(single).toBeDefined();
  });

  it("arcRole: 'development' mapped to 'escalation' on SessionMoment", () => {
    const decisions: WeaveDecision[] = [
      { action: "keep", momentIds: ["c0-m0"], arcId: "arc-1", arcRole: "development", relatedTo: [] },
      { action: "keep", momentIds: ["c0-m1"], arcId: "arc-1", arcRole: "development", relatedTo: [] },
      { action: "keep", momentIds: ["c1-m0"], arcId: "arc-1", arcRole: "development", relatedTo: [] },
    ];

    const result = applyWeaveDecisions(decisions, extracted, chunks);

    result.forEach((r) => {
      expect(r.arcRole).toBe("escalation");
    });
  });

  it("merge: uses earliest non-null occurredAt", () => {
    // m0 occurredAt 10:01, m1 occurredAt 10:02 — merge should use 10:01
    const decisions: WeaveDecision[] = [
      {
        action: "merge",
        momentIds: ["c0-m0", "c0-m1"],
        arcId: "general",
        arcRole: "development",
        relatedTo: [],
      },
      { action: "keep", momentIds: ["c1-m0"], arcId: "general", arcRole: "development", relatedTo: [] },
    ];

    const result = applyWeaveDecisions(decisions, extracted, chunks);
    const merged = result.find((r) => r.chunkId === "chunk-0")!;

    expect(merged.occurredAt).toBe("2026-07-04T10:01:00Z");
  });

  it("verification is always null on output moments", () => {
    const decisions: WeaveDecision[] = [
      { action: "keep", momentIds: ["c0-m0"], arcId: "general", arcRole: "development", relatedTo: [] },
      { action: "keep", momentIds: ["c0-m1"], arcId: "general", arcRole: "development", relatedTo: [] },
      { action: "keep", momentIds: ["c1-m0"], arcId: "general", arcRole: "development", relatedTo: [] },
    ];

    const result = applyWeaveDecisions(decisions, extracted, chunks);
    result.forEach((r) => {
      expect(r.verification).toBeNull();
    });
  });
});
