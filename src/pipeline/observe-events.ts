import { callHaiku } from "../llm/client.js";
import type { ActivityEvent } from "../adapters/types.js";
import { z } from "zod";

const ObservationSchema = z.object({
  observations: z.array(z.object({
    statement: z.string(),
    confidence: z.enum(["high", "medium", "low"]).optional().default("medium"),
    supportingEventIds: z.array(z.string()).optional().default([]),
    suggestedTags: z.array(z.string()).optional().default([]),
  })).optional().default([]),
});

export interface Observation {
  statement: string;
  confidence: string;
  supportingEventIds: string[];
  suggestedTags: string[];
}

export async function observeEvents(events: ActivityEvent[]): Promise<Observation[]> {
  if (events.length === 0) return [];

  const eventSummaries = events.map((e) =>
    `[${e.id ?? "?"}] ${e.timestamp.toISOString().slice(0, 16)} | ${e.category} | ${e.actor} | ${e.summary}`
  ).join("\n");

  const systemPrompt = `You observe a stream of development activity events. Your job is to notice anything interesting — recurring themes, knowledge gaps, contradictions, connections across sessions, emerging patterns. Report only genuine observations, not restatements of individual events. If nothing stands out, return an empty list.`;

  const userPrompt = `Here are recent events:\n\n${eventSummaries}\n\nWhat do you observe? Reference event IDs in supportingEventIds.`;

  const result = await callHaiku(systemPrompt, userPrompt, ObservationSchema);
  return result.observations;
}
