#!/usr/bin/env node

import "dotenv/config";
import { Command } from "commander";
import { up, down } from "./infra.js";
import { registerDigestCommand } from "./digest.js";
import { registerExploreCommand } from "./explore.js";

const program = new Command();

program
  .name("intent")
  .description("Execution memory system for Claude Code conversations")
  .version("1.0.0");

registerDigestCommand(program);
registerExploreCommand(program);

program
  .command("eval")
  .description("Run evaluation harness against digests")
  .action(() => {
    console.log("eval: not yet implemented");
  });

program
  .command("up")
  .description("Start database and run migrations")
  .action(() => {
    up();
  });

program
  .command("down")
  .description("Stop database")
  .action(() => {
    down();
  });

program
  .command("web")
  .description("Start the web dashboard")
  .option("-p, --port <port>", "Port", "3456")
  .action(async (opts: { port: string }) => {
    const { startWebServer } = await import("../web/server.js");
    await startWebServer(parseInt(opts.port));
  });

program
  .command("mcp")
  .description("Start MCP server — serves Feature context to agents")
  .action(async () => {
    const { startMcpServer } = await import("../mcp/server.js");
    await startMcpServer();
  });

program
  .command("observe")
  .description("Start the observe daemon for live Claude Code session tracking")
  .option("-p, --port <port>", "Port for hook server", "4317")
  .action(async (opts: { port: string }) => {
    const { startDaemon } = await import("../daemon/index.js");
    await startDaemon(parseInt(opts.port));
  });

program
  .command("events")
  .description("Query the activity event stream")
  .option("--category <prefix>", "Filter by category prefix")
  .option("--repo <repo>", "Filter by repo")
  .option("--branch <branch>", "Filter by branch")
  .option("--session <id>", "Filter by session ID")
  .option("--since <date>", "Events after this date")
  .option("--tags <tags>", "Filter by tags (comma-separated)")
  .option("--limit <n>", "Max events", "20")
  .action(async (opts: { category?: string; repo?: string; branch?: string; session?: string; since?: string; tags?: string; limit: string }) => {
    try {
      const { queryEvents } = await import("../storage/queries.js");
      const events = await queryEvents({
        categoryPrefix: opts.category,
        repo: opts.repo,
        branch: opts.branch,
        sessionId: opts.session,
        tags: opts.tags ? opts.tags.split(",") : undefined,
        since: opts.since ? new Date(opts.since) : undefined,
        limit: parseInt(opts.limit),
      });

      for (const event of events) {
        const time = event.timestamp.toISOString().slice(0, 16);
        const tags = event.tags.length ? ` [${event.tags.join(", ")}]` : "";
        process.stdout.write(`${time} | ${event.category} | ${event.actor} | ${event.summary}${tags}\n`);
      }

      if (events.length === 0) {
        process.stdout.write("No events found.\n");
      }

      const { closeDb } = await import("../storage/connection.js");
      await closeDb();
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });

program
  .command("observe-events")
  .description("Run observation layer over recent activity events")
  .option("--since <date>", "Observe events since date")
  .option("--category <prefix>", "Filter events by category")
  .option("--limit <n>", "Max events to observe", "50")
  .option("--dry-run", "Show observations without emitting")
  .action(async (opts: { since?: string; category?: string; limit: string; dryRun?: boolean }) => {
    try {
      const { queryEvents, emitEvents } = await import("../storage/queries.js");
      const { observeEvents } = await import("../pipeline/observe-events.js");

      const events = await queryEvents({
        since: opts.since ? new Date(opts.since) : undefined,
        categoryPrefix: opts.category,
        limit: parseInt(opts.limit),
      });

      process.stderr.write(`Observing ${events.length} events...\n`);

      if (events.length === 0) {
        process.stdout.write("No events to observe.\n");
        const { closeDb } = await import("../storage/connection.js");
        await closeDb();
        return;
      }

      const observations = await observeEvents(events);

      if (observations.length === 0) {
        process.stdout.write("No observations found.\n");
      } else {
        for (const obs of observations) {
          process.stdout.write(`[${obs.confidence}] ${obs.statement}\n`);
          if (obs.suggestedTags.length) {
            process.stdout.write(`  tags: ${obs.suggestedTags.join(", ")}\n`);
          }
        }
      }

      if (!opts.dryRun && observations.length > 0) {
        const obsEvents = observations.map((obs) => ({
          timestamp: new Date(),
          category: "observation",
          tags: obs.suggestedTags,
          actor: "system" as const,
          summary: obs.statement,
          metadata: {
            confidence: obs.confidence,
            supportingEventIds: obs.supportingEventIds,
          },
        }));
        await emitEvents(obsEvents);
        process.stderr.write(`Emitted ${obsEvents.length} observation events.\n`);
      }

      const { closeDb } = await import("../storage/connection.js");
      await closeDb();
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });

program.parse();
