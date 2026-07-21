/**
 * Normalizer — converts raw hook payloads and JSONL lines into ObservedEvent[].
 *
 * Two entry points:
 *   normalizeHook   — one hook body  → one ObservedEvent
 *   normalizeJsonlLine — one JSONL line → ObservedEvent[] (content blocks explode)
 */

import type { ObservedEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Hook event name → ObservedEvent kind
// ---------------------------------------------------------------------------

const HOOK_KIND_MAP: Record<string, string> = {
  UserPromptSubmit: "user_prompt",
  PostToolUse: "tool_result",
  PostToolUseFailure: "tool_failure",
  Stop: "assistant_stop",
  SessionStart: "session_start",
  SessionEnd: "session_end",
};

// ---------------------------------------------------------------------------
// normalizeHook
// ---------------------------------------------------------------------------

export function normalizeHook(body: Record<string, unknown>): ObservedEvent {
  const hookName = body.hook_event_name as string | undefined;
  const kind = (hookName && HOOK_KIND_MAP[hookName]) ?? "raw";

  return {
    source: "hook",
    sessionId: (body.session_id as string) ?? null,
    kind,
    ts: Date.now(),
    transcriptPath: body.transcript_path as string | undefined,
    raw: body,
    toolName: body.tool_name as string | undefined,
    toolInput: body.tool_input as unknown,
    toolResponse: body.tool_response as unknown,
    toolUseId: body.tool_use_id as string | undefined,
    prompt: body.prompt as string | undefined,
  };
}

// ---------------------------------------------------------------------------
// normalizeJsonlLine
// ---------------------------------------------------------------------------

export function normalizeJsonlLine(
  line: Record<string, unknown>,
): ObservedEvent[] {
  const sessionId = (line.sessionId as string) ?? null;
  const ts = Date.now();
  const base = { source: "jsonl" as const, sessionId, ts, raw: line };

  const type = line.type as string | undefined;

  if (type === "user") {
    return normalizeUserLine(line, base);
  }

  if (type === "assistant") {
    return normalizeAssistantLine(line, base);
  }

  // progress, file-history-snapshot, system, unknown → raw
  return [{ ...base, kind: "raw" }];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface EventBase {
  source: "jsonl";
  sessionId: string | null;
  ts: number;
  raw: unknown;
}

function normalizeUserLine(
  line: Record<string, unknown>,
  base: EventBase,
): ObservedEvent[] {
  const message = line.message as Record<string, unknown> | undefined;
  if (!message) return [{ ...base, kind: "raw" }];

  const content = message.content;

  // String content → single user_prompt
  if (typeof content === "string") {
    return [{ ...base, kind: "user_prompt", prompt: content }];
  }

  // Array of tool_result blocks
  if (Array.isArray(content)) {
    const events: ObservedEvent[] = [];
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        (block as Record<string, unknown>).type === "tool_result"
      ) {
        events.push({
          ...base,
          kind: "tool_result",
          toolUseId: (block as Record<string, unknown>).tool_use_id as
            | string
            | undefined,
        });
      }
    }
    return events.length > 0 ? events : [{ ...base, kind: "raw" }];
  }

  return [{ ...base, kind: "raw" }];
}

function normalizeAssistantLine(
  line: Record<string, unknown>,
  base: EventBase,
): ObservedEvent[] {
  const message = line.message as Record<string, unknown> | undefined;
  if (!message) return [{ ...base, kind: "raw" }];

  const content = (message.content ?? []) as Array<Record<string, unknown>>;
  if (!Array.isArray(content)) return [{ ...base, kind: "raw" }];

  const events: ObservedEvent[] = [];

  for (const block of content) {
    if (!block || typeof block !== "object") continue;

    if (block.type === "tool_use") {
      events.push({
        ...base,
        kind: "tool_call",
        toolUseId: block.id as string | undefined,
        toolName: block.name as string | undefined,
        toolInput: block.input,
      });
    } else if (block.type === "text") {
      events.push({ ...base, kind: "assistant_text" });
    }
    // skip "thinking" blocks
  }

  return events.length > 0 ? events : [{ ...base, kind: "raw" }];
}
