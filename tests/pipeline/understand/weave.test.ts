import { describe, it, expect } from "vitest";
import { applyWeaveDecisions, filterDedupSurvivors } from "../../../src/pipeline/understand/weave.js";
import type { ExtractedMoment, SessionChunk, EvidenceAnchor, Pass1Moment } from "../../../src/adapters/types.js";
import type { z } from "zod";
import type { WeaveOutputSchema } from "../../../src/llm/prompts/understand/weave.js";
import type { DedupResult } from "../../../src/pipeline/dedup-moments.js";

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

  it("multi-id keep: non-primary ids fall through to implicit keep — no moment is lost (I1 regression)", () => {
    // LLM emits a "keep" with 3 ids. Before the fix, ids [1] and [2] were
    // claimed but then only [0] was emitted — [1] and [2] vanished silently.
    // After the fix, only the primary is claimed so [1] and [2] fall through
    // to the implicit-keep safety net and appear in the output.
    const decisions: WeaveDecision[] = [
      {
        action: "keep",
        momentIds: ["c0-m0", "c0-m1", "c1-m0"], // primary + 2 extra
        arcId: "arc-multi",
        arcRole: "origin",
        relatedTo: [],
      },
    ];

    const result = applyWeaveDecisions(decisions, extracted, chunks);

    // All 3 moments must be present in the output
    expect(result).toHaveLength(3);

    // Primary moment carries the decision's arcId
    const primary = result.find((r) =>
      r.evidence.some((e) => (e as EvidenceAnchor).quote === "anchor-0a"),
    )!;
    expect(primary).toBeDefined();
    expect(primary.arcId).toBe("arc-multi");

    // Non-primary moments survive via implicit keep (arcId = "general")
    const implicit1 = result.find((r) =>
      r.evidence.some((e) => (e as EvidenceAnchor).quote === "anchor-1a"),
    )!;
    expect(implicit1).toBeDefined();
    expect(implicit1.arcId).toBe("general");

    const implicit2 = result.find((r) =>
      r.evidence.some((e) => (e as EvidenceAnchor).quote === "anchor-2a"),
    )!;
    expect(implicit2).toBeDefined();
    expect(implicit2.arcId).toBe("general");
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

// ── Tests: filterDedupSurvivors ────────────────────────────────────────

describe("filterDedupSurvivors", () => {
  it("keeps a moment whose pass1 twin was NOT removed, even when another moment in a different chunk shares the same statement", () => {
    // Two extracted moments in DIFFERENT chunks with IDENTICAL statements
    // but different evidence eventIndexes.
    // Dedup removes only the one in chunk 0; the one in chunk 1 must survive.
    const SHARED_STATEMENT = "identical statement across chunks";

    const mChunk0 = makeExtracted("dup-c0", 0, {
      statement: SHARED_STATEMENT,
      evidence: [makeAnchor({ eventIndex: 10, quote: "evidence-chunk0" })],
    });
    const mChunk1 = makeExtracted("dup-c1", 1, {
      statement: SHARED_STATEMENT,
      evidence: [makeAnchor({ eventIndex: 20, quote: "evidence-chunk1" })],
    });

    const extractedPair: ExtractedMoment[] = [mChunk0, mChunk1];

    // Simulate what weaveMoments does: build pass1 objects and track the map
    const pass1MomentToExtractId = new Map<object, string>();
    const pass1Chunk0: Pass1Moment = {
      type: mChunk0.type,
      statement: mChunk0.statement,
      significance: mChunk0.significance,
      agency: mChunk0.agency,
      confidence: "high",
      topicFingerprint: mChunk0.topicFingerprint,
      evidence: [{ quote: "evidence-chunk0", sourceEventId: "10", sourceType: "ai", quoteType: "verbatim" }],
    };
    const pass1Chunk1: Pass1Moment = {
      type: mChunk1.type,
      statement: mChunk1.statement,
      significance: mChunk1.significance,
      agency: mChunk1.agency,
      confidence: "high",
      topicFingerprint: mChunk1.topicFingerprint,
      evidence: [{ quote: "evidence-chunk1", sourceEventId: "20", sourceType: "ai", quoteType: "verbatim" }],
    };
    pass1MomentToExtractId.set(pass1Chunk0, mChunk0.id);
    pass1MomentToExtractId.set(pass1Chunk1, mChunk1.id);

    // Dedup removed only the chunk-0 moment (by object reference)
    const dedupResult: DedupResult = {
      moments: [
        { chunkIndex: 0, moments: [] },          // chunk0's moment was removed
        { chunkIndex: 1, moments: [pass1Chunk1] }, // chunk1's moment survived
      ],
      removed: [
        { chunkIndex: 0, moment: pass1Chunk0, reason: "duplicate of event 10 in chunk 1" },
      ],
      boundaryMerges: [],
      contradictions: [],
    };

    const survivors = filterDedupSurvivors(extractedPair, pass1MomentToExtractId, dedupResult);

    // The chunk-1 moment must survive despite having the same statement as the removed chunk-0 moment
    expect(survivors).toHaveLength(1);
    expect(survivors[0].id).toBe("dup-c1");
    expect(survivors[0].evidence[0].eventIndex).toBe(20);
  });

  it("removes both when both pass1 twins are in the removed set", () => {
    const SHARED_STATEMENT = "both removed";

    const mA = makeExtracted("both-c0", 0, { statement: SHARED_STATEMENT, evidence: [makeAnchor({ eventIndex: 1 })] });
    const mB = makeExtracted("both-c1", 1, { statement: SHARED_STATEMENT, evidence: [makeAnchor({ eventIndex: 2 })] });

    const pass1MomentToExtractId = new Map<object, string>();
    const p1A: Pass1Moment = { type: mA.type, statement: mA.statement, significance: mA.significance, agency: mA.agency, confidence: "low", topicFingerprint: "general", evidence: [] };
    const p1B: Pass1Moment = { type: mB.type, statement: mB.statement, significance: mB.significance, agency: mB.agency, confidence: "low", topicFingerprint: "general", evidence: [] };
    pass1MomentToExtractId.set(p1A, mA.id);
    pass1MomentToExtractId.set(p1B, mB.id);

    const dedupResult: DedupResult = {
      moments: [{ chunkIndex: 0, moments: [] }, { chunkIndex: 1, moments: [] }],
      removed: [
        { chunkIndex: 0, moment: p1A, reason: "duplicate" },
        { chunkIndex: 1, moment: p1B, reason: "duplicate" },
      ],
      boundaryMerges: [],
      contradictions: [],
    };

    const survivors = filterDedupSurvivors([mA, mB], pass1MomentToExtractId, dedupResult);
    expect(survivors).toHaveLength(0);
  });

  it("passes through all moments when nothing was removed", () => {
    const mA = makeExtracted("pass-c0", 0, { statement: "same" });
    const mB = makeExtracted("pass-c1", 1, { statement: "same" });

    const pass1MomentToExtractId = new Map<object, string>();
    const p1A: Pass1Moment = { type: mA.type, statement: "same", significance: mA.significance, agency: mA.agency, confidence: "high", topicFingerprint: "general", evidence: [] };
    const p1B: Pass1Moment = { type: mB.type, statement: "same", significance: mB.significance, agency: mB.agency, confidence: "high", topicFingerprint: "general", evidence: [] };
    pass1MomentToExtractId.set(p1A, mA.id);
    pass1MomentToExtractId.set(p1B, mB.id);

    const dedupResult: DedupResult = {
      moments: [{ chunkIndex: 0, moments: [p1A] }, { chunkIndex: 1, moments: [p1B] }],
      removed: [],
      boundaryMerges: [],
      contradictions: [],
    };

    const survivors = filterDedupSurvivors([mA, mB], pass1MomentToExtractId, dedupResult);
    expect(survivors).toHaveLength(2);
    expect(survivors.map((s) => s.id)).toEqual(["pass-c0", "pass-c1"]);
  });
});
