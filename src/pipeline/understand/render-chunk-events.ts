import type { NormalizedDevEvent } from "../../adapters/types.js";

/**
 * Renders a chunk's events to a string for the LLM prompt.
 * Each event is prefixed with [causalOrder], then formatted by category:
 *
 *   intent / proposal / reflection  →  DEV:/AI: + full content.detail
 *   action                          →  AI/ACTION(<files or summary>) + first 200 chars of detail
 *   result (with error)             →  RESULT(error): + first 300 chars of detail
 *   result (ok)                     →  RESULT: <summary first 120 chars>
 *
 * Single source of truth — imported by both the pipeline extract step and the
 * extract prompt builder, so tests and production always exercise the same code.
 */
export function renderChunkEvents(events: Array<{
  causalOrder: number;
  category: string;
  actor: string;
  content: { summary: string; detail: string; filesAffected?: string[] };
}>): string {
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
