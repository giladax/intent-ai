import { describe, it, expect } from "vitest";
import { normalize } from "../../src/pipeline/normalize.js";
import type { RawDevEvent } from "../../src/adapters/types.js";

/**
 * Build a minimal RawDevEvent sequence that exercises all category rules:
 *
 * 1. User message           → intent
 * 2. AI text (before tool)  → proposal
 * 3. AI tool_call (Edit)    → action
 * 4. Tool result            → result
 * 5. AI text (after result) → reflection
 * 6. AI tool_call (Read)    → reflection
 */
function buildTestSequence(): RawDevEvent[] {
  const base = { source: "claude-code" as const };

  return [
    // 1. User message → intent
    {
      ...base,
      id: "u-001",
      timestamp: "2026-05-20T10:00:01.000Z",
      type: "conversation_turn",
      raw: {
        message: { content: "Add a hello world function to utils.ts" },
      },
    },
    // 2. AI text before tool calls → proposal
    {
      ...base,
      id: "a-001-text-0",
      timestamp: "2026-05-20T10:00:02.000Z",
      type: "ai_response",
      raw: {
        message: {
          content: [
            { type: "text", text: "I'll add a hello world function." },
            {
              type: "tool_use",
              name: "Edit",
              input: { file_path: "src/utils.ts" },
            },
          ],
        },
      },
    },
    // 3. AI tool_call (Edit — state-modifying) → action
    {
      ...base,
      id: "a-001-tool-1",
      timestamp: "2026-05-20T10:00:02.000Z",
      type: "tool_call",
      raw: {
        message: {
          content: [
            { type: "text", text: "I'll add a hello world function." },
            {
              type: "tool_use",
              name: "Edit",
              input: {
                file_path: "src/utils.ts",
                old_string: "",
                new_string: "export function hello() { return 'hello world'; }",
              },
            },
          ],
        },
      },
    },
    // 4. Tool result → result
    {
      ...base,
      id: "u-002-result-0",
      timestamp: "2026-05-20T10:00:03.000Z",
      type: "tool_result",
      raw: {
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu-001",
              content: [{ type: "text", text: "File edited successfully" }],
            },
          ],
        },
      },
    },
    // 5. AI text after tool result → reflection
    {
      ...base,
      id: "a-002-text-0",
      timestamp: "2026-05-20T10:00:04.000Z",
      type: "ai_response",
      raw: {
        message: {
          content: [
            {
              type: "text",
              text: "Done! I've added the hello world function to utils.ts.",
            },
          ],
        },
      },
    },
    // 6. AI tool_call (Read — read-only) → reflection
    {
      ...base,
      id: "a-003-tool-0",
      timestamp: "2026-05-20T10:00:05.000Z",
      type: "tool_call",
      raw: {
        message: {
          content: [
            {
              type: "tool_use",
              name: "Read",
              input: { file_path: "src/utils.ts" },
            },
          ],
        },
      },
    },
  ];
}

describe("normalize", () => {
  const sessionId = "test-session-001";
  const events = buildTestSequence();
  const normalized = normalize(events, sessionId);

  it("produces one NormalizedDevEvent per input event", () => {
    expect(normalized).toHaveLength(6);
  });

  it("assigns sequential causalOrder starting at 0", () => {
    const orders = normalized.map((e) => e.causalOrder);
    expect(orders).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("sets sessionId on all events", () => {
    for (const e of normalized) {
      expect(e.sessionId).toBe(sessionId);
    }
  });

  it("links rawEventId back to the original event", () => {
    expect(normalized[0].rawEventId).toBe("u-001");
    expect(normalized[1].rawEventId).toBe("a-001-text-0");
    expect(normalized[2].rawEventId).toBe("a-001-tool-1");
  });

  // ── Category mapping ────────────────────────────────────────────────

  it("classifies user message as intent", () => {
    expect(normalized[0].category).toBe("intent");
    expect(normalized[0].actor).toBe("user");
  });

  it("classifies AI text before tool calls as proposal", () => {
    expect(normalized[1].category).toBe("proposal");
    expect(normalized[1].actor).toBe("ai");
  });

  it("classifies Edit tool_call as action", () => {
    expect(normalized[2].category).toBe("action");
    expect(normalized[2].actor).toBe("ai");
  });

  it("classifies tool_result as result", () => {
    expect(normalized[3].category).toBe("result");
    expect(normalized[3].actor).toBe("user");
  });

  it("classifies AI text after tool_result as reflection", () => {
    expect(normalized[4].category).toBe("reflection");
    expect(normalized[4].actor).toBe("ai");
  });

  it("classifies Read tool_call as reflection (read-only tool)", () => {
    expect(normalized[5].category).toBe("reflection");
    expect(normalized[5].actor).toBe("ai");
  });

  // ── Content extraction ──────────────────────────────────────────────

  it("generates summary for user messages (truncated to 200 chars)", () => {
    expect(normalized[0].content.summary).toBe(
      "Add a hello world function to utils.ts",
    );
    expect(normalized[0].content.detail).toBe(
      "Add a hello world function to utils.ts",
    );
  });

  it("generates summary for AI text responses", () => {
    expect(normalized[1].content.summary).toBe(
      "I'll add a hello world function.",
    );
  });

  it("generates tool summary with file path", () => {
    expect(normalized[2].content.summary).toBe("Tool: Edit on src/utils.ts");
    expect(normalized[2].content.filesAffected).toEqual(["src/utils.ts"]);
  });

  it("generates tool summary without file path for Read", () => {
    expect(normalized[5].content.summary).toBe("Tool: Read on src/utils.ts");
    expect(normalized[5].content.filesAffected).toEqual(["src/utils.ts"]);
  });

  it("extracts tool result text", () => {
    expect(normalized[3].content.summary).toBe("File edited successfully");
  });

  // ── Edge cases ──────────────────────────────────────────────────────

  it("filters out events with no meaningful content", () => {
    const emptyEvents: RawDevEvent[] = [
      {
        id: "empty-1",
        source: "claude-code",
        timestamp: "2026-05-20T10:00:00.000Z",
        type: "conversation_turn",
        raw: { message: { content: [] } }, // array, not string → null
      },
    ];
    const result = normalize(emptyEvents, "s-empty");
    expect(result).toHaveLength(0);
  });

  it("truncates long summaries to 200 characters", () => {
    const longText = "x".repeat(500);
    const longEvents: RawDevEvent[] = [
      {
        id: "long-1",
        source: "claude-code",
        timestamp: "2026-05-20T10:00:00.000Z",
        type: "conversation_turn",
        raw: { message: { content: longText } },
      },
    ];
    const result = normalize(longEvents, "s-long");
    expect(result[0].content.summary).toHaveLength(200);
    expect(result[0].content.detail).toHaveLength(500);
  });

  // ── State-modifying tool classification ─────────────────────────────

  it("classifies Write, Bash, NotebookEdit as action", () => {
    const tools = ["Write", "Bash", "NotebookEdit"];
    for (const toolName of tools) {
      const toolEvents: RawDevEvent[] = [
        {
          id: `t-${toolName}-tool-0`,
          source: "claude-code",
          timestamp: "2026-05-20T10:00:00.000Z",
          type: "tool_call",
          raw: {
            message: {
              content: [{ type: "tool_use", name: toolName, input: {} }],
            },
          },
        },
      ];
      const result = normalize(toolEvents, `s-${toolName}`);
      expect(result[0].category).toBe("action");
    }
  });

  it("classifies Glob, Grep, Agent as reflection", () => {
    const tools = ["Glob", "Grep", "Agent"];
    for (const toolName of tools) {
      const toolEvents: RawDevEvent[] = [
        {
          id: `t-${toolName}-tool-0`,
          source: "claude-code",
          timestamp: "2026-05-20T10:00:00.000Z",
          type: "tool_call",
          raw: {
            message: {
              content: [{ type: "tool_use", name: toolName, input: {} }],
            },
          },
        },
      ];
      const result = normalize(toolEvents, `s-${toolName}`);
      expect(result[0].category).toBe("reflection");
    }
  });
});
