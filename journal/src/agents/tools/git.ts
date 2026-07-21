import { execSync } from "child_process";
import { z } from "zod";
import { resolve } from "path";
import type { AgentToolDef } from "../core/types.js";
import { defineTool } from "../core/tool.js";

// ── makeGitTools ─────────────────────────────────────────────────────────────

/**
 * Returns AgentToolDef[] for git-backed context tools.
 * All execSync calls are contained — errors return "GIT_ERROR: ..." strings,
 * never throw into the agent graph.
 */
export function makeGitTools(): AgentToolDef[] {
  // ── git_log_window ─────────────────────────────────────────────────────────

  const gitLogWindow = defineTool({
    name: "git_log_window",
    description:
      "Retrieve a window of git commit history for a repository, filtered by time range. " +
      "Use this to understand what code changes happened around a session or event, " +
      "to correlate brain observations with commits, or to audit recent work. " +
      "Returns one-line commit summaries (hash · date · author: message). " +
      "Provide sinceIso and untilIso as ISO 8601 strings (e.g. '2026-07-01T00:00:00Z'). " +
      "The repo path must be an absolute path or resolvable relative to the process cwd.",
    schema: z.object({
      repo: z
        .string()
        .describe(
          "Absolute path to the git repository root (e.g. '/Users/you/dev/my-project')",
        ),
      sinceIso: z
        .string()
        .describe(
          "Start of the time window, ISO 8601 (e.g. '2026-07-01T00:00:00Z')",
        ),
      untilIso: z
        .string()
        .describe(
          "End of the time window, ISO 8601 (e.g. '2026-07-04T23:59:59Z')",
        ),
    }),
    execute: async ({ repo, sinceIso, untilIso }) => {
      try {
        const cwd = resolve(repo);

        const output = execSync(
          `git log --since="${sinceIso}" --until="${untilIso}" --oneline --format="%h · %ci · %an: %s"`,
          { cwd, encoding: "utf8", timeout: 10_000 },
        ).trim();

        if (!output) {
          return `(no commits in ${repo} between ${sinceIso} and ${untilIso})`;
        }

        const lines = output.split("\n");
        return lines.join("\n") + `\n— ${lines.length} commit${lines.length === 1 ? "" : "s"}`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Trim noisy execSync stderr noise if present
        const clean = msg.split("\n")[0] ?? msg;
        return `GIT_ERROR: ${clean}`;
      }
    },
  });

  return [gitLogWindow] as AgentToolDef[];
}
