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
  .command("scaffold")
  .description("Generate AGENTS.md from brain knowledge")
  .option("--repo <repoId>", "Repository ID")
  .option("--output <path>", "Output path", "AGENTS.md")
  .action(async (opts: { repo?: string; output: string }) => {
    const { generateAgentsMd } = await import("../brain/generate-scaffold.js");
    const { closeDb, getClient } = await import("../storage/connection.js");
    const { writeFileSync } = await import("node:fs");
    try {
      const sql = getClient();

      // Determine repo ID
      let repoId: string;
      if (opts.repo) {
        repoId = opts.repo;
      } else {
        const [first] = await sql`SELECT id, name FROM projects ORDER BY created_at LIMIT 1`;
        if (!first) {
          console.error("No projects found. Run 'intent digest' first.");
          await closeDb();
          process.exit(1);
        }
        repoId = first.id as string;
        console.log(`Using project: ${first.name}`);
      }

      const [projectRow] = await sql`SELECT name FROM projects WHERE id = ${repoId}`;
      const projectName = (projectRow?.name ?? "project") as string;

      // Load topics
      const allTopics = await sql`SELECT id, name, summary FROM topics WHERE repo_id = ${repoId} ORDER BY name`;

      const topicData = await Promise.all(allTopics.map(async (t: any) => {
        const topicInsights = await sql`
          SELECT category, statement FROM insights
          WHERE topic_id = ${t.id} AND status = 'active'
          ORDER BY category, confidence DESC
        `;
        const patterns = await sql`
          SELECT type, statement, frequency FROM topic_patterns
          WHERE topic_id = ${t.id}
          ORDER BY frequency DESC
        `;
        const skills = await sql`
          SELECT name, status, steps, pitfalls, files FROM topic_skills
          WHERE topic_id = ${t.id}
          ORDER BY name
        `;
        const files = await sql`
          SELECT DISTINCT file_path, role FROM topic_files
          WHERE topic_id = ${t.id}
          ORDER BY file_path
        `;
        return {
          name: t.name as string,
          summary: (t.summary ?? "") as string,
          insights: topicInsights.map((i: any) => ({ category: i.category as string, statement: i.statement as string })),
          patterns: patterns.map((p: any) => ({ type: p.type as string, statement: p.statement as string, frequency: Number(p.frequency) })),
          skills: skills.map((s: any) => ({
            name: s.name as string,
            status: s.status as string,
            steps: (s.steps ?? []) as Array<{ order: number; instruction: string; files: string[] }>,
            pitfalls: (s.pitfalls ?? []) as string[],
            files: (s.files ?? []) as string[],
          })),
          files: files.map((f: any) => ({ path: f.file_path as string, role: (f.role ?? "") as string })),
        };
      }));

      const md = generateAgentsMd({ projectName, topics: topicData });
      writeFileSync(opts.output, md);
      console.log(`Scaffold written to ${opts.output} (${md.split("\n").length} lines)`);
      await closeDb();
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      await closeDb();
      process.exit(1);
    }
  });

program
  .command("mcp")
  .description("Start MCP server for brain queries (reads from .repo/ directory)")
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

program.parse();
