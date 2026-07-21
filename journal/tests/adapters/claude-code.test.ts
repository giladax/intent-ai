import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parseClaudeCodeLog } from "../../src/adapters/claude-code.js";
import type { RawDevEvent } from "../../src/adapters/types.js";

const FIXTURE_PATH = join(
  import.meta.dirname,
  "..",
  "fixtures",
  "sample-session.jsonl",
);

describe("parseClaudeCodeLog", () => {
  let events: RawDevEvent[];

  it("parses the fixture without errors", async () => {
    events = await parseClaudeCodeLog(FIXTURE_PATH);
    expect(events.length).toBeGreaterThan(0);
  });

  it("produces the expected number of events", async () => {
    events = await parseClaudeCodeLog(FIXTURE_PATH);
    // Fixture breakdown:
    //   u-001: user string → 1 conversation_turn
    //   a-001: thinking(skip) + text + tool_use → 1 ai_response + 1 tool_call
    //   u-002: tool_result array (1 block) → 1 tool_result
    //   a-002: text → 1 ai_response
    //   u-003: user string → 1 conversation_turn
    //   a-003: text + tool_use → 1 ai_response + 1 tool_call
    //   u-004: tool_result array (1 block) → 1 tool_result
    //   s-001: system → skipped
    // Total: 2 conversation_turn + 3 ai_response + 2 tool_call + 2 tool_result = 9
    expect(events).toHaveLength(9);
  });

  it("sets source to claude-code on all events", async () => {
    events = await parseClaudeCodeLog(FIXTURE_PATH);
    for (const e of events) {
      expect(e.source).toBe("claude-code");
    }
  });

  it("maps user string messages to conversation_turn", async () => {
    events = await parseClaudeCodeLog(FIXTURE_PATH);
    const turns = events.filter((e) => e.type === "conversation_turn");
    expect(turns).toHaveLength(2);
    expect(turns[0].id).toBe("u-001");
    expect(turns[1].id).toBe("u-003");
  });

  it("maps assistant text blocks to ai_response", async () => {
    events = await parseClaudeCodeLog(FIXTURE_PATH);
    const responses = events.filter((e) => e.type === "ai_response");
    expect(responses).toHaveLength(3);
    // a-001 has thinking(idx0) + text(idx1), so text index is 1
    expect(responses[0].id).toBe("a-001-text-1");
    // a-002 has text(idx0)
    expect(responses[1].id).toBe("a-002-text-0");
    // a-003 has text(idx0) + tool_use(idx1)
    expect(responses[2].id).toBe("a-003-text-0");
  });

  it("maps assistant tool_use blocks to tool_call", async () => {
    events = await parseClaudeCodeLog(FIXTURE_PATH);
    const calls = events.filter((e) => e.type === "tool_call");
    expect(calls).toHaveLength(2);
    // a-001: thinking(0) + text(1) + tool_use(2)
    expect(calls[0].id).toBe("a-001-tool-2");
    // a-003: text(0) + tool_use(1)
    expect(calls[1].id).toBe("a-003-tool-1");
  });

  it("maps user tool_result blocks to tool_result", async () => {
    events = await parseClaudeCodeLog(FIXTURE_PATH);
    const results = events.filter((e) => e.type === "tool_result");
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("u-002-result-0");
    expect(results[1].id).toBe("u-004-result-0");
  });

  it("skips thinking blocks", async () => {
    events = await parseClaudeCodeLog(FIXTURE_PATH);
    const hasThinking = events.some((e) => e.id.includes("thinking"));
    expect(hasThinking).toBe(false);
  });

  it("preserves raw log entry on each event", async () => {
    events = await parseClaudeCodeLog(FIXTURE_PATH);
    const firstTurn = events.find((e) => e.type === "conversation_turn");
    expect(firstTurn?.raw).toBeDefined();
    expect(firstTurn?.raw.uuid).toBe("u-001");
  });

  it("preserves ISO 8601 timestamps", async () => {
    events = await parseClaudeCodeLog(FIXTURE_PATH);
    for (const e of events) {
      expect(e.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    }
  });
});
