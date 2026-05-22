import type { RawDevEvent, NormalizedDevEvent } from "../adapters/types.js";

// Tools that modify state — their tool_call events are categorized as "action"
const STATE_MODIFYING_TOOLS = new Set([
  "Edit",
  "Write",
  "Bash",
  "NotebookEdit",
]);

// Tools that read state — their tool_call events are categorized as "reflection"
// (Read, Glob, Grep, Agent, Explore, WebSearch, WebFetch, etc.)

/**
 * Normalize a sequence of RawDevEvents into NormalizedDevEvents.
 *
 * Assigns causal order, classifies each event into a semantic category,
 * extracts content summaries, and filters out events with no meaningful content.
 */
export function normalize(
  events: RawDevEvent[],
  sessionId: string,
): NormalizedDevEvent[] {
  // ── Pass 1: classify + extract content ──────────────────────────────
  const result: NormalizedDevEvent[] = [];
  let causalOrder = 0;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const extracted = extractContent(event);

    // Filter out events with no meaningful content
    if (!extracted) continue;

    const { category, actor } = classify(event, events, i);

    result.push({
      id: `${sessionId}-${causalOrder}`,
      sessionId,
      timestamp: event.timestamp,
      causalOrder,
      category,
      actor,
      content: extracted,
      rawEventId: event.id,
      turnId: deriveTurnId(event.id),
    });

    causalOrder++;
  }

  // ── Pass 2: assign respondingTo ─────────────────────────────────────
  assignRespondingTo(result, events);

  return result;
}

// ── Classification ───────────────────────────────────────────────────

type Classification = {
  category: NormalizedDevEvent["category"];
  actor: NormalizedDevEvent["actor"];
};

function classify(
  event: RawDevEvent,
  events: RawDevEvent[],
  index: number,
): Classification {
  switch (event.type) {
    case "conversation_turn":
      return { category: "intent", actor: "user" };

    case "tool_result":
      return { category: "result", actor: "user" };

    case "tool_call":
      return {
        category: isStateModifying(event) ? "action" : "reflection",
        actor: "ai",
      };

    case "ai_response":
      return {
        category: isAfterToolResult(events, index)
          ? "reflection"
          : "proposal",
        actor: "ai",
      };
  }
}

/**
 * Check whether a tool_call event uses a state-modifying tool.
 */
function isStateModifying(event: RawDevEvent): boolean {
  const toolName = getToolName(event);
  return toolName !== undefined && STATE_MODIFYING_TOOLS.has(toolName);
}

/**
 * An ai_response is a "reflection" if the most recent non-ai_response event
 * before it (scanning backwards) is a tool_result. Otherwise it's a "proposal".
 */
function isAfterToolResult(events: RawDevEvent[], index: number): boolean {
  for (let j = index - 1; j >= 0; j--) {
    const prev = events[j];
    // Skip over other ai_response events in the same message
    if (prev.type === "ai_response") continue;
    return prev.type === "tool_result";
  }
  return false;
}

// ── Content Extraction ───────────────────────────────────────────────

function extractContent(
  event: RawDevEvent,
): NormalizedDevEvent["content"] | null {
  const raw = event.raw;

  switch (event.type) {
    case "conversation_turn": {
      const text = getUserText(raw);
      if (!text) return null;
      return {
        summary: truncate(text, 200),
        detail: text,
      };
    }

    case "ai_response": {
      const text = getAiText(event);
      if (!text) return null;
      return {
        summary: truncate(text, 200),
        detail: text,
      };
    }

    case "tool_call": {
      const toolName = getToolName(event);
      const input = getToolInput(event);
      if (!toolName) return null;

      const filePath = extractFilePath(input);
      const summary = filePath
        ? `Tool: ${toolName} on ${filePath}`
        : `Tool: ${toolName}`;
      const detail = input ? JSON.stringify(input) : summary;
      const filesAffected = filePath ? [filePath] : undefined;

      return { summary: truncate(summary, 200), detail, filesAffected };
    }

    case "tool_result": {
      const text = getToolResultText(raw);
      if (!text) return null;
      return {
        summary: truncate(text, 200),
        detail: text,
      };
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function truncate(s: string, maxLen: number): string {
  return s.length <= maxLen ? s : s.slice(0, maxLen);
}

/**
 * Extract user text from the raw log entry.
 * Content can be a string or an array of content blocks.
 */
function getUserText(raw: Record<string, unknown>): string | null {
  const msg = raw.message as { content?: unknown } | undefined;
  if (!msg?.content) return null;
  if (typeof msg.content === "string") return msg.content;
  return null;
}

/**
 * Extract AI text from an ai_response event.
 * The event ID encodes which content block it came from (e.g., "a-001-text-1").
 */
function getAiText(event: RawDevEvent): string | null {
  const raw = event.raw;
  const msg = raw.message as { content?: unknown[] } | undefined;
  if (!msg?.content || !Array.isArray(msg.content)) return null;

  // Find the text block index from the event ID (format: "...-text-N")
  const match = event.id.match(/-text-(\d+)$/);
  if (match) {
    const idx = parseInt(match[1], 10);
    const block = msg.content[idx] as { type?: string; text?: string } | undefined;
    if (block?.type === "text" && block.text) return block.text;
  }

  // Fallback: find first text block
  for (const block of msg.content) {
    const b = block as { type?: string; text?: string };
    if (b.type === "text" && b.text) return b.text;
  }
  return null;
}

/**
 * Extract tool name from a tool_call event.
 */
function getToolName(event: RawDevEvent): string | undefined {
  const raw = event.raw;
  const msg = raw.message as { content?: unknown[] } | undefined;
  if (!msg?.content || !Array.isArray(msg.content)) return undefined;

  // Find tool_use block index from event ID (format: "...-tool-N")
  const match = event.id.match(/-tool-(\d+)$/);
  if (match) {
    const idx = parseInt(match[1], 10);
    const block = msg.content[idx] as { type?: string; name?: string } | undefined;
    if (block?.type === "tool_use" && block.name) return block.name;
  }

  // Fallback: first tool_use block
  for (const block of msg.content) {
    const b = block as { type?: string; name?: string };
    if (b.type === "tool_use" && b.name) return b.name;
  }
  return undefined;
}

/**
 * Extract tool input from a tool_call event.
 */
function getToolInput(
  event: RawDevEvent,
): Record<string, unknown> | undefined {
  const raw = event.raw;
  const msg = raw.message as { content?: unknown[] } | undefined;
  if (!msg?.content || !Array.isArray(msg.content)) return undefined;

  const match = event.id.match(/-tool-(\d+)$/);
  if (match) {
    const idx = parseInt(match[1], 10);
    const block = msg.content[idx] as {
      type?: string;
      input?: Record<string, unknown>;
    } | undefined;
    if (block?.type === "tool_use" && block.input) return block.input;
  }

  for (const block of msg.content) {
    const b = block as { type?: string; input?: Record<string, unknown> };
    if (b.type === "tool_use" && b.input) return b.input;
  }
  return undefined;
}

/**
 * Extract file path from tool input parameters.
 */
function extractFilePath(
  input: Record<string, unknown> | undefined,
): string | undefined {
  if (!input) return undefined;
  const candidates = ["file_path", "path", "filePath"];
  for (const key of candidates) {
    if (typeof input[key] === "string") return input[key] as string;
  }
  return undefined;
}

// ── Causal Threading ─────────────────────────────────────────────────

/**
 * Derive the turnId from a rawEventId.
 *
 * ID formats:
 *  - User conversation_turn: "u-001" → turnId "u-001"
 *  - AI text:    "a-001-text-0"   → turnId "a-001"
 *  - AI tool:    "a-001-tool-1"   → turnId "a-001"
 *  - Tool result: "u-002-result-0" → turnId "u-002"
 *
 * Strip the last two hyphen-separated segments if they match known suffixes.
 */
function deriveTurnId(rawEventId: string): string {
  // Match IDs with a type suffix: -text-N, -tool-N, -result-N
  const match = rawEventId.match(/^(.+)-(text|tool|result)-\d+$/);
  if (match) return match[1];
  // Plain user ID: "u-001"
  return rawEventId;
}

/**
 * Extract tool_use_id from a tool_result event's raw data.
 * The raw content is an array with blocks like { type: "tool_result", tool_use_id: "tu-001" }.
 */
function getToolUseIdFromResult(event: NormalizedDevEvent, rawEvents: RawDevEvent[]): string | undefined {
  // Find the original raw event
  const rawEvent = rawEvents.find((r) => r.id === event.rawEventId);
  if (!rawEvent) return undefined;

  const raw = rawEvent.raw;
  const msg = raw.message as { content?: unknown } | undefined;
  if (!msg?.content || !Array.isArray(msg.content)) return undefined;

  // The event ID tells us which block index: e.g., "u-002-result-0" → index 0
  const idxMatch = event.rawEventId.match(/-result-(\d+)$/);
  if (idxMatch) {
    const idx = parseInt(idxMatch[1], 10);
    const block = msg.content[idx] as { type?: string; tool_use_id?: string } | undefined;
    if (block?.type === "tool_result" && block.tool_use_id) return block.tool_use_id;
  }

  // Fallback: first tool_result block
  for (const block of msg.content) {
    const b = block as { type?: string; tool_use_id?: string };
    if (b.type === "tool_result" && b.tool_use_id) return b.tool_use_id;
  }
  return undefined;
}

/**
 * Extract tool_use id from a tool_call event's raw data.
 */
function getToolUseIdFromCall(event: NormalizedDevEvent, rawEvents: RawDevEvent[]): string | undefined {
  const rawEvent = rawEvents.find((r) => r.id === event.rawEventId);
  if (!rawEvent) return undefined;

  const raw = rawEvent.raw;
  const msg = raw.message as { content?: unknown[] } | undefined;
  if (!msg?.content || !Array.isArray(msg.content)) return undefined;

  const idxMatch = event.rawEventId.match(/-tool-(\d+)$/);
  if (idxMatch) {
    const idx = parseInt(idxMatch[1], 10);
    const block = msg.content[idx] as { type?: string; id?: string } | undefined;
    if (block?.type === "tool_use" && block.id) return block.id;
  }

  return undefined;
}

/**
 * Second pass: assign respondingTo for each normalized event.
 *
 * Rules:
 *  - First event: no respondingTo
 *  - Tool result: responds to matching tool_call (by tool_use_id)
 *  - AI event: responds to first event of the most recent user turn
 *  - User conversation_turn: responds to last event of the most recent AI turn
 */
function assignRespondingTo(
  events: NormalizedDevEvent[],
  rawEvents: RawDevEvent[],
): void {
  // Build a map of tool_use_id → normalized event id for tool_call events
  const toolUseIdToEventId = new Map<string, string>();
  for (const event of events) {
    if (event.rawEventId.includes("-tool-")) {
      const toolUseId = getToolUseIdFromCall(event, rawEvents);
      if (toolUseId) {
        toolUseIdToEventId.set(toolUseId, event.id);
      }
    }
  }

  // Track turns: first event per turnId, last event per turnId
  const firstEventByTurn = new Map<string, NormalizedDevEvent>();
  const lastEventByTurn = new Map<string, NormalizedDevEvent>();

  // Track the most recent completed user and AI turns
  let lastUserTurnId: string | undefined;
  let lastAiTurnId: string | undefined;

  for (const event of events) {
    const turnId = event.turnId;
    const isUserTurn = turnId.startsWith("u-");
    const isAiTurn = turnId.startsWith("a-");

    // Track first/last event per turn
    if (!firstEventByTurn.has(turnId)) {
      firstEventByTurn.set(turnId, event);
    }
    lastEventByTurn.set(turnId, event);

    // Determine respondingTo
    if (event.causalOrder === 0) {
      // First event — no respondingTo
      // (leave undefined)
    } else if (event.rawEventId.includes("-result-")) {
      // Tool result → responds to matching tool_call
      const toolUseId = getToolUseIdFromResult(event, rawEvents);
      if (toolUseId && toolUseIdToEventId.has(toolUseId)) {
        event.respondingTo = toolUseIdToEventId.get(toolUseId);
      }
    } else if (isAiTurn) {
      // AI event → responds to first event of most recent user turn
      if (lastUserTurnId) {
        const firstUserEvent = firstEventByTurn.get(lastUserTurnId);
        if (firstUserEvent) {
          event.respondingTo = firstUserEvent.id;
        }
      }
    } else if (isUserTurn && !event.rawEventId.includes("-result-")) {
      // User conversation_turn → responds to last event of most recent AI turn
      if (lastAiTurnId) {
        const lastAiEvent = lastEventByTurn.get(lastAiTurnId);
        if (lastAiEvent) {
          event.respondingTo = lastAiEvent.id;
        }
      }
    }

    // Update last completed turn tracking
    // A turn is "completed" when we see the first event of a different turn
    if (isUserTurn && lastUserTurnId !== turnId) {
      lastUserTurnId = turnId;
    }
    if (isAiTurn && lastAiTurnId !== turnId) {
      lastAiTurnId = turnId;
    }
  }
}

/**
 * Extract text from a tool_result event.
 */
function getToolResultText(raw: Record<string, unknown>): string | null {
  const msg = raw.message as { content?: unknown } | undefined;
  if (!msg?.content) return null;

  if (typeof msg.content === "string") return msg.content;

  if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      const b = block as { type?: string; content?: unknown };
      if (b.type === "tool_result") {
        // content can be a string or array of text blocks
        if (typeof b.content === "string") return b.content;
        if (Array.isArray(b.content)) {
          const texts: string[] = [];
          for (const inner of b.content) {
            const t = inner as { type?: string; text?: string };
            if (t.type === "text" && t.text) texts.push(t.text);
          }
          if (texts.length > 0) return texts.join("\n");
        }
      }
    }
  }
  return null;
}
