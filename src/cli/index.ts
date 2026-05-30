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
  .command("brain <sessionIds...>")
  .description("Synthesize brain topics from digested sessions. Multiple sessions build incrementally.")
  .option("--repo <repoId>", "Project/repo UUID to store topics under")
  .option("--dry-run", "Print topics without storing to DB")
  .action(async (sessionIds: string[], opts: { repo?: string; dryRun?: boolean }) => {
    const { synthesizeV2 } = await import("../pipeline/brain-synthesis.js");
    const { closeDb, getClient } = await import("../storage/connection.js");
    try {
      const sql = getClient();

      // Resolve repo ID — match first session's source_path to project path
      let repoId = opts.repo ?? null;
      if (!repoId && !opts.dryRun) {
        const [session] = await sql`SELECT source_path FROM sessions WHERE id = ${sessionIds[0]}`;
        if (session?.source_path) {
          const projects = await sql`SELECT id, name, path FROM projects ORDER BY length(path) DESC`;
          for (const p of projects) {
            if (session.source_path.includes(p.name) || session.source_path.includes(p.path.replace(/\//g, '-'))) {
              repoId = p.id;
              console.log(`Project: ${p.name}`);
              break;
            }
          }
        }
        if (!repoId) {
          const [first] = await sql`SELECT id, name FROM projects ORDER BY created_at LIMIT 1`;
          if (first) {
            repoId = first.id;
            console.log(`Project (default): ${first.name}`);
          } else {
            console.error("No projects found. Create one first or use --dry-run.");
            await closeDb();
            process.exit(1);
          }
        }
      }

      // Use a placeholder repoId for dry-run when none resolved
      const effectiveRepoId = repoId || "dry-run";

      console.log(`Synthesizing from ${sessionIds.length} session(s)...`);
      const { plan, specs } = await synthesizeV2(sessionIds, effectiveRepoId, { dryRun: opts.dryRun });

      // Print results
      console.log(`\nGraph plan: ${plan.assignments.length} assignments, ${plan.merges.length} merges, ${plan.splits.length} splits`);
      for (const spec of specs) {
        console.log(`\n## ${spec.name}`);
        console.log(spec.summary);
        for (const i of spec.insights) {
          console.log(`  [${i.category}] ${i.statement}`);
        }
      }

      if (!opts.dryRun) {
        console.log(`\nStored ${specs.length} specs. Brain version created.`);
      }

      await closeDb();
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      const { closeDb } = await import("../storage/connection.js");
      await closeDb();
      process.exit(1);
    }
  });

program
  .command("brain-classify <sessionId>")
  .description("Classify how a session relates to existing brain topics")
  .option("--repo <repoId>", "Project/repo UUID")
  .action(async (sessionId: string, opts: { repo?: string }) => {
    const { classifyRelevance, printRelevanceResult } = await import("../pipeline/brain-relevance.js");
    const { closeDb, getClient } = await import("../storage/connection.js");
    try {
      const sql = getClient();

      // Resolve repo ID
      let repoId = opts.repo;
      if (!repoId) {
        const [first] = await sql`SELECT id, name FROM projects ORDER BY created_at LIMIT 1`;
        if (first) {
          repoId = first.id;
          console.log(`Using project: ${first.name} (${first.id})`);
        } else {
          console.error("No projects found. Create one first.");
          await closeDb();
          process.exit(1);
        }
      }

      console.log(`Classifying relevance for session ${sessionId}...`);
      const result = await classifyRelevance(sessionId, repoId!);
      printRelevanceResult(result);

      await closeDb();
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      const { closeDb } = await import("../storage/connection.js");
      await closeDb();
      process.exit(1);
    }
  });

program
  .command("brain-export")
  .description("Generate .repo/ markdown from brain DB")
  .option("--repo <repoId>", "Project/repo UUID")
  .option("--out <dir>", "Output directory", ".repo")
  .action(async (opts: { repo?: string; out: string }) => {
    const { generateAllMarkdown } = await import("../brain/generate-markdown.js");
    const { closeDb, getClient } = await import("../storage/connection.js");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    try {
      const sql = getClient();

      let repoId = opts.repo;
      if (!repoId) {
        const [first] = await sql`SELECT id, name FROM projects ORDER BY created_at LIMIT 1`;
        if (first) {
          repoId = first.id;
          console.log(`Using project: ${first.name}`);
        } else {
          console.error("No projects found.");
          await closeDb();
          process.exit(1);
        }
      }

      const { brainMd, topics } = await generateAllMarkdown(repoId);

      const outDir = resolve(opts.out);
      const topicsDir = resolve(outDir, "topics");
      mkdirSync(topicsDir, { recursive: true });

      writeFileSync(resolve(outDir, "brain.md"), brainMd);
      console.log(`Wrote ${outDir}/brain.md`);

      for (const t of topics) {
        const path = resolve(topicsDir, `${t.slug}.md`);
        writeFileSync(path, t.content);
        console.log(`Wrote ${path}`);
      }

      console.log(`\nGenerated ${topics.length} topic files.`);
      await closeDb();
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      await closeDb();
      process.exit(1);
    }
  });

program
  .command("observe")
  .description("Start the observe daemon for live Claude Code session tracking")
  .option("-p, --port <port>", "Port for hook server", "4317")
  .action(async (opts: { port: string }) => {
    const { startDaemon } = await import("../daemon/index.js");
    await startDaemon(parseInt(opts.port));
  });

program.parse();
