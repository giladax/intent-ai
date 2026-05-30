import { describe, it, expect } from "vitest";
import { normalizeHook, normalizeJsonlLine } from "../../src/daemon/normalizer.js";

// -------------------------------------------------------------------------
// normalizeHook
// -------------------------------------------------------------------------

describe("normalizeHook", () => {
  it("PostToolUse → kind=tool_result with toolName and toolUseId", () => {
    const body = {
      hook_event_name: "PostToolUse",
      session_id: "sess-abc",
      transcript_path: "/tmp/transcript.jsonl",
      tool_name: "Read",
      tool_use_id: "tu-123",
      tool_input: { file_path: "/src/index.ts" },
      tool_response: "file contents...",
    };
    const evt = normalizeHook(body);

    expect(evt.kind).toBe("tool_result");
    expect(evt.source).toBe("hook");
    expect(evt.sessionId).toBe("sess-abc");
    expect(evt.toolName).toBe("Read");
    expect(evt.toolUseId).toBe("tu-123");
    expect(evt.toolInput).toEqual({ file_path: "/src/index.ts" });
    expect(evt.toolResponse).toBe("file contents...");
    expect(evt.transcriptPath).toBe("/tmp/transcript.jsonl");
    expect(evt.raw).toBe(body);
    expect(typeof evt.ts).toBe("number");
  });

  it("UserPromptSubmit → kind=user_prompt with prompt", () => {
    const body = {
      hook_event_name: "UserPromptSubmit",
      session_id: "sess-abc",
      prompt: "Add a hello world function",
    };
    const evt = normalizeHook(body);

    expect(evt.kind).toBe("user_prompt");
    expect(evt.prompt).toBe("Add a hello world function");
    expect(evt.sessionId).toBe("sess-abc");
  });

  it("SessionStart → kind=session_start with sessionId", () => {
    const body = {
      hook_event_name: "SessionStart",
      session_id: "sess-xyz",
      transcript_path: "/tmp/t.jsonl",
    };
    const evt = normalizeHook(body);

    expect(evt.kind).toBe("session_start");
    expect(evt.sessionId).toBe("sess-xyz");
  });

  it("unknown hook_event_name → kind=raw", () => {
    const body = {
      hook_event_name: "SomeFutureHook",
      session_id: "sess-abc",
    };
    const evt = normalizeHook(body);

    expect(evt.kind).toBe("raw");
    expect(evt.raw).toBe(body);
  });

  it("missing hook_event_name → kind=raw", () => {
    const body = { session_id: "sess-abc" };
    const evt = normalizeHook(body);

    expect(evt.kind).toBe("raw");
  });
});

// -------------------------------------------------------------------------
// normalizeJsonlLine
// -------------------------------------------------------------------------

describe("normalizeJsonlLine", () => {
  it("user string message → 1 event, kind=user_prompt with prompt set", () => {
    const line = {
      type: "user",
      sessionId: "sess-test",
      message: {
        role: "user",
        content: "Add a hello world function to utils.ts",
      },
    };
    const events = normalizeJsonlLine(line);

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("user_prompt");
    expect(events[0].prompt).toBe("Add a hello world function to utils.ts");
    expect(events[0].source).toBe("jsonl");
    expect(events[0].sessionId).toBe("sess-test");
  });

  it("user tool_result message → 1 event per block, kind=tool_result with toolUseId", () => {
    const line = {
      type: "user",
      sessionId: "sess-test",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu-001",
            content: [{ type: "text", text: "File edited successfully" }],
          },
          {
            type: "tool_result",
            tool_use_id: "tu-002",
            content: "File created successfully",
          },
        ],
      },
    };
    const events = normalizeJsonlLine(line);

    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe("tool_result");
    expect(events[0].toolUseId).toBe("tu-001");
    expect(events[1].kind).toBe("tool_result");
    expect(events[1].toolUseId).toBe("tu-002");
  });

  it("assistant with text + tool_use + thinking → 2 events (thinking skipped)", () => {
    const line = {
      type: "assistant",
      sessionId: "sess-test",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Let me think about this..." },
          { type: "text", text: "I'll add a hello world function." },
          {
            type: "tool_use",
            id: "tu-001",
            name: "Edit",
            input: { file_path: "src/utils.ts", old_string: "", new_string: "export function hello() {}" },
          },
        ],
      },
    };
    const events = normalizeJsonlLine(line);

    expect(events).toHaveLength(2);

    const textEvt = events.find((e) => e.kind === "assistant_text");
    expect(textEvt).toBeDefined();
    expect(textEvt!.source).toBe("jsonl");

    const toolEvt = events.find((e) => e.kind === "tool_call");
    expect(toolEvt).toBeDefined();
    expect(toolEvt!.toolUseId).toBe("tu-001");
    expect(toolEvt!.toolName).toBe("Edit");
    expect(toolEvt!.toolInput).toEqual({
      file_path: "src/utils.ts",
      old_string: "",
      new_string: "export function hello() {}",
    });
  });

  it("progress line → 1 event, kind=raw", () => {
    const line = {
      type: "progress",
      sessionId: "sess-test",
      data: { step: 3 },
    };
    const events = normalizeJsonlLine(line);

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("raw");
    expect(events[0].source).toBe("jsonl");
  });

  it("unknown type → 1 event, kind=raw", () => {
    const line = {
      type: "file-history-snapshot",
      sessionId: "sess-test",
      files: ["a.ts"],
    };
    const events = normalizeJsonlLine(line);

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("raw");
  });

  it("missing type → 1 event, kind=raw", () => {
    const line = { sessionId: "sess-test", something: "else" };
    const events = normalizeJsonlLine(line);

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("raw");
  });

  it("all events carry raw = original line", () => {
    const line = {
      type: "user",
      sessionId: "sess-test",
      message: { role: "user", content: "hello" },
    };
    const events = normalizeJsonlLine(line);
    expect(events[0].raw).toBe(line);
  });
});
