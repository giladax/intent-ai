import { z } from "zod";
import type { NormalizedDevEvent } from "../../adapters/types.js";
import type { AgentToolDef } from "../core/types.js";
import { defineTool } from "../core/tool.js";
import { renderChunkEvents } from "../../pipeline/understand/render-chunk-events.js";

// ── Constants ────────────────────────────────────────────────────────────────

const RANGE_CAP = 200;
const SEARCH_CAP = 50;
const TOOL_EVENTS_CAP = 100;

// ── buildToolEventLine ───────────────────────────────────────────────────────

/**
 * Renders a single action/result event as a causal-order-prefixed line for
 * list_tool_events. Mirrors the pattern from verify.ts buildClaimWindow:
 * CATEGORY(actor): detail (capped at 500 chars, with truncation marker).
 */
function buildToolEventLine(e: NormalizedDevEvent): string {
  const fullDetail = e.content.detail;
  const detail = fullDetail.slice(0, 500);
  const truncationMarker = fullDetail.length > 500 ? " …[event truncated]" : "";
  return `[${e.causalOrder}] ${e.category.toUpperCase()}(${e.actor}): ${detail}${truncationMarker}`;
}

// ── makeTranscriptTools ──────────────────────────────────────────────────────

/**
 * Factory: closes over an already-parsed session's normalized events.
 * Returns AgentToolDef[] for the three transcript inspection tools.
 * No file I/O inside the tools — all data comes from the closure.
 */
export function makeTranscriptTools(
  normalizedEvents: NormalizedDevEvent[],
): AgentToolDef[] {
  // Sort once at factory time; tools operate on sorted copy
  const sorted = [...normalizedEvents].sort((a, b) => a.causalOrder - b.causalOrder);

  // ── read_transcript_range ──────────────────────────────────────────────────

  const readRange = defineTool({
    name: "read_transcript_range",
    description:
      "Read a slice of the session transcript by causal-order range. " +
      "Use this when you need to see what happened between two specific events — " +
      "proposals, actions, and results in context. " +
      "Returns each event prefixed with [N], formatted by category (DEV:/AI: for dialogue, " +
      "AI/ACTION(files) for edits/commands, RESULT for outcomes). " +
      "Max 200 events per call; if the range exceeds the cap, only the first 200 are returned " +
      "and a notice is appended. Narrow the range if you need finer coverage.",
    schema: z.object({
      from: z
        .number()
        .int()
        .describe("First causal-order index to include (inclusive)"),
      to: z
        .number()
        .int()
        .describe("Last causal-order index to include (inclusive)"),
    }),
    execute: async ({ from, to }) => {
      const inRange = sorted.filter(
        (e) => e.causalOrder >= from && e.causalOrder <= to,
      );

      const capped = inRange.slice(0, RANGE_CAP);
      const rendered = renderChunkEvents(capped);
      const notice =
        inRange.length > RANGE_CAP
          ? `\n— cap: showing first ${RANGE_CAP} of ${inRange.length} events in range [${from}..${to}]. Narrow the range to see more.`
          : "";

      if (capped.length === 0) {
        return `(no events in causal-order range [${from}..${to}])`;
      }

      return rendered + notice;
    },
  });

  // ── search_transcript ──────────────────────────────────────────────────────

  const searchTranscript = defineTool({
    name: "search_transcript",
    description:
      "Search the session transcript for events matching a substring or regex. " +
      "Use this when you need to find where a specific file, function, error message, " +
      "or keyword was mentioned — without knowing the causal-order range. " +
      "Returns matching events with their causal-order prefix and a ~200-char snippet. " +
      "Max 50 hits; if more match, only the first 50 are returned. " +
      "Set regex=true to use a JS regular expression instead of plain substring matching.",
    schema: z.object({
      query: z
        .string()
        .describe(
          "Substring to search for (case-insensitive), or a JS regex pattern if regex=true",
        ),
      regex: z
        .boolean()
        .optional()
        .describe(
          "If true, treat query as a JS regular expression. Default false (substring match).",
        ),
    }),
    execute: async ({ query, regex }) => {
      let matches: NormalizedDevEvent[];

      if (regex) {
        let re: RegExp;
        try {
          re = new RegExp(query, "i");
        } catch {
          return `SEARCH_ERROR: invalid regex — ${query}`;
        }
        matches = sorted.filter(
          (e) =>
            re.test(e.content.detail) ||
            re.test(e.content.summary) ||
            (e.content.filesAffected ?? []).some((f) => re.test(f)),
        );
      } else {
        const lower = query.toLowerCase();
        matches = sorted.filter(
          (e) =>
            e.content.detail.toLowerCase().includes(lower) ||
            e.content.summary.toLowerCase().includes(lower) ||
            (e.content.filesAffected ?? []).some((f) =>
              f.toLowerCase().includes(lower),
            ),
        );
      }

      if (matches.length === 0) {
        return `0 hits — no matching events for "${query}"`;
      }

      const capped = matches.slice(0, SEARCH_CAP);
      const lines = capped.map((e) => {
        const snippet = e.content.detail.slice(0, 200);
        const ellipsis = e.content.detail.length > 200 ? "…" : "";
        return `[${e.causalOrder}] (${e.category}): ${snippet}${ellipsis}`;
      });

      const notice =
        matches.length > SEARCH_CAP
          ? `\n— showing ${SEARCH_CAP} of ${matches.length} hits. Refine your query to narrow results.`
          : `\n— ${matches.length} hit${matches.length === 1 ? "" : "s"}`;

      return lines.join("\n") + notice;
    },
  });

  // ── list_tool_events ───────────────────────────────────────────────────────

  const listToolEvents = defineTool({
    name: "list_tool_events",
    description:
      "List only the action and result events (tool calls and their outcomes) within " +
      "a causal-order range. Use this to audit what tools were called and whether they " +
      "succeeded or failed — ideal for verifying claims about what was done and what the " +
      "actual outcomes were. Successes are included, not just errors. " +
      "Format: [N] ACTION/RESULT(actor): detail (up to 500 chars per event, with truncation marker).",
    schema: z.object({
      from: z
        .number()
        .int()
        .describe("First causal-order index to include (inclusive)"),
      to: z
        .number()
        .int()
        .describe("Last causal-order index to include (inclusive)"),
    }),
    execute: async ({ from, to }) => {
      const toolEvents = sorted.filter(
        (e) =>
          e.causalOrder >= from &&
          e.causalOrder <= to &&
          (e.category === "action" || e.category === "result"),
      );

      if (toolEvents.length === 0) {
        return `(no action or result events in causal-order range [${from}..${to}])`;
      }

      const capped = toolEvents.slice(0, TOOL_EVENTS_CAP);
      const rendered = capped.map(buildToolEventLine).join("\n");
      const notice =
        toolEvents.length > TOOL_EVENTS_CAP
          ? `\n— capped at ${TOOL_EVENTS_CAP} events (of ${toolEvents.length}); narrow the range`
          : "";

      return rendered + notice;
    },
  });

  return [readRange, searchTranscript, listToolEvents] as AgentToolDef[];
}
