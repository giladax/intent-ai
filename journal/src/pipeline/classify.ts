import type { NormalizedDevEvent } from "../adapters/types.js";
import type { SessionShape } from "../adapters/types.js";
import { callHaiku } from "../llm/client.js";
import {
  buildClassifyPrompt,
  SessionShapeSchema,
  type ClassifyInput,
} from "../llm/prompts/classify.js";

// Re-export for convenience
export type { SessionShape };

/**
 * Classify a session's overall shape using Haiku.
 *
 * Builds a lightweight summary of the event stream and asks Haiku
 * to pick one of the five canonical session shapes.
 */
export async function classifySession(
  events: NormalizedDevEvent[],
): Promise<SessionShape> {
  const summary = buildSummary(events);
  const { system, user } = buildClassifyPrompt(summary);
  const result = await callHaiku(system, user, SessionShapeSchema);
  return result.shape as SessionShape;
}

// ── Internal ──────────────────────────────────────────────────────────

function buildSummary(events: NormalizedDevEvent[]): ClassifyInput {
  // Count events by category
  const eventCounts: Record<string, number> = {};
  for (const e of events) {
    eventCounts[e.category] = (eventCounts[e.category] ?? 0) + 1;
  }

  // Count by actor
  for (const e of events) {
    const key = `actor:${e.actor}`;
    eventCounts[key] = (eventCounts[key] ?? 0) + 1;
  }

  // Unique files touched
  const filesSet = new Set<string>();
  for (const e of events) {
    if (e.content.filesAffected) {
      for (const f of e.content.filesAffected) {
        filesSet.add(f);
      }
    }
  }

  // Sample of first 3 user messages, truncated to 200 chars
  const userMessages: string[] = [];
  for (const e of events) {
    if (e.actor === "user" && e.category === "intent") {
      userMessages.push(e.content.summary.slice(0, 200));
      if (userMessages.length >= 3) break;
    }
  }

  return {
    eventCounts,
    files: Array.from(filesSet),
    sampleUserMessages: userMessages,
    totalEvents: events.length,
  };
}
