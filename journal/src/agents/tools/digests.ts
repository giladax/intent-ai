import { z } from "zod";
import type { AgentToolDef } from "../core/types.js";
import { defineTool } from "../core/tool.js";
import {
  queryEvents,
  getSessionNarrative,
  getSessionMoments,
  listSessions,
} from "../../storage/queries.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: Date | null | undefined): string {
  if (!d) return "unknown";
  return d instanceof Date ? d.toISOString().slice(0, 16) + "Z" : String(d);
}

// ── makeDigestTools ──────────────────────────────────────────────────────────

/**
 * Returns AgentToolDef[] wrapping the storage read functions.
 * Thin wrappers — each tool formats results as compact readable text for the
 * model (not raw JSON dumps). All DB calls are contained; errors return a
 * descriptive string rather than throwing.
 */
export function makeDigestTools(): AgentToolDef[] {
  // ── search_events ──────────────────────────────────────────────────────────

  const searchEvents = defineTool({
    name: "search_events",
    description:
      "Search the activity event stream for relevant events by category prefix, " +
      "tags, actor, session, repo, branch, or time window. " +
      "Use this to find past actions, observations, brain mutations, and session moments " +
      "across all digested sessions. " +
      "Returns up to 50 events as compact one-line summaries (timestamp · category · actor: summary). " +
      "Narrow with categoryPrefix (e.g. 'session', 'brain', 'observation') or tags to reduce noise.",
    schema: z.object({
      categoryPrefix: z
        .string()
        .optional()
        .describe(
          "Filter events whose category starts with this prefix (e.g. 'session', 'brain')",
        ),
      tags: z
        .array(z.string())
        .optional()
        .describe("Filter events that have ALL of these tags"),
      actor: z.string().optional().describe("Filter by actor (e.g. 'pipeline', 'mcp')"),
      sessionId: z.string().optional().describe("Filter to a specific session UUID"),
      repo: z.string().optional().describe("Filter by repo name"),
      branch: z.string().optional().describe("Filter by git branch"),
      since: z
        .string()
        .optional()
        .describe("ISO 8601 start timestamp (inclusive)"),
      until: z
        .string()
        .optional()
        .describe("ISO 8601 end timestamp (inclusive)"),
    }),
    execute: async ({
      categoryPrefix,
      tags,
      actor,
      sessionId,
      repo,
      branch,
      since,
      until,
    }) => {
      try {
        const events = await queryEvents({
          categoryPrefix,
          tags,
          actor,
          sessionId,
          repo,
          branch,
          since: since ? new Date(since) : undefined,
          until: until ? new Date(until) : undefined,
          limit: 50,
        });

        if (events.length === 0) {
          return "(no events matched the query)";
        }

        const lines = events.map((e) => {
          const ts = formatDate(e.timestamp);
          const tagStr = e.tags.length > 0 ? ` [${e.tags.slice(0, 3).join(", ")}]` : "";
          return `${ts} · ${e.category} · ${e.actor}${tagStr}: ${e.summary}`;
        });

        return lines.join("\n") + `\n— ${events.length} event${events.length === 1 ? "" : "s"} (limit 50)`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `QUERY_ERROR: ${msg}`;
      }
    },
  });

  // ── get_session_digest ─────────────────────────────────────────────────────

  const getSessionDigest = defineTool({
    name: "get_session_digest",
    description:
      "Retrieve the narrative summary and key moments for a specific session. " +
      "Use this to understand what happened in a past session — the overall arc, " +
      "discoveries, pivots, and outcomes — without reading the raw transcript. " +
      "Returns the session narrative (shape, summary, progression, discoveries) " +
      "followed by up to 20 moments (type, statement, confidence, verification status).",
    schema: z.object({
      session_id: z
        .string()
        .describe("UUID of the session to retrieve (from list_sessions)"),
    }),
    execute: async ({ session_id }) => {
      try {
        const [narrative, moments] = await Promise.all([
          getSessionNarrative(session_id),
          getSessionMoments(session_id),
        ]);

        if (!narrative) {
          return `(no digest found for session ${session_id})`;
        }

        const lines: string[] = [
          `Session: ${session_id}`,
          `Shape: ${narrative.sessionShape}`,
          "",
          `Summary: ${narrative.summary}`,
          "",
        ];

        if (narrative.progression.length > 0) {
          lines.push("Progression:");
          narrative.progression.forEach((p) => lines.push(`  • ${p}`));
          lines.push("");
        }

        if (narrative.discoveries.length > 0) {
          lines.push("Discoveries:");
          narrative.discoveries.forEach((d) => lines.push(`  • ${d}`));
          lines.push("");
        }

        if (narrative.stabilizedDirections.length > 0) {
          lines.push("Stabilized directions:");
          narrative.stabilizedDirections.forEach((s) => lines.push(`  • ${s}`));
          lines.push("");
        }

        if (narrative.abandonedDirections.length > 0) {
          lines.push("Abandoned directions:");
          narrative.abandonedDirections.forEach((a) => lines.push(`  • ${a}`));
          lines.push("");
        }

        const topMoments = moments.slice(0, 20);
        if (topMoments.length > 0) {
          lines.push(`Moments (${topMoments.length} of ${moments.length}):`);
          topMoments.forEach((m) => {
            const verif = m.verification ? ` [${m.verification}]` : "";
            lines.push(`  [${m.type}/${m.confidence}${verif}] ${m.statement}`);
          });
        }

        return lines.join("\n");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `QUERY_ERROR: ${msg}`;
      }
    },
  });

  // ── list_sessions ──────────────────────────────────────────────────────────

  const listSessionsTool = defineTool({
    name: "list_sessions",
    description:
      "List the most recent digested sessions (up to 20). " +
      "Use this to discover available session IDs before calling get_session_digest, " +
      "or to orient yourself in the project's history. " +
      "Returns each session as: ID · shape · started-at · summary snippet.",
    schema: z.object({}),
    execute: async () => {
      try {
        const sessions = await listSessions();

        if (sessions.length === 0) {
          return "(no sessions found — run `npx tsx src/cli/index.ts digest` to ingest a session)";
        }

        const lines = sessions.map((s) => {
          const ts = formatDate(s.startedAt);
          const snippet = s.summary.slice(0, 120);
          const ellipsis = s.summary.length > 120 ? "…" : "";
          return `${s.id} · ${s.shape} · ${ts}: ${snippet}${ellipsis}`;
        });

        return lines.join("\n") + `\n— ${sessions.length} session${sessions.length === 1 ? "" : "s"}`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `QUERY_ERROR: ${msg}`;
      }
    },
  });

  return [searchEvents, getSessionDigest, listSessionsTool] as AgentToolDef[];
}
