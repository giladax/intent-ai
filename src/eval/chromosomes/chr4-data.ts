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
