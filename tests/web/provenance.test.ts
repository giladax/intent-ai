import { describe, it, expect } from "vitest";
import {
  buildProvenance,
  confidencePct,
  isUuidLike,
  provenanceKind,
  verificationVerdict,
  splitAgentTrace,
  type ProvenanceEventRow,
  type ProvenanceInput,
} from "../../src/web/provenance.js";

// ── Fixture rows ──────────────────────────────────────────────────────

const SESSION_ID = "6f9619ff-8b86-d011-b42d-00c04fc964ff";

const momentEvent: ProvenanceEventRow = {
  id: "11111111-1111-4111-8111-111111111111",
  timestamp: "2026-07-04T10:00:00.000Z",
  category: "discovery",
  summary: "Realized the emit path stamps digest time on every beat",
  actor: "developer",
  sourceType: "moment",
  sourceId: "moment-3", // pipeline-local — NOT a DB uuid
  sessionId: SESSION_ID,
  featureId: null,
  metadata: { verification: "supported" },
};

const momentRow = {
  id: "22222222-2222-4222-8222-222222222222",
  type: "discovery",
  statement: "Realized the emit path stamps digest time on every beat",
  significance: "Explains the timestamp collapse",
  agency: "developer",
  confidence: "high",
  verification: "supported",
};

const anchoredEvidence = {
  id: "e1",
  momentId: momentRow.id,
  quote: "wait — every beat has the same timestamp",
  quoteType: "verbatim",
  sourceType: "user_message",
  sourceEventId: "ne-42",
};

const unanchoredEvidence = {
  id: "e2",
  momentId: momentRow.id,
  quote: "the digest run collapses time",
  quoteType: "paraphrase",
  sourceType: "assistant_message",
  sourceEventId: null,
};

const anchorEvent = {
  id: "ne-42",
  causalOrder: 42,
  summary: "User notices identical timestamps across beats",
  category: "user_message",
  actor: "developer",
  timestamp: "2026-07-04T09:12:00.000Z",
};

const sessionRow = {
  id: SESSION_ID,
  sessionShape: "debugging",
  startedAt: "2026-07-04T09:00:00.000Z",
  endedAt: "2026-07-04T11:30:00.000Z",
};

const qualityRow = { moments: 12, quotes: 30, anchored: 24, supported: 7, contradicted: 1 };

function fullInput(overrides: Partial<ProvenanceInput> = {}): ProvenanceInput {
  return {
    event: momentEvent,
    moments: [momentRow],
    evidence: [anchoredEvidence, unanchoredEvidence],
    anchorEvents: [anchorEvent],
    session: sessionRow,
    quality: qualityRow,
    traceRows: [],
    observationRows: [],
    ...overrides,
  };
}

// ── Pure helpers ──────────────────────────────────────────────────────

describe("isUuidLike", () => {
  it("accepts uuids and rejects pipeline-local ids", () => {
    expect(isUuidLike(SESSION_ID)).toBe(true);
    expect(isUuidLike("22222222-2222-4222-8222-222222222222")).toBe(true);
    expect(isUuidLike("moment-3")).toBe(false);
    expect(isUuidLike("transition-0")).toBe(false);
    expect(isUuidLike("")).toBe(false);
    expect(isUuidLike(null)).toBe(false);
    expect(isUuidLike(42)).toBe(false);
  });
});

describe("confidencePct", () => {
  it("maps the freeform labels to a ring share", () => {
    expect(confidencePct("high")).toBe(90);
    expect(confidencePct("Medium")).toBe(65);
    expect(confidencePct("low")).toBe(40);
  });
  it("returns null for unlabeled or unknown confidence", () => {
    expect(confidencePct(null)).toBeNull();
    expect(confidencePct(undefined)).toBeNull();
    expect(confidencePct("certain")).toBeNull();
    expect(confidencePct("")).toBeNull();
  });
});

describe("provenanceKind", () => {
  it("classifies by sourceType first", () => {
    expect(provenanceKind("moment", "discovery")).toBe("moment");
    expect(provenanceKind("narrative", "debugging")).toBe("narrative");
    expect(provenanceKind("transition", "transition")).toBe("transition");
    expect(provenanceKind("outcome", "outcome")).toBe("outcome");
    expect(provenanceKind("agent-trace", "agent:tool-call")).toBe("agent-trace");
    expect(provenanceKind("mcp", "mcp:brain_enter")).toBe("consult");
  });
  it("falls back to category prefixes", () => {
    expect(provenanceKind(null, "observation:pattern")).toBe("observation");
    expect(provenanceKind(null, "mcp:brain_search")).toBe("consult");
    expect(provenanceKind(null, "agent:run")).toBe("agent-trace");
    expect(provenanceKind(null, "review:approved")).toBe("event");
    expect(provenanceKind(null, null)).toBe("event");
  });
});

describe("verificationVerdict", () => {
  it("aggregates counts into one word", () => {
    expect(verificationVerdict(2, 0)).toBe("supported");
    expect(verificationVerdict(0, 1)).toBe("contradicted");
    expect(verificationVerdict(2, 1)).toBe("mixed");
    expect(verificationVerdict(0, 0)).toBe("unverified");
  });
});

describe("splitAgentTrace", () => {
  it("returns null when the digester left no trace", () => {
    expect(splitAgentTrace([])).toBeNull();
  });
  it("splits run summary from tool calls, reading metadata", () => {
    const trace = splitAgentTrace([
      {
        id: "t1",
        timestamp: "2026-07-04T10:00:00Z",
        category: "agent:tool-call",
        summary: "read_chunk(chunk 2 of 5) 812ms",
        metadata: { toolName: "read_chunk", ms: 812, argsSummary: "chunk 2 of 5" },
      },
      {
        id: "t2",
        timestamp: "2026-07-04T10:01:00Z",
        category: "agent:run",
        summary: "digest agent: 9 turns, 48210 tokens, 6 tool calls, 0 repairs",
        metadata: { turns: 9, tokensUsed: 48210 },
      },
    ]);
    expect(trace).not.toBeNull();
    expect(trace!.run?.summary).toContain("digest agent");
    expect(trace!.toolCalls).toHaveLength(1);
    expect(trace!.toolCalls[0]).toEqual({
      name: "read_chunk",
      ms: 812,
      argsSummary: "chunk 2 of 5",
      summary: "read_chunk(chunk 2 of 5) 812ms",
    });
  });
  it("tolerates missing metadata on tool calls", () => {
    const trace = splitAgentTrace([
      { id: "t1", timestamp: "2026-07-04T10:00:00Z", category: "agent:tool-call", summary: "grep(foo) 12ms", metadata: null },
    ]);
    expect(trace!.toolCalls[0].name).toBe("grep");
    expect(trace!.toolCalls[0].ms).toBeNull();
    expect(trace!.run).toBeNull();
  });
});

// ── The chain assembler ───────────────────────────────────────────────

describe("buildProvenance — moment event chain", () => {
  it("resolves the full chain: moment → evidence → anchored transcript event", () => {
    const out = buildProvenance(fullInput());

    expect(out.kind).toBe("moment");
    expect(out.event?.id).toBe(momentEvent.id);
    expect(out.moments).toHaveLength(1);

    const m = out.moments[0];
    expect(m.statement).toBe(momentRow.statement);
    expect(m.confidencePct).toBe(90);
    expect(m.verification).toBe("supported");
    expect(m.evidence).toHaveLength(2);

    const [anchored, loose] = m.evidence;
    expect(anchored.anchored).toBe(true);
    expect(anchored.event?.causalOrder).toBe(42);
    expect(anchored.event?.summary).toContain("identical timestamps");
    expect(loose.anchored).toBe(false);
    expect(loose.event).toBeNull();
  });

  it("computes the C-level verdict from the chain", () => {
    const out = buildProvenance(fullInput());
    expect(out.verdict).toEqual({
      confidencePct: 90,
      verification: "supported",
      supported: 1,
      contradicted: 0,
      unverified: 0,
      moments: 1,
      quotes: 2,
      anchored: 1,
      anchoredPct: 50,
      transcriptEvents: 1,
    });
  });

  it("carries session + digest quality with derived anchoredPct", () => {
    const out = buildProvenance(fullInput());
    expect(out.session).toEqual({
      id: SESSION_ID,
      shape: "debugging",
      startedAt: sessionRow.startedAt,
      endedAt: sessionRow.endedAt,
    });
    expect(out.digest).toEqual({ ...qualityRow, anchoredPct: 80 });
  });

  it("always reserves understandingDelta as null (digestion-v2 slot)", () => {
    const out = buildProvenance(fullInput());
    expect(out.understandingDelta).toBeNull();
    expect("understandingDelta" in out).toBe(true);
  });
});

describe("buildProvenance — multi-moment chains (transition/outcome/narrative)", () => {
  const second = {
    id: "33333333-3333-4333-8333-333333333333",
    type: "struggle",
    statement: "Fought the timestamp collapse for an hour",
    confidence: "low",
    verification: "contradicted",
  };

  it("averages labeled confidence across supporting moments", () => {
    const out = buildProvenance(
      fullInput({
        event: { ...momentEvent, sourceType: "transition", category: "transition" },
        moments: [momentRow, second],
      }),
    );
    expect(out.kind).toBe("transition");
    expect(out.verdict.confidencePct).toBe(65); // (90 + 40) / 2
    expect(out.verdict.verification).toBe("mixed");
    expect(out.verdict.supported).toBe(1);
    expect(out.verdict.contradicted).toBe(1);
  });

  it("counts distinct transcript events across all evidence", () => {
    const out = buildProvenance(
      fullInput({
        moments: [momentRow, second],
        evidence: [
          anchoredEvidence,
          { id: "e3", momentId: second.id, quote: "again the same clock", sourceEventId: "ne-42" },
          { id: "e4", momentId: second.id, quote: "tests red", sourceEventId: "ne-77" },
        ],
        anchorEvents: [anchorEvent, { id: "ne-77", causalOrder: 77, summary: "vitest fails" }],
      }),
    );
    expect(out.verdict.quotes).toBe(3);
    expect(out.verdict.anchored).toBe(3);
    expect(out.verdict.transcriptEvents).toBe(2);
  });

  it("null chain confidence when no supporting moment is labeled", () => {
    const out = buildProvenance(
      fullInput({
        moments: [
          { ...momentRow, confidence: null },
          { ...second, confidence: undefined as unknown as string },
        ],
      }),
    );
    expect(out.verdict.confidencePct).toBeNull();
  });
});

describe("buildProvenance — fail-safe missing links", () => {
  it("resolves every missing link to null/[] — never throws", () => {
    const out = buildProvenance({
      event: null,
      moments: [],
      evidence: [],
      anchorEvents: [],
      session: null,
      quality: null,
      traceRows: [],
      observationRows: [],
    });
    expect(out.event).toBeNull();
    expect(out.kind).toBe("event");
    expect(out.moments).toEqual([]);
    expect(out.session).toBeNull();
    expect(out.digest).toBeNull();
    expect(out.agentTrace).toBeNull();
    expect(out.observations).toEqual([]);
    expect(out.verdict.verification).toBe("unverified");
    expect(out.verdict.anchoredPct).toBeNull();
    expect(out.verdict.confidencePct).toBeNull();
  });

  it("tolerates evidence whose anchor event went missing (set null on delete)", () => {
    const out = buildProvenance(
      fullInput({
        evidence: [{ ...anchoredEvidence, sourceEventId: "ne-gone" }],
        anchorEvents: [], // the normalized event was purged
      }),
    );
    expect(out.moments[0].evidence[0].anchored).toBe(false);
    expect(out.moments[0].evidence[0].event).toBeNull();
    expect(out.verdict.anchored).toBe(0);
  });

  it("honors an explicit kind override for synthesized chains (lookup by moment id)", () => {
    const out = buildProvenance(fullInput({ event: null, kind: "moment" }));
    expect(out.kind).toBe("moment");
    expect(out.moments).toHaveLength(1);
  });
});

describe("buildProvenance — brain delta slot (observations)", () => {
  it("shapes related observations with review status", () => {
    const out = buildProvenance(
      fullInput({
        observationRows: [
          {
            id: "o1",
            timestamp: "2026-07-04T12:00:00Z",
            category: "observation:pattern",
            summary: "Digest-time stamping recurs across sessions",
            reviewStatus: "pending",
            featureId: "f1",
          },
          {
            id: "o2",
            timestamp: "2026-07-04T13:00:00Z",
            category: "observation:constraint",
            summary: "Beat timestamps must come from occurredAt",
            reviewStatus: null,
            featureId: null,
          },
        ],
      }),
    );
    expect(out.observations).toHaveLength(2);
    expect(out.observations[0]).toEqual({
      id: "o1",
      timestamp: "2026-07-04T12:00:00Z",
      category: "observation:pattern",
      summary: "Digest-time stamping recurs across sessions",
      reviewStatus: "pending",
      featureId: "f1",
    });
    expect(out.observations[1].reviewStatus).toBeNull();
  });
});
