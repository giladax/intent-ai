import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/llm/client.js", () => ({
  callHaiku: vi.fn(),
}));

import { chunkSession, detectTopicShifts } from "../../src/pipeline/chunk.js";
import { callHaiku } from "../../src/llm/client.js";
import type { NormalizedDevEvent } from "../../src/adapters/types.js";

const mockedHaiku = vi.mocked(callHaiku);

// ── Helpers ──────────────────────────────────────────────────────────

function makeEvent(
  overrides: Partial<NormalizedDevEvent> & { causalOrder: number },
): NormalizedDevEvent {
  const order = overrides.causalOrder;
  return {
    id: `s1-${order}`,
    sessionId: "s1",
    timestamp: overrides.timestamp ?? "2026-05-20T10:00:00.000Z",
    causalOrder: order,
    category: overrides.category ?? "action",
    actor: overrides.actor ?? "ai",
    content: overrides.content ?? {
      summary: `Event ${order}`,
      detail: `Detail for event ${order}`,
    },
    rawEventId: `raw-${order}`,
  };
}

/** Generate N events with sequential causalOrder and timestamps spaced 10s apart. */
function makeEvents(
  n: number,
  opts?: {
    startOrder?: number;
    startTime?: Date;
    category?: NormalizedDevEvent["category"];
    filesAffected?: string[];
  },
): NormalizedDevEvent[] {
  const start = opts?.startTime ?? new Date("2026-05-20T10:00:00.000Z");
  const startOrder = opts?.startOrder ?? 0;
  return Array.from({ length: n }, (_, i) => {
    const ts = new Date(start.getTime() + i * 10_000); // 10s apart
    return makeEvent({
      causalOrder: startOrder + i,
      timestamp: ts.toISOString(),
      category: opts?.category,
      content: opts?.filesAffected
        ? {
            summary: `Event ${startOrder + i}`,
            detail: `Detail for event ${startOrder + i}`,
            filesAffected: opts.filesAffected,
          }
        : undefined,
    });
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe("chunkSession", () => {
  const sessionId = "test-session";

  it("returns empty array for empty events", () => {
    expect(chunkSession([], sessionId)).toEqual([]);
  });

  it("returns one chunk for short sessions (<10 events)", () => {
    const events = makeEvents(5);
    const chunks = chunkSession(events, sessionId);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].events).toHaveLength(5);
    expect(chunks[0].eventRange).toEqual([0, 4]);
    expect(chunks[0].sessionId).toBe(sessionId);
    expect(chunks[0].id).toBe(`${sessionId}-chunk-0`);
  });

  it("splits at pauses >5 minutes", () => {
    const t0 = new Date("2026-05-20T10:00:00.000Z");
    // First batch: 12 events
    const batch1 = makeEvents(12, { startTime: t0 });

    // Gap of 10 minutes
    const afterGap = new Date(t0.getTime() + 12 * 10_000 + 10 * 60_000);

    // Second batch: 12 events after the gap
    const batch2 = makeEvents(12, {
      startOrder: 12,
      startTime: afterGap,
    });

    const events = [...batch1, ...batch2];
    const chunks = chunkSession(events, sessionId);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].eventRange).toEqual([0, 11]);
    expect(chunks[1].eventRange).toEqual([12, 23]);
  });

  it("splits when file cluster shifts (>70% new files)", () => {
    const t0 = new Date("2026-05-20T10:00:00.000Z");
    const events: NormalizedDevEvent[] = [];

    // First 12 events: each touches a unique src/ file (builds up file context)
    for (let i = 0; i < 12; i++) {
      events.push(
        makeEvent({
          causalOrder: i,
          timestamp: new Date(t0.getTime() + i * 10_000).toISOString(),
          content: {
            summary: `Edit src/file${i}.ts`,
            detail: `Editing src/file${i}.ts`,
            filesAffected: [`src/file${i}.ts`],
          },
        }),
      );
    }

    // Next 12 events: each touches 2+ new test files (triggers >70% shift)
    for (let i = 12; i < 24; i++) {
      events.push(
        makeEvent({
          causalOrder: i,
          timestamp: new Date(t0.getTime() + i * 10_000).toISOString(),
          content: {
            summary: `Edit tests/test${i}.ts`,
            detail: `Editing tests/test${i}.ts`,
            filesAffected: [`tests/test${i}a.ts`, `tests/test${i}b.ts`],
          },
        }),
      );
    }

    const chunks = chunkSession(events, sessionId);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].filesInScope.some((f) => f.startsWith("src/"))).toBe(
      true,
    );
  });

  it("splits at topic-shift event ids supplied by the caller", () => {
    const t0 = new Date("2026-05-20T10:00:00.000Z");

    // First batch: 12 events
    const batch1 = makeEvents(12, { startTime: t0 });

    // Topic shift event (id is "s1-12" per makeEvent)
    const shift = makeEvent({
      causalOrder: 12,
      timestamp: new Date(t0.getTime() + 12 * 10_000).toISOString(),
      category: "intent",
      actor: "user",
      content: {
        summary: "Now let's work on the tests",
        detail: "Now let's work on the tests",
      },
    });

    // Second batch: 11 more events
    const batch2 = makeEvents(11, {
      startOrder: 13,
      startTime: new Date(t0.getTime() + 13 * 10_000),
    });

    const events = [...batch1, shift, ...batch2];

    // Topic-shift detection is now a precomputed (Haiku-classified) signal
    // passed into chunkSession; here we supply it deterministically.
    const chunks = chunkSession(events, sessionId, new Set([shift.id]));

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[1].eventRange[0]).toBe(12);
  });

  it("does NOT split on topic shifts when no signal set is provided", () => {
    const t0 = new Date("2026-05-20T10:00:00.000Z");

    const batch1 = makeEvents(12, { startTime: t0 });
    const shift = makeEvent({
      causalOrder: 12,
      timestamp: new Date(t0.getTime() + 12 * 10_000).toISOString(),
      category: "intent",
      actor: "user",
      content: {
        summary: "Now let's work on the tests",
        detail: "Now let's work on the tests",
      },
    });
    const batch2 = makeEvents(11, {
      startOrder: 13,
      startTime: new Date(t0.getTime() + 13 * 10_000),
    });

    const events = [...batch1, shift, ...batch2];

    // No topic-shift set and no pause/file-shift signals → single chunk.
    const chunks = chunkSession(events, sessionId);
    expect(chunks).toHaveLength(1);
  });

  it("splits chunks exceeding 80 events at natural boundaries", () => {
    const t0 = new Date("2026-05-20T10:00:00.000Z");
    const events: NormalizedDevEvent[] = [];

    for (let i = 0; i < 100; i++) {
      const category: NormalizedDevEvent["category"] =
        i % 20 === 19 ? "result" : "action";
      events.push(
        makeEvent({
          causalOrder: i,
          timestamp: new Date(t0.getTime() + i * 10_000).toISOString(),
          category,
        }),
      );
    }

    const chunks = chunkSession(events, sessionId);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) {
      const ownedCount = chunk.eventRange[1] - chunk.eventRange[0] + 1;
      expect(ownedCount).toBeLessThanOrEqual(90);
    }
  });

  it("includes 3-event overlap between consecutive chunks", () => {
    const t0 = new Date("2026-05-20T10:00:00.000Z");

    // 12 events, then 10min pause, then 12 events
    const batch1 = makeEvents(12, { startTime: t0 });
    const afterGap = new Date(t0.getTime() + 12 * 10_000 + 10 * 60_000);
    const batch2 = makeEvents(12, {
      startOrder: 12,
      startTime: afterGap,
    });

    const events = [...batch1, ...batch2];
    const chunks = chunkSession(events, sessionId);

    expect(chunks).toHaveLength(2);

    // First chunk: 12 owned events, no overlap
    expect(chunks[0].events).toHaveLength(12);
    expect(chunks[0].eventRange).toEqual([0, 11]);

    // Second chunk: 3 overlap + 12 owned = 15 events
    expect(chunks[1].events).toHaveLength(15);
    expect(chunks[1].eventRange).toEqual([12, 23]);

    // The overlap events should be the last 3 from chunk 0
    const overlapEvents = chunks[1].events.slice(0, 3);
    const lastThreeOfChunk0 = chunks[0].events.slice(-3);
    expect(overlapEvents.map((e) => e.causalOrder)).toEqual(
      lastThreeOfChunk0.map((e) => e.causalOrder),
    );
  });

  it("enforces minimum chunk size between splits", () => {
    const t0 = new Date("2026-05-20T10:00:00.000Z");

    // 12 events, then pause, then 3 events (tiny), then pause, then 12 events
    // The second pause is too close to the first (only 3 events apart)
    // so it won't create a split — tiny events merge with batch3
    const batch1 = makeEvents(12, { startTime: t0 });
    const gap1 = new Date(t0.getTime() + 12 * 10_000 + 10 * 60_000);
    const tiny = makeEvents(3, { startOrder: 12, startTime: gap1 });
    const gap2 = new Date(gap1.getTime() + 3 * 10_000 + 10 * 60_000);
    const batch3 = makeEvents(12, { startOrder: 15, startTime: gap2 });

    const events = [...batch1, ...tiny, ...batch3];
    const chunks = chunkSession(events, sessionId);

    // Split only at the first pause; tiny + batch3 stay together
    expect(chunks).toHaveLength(2);
    expect(chunks[0].eventRange).toEqual([0, 11]);
    expect(chunks[1].eventRange[0]).toBe(12);
  });

  it("generates topic hint from most frequent file", () => {
    const events: NormalizedDevEvent[] = [];
    const t0 = new Date("2026-05-20T10:00:00.000Z");

    for (let i = 0; i < 5; i++) {
      events.push(
        makeEvent({
          causalOrder: i,
          timestamp: new Date(t0.getTime() + i * 10_000).toISOString(),
          content: {
            summary: `Edit src/main.ts`,
            detail: `Editing src/main.ts`,
            filesAffected: ["src/main.ts"],
          },
        }),
      );
    }

    const chunks = chunkSession(events, sessionId);
    expect(chunks[0].topicHint).toBe("src/main.ts");
  });

  it("falls back to user message for topic hint when no files", () => {
    const events: NormalizedDevEvent[] = [];
    const t0 = new Date("2026-05-20T10:00:00.000Z");

    events.push(
      makeEvent({
        causalOrder: 0,
        timestamp: t0.toISOString(),
        category: "intent",
        actor: "user",
        content: {
          summary: "Fix the login bug",
          detail: "Fix the login bug please",
        },
      }),
    );
    for (let i = 1; i < 5; i++) {
      events.push(
        makeEvent({
          causalOrder: i,
          timestamp: new Date(t0.getTime() + i * 10_000).toISOString(),
        }),
      );
    }

    const chunks = chunkSession(events, sessionId);
    expect(chunks[0].topicHint).toBe("Fix the login bug");
  });

  it("collects all unique files in filesInScope", () => {
    const events: NormalizedDevEvent[] = [];
    const t0 = new Date("2026-05-20T10:00:00.000Z");

    events.push(
      makeEvent({
        causalOrder: 0,
        timestamp: t0.toISOString(),
        content: { summary: "Edit a.ts", detail: "Edit a.ts", filesAffected: ["src/a.ts"] },
      }),
    );
    events.push(
      makeEvent({
        causalOrder: 1,
        timestamp: new Date(t0.getTime() + 10_000).toISOString(),
        content: { summary: "Edit b.ts", detail: "Edit b.ts", filesAffected: ["src/b.ts"] },
      }),
    );
    events.push(
      makeEvent({
        causalOrder: 2,
        timestamp: new Date(t0.getTime() + 20_000).toISOString(),
        content: { summary: "Edit a.ts again", detail: "Edit a.ts again", filesAffected: ["src/a.ts"] },
      }),
    );

    const chunks = chunkSession(events, sessionId);
    expect(chunks[0].filesInScope.sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("single-topic session with no split points produces one chunk", () => {
    const events = makeEvents(50, { filesAffected: ["src/same-file.ts"] });
    const chunks = chunkSession(events, sessionId);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].events).toHaveLength(50);
  });

  // ── hardBreaks option ───────────────────────────────────────────────

  it("hardBreaks: forces a chunk split at the given causalOrders", () => {
    // 40 uniformly-timed events — no pauses, no file-shifts, no topic shifts
    const events = makeEvents(40, { filesAffected: ["src/same.ts"] });
    // Without hardBreaks → 1 chunk
    expect(chunkSession(events, sessionId)).toHaveLength(1);

    // The 20th event has causalOrder 19 (0-based). Pass its causalOrder as a
    // hardBreak — chunkSession should now split before it.
    const hardBreakOrder = events[19].causalOrder;
    const chunks = chunkSession(events, sessionId, new Set(), { hardBreaks: [hardBreakOrder] });

    // Two chunks expected (the hardBreak forces a split at index 19)
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // The second chunk's event range should start at or near hardBreakOrder
    const secondChunk = chunks[1];
    expect(secondChunk.eventRange[0]).toBeLessThanOrEqual(hardBreakOrder);
    // The second owned group must start with or include the hardBreak event
    const ownedEvents = secondChunk.events.filter(
      (e) => e.causalOrder >= secondChunk.eventRange[0],
    );
    expect(ownedEvents.length).toBeGreaterThan(0);
  });

  it("hardBreaks: omitting options produces byte-identical result to no-options call", () => {
    const events = makeEvents(40, { filesAffected: ["src/same.ts"] });
    const withoutOpts = chunkSession(events, sessionId);
    const withEmptyOpts = chunkSession(events, sessionId, new Set(), {});
    // Same number of chunks
    expect(withEmptyOpts).toHaveLength(withoutOpts.length);
    // Same event ranges
    for (let i = 0; i < withoutOpts.length; i++) {
      expect(withEmptyOpts[i].eventRange).toEqual(withoutOpts[i].eventRange);
    }
  });

  it("hardBreaks: post-break chunk starts EXACTLY at the hard-break causalOrder", () => {
    // 40 uniformly-timed events with no natural split signals
    const events = makeEvents(40, { filesAffected: ["src/same.ts"] });
    const hardBreakOrder = events[19].causalOrder; // causalOrder 19
    const chunks = chunkSession(events, sessionId, new Set(), { hardBreaks: [hardBreakOrder] });

    // Exactly 2 chunks expected
    expect(chunks).toHaveLength(2);
    // The second chunk must start EXACTLY at the hard-break causalOrder
    expect(chunks[1].eventRange[0]).toBe(hardBreakOrder);
  });

  it("hardBreaks: a 9-event short session with one hard break produces 2 chunks", () => {
    // Sessions under SHORT_SESSION_THRESHOLD (10) currently return a single chunk
    // regardless — hard breaks must override this.
    const events = makeEvents(9, { filesAffected: ["src/same.ts"] });
    // Put the break at event index 4 (causalOrder 4)
    const hardBreakOrder = events[4].causalOrder;
    const chunks = chunkSession(events, sessionId, new Set(), { hardBreaks: [hardBreakOrder] });

    expect(chunks).toHaveLength(2);
    expect(chunks[0].eventRange).toEqual([0, 3]);
    expect(chunks[1].eventRange[0]).toBe(hardBreakOrder);
  });

  it("hardBreaks: a tiny post-break chunk is NOT merged backward across the boundary", () => {
    // Build: 20 events, hard break at index 18 → first chunk has 18 events,
    // second chunk has only 2 events (< MIN_CHUNK_SIZE=8). Without protection
    // the tiny second chunk would merge backward into chunk 1.
    const events = makeEvents(20, { filesAffected: ["src/same.ts"] });
    const hardBreakOrder = events[18].causalOrder; // causalOrder 18
    const chunks = chunkSession(events, sessionId, new Set(), { hardBreaks: [hardBreakOrder] });

    // Must still be 2 chunks — the boundary must NOT be dissolved
    expect(chunks).toHaveLength(2);
    expect(chunks[1].eventRange[0]).toBe(hardBreakOrder);
  });
});

describe("detectTopicShifts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the set of event ids classified as topic shifts", async () => {
    const events = makeEvents(10, { category: "intent" });
    mockedHaiku.mockResolvedValue({
      shifts: [
        { eventId: "s1-3", isTopicShift: true },
        { eventId: "s1-5", isTopicShift: false },
        { eventId: "s1-7", isTopicShift: true },
      ],
    } as never);

    const ids = await detectTopicShifts(events);

    expect(mockedHaiku).toHaveBeenCalledTimes(1);
    expect(ids.has("s1-3")).toBe(true);
    expect(ids.has("s1-7")).toBe(true);
    expect(ids.has("s1-5")).toBe(false);
  });

  it("skips the LLM call for short sessions", async () => {
    const events = makeEvents(5, { category: "intent" });
    const ids = await detectTopicShifts(events);
    expect(mockedHaiku).not.toHaveBeenCalled();
    expect(ids.size).toBe(0);
  });

  it("returns an empty set when there are fewer than 2 intent messages", async () => {
    // 10 action events (long enough session) but no user/intent messages.
    const events = makeEvents(10, { category: "action" });
    const ids = await detectTopicShifts(events);
    expect(mockedHaiku).not.toHaveBeenCalled();
    expect(ids.size).toBe(0);
  });

  it("never throws — returns an empty set when Haiku fails", async () => {
    const events = makeEvents(10, { category: "intent" });
    mockedHaiku.mockRejectedValue(new Error("no api key"));

    const ids = await detectTopicShifts(events);

    expect(ids.size).toBe(0);
  });
});
