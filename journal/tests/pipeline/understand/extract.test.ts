import { describe, it, expect } from "vitest";
import { renderChunkEvents, validateAnchors } from "../../../src/pipeline/understand/extract.js";
import type { NormalizedDevEvent, SessionChunk } from "../../../src/adapters/types.js";
import type { z } from "zod";
import type { ExtractOutputSchema } from "../../../src/llm/prompts/understand/extract.js";

// ── Helpers ───────────────────────────────────────────────────────────

type ParsedMoment = z.infer<typeof ExtractOutputSchema>["moments"][number];

const ev = (
  causalOrder: number,
  category: NormalizedDevEvent["category"],
  detail: string,
  opts: Partial<NormalizedDevEvent> = {},
): NormalizedDevEvent => ({
  id: `ev-${causalOrder}`,
  sessionId: "s1",
  timestamp: `2026-07-04T10:${String(causalOrder).padStart(2, "0")}:00Z`,
  causalOrder,
  category,
  actor: category === "intent" ? "user" : "ai",
  content: {
    summary: opts.content?.summary ?? `summary-${causalOrder}`,
    detail,
    filesAffected: opts.content?.filesAffected,
  },
  rawEventId: `raw-${causalOrder}`,
  turnId: `t${causalOrder}`,
  ...opts,
} as NormalizedDevEvent);

function makeChunk(
  chunkIndex: number,
  events: NormalizedDevEvent[],
  eventRange?: [number, number],
): SessionChunk {
  const orders = events.map((e) => e.causalOrder);
  const range: [number, number] = eventRange ?? [
    Math.min(...orders),
    Math.max(...orders),
  ];
  return {
    id: `s1-chunk-${chunkIndex}`,
    sessionId: "s1",
    chunkIndex,
    events,
    topicHint: "test-topic",
    filesInScope: [],
    eventRange: range,
  };
}

function makeMoment(overrides: Partial<ParsedMoment> = {}): ParsedMoment {
  return {
    type: "proposal",
    statement: "A test moment",
    significance: "matters",
    agency: "developer",
    confidence: "high",
    topicFingerprint: "test",
    evidence: [{ quote: "use postgres", eventIndex: 7, sourceType: "user" }],
    ...overrides,
  } as ParsedMoment;
}

// ── renderChunkEvents tests ───────────────────────────────────────────

describe("renderChunkEvents", () => {
  it("prefixes every event with [causalOrder]", () => {
    const events = [
      ev(3, "intent", "use postgres"),
      ev(5, "proposal", "AI suggestion"),
    ];
    const out = renderChunkEvents(events);
    expect(out).toContain("[3]");
    expect(out).toContain("[5]");
  });

  it("renders intent events with DEV: prefix and full detail", () => {
    const events = [ev(3, "intent", "use postgres for storage")];
    const out = renderChunkEvents(events);
    expect(out).toContain("[3] DEV: use postgres for storage");
  });

  it("renders action events with AI/ACTION prefix and files", () => {
    const e = ev(8, "action", "writing changes to file", {
      content: {
        summary: "Tool: Write",
        detail: "writing changes to file",
        filesAffected: ["src/db.ts"],
      },
    } as Partial<NormalizedDevEvent>);
    const out = renderChunkEvents([e]);
    expect(out).toContain("[8] AI/ACTION(src/db.ts):");
  });

  it("includes RESULT(error): for error results and trims to 300 chars", () => {
    const longError = "Error: connection refused — " + "x".repeat(400);
    const e = ev(11, "result", longError, {
      content: { summary: "tool failed", detail: longError },
    } as Partial<NormalizedDevEvent>);
    const out = renderChunkEvents([e]);
    expect(out).toMatch(/\[11\] RESULT\(error\):/);
    // detail trimmed to 300 chars
    const line = out.split("\n").find((l) => l.startsWith("[11]"))!;
    // The rendered detail portion is at most 300 chars from detail
    expect(line.length).toBeLessThanOrEqual("[11] RESULT(error): ".length + 300);
  });

  it("renders ok results with RESULT: <summary first 120 chars>", () => {
    const e = ev(15, "result", "wrote 5 lines", {
      content: {
        summary: "file written successfully",
        detail: "wrote 5 lines",
      },
    } as Partial<NormalizedDevEvent>);
    const out = renderChunkEvents([e]);
    expect(out).toContain("[15] RESULT: file written successfully");
    expect(out).not.toContain("RESULT(error)");
  });
});

// ── validateAnchors tests ─────────────────────────────────────────────

describe("validateAnchors", () => {
  it("accepts a valid anchor: index in range and quote found in cited event", () => {
    const events = [
      ev(7, "intent", "use postgres for the database"),
      ev(8, "proposal", "I can set up postgres"),
    ];
    const chunk = makeChunk(0, events, [7, 8]);
    const moments: ParsedMoment[] = [makeMoment({
      evidence: [{ quote: "use postgres", eventIndex: 7, sourceType: "user" }],
    })];

    const out = validateAnchors(moments, chunk);

    expect(out).toHaveLength(1);
    expect(out[0].evidence[0]).toEqual({
      quote: "use postgres",
      eventIndex: 7,
      anchored: true,
      sourceType: "user",
    });
  });

  it("re-anchors when wrong index cited but quote found in exactly one other event", () => {
    const events = [
      ev(7, "intent", "use postgres for the database"),
      ev(8, "proposal", "let me configure that"),
    ];
    const chunk = makeChunk(0, events, [7, 8]);
    // LLM cites eventIndex 8 but the quote is in event 7
    const moments: ParsedMoment[] = [makeMoment({
      evidence: [{ quote: "use postgres", eventIndex: 8, sourceType: "user" }],
    })];

    const out = validateAnchors(moments, chunk);

    expect(out[0].evidence[0].eventIndex).toBe(7);
    expect(out[0].evidence[0].anchored).toBe(true);
  });

  it("marks anchored: false when quote is not found in any chunk event", () => {
    const events = [
      ev(7, "intent", "let us refactor the auth module"),
      ev(8, "proposal", "sure, I can help with that"),
    ];
    const chunk = makeChunk(0, events, [7, 8]);
    const moments: ParsedMoment[] = [makeMoment({
      evidence: [{ quote: "use postgres", eventIndex: 7, sourceType: "user" }],
    })];

    const out = validateAnchors(moments, chunk);

    expect(out[0].evidence[0].anchored).toBe(false);
  });

  it("assigns occurredAt from the first anchored evidence's event timestamp", () => {
    const events = [
      ev(7, "intent", "use postgres for the database"),
      ev(8, "proposal", "another event"),
    ];
    const chunk = makeChunk(0, events, [7, 8]);
    const moments: ParsedMoment[] = [makeMoment({
      evidence: [{ quote: "use postgres", eventIndex: 7, sourceType: "user" }],
    })];

    const out = validateAnchors(moments, chunk);

    // event 7 has timestamp 2026-07-04T10:07:00Z (padded as "07")
    expect(out[0].occurredAt).toBe(events[0].timestamp);
  });

  it("falls back occurredAt to chunk.events[0].timestamp when no anchored evidence", () => {
    const events = [
      ev(7, "intent", "some unrelated text here"),
      ev(8, "proposal", "another event"),
    ];
    const chunk = makeChunk(0, events, [7, 8]);
    const moments: ParsedMoment[] = [makeMoment({
      evidence: [{ quote: "quote not in any event", eventIndex: 7, sourceType: "user" }],
    })];

    const out = validateAnchors(moments, chunk);

    expect(out[0].evidence[0].anchored).toBe(false);
    expect(out[0].occurredAt).toBe(events[0].timestamp);
  });

  it("assigns deterministic ids: c<chunkIndex>-m<i>", () => {
    const events = [
      ev(7, "intent", "use postgres for the database"),
      ev(8, "intent", "and redis for caching"),
    ];
    const chunk = makeChunk(2, events, [7, 8]);
    const moments: ParsedMoment[] = [
      makeMoment({ evidence: [{ quote: "use postgres", eventIndex: 7, sourceType: "user" }] }),
      makeMoment({ evidence: [{ quote: "redis for caching", eventIndex: 8, sourceType: "user" }] }),
    ];

    const out = validateAnchors(moments, chunk);

    expect(out[0].id).toBe("c2-m0");
    expect(out[1].id).toBe("c2-m1");
  });

  it("accepts anchors to overlap events (causalOrder < eventRange[0] but present in chunk.events)", () => {
    // Overlap: event 5 is before range start (7) but included in chunk.events
    const events = [
      ev(5, "intent", "overlap event text here"), // overlap
      ev(7, "intent", "main chunk event"),
      ev(8, "proposal", "ai response"),
    ];
    const chunk = makeChunk(1, events, [7, 8]); // range is [7,8], but event 5 is overlap
    const moments: ParsedMoment[] = [makeMoment({
      evidence: [{ quote: "overlap event text", eventIndex: 5, sourceType: "user" }],
    })];

    const out = validateAnchors(moments, chunk);

    expect(out[0].evidence[0].anchored).toBe(true);
    expect(out[0].evidence[0].eventIndex).toBe(5);
  });

  it("multi-match non-re-anchor: quote found in 2+ events stays anchored: false, index unchanged (RW3 M2)", () => {
    // LLM cites eventIndex 9, which is out-of-range (range [7,8]) and not present
    // in chunk.events. The quote "shared text" appears in BOTH events 7 and 8.
    // Because matchingEvents.length === 2 (not 1), re-anchor must NOT fire.
    // Result: anchored: false, eventIndex: null (9 is out of range so citedInRange = false).
    const events = [
      ev(7, "intent", "shared text in both events here"),
      ev(8, "proposal", "shared text in both events here too"),
    ];
    const chunk = makeChunk(0, events, [7, 8]);
    const moments: ParsedMoment[] = [makeMoment({
      // LLM cites out-of-range index 9; quote matches 2 events → no re-anchor
      evidence: [{ quote: "shared text in both", eventIndex: 9, sourceType: "user" }],
    })];

    const out = validateAnchors(moments, chunk);

    expect(out[0].evidence[0].anchored).toBe(false);
    // eventIndex must be null because 9 is out of range (citedInRange = false)
    expect(out[0].evidence[0].eventIndex).toBeNull();
  });

  it("string eventIndex coercion: numeric string '12' → 12, garbage → null (RW3 M2)", () => {
    // ExtractEvidenceSchema has a z.union that transforms string → number or null.
    // validateAnchors receives the already-parsed output, so we test the two branches
    // of the typeof-check path: string "12" was already coerced to 12 by Zod;
    // here we verify the validator handles a non-number rawIndex (simulating Zod
    // returning null for garbage) by passing null directly as eventIndex.
    const events = [
      ev(12, "intent", "use postgres"),
    ];
    const chunk = makeChunk(0, events, [12, 12]);

    // Case 1: eventIndex is already a number (Zod coerced "12" → 12)
    const momentsNumeric: ParsedMoment[] = [makeMoment({
      evidence: [{ quote: "use postgres", eventIndex: 12, sourceType: "user" }],
    })];
    const outNumeric = validateAnchors(momentsNumeric, chunk);
    expect(outNumeric[0].evidence[0].anchored).toBe(true);
    expect(outNumeric[0].evidence[0].eventIndex).toBe(12);

    // Case 2: eventIndex is null (Zod returned null for garbage input)
    const momentsNull: ParsedMoment[] = [makeMoment({
      evidence: [{ quote: "some text", eventIndex: null, sourceType: "user" }],
    })];
    const outNull = validateAnchors(momentsNull, chunk);
    // null index → citedEvent is undefined → no anchor possible → anchored: false
    expect(outNull[0].evidence[0].anchored).toBe(false);
    expect(outNull[0].evidence[0].eventIndex).toBeNull();
  });

  it("never drops moments — all input moments produce output moments", () => {
    const events = [ev(7, "intent", "some text")];
    const chunk = makeChunk(0, events, [7, 7]);
    const moments: ParsedMoment[] = [
      makeMoment({ evidence: [{ quote: "unanchored quote one", eventIndex: 7, sourceType: "ai" }] }),
      makeMoment({ evidence: [{ quote: "unanchored quote two", eventIndex: 7, sourceType: "ai" }] }),
      makeMoment({ evidence: [{ quote: "unanchored quote three", eventIndex: 7, sourceType: "ai" }] }),
    ];

    const out = validateAnchors(moments, chunk);

    expect(out).toHaveLength(3);
  });
});
