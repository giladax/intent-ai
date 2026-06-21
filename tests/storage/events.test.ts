import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActivityEvent } from "../../src/adapters/types.js";

vi.mock("../../src/storage/connection.js", () => {
  const mockSql = Object.assign(
    vi.fn().mockResolvedValue([]),
    { unsafe: vi.fn().mockResolvedValue([]) }
  );
  return {
    getClient: vi.fn(() => mockSql),
    getDb: vi.fn(),
    closeDb: vi.fn(),
  };
});

import { emitEvent, emitEvents, queryEvents } from "../../src/storage/queries.js";
import { getClient } from "../../src/storage/connection.js";

describe("emitEvent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts a single event and returns an id", async () => {
    const event: ActivityEvent = {
      timestamp: new Date("2026-06-22T10:00:00Z"),
      category: "struggle",
      tags: ["auth"],
      actor: "ai",
      summary: "Agent struggled with circular imports in auth module",
      metadata: { confidence: "high" },
      sessionId: "session-1",
      repo: "intent-ai",
      branch: "feat/auth",
      files: ["src/auth.ts"],
    };

    const id = await emitEvent(event);
    expect(id).toBeDefined();
    expect(typeof id).toBe("string");

    const mockSql = (getClient as ReturnType<typeof vi.fn>)();
    expect(mockSql).toHaveBeenCalled();
  });
});

describe("emitEvents", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts multiple events", async () => {
    const events: ActivityEvent[] = [
      {
        timestamp: new Date("2026-06-22T10:00:00Z"),
        category: "discovery",
        tags: [],
        actor: "ai",
        summary: "Found helper",
        metadata: {},
      },
      {
        timestamp: new Date("2026-06-22T10:01:00Z"),
        category: "outcome",
        tags: [],
        actor: "collaborative",
        summary: "Auth done",
        metadata: {},
      },
    ];

    const ids = await emitEvents(events);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe("queryEvents", () => {
  beforeEach(() => vi.clearAllMocks());

  it("queries with no filters", async () => {
    const events = await queryEvents({});
    expect(events).toEqual([]);
  });

  it("queries with category prefix", async () => {
    const events = await queryEvents({ categoryPrefix: "struggle" });
    expect(events).toEqual([]);

    const mockSql = (getClient as ReturnType<typeof vi.fn>)();
    const unsafeCall = mockSql.unsafe.mock.calls[0][0];
    expect(unsafeCall).toContain("category LIKE 'struggle%'");
  });

  it("queries with multiple filters", async () => {
    const events = await queryEvents({
      repo: "intent-ai",
      branch: "feat/auth",
      since: new Date("2026-06-01"),
      limit: 10,
    });

    const mockSql = (getClient as ReturnType<typeof vi.fn>)();
    const unsafeCall = mockSql.unsafe.mock.calls[0][0];
    expect(unsafeCall).toContain("repo = 'intent-ai'");
    expect(unsafeCall).toContain("branch = 'feat/auth'");
    expect(unsafeCall).toContain("LIMIT 10");
  });
});
