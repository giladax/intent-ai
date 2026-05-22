import { describe, it, expect } from "vitest";
import { chunkSession } from "../../src/pipeline/chunk.js";
import type { NormalizedDevEvent } from "../../src/adapters/types.js";

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

  it("splits on explicit topic shift phrases in user messages", () => {
    const t0 = new Date("2026-05-20T10:00:00.000Z");

    // First batch: 12 events
    const batch1 = makeEvents(12, { startTime: t0 });

    // Topic shift event
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
    const chunks = chunkSession(events, sessionId);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[1].eventRange[0]).toBe(12);
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
});
