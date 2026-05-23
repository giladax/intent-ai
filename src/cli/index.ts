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
    const { synthesizeFromSession, storeTopics, loadExistingTopics, printTopics, createBrainVersion } = await import("../pipeline/brain-synthesis.js");
    const { closeDb, getClient } = await import("../storage/connection.js");
    try {
      const sql = getClient();

      // Resolve repo ID
      let repoId = opts.repo;
      if (!repoId && !opts.dryRun) {
        const [first] = await sql`SELECT id, name FROM projects ORDER BY created_at LIMIT 1`;
        if (first) {
          repoId = first.id;
          console.log(`Using project: ${first.name} (${first.id})`);
        } else {
          console.error("No projects found. Create one first or use --dry-run.");
          await closeDb();
          process.exit(1);
        }
      }

      for (const sessionId of sessionIds) {
        // Check if session already processed
        const [alreadyProcessed] = await sql`
          SELECT 1 FROM topic_sessions WHERE session_id = ${sessionId} LIMIT 1
        `;
        if (alreadyProcessed && !opts.dryRun) {
          console.log(`\nSession ${sessionId} already processed. Skipping.`);
          continue;
        }

        // Load existing brain state from DB
        const existingTopics = repoId ? await loadExistingTopics(repoId) : undefined;
        const topicCount = existingTopics?.length || 0;

        console.log(`\nSynthesizing from session ${sessionId}${topicCount > 0 ? ` (${topicCount} existing topics)` : ""}...`);
        const topics = await synthesizeFromSession(sessionId, existingTopics);
        printTopics(topics);

        // Store to DB unless dry-run
        if (!opts.dryRun && repoId) {
          // Build moment ID map (LLM receives UUIDs, passes them back)
          const momentRows = await sql`SELECT id FROM moments WHERE session_id = ${sessionId} ORDER BY id`;
          const momentIdMap = new Map<string, string>();
          for (const m of momentRows) {
            momentIdMap.set(m.id, m.id); // identity map — LLM should return actual UUIDs
          }

          await storeTopics(repoId, sessionId, topics, momentIdMap);
          const versionId = await createBrainVersion(repoId);
          console.log(`  Stored ${topics.length} topics. Brain version: ${versionId}`);
        }

        if (sessionIds.length > 1) {
          console.log("\n" + "=".repeat(60) + "\n");
        }
      }

      await closeDb();
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
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

program.parse();
