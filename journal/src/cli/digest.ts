import type { Command } from "commander";
import { runPipeline } from "../pipeline/orchestrator.js";
import { parseClaudeCodeLog } from "../adapters/claude-code.js";
import { normalize } from "../pipeline/normalize.js";
import { analyzeInteractions } from "../pipeline/analyze.js";
import { chunkSession } from "../pipeline/chunk.js";
import { discoverLatestLog, discoverLogs } from "../utils/log-discovery.js";
import { closeDb } from "../storage/connection.js";
import type {
  SessionNarrative,
  SessionMoment,
  IntentTransition,
  AcceptedOutcome,
} from "../adapters/types.js";

export function registerDigestCommand(program: Command): void {
  program
    .command("digest [path]")
    .description("[DEPRECATED] Session digestion has moved to the Python backend")
    .option("--last <n>", "Process N most recent sessions", parseInt)
    .option("--dry-run", "Run deterministic pipeline only (no LLM calls), print stats")
    .option("--force", "Re-digest even if already stored (deletes stored digest first)")
    .option("--force-legacy", "Emergency escape hatch: run the old TS digest despite the deprecation")
    .action(async (path: string | undefined, opts: { last?: number; dryRun?: boolean; force?: boolean; forceLegacy?: boolean }) => {
      try {
        if (opts.dryRun) {
          await runDryRun(path, opts.last);
          return;
        }

        // ── Deprecation gate (Slice 4) ──────────────────────────────────
        // Session digestion has moved to the Python backend (single-writer rule).
        // Use: python3 -m quire.cli journal digest <log-path>
        // --force-legacy bypasses this for emergencies only.
        if (!opts.forceLegacy) {
          process.stderr.write(
            "DEPRECATED: TS session digestion has moved to the Python backend.\n" +
            "Use: python3 -m quire.cli journal digest <log-path>\n" +
            "     python3 -m quire.cli journal digest --force <log-path>  (re-digest)\n" +
            "Emergency bypass (not recommended): npx tsx src/cli/index.ts digest --force-legacy\n",
          );
          process.exit(1);
        }

        const paths = await resolvePaths(path, opts.last);

        for (const logPath of paths) {
          try {
            const result = await runPipeline(logPath, { force: opts.force });
            printDigest(result);
            if (paths.length > 1) {
              console.log("\n" + "─".repeat(60) + "\n");
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("already digested")) {
              console.error(`  ⚠ ${msg}`);
              continue;
            }
            throw err;
          }
        }
        await closeDb();
      } catch (err) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    });
}

// ── Path Resolution ─────────────────────────────────────────────────

async function resolvePaths(
  path: string | undefined,
  last: number | undefined,
): Promise<string[]> {
  if (path) {
    return [path];
  }

  if (last && last > 0) {
    const paths = await discoverLogs(last);
    if (paths.length === 0) {
      throw new Error("No Claude Code logs found in ~/.claude/projects/");
    }
    return paths;
  }

  // Default: latest log
  const latest = await discoverLatestLog();
  if (!latest) {
    throw new Error(
      "No Claude Code logs found in ~/.claude/projects/. Provide an explicit path.",
    );
  }
  return [latest];
}

// ── Dry Run ─────────────────────────────────────────────────────────

async function runDryRun(
  path: string | undefined,
  last: number | undefined,
): Promise<void> {
  const paths = await resolvePaths(path, last);

  for (const logPath of paths) {
    console.log(`Log: ${logPath}`);
    const rawEvents = await parseClaudeCodeLog(logPath);
    const sessionId = "dry-run";
    const normalizedEvents = normalize(rawEvents, sessionId);
    const sessionChunks = chunkSession(normalizedEvents, sessionId);

    const timestamps = rawEvents
      .map((e) => e.timestamp)
      .filter(Boolean)
      .map((t) => new Date(t));
    const startedAt =
      timestamps.length > 0
        ? new Date(Math.min(...timestamps.map((d) => d.getTime())))
        : null;
    const endedAt =
      timestamps.length > 0
        ? new Date(Math.max(...timestamps.map((d) => d.getTime())))
        : null;

    console.log(`  Raw events:        ${rawEvents.length}`);
    console.log(`  Normalized events: ${normalizedEvents.length}`);
    console.log(`  Chunks:            ${sessionChunks.length}`);
    if (startedAt && endedAt) {
      const durationMin = Math.round(
        (endedAt.getTime() - startedAt.getTime()) / 60000,
      );
      console.log(`  Time span:         ${formatTime(startedAt)} → ${formatTime(endedAt)} (${durationMin} min)`);
    }

    // Category breakdown
    const categories: Record<string, number> = {};
    for (const e of normalizedEvents) {
      categories[e.category] = (categories[e.category] ?? 0) + 1;
    }
    console.log(
      `  Categories:        ${Object.entries(categories)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ")}`,
    );

    // Directives
    const directives = analyzeInteractions(normalizedEvents);
    console.log(`  Directives:`);
    console.log(`    detectPassiveAcceptance: ${directives.promptSections.detectPassiveAcceptance}`);
    console.log(`    trackDelegation:         ${directives.promptSections.trackDelegation}`);
    console.log(`    detectIgnoredProposals:  ${directives.promptSections.detectIgnoredProposals}`);
    console.log(`    isLearningExchange:      ${directives.promptSections.isLearningExchange}`);
    const { totalExchanges, shortResponseCount, questionCount } = directives.exchangeSummary;
    console.log(`    Exchanges: ${totalExchanges} total, ${shortResponseCount} short, ${questionCount} with questions`);

    if (paths.length > 1) console.log();
  }
}

// ── Output Formatting ───────────────────────────────────────────────

function printDigest(result: {
  sessionId: string;
  narrative: SessionNarrative;
  moments: SessionMoment[];
  transitions: IntentTransition[];
  outcomes: AcceptedOutcome[];
}): void {
  const { narrative, moments, transitions, outcomes } = result;

  // Header
  console.log(`Session: ${narrative.sessionShape}`);
  console.log();

  // Summary
  console.log(`Summary: ${narrative.summary}`);
  console.log();

  // Arcs
  if (narrative.arcs.length > 0) {
    console.log("Arcs:");
    for (const arc of narrative.arcs) {
      console.log(`  ◆ ${arc.title} (${arc.resolution})`);
      // Find progression items that belong to this arc's moments
      const arcMomentIds = new Set(arc.momentIds);
      const arcProgressions = narrative.progression.filter((_, idx) => {
        // Map progression items to moments by index
        return idx < moments.length && arcMomentIds.has(moments[idx]?.id);
      });
      for (const item of arcProgressions) {
        console.log(`    → ${item}`);
      }
    }
    console.log();
  }

  // Accepted outcomes
  if (outcomes.length > 0) {
    console.log("Accepted Outcomes:");
    for (const o of outcomes) {
      console.log(`  • ${o.statement}`);
    }
    console.log();
  }

  // Abandoned directions
  if (narrative.abandonedDirections.length > 0) {
    console.log("Abandoned:");
    for (const d of narrative.abandonedDirections) {
      console.log(`  • ${d}`);
    }
    console.log();
  }

  // Stats
  const high = moments.filter((m) => m.confidence === "high").length;
  const medium = moments.filter((m) => m.confidence === "medium").length;
  const low = moments.filter((m) => m.confidence === "low").length;
  console.log(
    `Moments: ${moments.length} total (${high} high, ${medium} medium, ${low} low confidence)`,
  );
  console.log(`Transitions: ${transitions.length}`);
}

function formatTime(date: Date): string {
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
