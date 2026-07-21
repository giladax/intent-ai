import { describe, it, expect } from "vitest";
import { buildSessionDigest } from "../../src/pipeline/session-digest.js";
import type { SessionChunk, NormalizedDevEvent } from "../../src/adapters/types.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeEvent(
  overrides: Partial<NormalizedDevEvent> & { causalOrder: number },
): NormalizedDevEvent {
  const order = overrides.causalOrder;
  return {
    id: overrides.id ?? `s1-${order}`,
    sessionId: "s1",
    timestamp: "2026-05-20T10:00:00.000Z",
    causalOrder: order,
    category: overrides.category ?? "action",
    actor: overrides.actor ?? "ai",
    content: overrides.content ?? {
      summary: `Event ${order}`,
      detail: `Detail for event ${order}`,
    },
    rawEventId: `raw-${order}`,
    turnId: overrides.turnId ?? `turn-${order}`,
    respondingTo: overrides.respondingTo,
  };
}

function makeChunk(
  index: number,
  events: NormalizedDevEvent[],
  opts?: { topicHint?: string; filesInScope?: string[] },
): SessionChunk {
  const orders = events.map((e) => e.causalOrder);
  return {
    id: `s1-chunk-${index}`,
    sessionId: "s1",
    chunkIndex: index,
    events,
    topicHint: opts?.topicHint ?? `topic-${index}`,
    filesInScope: opts?.filesInScope ?? [`src/file-${index}.ts`],
    eventRange: [Math.min(...orders), Math.max(...orders)],
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("buildSessionDigest", () => {
  it("extracts developer statements (category=intent) with chunk index", () => {
    const events = [
      makeEvent({ causalOrder: 0, category: "intent", actor: "user", content: { summary: "Add auth", detail: "I want to add authentication" } }),
      makeEvent({ causalOrder: 1, category: "action", actor: "ai" }),
      makeEvent({ causalOrder: 2, category: "intent", actor: "user", content: { summary: "Use JWT", detail: "Let's use JWT tokens" } }),
      makeEvent({ causalOrder: 3, category: "action", actor: "ai" }),
    ];

    const chunk0 = makeChunk(0, [events[0], events[1]]);
    const chunk1 = makeChunk(1, [events[2], events[3]]);

    const digest = buildSessionDigest([chunk0, chunk1], events);

    expect(digest.developerStatements).toHaveLength(2);
    expect(digest.developerStatements[0]).toEqual({
      causalOrder: 0,
      text: "I want to add authentication",
      chunkIndex: 0,
    });
    expect(digest.developerStatements[1]).toEqual({
      causalOrder: 2,
      text: "Let's use JWT tokens",
      chunkIndex: 1,
    });
  });

  it("builds topic flow from chunk metadata", () => {
    const chunk0 = makeChunk(0, [makeEvent({ causalOrder: 0 })], {
      topicHint: "auth setup",
      filesInScope: ["src/auth.ts"],
    });
    const chunk1 = makeChunk(1, [makeEvent({ causalOrder: 1 })], {
      topicHint: "test writing",
      filesInScope: ["tests/auth.test.ts"],
    });

    const digest = buildSessionDigest([chunk0, chunk1], []);

    expect(digest.topicFlow).toHaveLength(2);
    expect(digest.topicFlow[0]).toEqual({
      chunkIndex: 0,
      topicHint: "auth setup",
      filesInScope: ["src/auth.ts"],
    });
    expect(digest.topicFlow[1]).toEqual({
      chunkIndex: 1,
      topicHint: "test writing",
      filesInScope: ["tests/auth.test.ts"],
    });
  });

  it("detects boundary exchanges via respondingTo spanning chunks", () => {
    const ev0 = makeEvent({ causalOrder: 0, id: "ev-0", category: "intent", actor: "user" });
    const ev1 = makeEvent({ causalOrder: 1, id: "ev-1", category: "action", actor: "ai" });
    // ev2 is in chunk 1 but responds to ev-1 in chunk 0
    const ev2 = makeEvent({ causalOrder: 2, id: "ev-2", category: "result", actor: "user", respondingTo: "ev-1" });
    const ev3 = makeEvent({ causalOrder: 3, id: "ev-3", category: "action", actor: "ai" });

    const chunk0 = makeChunk(0, [ev0, ev1]);
    const chunk1 = makeChunk(1, [ev2, ev3]);

    const digest = buildSessionDigest([chunk0, chunk1], [ev0, ev1, ev2, ev3]);

    expect(digest.boundaryExchanges).toHaveLength(1);
    expect(digest.boundaryExchanges[0].chunkA).toBe(0);
    expect(digest.boundaryExchanges[0].chunkB).toBe(1);
    expect(digest.boundaryExchanges[0].eventIds).toContain("ev-1");
    expect(digest.boundaryExchanges[0].eventIds).toContain("ev-2");
  });

  it("detects boundary exchanges via turnId spanning chunks", () => {
    const ev0 = makeEvent({ causalOrder: 0, id: "ev-0", turnId: "turn-shared" });
    const ev1 = makeEvent({ causalOrder: 1, id: "ev-1", turnId: "turn-shared" });
    const ev2 = makeEvent({ causalOrder: 2, id: "ev-2", turnId: "turn-shared" });
    const ev3 = makeEvent({ causalOrder: 3, id: "ev-3", turnId: "turn-other" });

    const chunk0 = makeChunk(0, [ev0, ev1]);
    const chunk1 = makeChunk(1, [ev2, ev3]);

    const digest = buildSessionDigest([chunk0, chunk1], [ev0, ev1, ev2, ev3]);

    expect(digest.boundaryExchanges).toHaveLength(1);
    expect(digest.boundaryExchanges[0].chunkA).toBe(0);
    expect(digest.boundaryExchanges[0].chunkB).toBe(1);
    expect(digest.boundaryExchanges[0].eventIds).toContain("ev-0");
    expect(digest.boundaryExchanges[0].eventIds).toContain("ev-1");
    expect(digest.boundaryExchanges[0].eventIds).toContain("ev-2");
    // ev-3 has a different turnId, should NOT be included
    expect(digest.boundaryExchanges[0].eventIds).not.toContain("ev-3");
  });

  it("returns empty boundary exchanges when all causal links are within chunks", () => {
    const ev0 = makeEvent({ causalOrder: 0, id: "ev-0", turnId: "turn-0" });
    const ev1 = makeEvent({ causalOrder: 1, id: "ev-1", turnId: "turn-0", respondingTo: "ev-0" });
    const ev2 = makeEvent({ causalOrder: 2, id: "ev-2", turnId: "turn-1" });
    const ev3 = makeEvent({ causalOrder: 3, id: "ev-3", turnId: "turn-1", respondingTo: "ev-2" });

    const chunk0 = makeChunk(0, [ev0, ev1]);
    const chunk1 = makeChunk(1, [ev2, ev3]);

    const digest = buildSessionDigest([chunk0, chunk1], [ev0, ev1, ev2, ev3]);

    expect(digest.boundaryExchanges).toHaveLength(0);
  });

  it("handles single-chunk session", () => {
    const ev = makeEvent({ causalOrder: 0, category: "intent", actor: "user", content: { summary: "test", detail: "test detail" } });
    const chunk = makeChunk(0, [ev]);

    const digest = buildSessionDigest([chunk], [ev]);

    expect(digest.developerStatements).toHaveLength(1);
    expect(digest.topicFlow).toHaveLength(1);
    expect(digest.boundaryExchanges).toHaveLength(0);
  });

  it("handles empty chunks array", () => {
    const digest = buildSessionDigest([], []);

    expect(digest.developerStatements).toHaveLength(0);
    expect(digest.topicFlow).toHaveLength(0);
    expect(digest.boundaryExchanges).toHaveLength(0);
  });
});
