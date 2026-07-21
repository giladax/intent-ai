import { describe, it, expect } from "vitest";
import {
  globToRegExp,
  matchesAnyGlob,
  computeETC,
  extractToolCalls,
  extractToolCallsFromFile,
  EXPLORATORY_TOOLS,
  EDIT_TOOLS,
  type ToolCall,
} from "../../src/eval/transcript-metrics.js";
import type { RawDevEvent } from "../../src/adapters/types.js";

// ── Helpers ──────────────────────────────────────────────────────────

function tc(
  index: number,
  name: string,
  filePath?: string,
): ToolCall {
  return { index, name, input: filePath ? { file_path: filePath } : {}, filePath, timestamp: `t${index}` };
}

/** Build a raw tool_call event the way the adapter would emit it. */
function rawToolCall(
  uuid: string,
  blockIdx: number,
  name: string,
  input: Record<string, unknown>,
): RawDevEvent {
  return {
    id: `${uuid}-tool-${blockIdx}`,
    source: "claude-code",
    timestamp: "2026-06-27T00:00:00Z",
    type: "tool_call",
    raw: {
      message: {
        content: Array.from({ length: blockIdx + 1 }, (_, i) =>
          i === blockIdx ? { type: "tool_use", name, input } : { type: "text", text: "x" },
        ),
      },
    },
  };
}

// ── globToRegExp / matchesAnyGlob ────────────────────────────────────

describe("globToRegExp", () => {
  it("matches an exact repo-relative path as a suffix of an absolute path", () => {
    const re = globToRegExp("src/mcp/server.ts");
    expect(re.test("/Users/x/repo/src/mcp/server.ts")).toBe(true);
    expect(re.test("src/mcp/server.ts")).toBe(true);
  });

  it("* does not cross a path separator", () => {
    const re = globToRegExp("src/cli/*.ts");
    expect(re.test("/repo/src/cli/index.ts")).toBe(true);
    expect(re.test("/repo/src/cli/sub/index.ts")).toBe(false);
  });

  it("** crosses path separators", () => {
    const re = globToRegExp("src/mcp/**/*.ts");
    expect(re.test("/repo/src/mcp/server.ts")).toBe(true);
    expect(re.test("/repo/src/mcp/tools/recent.ts")).toBe(true);
  });

  it("does not match an unrelated file", () => {
    expect(matchesAnyGlob("/repo/src/web/app.ts", ["src/mcp/server.ts"])).toBe(false);
  });

  it("matchesAnyGlob is false for empty path", () => {
    expect(matchesAnyGlob("", ["src/mcp/server.ts"])).toBe(false);
  });
});

// ── computeETC ───────────────────────────────────────────────────────

describe("computeETC", () => {
  const correct = ["src/mcp/server.ts"];

  it("counts exploratory calls before the first correct edit", () => {
    const calls = [
      tc(0, "Read", "/repo/src/mcp/server.ts"),
      tc(1, "Grep"),
      tc(2, "Glob"),
      tc(3, "Edit", "/repo/src/mcp/server.ts"),
      tc(4, "Read", "/repo/other.ts"),
    ];
    const r = computeETC(calls, correct);
    expect(r.etc).toBe(3);
    expect(r.reachedCorrectEdit).toBe(true);
    expect(r.firstCorrectEditIndex).toBe(3);
  });

  it("does not count non-exploratory tools (e.g. Bash) toward ETC", () => {
    const calls = [
      tc(0, "Bash"),
      tc(1, "Read", "/repo/src/mcp/server.ts"),
      tc(2, "Bash"),
      tc(3, "Write", "/repo/src/mcp/server.ts"),
    ];
    const r = computeETC(calls, correct);
    expect(r.etc).toBe(1);
  });

  it("an edit to a WRONG file does not stop the count", () => {
    const calls = [
      tc(0, "Read", "/repo/a.ts"),
      tc(1, "Edit", "/repo/src/web/wrong.ts"),
      tc(2, "Grep"),
      tc(3, "Edit", "/repo/src/mcp/server.ts"),
    ];
    const r = computeETC(calls, correct);
    // exploratory before the correct edit: Read(0) + Grep(2) = 2
    expect(r.etc).toBe(2);
    expect(r.firstCorrectEditIndex).toBe(3);
  });

  it("reports reachedCorrectEdit=false and total exploratory when no correct edit", () => {
    const calls = [
      tc(0, "Read", "/repo/a.ts"),
      tc(1, "Grep"),
      tc(2, "Edit", "/repo/src/web/wrong.ts"),
    ];
    const r = computeETC(calls, correct);
    expect(r.reachedCorrectEdit).toBe(false);
    expect(r.etc).toBe(2);
    expect(r.firstCorrectEditIndex).toBe(-1);
  });

  it("ETC is 0 when the first action is a correct edit", () => {
    const r = computeETC([tc(0, "Write", "/repo/src/mcp/server.ts")], correct);
    expect(r.etc).toBe(0);
    expect(r.reachedCorrectEdit).toBe(true);
  });

  it("taxonomy sets are disjoint and populated", () => {
    expect(EXPLORATORY_TOOLS.has("Read")).toBe(true);
    expect(EDIT_TOOLS.has("Edit")).toBe(true);
    for (const t of EDIT_TOOLS) expect(EXPLORATORY_TOOLS.has(t)).toBe(false);
  });
});

// ── extractToolCalls ─────────────────────────────────────────────────

describe("extractToolCalls", () => {
  it("recovers tool name + file_path from raw events by block index", () => {
    const events: RawDevEvent[] = [
      rawToolCall("u1", 0, "Read", { file_path: "/repo/a.ts" }),
      rawToolCall("u2", 1, "Edit", { file_path: "/repo/b.ts" }),
    ];
    const calls = extractToolCalls(events);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ name: "Read", filePath: "/repo/a.ts", index: 0 });
    expect(calls[1]).toMatchObject({ name: "Edit", filePath: "/repo/b.ts", index: 1 });
  });

  it("ignores non tool_call events", () => {
    const events: RawDevEvent[] = [
      { id: "x", source: "claude-code", timestamp: "t", type: "conversation_turn", raw: {} },
      rawToolCall("u1", 0, "Grep", {}),
    ];
    const calls = extractToolCalls(events);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("Grep");
    expect(calls[0].filePath).toBeUndefined();
  });
});

// ── Integration: real fixture ────────────────────────────────────────

describe("extractToolCallsFromFile (real fixture)", () => {
  it("extracts ordered tool calls from a Claude Code JSONL", async () => {
    const calls = await extractToolCallsFromFile(
      "tests/eval/fixtures/scope-implementation.jsonl",
    );
    expect(calls.length).toBeGreaterThan(0);

    const names = new Set(calls.map((c) => c.name));
    expect(names.has("Read")).toBe(true);
    expect(names.has("Edit") || names.has("Write")).toBe(true);

    // Edits should carry a file_path
    const edits = calls.filter((c) => EDIT_TOOLS.has(c.name));
    expect(edits.some((e) => typeof e.filePath === "string")).toBe(true);

    // indices are strictly increasing
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i].index).toBe(calls[i - 1].index + 1);
    }
  });

  it("computeETC runs end-to-end on a real fixture", async () => {
    const calls = await extractToolCallsFromFile(
      "tests/eval/fixtures/scope-implementation.jsonl",
    );
    // Pick a file actually edited in the fixture as the "correct" target.
    const firstEdit = calls.find(
      (c) => EDIT_TOOLS.has(c.name) && c.filePath,
    );
    expect(firstEdit).toBeDefined();
    const r = computeETC(calls, [firstEdit!.filePath!]);
    expect(r.reachedCorrectEdit).toBe(true);
    expect(r.etc).toBeGreaterThanOrEqual(0);
    expect(r.etc).toBeLessThanOrEqual(r.totalExploratory);
  });
});

// ── ETC v2: brain reads cost exploration (fixes F3) ──────────────────

describe("ETC v2 — symmetric exploration accounting", () => {
  it("brain MCP read tools count toward ETC like Grep does", async () => {
    const { BRAIN_READ_TOOLS } = await import(
      "../../src/eval/transcript-metrics.js"
    );
    for (const tool of BRAIN_READ_TOOLS) {
      expect(EXPLORATORY_TOOLS.has(tool), `${tool} must be exploratory`).toBe(true);
    }

    const calls: ToolCall[] = [
      tc(0, "mcp__intent-brain__brain_enter"),
      tc(1, "mcp__intent-brain__brain_feature_context"),
      tc(2, "Edit", "/repo/src/mcp/server.ts"),
    ];
    const result = computeETC(calls, ["src/mcp/server.ts"]);
    expect(result.etc).toBe(2); // both brain reads paid for
    expect(result.reachedCorrectEdit).toBe(true);
  });

  it("brain WRITE tools do not count as exploration", () => {
    const writes = [
      "mcp__intent-brain__brain_report_observation",
      "mcp__intent-brain__brain_report_unknown",
      "mcp__intent-brain__brain_rate_context",
      "mcp__intent-brain__brain_propose_knowledge_delta",
    ];
    for (const tool of writes) {
      expect(EXPLORATORY_TOOLS.has(tool), `${tool} must not be exploratory`).toBe(false);
    }
  });
});

// ── Tokens-to-completion ─────────────────────────────────────────────

describe("extractTokenTotals", () => {
  it("sums usage across assistant messages, deduping per raw message", async () => {
    const { extractTokenTotals } = await import(
      "../../src/eval/transcript-metrics.js"
    );
    const sharedRaw = {
      message: {
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 1000,
          cache_creation_input_tokens: 20,
        },
        content: [],
      },
    };
    const events: RawDevEvent[] = [
      // two events from the SAME assistant message (text + tool blocks)
      { id: "u1-text-0", source: "claude-code", timestamp: "t", type: "ai_response", raw: sharedRaw },
      { id: "u1-tool-1", source: "claude-code", timestamp: "t", type: "tool_call", raw: sharedRaw },
      // a second message
      {
        id: "u2-text-0",
        source: "claude-code",
        timestamp: "t",
        type: "ai_response",
        raw: { message: { usage: { input_tokens: 10, output_tokens: 5 }, content: [] } },
      },
      // a user message with no usage
      { id: "u3", source: "claude-code", timestamp: "t", type: "conversation_turn", raw: { message: {} } },
    ];
    const totals = extractTokenTotals(events);
    expect(totals.inputTokens).toBe(110);
    expect(totals.outputTokens).toBe(55);
    expect(totals.cacheReadTokens).toBe(1000);
    expect(totals.cacheCreationTokens).toBe(20);
    expect(totals.total).toBe(165);
  });

  it("returns zeros for an empty transcript", async () => {
    const { extractTokenTotals } = await import(
      "../../src/eval/transcript-metrics.js"
    );
    expect(extractTokenTotals([]).total).toBe(0);
  });
});
