import type { DataAllele } from "./types.js";
import type { RawDevEvent } from "../../adapters/types.js";

// ── 4a: Conversation Only ───────────────────────────────────────────
// Filter to only user text + AI text events (drop all tool calls and results)

export const conversationOnly: DataAllele = {
  name: "4a_conversation",
  select(events: RawDevEvent[]): RawDevEvent[] {
    return events.filter(
      (e) => e.type === "conversation_turn" || e.type === "ai_response",
    );
  },
};

// ── 4b: Conversation + Actions ──────────────────────────────────────
// User text + AI text + tool calls (no tool result contents)

export const conversationActions: DataAllele = {
  name: "4b_conversation_actions",
  select(events: RawDevEvent[]): RawDevEvent[] {
    return events.filter((e) => e.type !== "tool_result");
  },
};

// ── 4c: Conversation + Actions + Results ────────────────────────────
// Everything: user text + AI text + tool calls + tool results

export const conversationActionsResults: DataAllele = {
  name: "4c_conversation_actions_results",
  select(events: RawDevEvent[]): RawDevEvent[] {
    // Keep all events (no filtering)
    return events;
  },
};

// ── 4d: Conversation + Diffs ────────────────────────────────────────
// User text + AI text + only Edit tool calls (diffs) + error results
// Edit diffs reveal implementation decisions; file reads are noise

export const conversationDiffs: DataAllele = {
  name: "4d_conversation_diffs",
  select(events: RawDevEvent[]): RawDevEvent[] {
    return events.filter((e) => {
      // Always keep conversation
      if (e.type === "conversation_turn" || e.type === "ai_response") return true;

      // Keep only Edit/Write tool calls (they carry diffs)
      if (e.type === "tool_call") {
        const raw = e.raw as Record<string, unknown>;
        // Check for tool name in the raw content
        const message = raw.message as Record<string, unknown> | undefined;
        const content = message?.content as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_use") {
              const name = block.name as string | undefined;
              if (name === "Edit" || name === "Write" || name === "Bash") {
                return true;
              }
            }
          }
        }
        return false;
      }

      // Keep only error results (they signal struggles)
      if (e.type === "tool_result") {
        const raw = e.raw as Record<string, unknown>;
        const message = raw.message as Record<string, unknown> | undefined;
        const content = message?.content as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_result" && block.is_error) {
              return true;
            }
          }
        }
        return false;
      }

      return false;
    });
  },
};
