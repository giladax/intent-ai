import { parseTranscript } from "@constellos/claude-code-kit/transcripts";
import type { RawDevEvent } from "./types.js";

/**
 * Parse a Claude Code JSONL log file into RawDevEvent[].
 *
 * Uses claude-code-kit's parseTranscript for JSONL parsing and schema
 * validation, then maps each message to one or more RawDevEvents:
 *
 *  - User messages with string content → conversation_turn
 *  - User messages with tool_result content blocks → tool_result (one per block)
 *  - Assistant text blocks → ai_response
 *  - Assistant tool_use blocks → tool_call (one per block)
 *  - Thinking blocks, system messages → skipped
 */
export async function parseClaudeCodeLog(
  filePath: string,
): Promise<RawDevEvent[]> {
  const transcript = await parseTranscript(filePath, { lenient: true });
  const events: RawDevEvent[] = [];

  for (const msg of transcript.messages) {
    const raw = msg as unknown as Record<string, unknown>;
    const base = {
      source: "claude-code" as const,
      timestamp: msg.timestamp,
      raw,
    };

    if (msg.type === "user") {
      const content = msg.message.content;

      // String content → single conversation_turn
      if (typeof content === "string") {
        events.push({
          ...base,
          id: msg.uuid,
          type: "conversation_turn",
        });
        continue;
      }

      // Array of tool_result blocks → one tool_result event per block
      if (Array.isArray(content)) {
        for (let i = 0; i < content.length; i++) {
          const block = content[i];
          if (block.type === "tool_result") {
            events.push({
              ...base,
              id: `${msg.uuid}-result-${i}`,
              type: "tool_result",
            });
          }
        }
      }
      continue;
    }

    if (msg.type === "assistant") {
      const content = msg.message.content;

      for (let i = 0; i < content.length; i++) {
        const block = content[i];

        if (block.type === "text") {
          events.push({
            ...base,
            id: `${msg.uuid}-text-${i}`,
            type: "ai_response",
          });
        } else if (block.type === "tool_use") {
          events.push({
            ...base,
            id: `${msg.uuid}-tool-${i}`,
            type: "tool_call",
          });
        }
        // skip "thinking" blocks
      }
      continue;
    }

    // Skip system messages
  }

  return events;
}
