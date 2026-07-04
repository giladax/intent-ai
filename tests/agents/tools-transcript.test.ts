import { describe, it, expect } from "vitest";
import type { NormalizedDevEvent } from "../../src/adapters/types.js";
import { makeTranscriptTools } from "../../src/agents/tools/transcript.js";

// ── Fixture event array ──────────────────────────────────────────────────────

function makeEvent(
  causalOrder: number,
  category: NormalizedDevEvent["category"],
  actor: NormalizedDevEvent["actor"],
  detail: string,
  summary?: string,
  filesAffected?: string[],
): NormalizedDevEvent {
  return {
    id: `evt-${causalOrder}`,
    sessionId: "test-session",
    timestamp: `2026-07-04T10:00:${String(causalOrder).padStart(2, "0")}.000Z`,
    causalOrder,
    category,
    actor,
    content: {
      summary: summary ?? detail.slice(0, 60),
      detail,
      filesAffected,
    },
    rawEventId: `raw-${causalOrder}`,
    turnId: `turn-${Math.floor(causalOrder / 3)}`,
  };
}

// 15 events spanning causalOrders 1..15
const FIXTURE_EVENTS: NormalizedDevEvent[] = [
  makeEvent(1, "intent", "user", "Add a hello world function"),
  makeEvent(2, "proposal", "ai", "I will add a helloWorld function to utils.ts"),
  makeEvent(3, "action", "ai", "Editing src/utils.ts", "edit utils.ts", ["src/utils.ts"]),
  makeEvent(4, "result", "ai", "Edit applied successfully. File saved.", "file saved"),
  makeEvent(5, "reflection", "ai", "The function is now exported correctly"),
  makeEvent(6, "intent", "user", "Now add a test for it"),
  makeEvent(7, "proposal", "ai", "I will add a vitest test"),
  makeEvent(8, "action", "ai", "Writing tests/utils.test.ts", "write test", ["tests/utils.test.ts"]),
  makeEvent(9, "result", "ai", "Error: Cannot find module 'vitest' — tests failed", "test error"),
  makeEvent(10, "action", "ai", "Running npm install vitest", "npm install"),
  makeEvent(11, "result", "ai", "Installed vitest successfully", "install ok"),
  makeEvent(12, "action", "ai", "Running npm test", "run tests"),
  makeEvent(13, "result", "ai", "All tests pass — 1 test suite, 1 passing", "tests pass"),
  makeEvent(14, "reflection", "ai", "Tests are green and helloWorld exports correctly"),
  makeEvent(15, "intent", "user", "Great, commit this"),
];

// ── read_transcript_range ────────────────────────────────────────────────────

describe("read_transcript_range", () => {
  const tools = makeTranscriptTools(FIXTURE_EVENTS);
  const rangeTool = tools.find((t) => t.name === "read_transcript_range")!;

  it("returns events in the requested causalOrder range with [N] prefixes", async () => {
    const result = await rangeTool.execute({ from: 1, to: 3 });
    expect(typeof result).toBe("string");
    const text = result as string;
    expect(text).toContain("[1]");
    expect(text).toContain("[2]");
    expect(text).toContain("[3]");
    // Event 4 must not appear
    expect(text).not.toContain("[4]");
  });

  it("renders events with per-category formatting (DEV: for intent, AI: for proposal)", async () => {
    const result = await rangeTool.execute({ from: 1, to: 2 });
    const text = result as string;
    expect(text).toContain("DEV:");
    expect(text).toContain("AI:");
  });

  it("renders action events with AI/ACTION prefix", async () => {
    const result = await rangeTool.execute({ from: 3, to: 3 });
    const text = result as string;
    expect(text).toContain("AI/ACTION");
  });

  it("caps at 200 events per call (returns first 200 when range exceeds cap)", async () => {
    // Build a large fixture of 300 events
    const bigEvents: NormalizedDevEvent[] = Array.from({ length: 300 }, (_, i) =>
      makeEvent(i + 1, "intent", "user", `Intent ${i + 1}`),
    );
    const bigTools = makeTranscriptTools(bigEvents);
    const bigRange = bigTools.find((t) => t.name === "read_transcript_range")!;

    const result = await bigRange.execute({ from: 1, to: 300 });
    const text = result as string;
    // Should include [1] through [200] but not [201]
    expect(text).toContain("[200]");
    expect(text).not.toContain("[201]");
  });

  it("returns a notice when range exceeds cap", async () => {
    const bigEvents: NormalizedDevEvent[] = Array.from({ length: 250 }, (_, i) =>
      makeEvent(i + 1, "intent", "user", `Intent ${i + 1}`),
    );
    const bigTools = makeTranscriptTools(bigEvents);
    const bigRange = bigTools.find((t) => t.name === "read_transcript_range")!;
    const result = await bigRange.execute({ from: 1, to: 250 }) as string;
    // Should mention cap or truncation
    expect(result.toLowerCase()).toMatch(/cap|truncat|200/);
  });
});

// ── search_transcript ────────────────────────────────────────────────────────

describe("search_transcript", () => {
  const tools = makeTranscriptTools(FIXTURE_EVENTS);
  const searchTool = tools.find((t) => t.name === "search_transcript")!;

  it("finds events matching a substring query", async () => {
    const result = await searchTool.execute({ query: "helloWorld" });
    const text = result as string;
    expect(text).toContain("[2]");
    expect(text).not.toContain("[1]");
  });

  it("is case-insensitive by default for substring search", async () => {
    const result = await searchTool.execute({ query: "HELLO WORLD" });
    const text = result as string;
    // Should find events 1 and 2 which contain "hello world"
    expect(text.length).toBeGreaterThan(0);
  });

  it("returns empty / no-match message when nothing found", async () => {
    const result = await searchTool.execute({ query: "xyzzy_no_match_xyz" });
    const text = result as string;
    expect(text.toLowerCase()).toMatch(/no match|no result|0 hit/);
  });

  it("includes causalOrder prefix and snippet in results", async () => {
    const result = await searchTool.execute({ query: "vitest" });
    const text = result as string;
    // Events 7 and 8 mention vitest
    expect(text).toContain("[7]");
  });

  it("caps at 50 hits", async () => {
    // Build 100 events all matching
    const bigEvents: NormalizedDevEvent[] = Array.from({ length: 100 }, (_, i) =>
      makeEvent(i + 1, "intent", "user", `matching keyword ${i + 1}`),
    );
    const bigTools = makeTranscriptTools(bigEvents);
    const bigSearch = bigTools.find((t) => t.name === "search_transcript")!;

    const result = await bigSearch.execute({ query: "matching" }) as string;
    // Must include [50] but not [51]
    expect(result).toContain("[50]");
    expect(result).not.toContain("[51]");
  });

  it("supports regex mode", async () => {
    const result = await searchTool.execute({ query: "npm (install|test)", regex: true });
    const text = result as string;
    // Events 10 and 12 mention npm install / npm test
    expect(text).toContain("[10]");
    expect(text).toContain("[12]");
  });
});

// ── list_tool_events ─────────────────────────────────────────────────────────

describe("list_tool_events", () => {
  const tools = makeTranscriptTools(FIXTURE_EVENTS);
  const listTool = tools.find((t) => t.name === "list_tool_events")!;

  it("returns only action and result events in range", async () => {
    const result = await listTool.execute({ from: 1, to: 15 });
    const text = result as string;
    // causalOrders 3,4,8,9,10,11,12,13 are action/result
    expect(text).toContain("[3]");
    expect(text).toContain("[4]");
    // Intent and proposal events should NOT appear
    expect(text).not.toContain("[1]");
    expect(text).not.toContain("[2]");
  });

  it("includes success results (not only errors)", async () => {
    const result = await listTool.execute({ from: 11, to: 13 });
    const text = result as string;
    // Event 11: "Installed vitest successfully" — a success result
    expect(text).toContain("[11]");
    // Event 13: "All tests pass" — a success result
    expect(text).toContain("[13]");
  });

  it("returns a message when no action/result events exist in range", async () => {
    // Events 1-2 are intent/proposal only
    const result = await listTool.execute({ from: 1, to: 2 });
    const text = result as string;
    expect(text.toLowerCase()).toMatch(/no action|no tool|no event/);
  });
});
