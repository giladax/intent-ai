import { describe, it, expect } from "vitest";
import {
  selectClaims,
  buildClaimWindow,
  applyVerdicts,
} from "../../../src/pipeline/understand/verify.js";
import type {
  SessionMoment,
  SessionChunk,
  NormalizedDevEvent,
} from "../../../src/adapters/types.js";

// ── Helpers ───────────────────────────────────────────────────────────

function makeEvent(
  causalOrder: number,
  category: NormalizedDevEvent["category"],
  detail: string,
  actor: NormalizedDevEvent["actor"] = "ai",
): NormalizedDevEvent {
  return {
    id: `evt-${causalOrder}`,
    sessionId: "s1",
    timestamp: "2026-07-04T10:00:00Z",
    causalOrder,
    category,
    actor,
    content: {
      summary: detail.slice(0, 80),
      detail,
    },
    rawEventId: `raw-${causalOrder}`,
    turnId: `turn-${causalOrder}`,
  };
}

function makeChunk(
  id: string,
  events: NormalizedDevEvent[],
  eventRange: [number, number] = [0, 10],
): SessionChunk {
  return {
    id,
    sessionId: "s1",
    chunkIndex: 0,
    events,
    topicHint: "test",
    filesInScope: [],
    eventRange,
  };
}

function makeMoment(
  id: string,
  type: SessionMoment["type"],
  chunkId = "chunk-0",
  overrides: Partial<SessionMoment> = {},
): SessionMoment {
  return {
    id,
    chunkId,
    type,
    statement: `statement for ${id}`,
    significance: "significant",
    agency: "developer",
    confidence: "high",
    topicFingerprint: "general",
    relatedMomentIds: [],
    evidence: [],
    occurredAt: null,
    verification: null,
    ...overrides,
  };
}

// ── Tests: selectClaims ───────────────────────────────────────────────

describe("selectClaims", () => {
  it("picks exactly confirmation, breakthrough, and execution types", () => {
    const allTypes: SessionMoment["type"][] = [
      "proposal",
      "discovery",
      "pivot",
      "confirmation",
      "rejection",
      "commitment",
      "struggle",
      "breakthrough",
      "execution",
    ];

    const moments = allTypes.map((t) => makeMoment(`m-${t}`, t));
    const claims = selectClaims(moments);

    const claimTypes = claims.map((m) => m.type);
    expect(claimTypes).toContain("confirmation");
    expect(claimTypes).toContain("breakthrough");
    expect(claimTypes).toContain("execution");
    expect(claimTypes).toHaveLength(3);

    // Non-claim types must not be present
    for (const t of ["proposal", "discovery", "pivot", "rejection", "commitment", "struggle"]) {
      expect(claimTypes).not.toContain(t);
    }
  });

  it("returns empty array when no claim-type moments exist", () => {
    const moments = [
      makeMoment("m1", "proposal"),
      makeMoment("m2", "discovery"),
      makeMoment("m3", "pivot"),
    ];
    expect(selectClaims(moments)).toHaveLength(0);
  });
});

// ── Tests: buildClaimWindow ───────────────────────────────────────────

describe("buildClaimWindow", () => {
  it("includes action and result events with [causalOrder] prefixes", () => {
    const events: NormalizedDevEvent[] = [
      makeEvent(1, "intent", "user intent message"),
      makeEvent(2, "action", "ran npm test"),
      makeEvent(3, "result", "all 10 tests passed"),
      makeEvent(4, "proposal", "ai proposal text"),
      makeEvent(5, "reflection", "ai reflection"),
    ];
    const chunk = makeChunk("chunk-0", events);
    const moment = makeMoment("m0", "confirmation", "chunk-0");

    const window = buildClaimWindow(moment, [chunk]);

    expect(window).toContain("[2]");
    expect(window).toContain("[3]");
    expect(window).toContain("ran npm test");
    expect(window).toContain("all 10 tests passed");
    // Non-action/result events must not appear
    expect(window).not.toContain("user intent message");
    expect(window).not.toContain("ai proposal text");
    expect(window).not.toContain("ai reflection");
  });

  it("includes success results (not just errors)", () => {
    const events: NormalizedDevEvent[] = [
      makeEvent(1, "action", "git commit -m 'fix'"),
      makeEvent(2, "result", "commit abc123 created successfully"),
    ];
    const chunk = makeChunk("chunk-0", events);
    const moment = makeMoment("m0", "confirmation", "chunk-0");

    const window = buildClaimWindow(moment, [chunk]);

    // Success result must be in the window
    expect(window).toContain("commit abc123 created successfully");
  });

  it("respects 4000-char cap by truncating whole events from the end", () => {
    // Create many events whose total length exceeds 4000 chars
    const events: NormalizedDevEvent[] = [];
    for (let i = 0; i < 30; i++) {
      events.push(makeEvent(i, "result", "x".repeat(200) + ` event-${i}`));
    }
    const chunk = makeChunk("chunk-0", events);
    const moment = makeMoment("m0", "confirmation", "chunk-0");

    const window = buildClaimWindow(moment, [chunk]);

    expect(window.length).toBeLessThanOrEqual(4000);
    expect(window).toContain("— window truncated");
  });

  it("returns a sentinel when the chunk is not found", () => {
    const moment = makeMoment("m0", "confirmation", "missing-chunk");
    const window = buildClaimWindow(moment, []);
    expect(window).toBe("(chunk not found)");
  });

  it("returns a sentinel when there are no action/result events", () => {
    const events: NormalizedDevEvent[] = [
      makeEvent(1, "intent", "user message"),
      makeEvent(2, "proposal", "ai says something"),
    ];
    const chunk = makeChunk("chunk-0", events);
    const moment = makeMoment("m0", "confirmation", "chunk-0");

    const window = buildClaimWindow(moment, [chunk]);
    expect(window).toBe("(no action or result events in chunk)");
  });

  it("appends truncation marker when event detail exceeds 500 chars", () => {
    const longDetail = "x".repeat(600); // 600 chars, exceeds 500-char slice
    const events: NormalizedDevEvent[] = [
      makeEvent(1, "action", longDetail),
      makeEvent(2, "result", "test result"),
    ];
    const chunk = makeChunk("chunk-0", events);
    const moment = makeMoment("m0", "confirmation", "chunk-0");

    const window = buildClaimWindow(moment, [chunk]);

    // The sliced event should be capped at 500 chars and marked with " …[event truncated]"
    expect(window).toContain(" …[event truncated]");
    expect(window).not.toContain("x".repeat(600)); // Full string not present
  });

  it("does not append truncation marker when event detail is under 500 chars", () => {
    const shortDetail = "y".repeat(100); // Under 500 chars
    const events: NormalizedDevEvent[] = [
      makeEvent(1, "action", shortDetail),
      makeEvent(2, "result", "test result"),
    ];
    const chunk = makeChunk("chunk-0", events);
    const moment = makeMoment("m0", "confirmation", "chunk-0");

    const window = buildClaimWindow(moment, [chunk]);

    // Event should be present without per-event truncation marker
    expect(window).toContain("y".repeat(100));
    expect(window).not.toContain(" …[event truncated]");
  });
});

// ── Tests: applyVerdicts ──────────────────────────────────────────────

describe("applyVerdicts", () => {
  it("sets verification field from verdict for claim moments", () => {
    const moments = [
      makeMoment("m0", "confirmation"),
      makeMoment("m1", "breakthrough"),
    ];
    const verdicts = [
      { momentId: "m0", verdict: "supported" as const },
      { momentId: "m1", verdict: "contradicted" as const },
    ];

    const result = applyVerdicts(moments, verdicts);

    expect(result.find((m) => m.id === "m0")?.verification).toBe("supported");
    expect(result.find((m) => m.id === "m1")?.verification).toBe("contradicted");
  });

  it("contradicted verdict forces confidence to 'low'", () => {
    const moments = [
      makeMoment("m0", "confirmation", "chunk-0", { confidence: "high" }),
      makeMoment("m1", "breakthrough", "chunk-0", { confidence: "medium" }),
    ];
    const verdicts = [
      { momentId: "m0", verdict: "contradicted" as const },
      { momentId: "m1", verdict: "contradicted" as const },
    ];

    const result = applyVerdicts(moments, verdicts);

    expect(result.find((m) => m.id === "m0")?.confidence).toBe("low");
    expect(result.find((m) => m.id === "m1")?.confidence).toBe("low");
  });

  it("supported verdict with null confidence leaves confidence unchanged", () => {
    const moments = [
      makeMoment("m0", "confirmation", "chunk-0", { confidence: "low" }),
    ];
    // Simulate null confidence (cast to get around TypeScript)
    (moments[0] as unknown as { confidence: null }).confidence = null;

    const verdicts = [{ momentId: "m0", verdict: "supported" as const }];
    const result = applyVerdicts(moments, verdicts);

    expect(result.find((m) => m.id === "m0")?.confidence).toBeNull();
    expect(result.find((m) => m.id === "m0")?.verification).toBe("supported");
  });

  it("supported verdict with 'low' confidence keeps it 'low' (never raises)", () => {
    const moments = [
      makeMoment("m0", "confirmation", "chunk-0", { confidence: "low" }),
    ];
    const verdicts = [{ momentId: "m0", verdict: "supported" as const }];

    const result = applyVerdicts(moments, verdicts);

    // 'supported' verdict must not raise confidence from 'low'
    expect(result.find((m) => m.id === "m0")?.confidence).toBe("low");
    expect(result.find((m) => m.id === "m0")?.verification).toBe("supported");
  });

  it("non-claim moments keep verification: null regardless of verdicts", () => {
    const moments = [
      makeMoment("non-claim-1", "proposal"),
      makeMoment("non-claim-2", "discovery"),
      makeMoment("non-claim-3", "pivot"),
      makeMoment("non-claim-4", "rejection"),
      makeMoment("non-claim-5", "commitment"),
      makeMoment("non-claim-6", "struggle"),
      makeMoment("claim", "confirmation"),
    ];

    // Even if the LLM returns verdicts for non-claim ids (shouldn't happen, but be safe)
    const verdicts = [{ momentId: "claim", verdict: "supported" as const }];
    const result = applyVerdicts(moments, verdicts);

    for (const id of ["non-claim-1", "non-claim-2", "non-claim-3", "non-claim-4", "non-claim-5", "non-claim-6"]) {
      expect(result.find((m) => m.id === id)?.verification).toBeNull();
    }
  });

  it("claim moment with no verdict returned gets 'unverified'", () => {
    const moments = [
      makeMoment("m0", "confirmation"),
      makeMoment("m1", "breakthrough"),
    ];
    // Only verdict for m0; m1 is missing
    const verdicts = [{ momentId: "m0", verdict: "supported" as const }];

    const result = applyVerdicts(moments, verdicts);

    expect(result.find((m) => m.id === "m1")?.verification).toBe("unverified");
  });

  it("unknown momentId in verdicts is ignored without crashing", () => {
    const moments = [makeMoment("m0", "confirmation")];
    const verdicts = [
      { momentId: "m0", verdict: "supported" as const },
      { momentId: "totally-unknown-id", verdict: "contradicted" as const },
    ];

    let result: SessionMoment[];
    expect(() => {
      result = applyVerdicts(moments, verdicts);
    }).not.toThrow();

    // Only m0 in output, unknown id not added
    expect(result!).toHaveLength(1);
    expect(result!.find((m) => m.id === "m0")?.verification).toBe("supported");
  });
});
