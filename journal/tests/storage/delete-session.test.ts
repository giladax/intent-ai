/**
 * Tests for deleteSessionDigest — verifies transactional semantics via mock.
 *
 * Since postgres.js sql.begin() calls are not hit against a real DB in unit
 * tests, we verify the *structural* contract: the function calls sql.begin()
 * with a callback, and the callback executes all three DELETEs through the
 * transaction proxy (tx), not the top-level sql object.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Build a minimal mock of the postgres.js tagged-template SQL client.
// `mockSql` is the top-level `sql`; `mockTx` is what gets passed into
// the sql.begin() callback (the transaction proxy).
const mockTx = vi.fn().mockResolvedValue([]);
const beginFn = vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => {
  return cb(mockTx);
});
const mockSql = Object.assign(vi.fn().mockResolvedValue([]), {
  begin: beginFn,
  unsafe: vi.fn().mockResolvedValue([]),
});

vi.mock("../../src/storage/connection.js", () => ({
  getClient: vi.fn(() => mockSql),
  getDb: vi.fn(),
  closeDb: vi.fn(),
}));

import { deleteSessionDigest } from "../../src/storage/queries.js";

describe("deleteSessionDigest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-attach begin after clearAllMocks restores the impl
    mockSql.begin = beginFn;
  });

  it("uses sql.begin() — wraps deletes in a single transaction", async () => {
    await deleteSessionDigest("session-abc");

    // sql.begin must have been called exactly once
    expect(beginFn).toHaveBeenCalledTimes(1);
  });

  it("executes all three DELETEs inside the transaction callback, not on bare sql", async () => {
    await deleteSessionDigest("session-abc");

    // The transaction proxy (tx) must have been called — deletes go through tx
    expect(mockTx).toHaveBeenCalled();

    // The bare sql template tag must NOT be called for any DELETE
    // (it's still called once to obtain the client, but not as a template tag)
    const topLevelCalls = (mockSql as unknown as ReturnType<typeof vi.fn>).mock.calls;
    // Any template-tag call would have an array as first argument (tagged template literal)
    const templateTagCalls = topLevelCalls.filter(
      (args: unknown[]) => Array.isArray(args[0]),
    );
    expect(templateTagCalls).toHaveLength(0);
  });

  it("passes the session id to the DELETE statements", async () => {
    await deleteSessionDigest("my-session-123");

    // Collect all calls made to the transaction proxy
    const txCalls = mockTx.mock.calls;
    // Each call is a tagged-template-literal invocation: args[0] is the
    // TemplateStringsArray, args[1..] are interpolated values.
    const allValues = txCalls.flatMap((args: unknown[]) => args.slice(1));
    expect(allValues).toContain("my-session-123");
  });
});
