import { z } from "zod";
import type { NormalizedDevEvent, SessionChunk, PipelineDirectives, ExtractedMoment, EvidenceAnchor } from "../../adapters/types.js";
import { callSonnet } from "../../llm/client.js";
import { buildExtractPrompt, ExtractOutputSchema } from "../../llm/prompts/understand/extract.js";

// ── renderChunkEvents ─────────────────────────────────────────────────
//
// Renders a chunk's events to a string for the LLM prompt.
// Each event is prefixed with [causalOrder], then formatted by category:
//
//   intent / proposal / reflection  →  DEV:/AI: + full content.detail
//   action                          →  AI/ACTION(<files or summary>) + first 200 chars of detail
//   result (with error)             →  RESULT(error): + first 300 chars of detail
//   result (ok)                     →  RESULT: <summary first 120 chars>

export function renderChunkEvents(events: NormalizedDevEvent[]): string {
  return events
    .map((e) => {
      const co = e.causalOrder;
      const detail = e.content.detail;
      const summary = e.content.summary;
      const files = e.content.filesAffected ?? [];

      switch (e.category) {
        case "intent":
          return `[${co}] DEV: ${detail}`;

        case "proposal":
          return `[${co}] AI: ${detail}`;

        case "reflection":
          return `[${co}] AI: ${detail}`;

        case "action": {
          const fileStr = files.length > 0 ? files.join(", ") : summary;
          const detailSnippet = detail.slice(0, 200);
          return `[${co}] AI/ACTION(${fileStr}): ${detailSnippet}`;
        }

        case "result": {
          const lower = detail.toLowerCase();
          const isError =
            lower.includes("error") ||
            lower.includes("fail") ||
            lower.includes("err!");
          if (isError) {
            return `[${co}] RESULT(error): ${detail.slice(0, 300)}`;
          }
          return `[${co}] RESULT: ${summary.slice(0, 120)}`;
        }

        default:
          return `[${co}] ${e.actor.toUpperCase()}: ${detail}`;
      }
    })
    .join("\n");
}

// ── validateAnchors ───────────────────────────────────────────────────
//
// For each parsed moment, assigns a deterministic id and resolves evidence
// anchors against the chunk's events.
//
// Anchor rules:
//   1. eventIndex must be a number AND within chunk.eventRange (or in overlap
//      events' causalOrders present in chunk.events).
//   2. The normalized quote must be a substring of the normalized event text
//      (content.detail + " " + content.summary, lowercase, whitespace→" ").
//   3. If the quote is not found in the cited event but IS found in exactly one
//      other event in the chunk, re-anchor to that event (fix the index).
//   4. Otherwise anchored = false; keep the evidence visibly unanchored.
//   5. occurredAt = timestamp of the first anchored evidence's event.
//      Falls back to chunk.events[0]?.timestamp ?? null.
//   6. Never drop a moment — visibility over deletion.

export function validateAnchors(
  moments: z.infer<typeof ExtractOutputSchema>["moments"],
  chunk: SessionChunk,
): ExtractedMoment[] {
  // Build a lookup: causalOrder → event
  const eventByOrder = new Map<number, NormalizedDevEvent>();
  for (const ev of chunk.events) {
    eventByOrder.set(ev.causalOrder, ev);
  }

  // Set of causalOrders present in this chunk (includes overlap events)
  const presentOrders = new Set(chunk.events.map((e) => e.causalOrder));

  const [rangeStart, rangeEnd] = chunk.eventRange;

  function normalizeText(s: string): string {
    return s.toLowerCase().replace(/\s+/g, " ");
  }

  function quoteFoundInEvent(quote: string, ev: NormalizedDevEvent): boolean {
    const haystack = normalizeText(ev.content.detail + " " + ev.content.summary);
    const needle = normalizeText(quote);
    return haystack.includes(needle);
  }

  function isInRange(order: number): boolean {
    // Within the chunk's declared event range, OR present in chunk.events
    // (overlap events have causalOrders < rangeStart but are still in chunk.events)
    return (order >= rangeStart && order <= rangeEnd) || presentOrders.has(order);
  }

  return moments.map((m, i) => {
    const id = `c${chunk.chunkIndex}-m${i}`;

    const resolvedEvidence: EvidenceAnchor[] = m.evidence.map((ev) => {
      const rawIndex = ev.eventIndex;
      const eventIndex = typeof rawIndex === "number" ? rawIndex : null;

      // Step 1: check if the cited index is valid and in range
      const citedEvent =
        eventIndex !== null ? eventByOrder.get(eventIndex) : undefined;

      const citedInRange = eventIndex !== null && isInRange(eventIndex);
      const quoteInCited =
        citedEvent !== undefined && quoteFoundInEvent(ev.quote, citedEvent);

      if (citedInRange && quoteInCited) {
        // Happy path: anchor is valid
        return {
          quote: ev.quote,
          eventIndex,
          anchored: true,
          sourceType: ev.sourceType ?? "ai",
        } as EvidenceAnchor;
      }

      // Step 2: quote not in cited event — search all chunk events for it
      const matchingEvents = chunk.events.filter((chunkEv) =>
        quoteFoundInEvent(ev.quote, chunkEv),
      );

      if (matchingEvents.length === 1) {
        // Re-anchor to the one event that contains the quote
        return {
          quote: ev.quote,
          eventIndex: matchingEvents[0].causalOrder,
          anchored: true,
          sourceType: ev.sourceType ?? "ai",
        } as EvidenceAnchor;
      }

      // Step 3: can't anchor — keep visibly unanchored
      return {
        quote: ev.quote,
        eventIndex: citedInRange ? eventIndex : null,
        anchored: false,
        sourceType: ev.sourceType ?? "ai",
      } as EvidenceAnchor;
    });

    // occurredAt = timestamp of the first anchored evidence's event
    let occurredAt: string | null = null;
    for (const anchor of resolvedEvidence) {
      if (anchor.anchored && anchor.eventIndex !== null) {
        const ev = eventByOrder.get(anchor.eventIndex);
        if (ev) {
          occurredAt = ev.timestamp;
          break;
        }
      }
    }
    if (occurredAt === null) {
      occurredAt = chunk.events[0]?.timestamp ?? null;
    }

    return {
      id,
      chunkIndex: chunk.chunkIndex,
      type: m.type,
      statement: m.statement,
      significance: m.significance ?? "",
      agency: m.agency,
      confidence: m.confidence ?? null,
      topicFingerprint: m.topicFingerprint ?? "general",
      evidence: resolvedEvidence,
      occurredAt,
    } satisfies ExtractedMoment;
  });
}

// ── extractChunk ──────────────────────────────────────────────────────

export async function extractChunk(
  chunk: SessionChunk,
  sessionShape: string,
  directives?: PipelineDirectives,
  digestHeader?: string,
): Promise<ExtractedMoment[]> {
  const { system, user } = buildExtractPrompt({
    chunk,
    sessionShape,
    directives,
    digestHeader,
  });

  const output = await callSonnet(system, user, ExtractOutputSchema);
  return validateAnchors(output.moments, chunk);
}
