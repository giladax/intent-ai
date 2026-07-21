import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveEvidenceSourceIds } from "../../src/storage/queries.js";

describe("resolveEvidenceSourceIds", () => {
  const map = new Map([[7, "uuid-7"], [9, "uuid-9"]]);
  it("maps anchored evidence to the event uuid", () => {
    expect(resolveEvidenceSourceIds(
      [{ quote: "q", eventIndex: 7, anchored: true, sourceType: "user" }], map,
    )).toEqual(["uuid-7"]);
  });
  it("unanchored or unmapped evidence stays null", () => {
    expect(resolveEvidenceSourceIds(
      [
        { quote: "q", eventIndex: 7, anchored: false, sourceType: "ai" },
        { quote: "q", eventIndex: 99, anchored: true, sourceType: "ai" },
        { quote: "q", eventIndex: null, anchored: false, sourceType: "ai" },
      ], map,
    )).toEqual([null, null, null]);
  });
});

// ── storeSessionDigest conflict (ON CONFLICT source_hash) ───────────────

// When the session INSERT returns count=0 (another concurrent digest landed
// first), storeSessionDigest must:
//   • NOT call any child inserts (normalized_events, chunks, moments, etc.)
//   • NOT throw
//   • log the exact warning to stderr

// We build a minimal postgres.js mock where the first call (sessions INSERT)
// returns a result with count=0 (simulating ON CONFLICT DO NOTHING). All
// subsequent calls return count=1 as usual.

const conflictResult = Object.assign([], { count: 0 });
const normalResult = Object.assign([], { count: 1 });

// Track every tagged-template-literal invocation so we can assert on it.
let callCount = 0;
const mockSqlConflict = vi.fn().mockImplementation((..._args: unknown[]) => {
  callCount++;
  // First call = sessions INSERT → conflict (count=0)
  if (callCount === 1) return Promise.resolve(conflictResult);
  return Promise.resolve(normalResult);
});

vi.mock("../../src/storage/connection.js", () => ({
  getClient: vi.fn(() => mockSqlConflict),
  getDb: vi.fn(),
  closeDb: vi.fn(),
}));

import { storeSessionDigest } from "../../src/storage/queries.js";

const minimalDigest = {
  sessionId: "test-session-id",
  sourceType: "cc",
  sourcePath: "/tmp/test.jsonl",
  sourceHash: "abc123",
  sessionShape: "linear" as const,
  startedAt: null,
  endedAt: null,
  rawEvents: [],
  normalizedEvents: [],
  chunks: [],
  moments: [],
  transitions: [],
  outcomes: [],
  narrative: {
    sessionId: "test-session-id",
    sessionShape: "linear" as const,
    summary: "test",
    progression: [],
    discoveries: [],
    stabilizedDirections: [],
    abandonedDirections: [],
    arcs: [],
  },
  sittings: [],
};

describe("storeSessionDigest — ON CONFLICT source_hash", () => {
  beforeEach(() => {
    callCount = 0;
    vi.clearAllMocks();
    // Re-attach implementation after clearAllMocks
    mockSqlConflict.mockImplementation((..._args: unknown[]) => {
      callCount++;
      if (callCount === 1) return Promise.resolve(conflictResult);
      return Promise.resolve(normalResult);
    });
  });

  it("resolves without throwing when the session INSERT conflicts", async () => {
    await expect(storeSessionDigest(minimalDigest)).resolves.toEqual({ stored: false });
  });

  it("makes exactly one SQL call (the session INSERT) when source_hash conflicts", async () => {
    await storeSessionDigest(minimalDigest);
    // Only the sessions INSERT should have been called — no child inserts
    expect(callCount).toBe(1);
  });

  it("logs the concurrent-digest warning to stderr on conflict", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await storeSessionDigest(minimalDigest);
    const written = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain("concurrent digest detected");
    stderrSpy.mockRestore();
  });
});
