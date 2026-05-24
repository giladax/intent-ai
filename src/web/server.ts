import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { getClient } from "../storage/connection.js";
import {
  getSessionNarrative,
  getSessionMoments,
  getSessionTransitions,
  getSessionOutcomes,
  getChunkEvents,
} from "../storage/queries.js";
import { buildSystemPrompt, loadDigest } from "../cli/explore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SONNET_MODEL = "claude-sonnet-4-6";

// ── In-memory sync job tracking (survives page refresh, not server restart) ──
interface SyncJob {
  id: string;
  repoId: string;
  phase: "discovering" | "digesting" | "selecting" | "proposing" | "reviewing" | "applying" | "done" | "error";
  sessions?: any[];
  selectedSessionIds?: string[];
  proposal?: any;
  // Cached synthesis result — what was reviewed is exactly what gets applied
  cachedPlan?: any;
  cachedSpecs?: any[];
  digestedCount?: number;
  digestTotal?: number;
  error?: string;
  startedAt: number;
}
const syncJobs = new Map<string, SyncJob>();
const JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes (synthesis is slow)

function getActiveJob(repoId: string): SyncJob | null {
  const job = syncJobs.get(repoId);
  if (!job) return null;
  if (Date.now() - job.startedAt > JOB_TTL_MS) {
    syncJobs.delete(repoId);
    return null;
  }
  return job;
}

function upsertJob(repoId: string, update: Partial<SyncJob>): SyncJob {
  const existing = syncJobs.get(repoId);
  const job: SyncJob = {
    id: existing?.id ?? crypto.randomUUID(),
    repoId,
    phase: "discovering",
    startedAt: existing?.startedAt ?? Date.now(),
    ...existing,
    ...update,
  };
  syncJobs.set(repoId, job);
  return job;
}

export async function startWebServer(port: number): Promise<void> {
  const app = express();
  app.use(express.json());

  // Serve static files from public/
  app.use(express.static(join(__dirname, "public")));

  // ── Projects ──────────────────────────────────────────────────────

  app.get("/api/projects", async (_req, res) => {
    try {
      const sql = getClient();
      const rows = await sql`SELECT * FROM projects ORDER BY created_at DESC`;
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/projects", async (req, res) => {
    try {
      const { name, path } = req.body;
      if (!name || !path) {
        res.status(400).json({ error: "name and path are required" });
        return;
      }
      const sql = getClient();
      const rows = await sql`INSERT INTO projects (name, path) VALUES (${name}, ${path}) RETURNING *`;
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Features ──────────────────────────────────────────────────────

  app.get("/api/projects/:id/features", async (req, res) => {
    try {
      const sql = getClient();
      const rows = await sql`
        SELECT f.*, COUNT(fs.session_id) AS session_count
        FROM features f
        LEFT JOIN feature_sessions fs ON fs.feature_id = f.id
        WHERE f.project_id = ${req.params.id}
        GROUP BY f.id
        ORDER BY f.created_at DESC`;
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/projects/:id/features", async (req, res) => {
    try {
      const { name, description } = req.body;
      if (!name) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      const sql = getClient();
      const rows = await sql`INSERT INTO features (project_id, name, description) VALUES (${req.params.id}, ${name}, ${description ?? ""}) RETURNING *`;
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Feature Detail ────────────────────────────────────────────────

  app.get("/api/features/:id", async (req, res) => {
    try {
      const sql = getClient();
      const featureRows = await sql`SELECT * FROM features WHERE id = ${req.params.id}`;
      if (featureRows.length === 0) {
        res.status(404).json({ error: "feature not found" });
        return;
      }
      const feature = featureRows[0];

      // Get sessions tagged to this feature with their narratives
      const sessionRows = await sql`
        SELECT s.*, fs.role, n.summary AS narrative_summary, n.session_shape AS narrative_shape
        FROM feature_sessions fs
        JOIN sessions s ON s.id = fs.session_id
        LEFT JOIN narratives n ON n.session_id = s.id
        WHERE fs.feature_id = ${req.params.id}
        ORDER BY s.started_at ASC NULLS LAST`;

      // Get moment counts per session
      const momentCounts = await sql`
        SELECT m.session_id, COUNT(*) AS count
        FROM moments m
        JOIN feature_sessions fs ON fs.session_id = m.session_id
        WHERE fs.feature_id = ${req.params.id}
        GROUP BY m.session_id`;

      const countMap = new Map<string, number>();
      for (const mc of momentCounts) {
        countMap.set(mc.session_id, Number(mc.count));
      }

      const sessions = sessionRows.map((s: any) => ({
        id: s.id,
        sourceType: s.source_type,
        sourcePath: s.source_path,
        sessionShape: s.session_shape,
        startedAt: s.started_at,
        endedAt: s.ended_at,
        createdAt: s.created_at,
        role: s.role,
        narrativeSummary: s.narrative_summary,
        narrativeShape: s.narrative_shape,
        momentCount: countMap.get(s.id) ?? 0,
      }));

      // Build story from concatenated summaries
      const story = sessions
        .filter((s: any) => s.narrativeSummary)
        .map((s: any) => s.narrativeSummary)
        .join("\n\n---\n\n");

      res.json({ feature, sessions, story });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Feature Session Tagging ───────────────────────────────────────

  app.post("/api/features/:id/sessions", async (req, res) => {
    try {
      const { sessionId, role } = req.body;
      if (!sessionId || !role) {
        res.status(400).json({ error: "sessionId and role are required" });
        return;
      }
      const sql = getClient();
      await sql`INSERT INTO feature_sessions (feature_id, session_id, role) VALUES (${req.params.id}, ${sessionId}, ${role}) ON CONFLICT DO NOTHING`;
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.delete("/api/features/:id/sessions/:sid", async (req, res) => {
    try {
      const sql = getClient();
      await sql`DELETE FROM feature_sessions WHERE feature_id = ${req.params.id} AND session_id = ${req.params.sid}`;
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Sessions ──────────────────────────────────────────────────────

  app.get("/api/sessions", async (_req, res) => {
    try {
      const sql = getClient();
      const rows = await sql`
        SELECT s.id, s.source_type, s.source_path, s.session_shape, s.started_at, s.ended_at, s.created_at,
               n.summary AS narrative_summary,
               (SELECT COUNT(*) FROM moments m WHERE m.session_id = s.id) AS moment_count,
               COALESCE(
                 (SELECT json_agg(json_build_object('featureId', fs.feature_id, 'role', fs.role))
                  FROM feature_sessions fs WHERE fs.session_id = s.id),
                 '[]'::json
               ) AS features,
               COALESCE(
                 (SELECT json_agg(json_build_object('topicId', t.id, 'topicName', t.name))
                  FROM topic_sessions ts
                  JOIN topics t ON t.id = ts.topic_id
                  WHERE ts.session_id = s.id),
                 '[]'::json
               ) AS topics
        FROM sessions s
        LEFT JOIN narratives n ON n.session_id = s.id
        ORDER BY s.created_at DESC`;
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/sessions/:id", async (req, res) => {
    try {
      const sessionId = req.params.id;
      const [narrative, moments, transitions, outcomes] = await Promise.all([
        getSessionNarrative(sessionId),
        getSessionMoments(sessionId),
        getSessionTransitions(sessionId),
        getSessionOutcomes(sessionId),
      ]);

      const sql = getClient();
      const sessionRows = await sql`SELECT * FROM sessions WHERE id = ${sessionId}`;
      const session = sessionRows[0] ?? null;

      res.json({ session, narrative, moments, transitions, outcomes });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Moment Events Drill-down ──────────────────────────────────────

  app.get("/api/sessions/:id/moments/:mid/events", async (req, res) => {
    try {
      const sql = getClient();
      const momentRows = await sql`SELECT chunk_id FROM moments WHERE id = ${req.params.mid}`;
      if (momentRows.length === 0 || !momentRows[0].chunk_id) {
        res.json([]);
        return;
      }
      const events = await getChunkEvents(req.params.id, momentRows[0].chunk_id);
      res.json(events);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Topics ───────────────────────────────────────────────────────

  app.get("/api/topics", async (req, res) => {
    try {
      const repoId = req.query.repoId as string;
      if (!repoId) {
        res.status(400).json({ error: "repoId query parameter is required" });
        return;
      }
      const sql = getClient();
      const rows = await sql`
        SELECT t.id, t.name, t.summary, t.parent_topic_id, t.updated_at,
          (SELECT count(*) FROM insights i WHERE i.topic_id = t.id AND i.status = 'active') as insight_count,
          (SELECT count(DISTINCT ts.session_id) FROM topic_sessions ts WHERE ts.topic_id = t.id) as session_count,
          (SELECT count(*) FROM brain_versions bv WHERE bv.repo_id = t.repo_id) as update_count
        FROM topics t WHERE t.repo_id = ${repoId}
        ORDER BY t.name`;
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/topics/:id", async (req, res) => {
    try {
      const sql = getClient();
      const topicRows = await sql`SELECT * FROM topics WHERE id = ${req.params.id}`;
      if (topicRows.length === 0) {
        res.status(404).json({ error: "topic not found" });
        return;
      }
      const topic = topicRows[0];

      // Active insights with evidence
      const insights = await sql`
        SELECT i.*,
          COALESCE(
            (SELECT json_agg(json_build_object('id', ie.id, 'reasoning', ie.reasoning))
             FROM insight_evidence ie WHERE ie.insight_id = i.id),
            '[]'::json
          ) AS evidence
        FROM insights i
        WHERE i.topic_id = ${req.params.id} AND i.status = 'active'
        ORDER BY i.created_at DESC`;

      // Files
      const files = await sql`
        SELECT * FROM topic_files
        WHERE topic_id = ${req.params.id}
        ORDER BY file_path`;

      // Sessions that contributed
      const sessions = await sql`
        SELECT s.id, s.source_type, s.source_path, s.session_shape, s.started_at, s.ended_at,
               n.summary AS narrative_summary,
               (SELECT COUNT(*) FROM moments m WHERE m.session_id = s.id) AS moment_count
        FROM topic_sessions ts
        JOIN sessions s ON s.id = ts.session_id
        LEFT JOIN narratives n ON n.session_id = s.id
        WHERE ts.topic_id = ${req.params.id}
        ORDER BY s.started_at ASC NULLS LAST`;

      // Related topics
      const relatedTopics = await sql`
        SELECT t2.id, t2.name, tr.relationship
        FROM topic_relations tr
        JOIN topics t2 ON t2.id = tr.related_topic_id
        WHERE tr.topic_id = ${req.params.id}
        ORDER BY t2.name`;

      res.json({
        topic: { id: topic.id, name: topic.name, summary: topic.summary },
        insights: insights.map((i: any) => ({
          id: i.id,
          category: i.category,
          statement: i.statement,
          confidence: Number(i.confidence),
        })),
        files: files.map((f: any) => ({
          file_path: f.file_path,
          role: f.role,
        })),
        sessions: sessions.map((s: any) => ({
          session_id: s.id,
          session_shape: s.session_shape,
          summary: s.narrative_summary,
          started_at: s.started_at,
          moment_count: Number(s.moment_count),
        })),
        relatedTopics: relatedTopics.map((r: any) => ({
          id: r.id,
          name: r.name,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Brain Cards ───────────────────────────────────────────────────

  app.get("/api/brain/cards/:repoId", async (req, res) => {
    try {
      const sql = getClient();
      const cards = await sql`
        SELECT node_name, level, summary, parent_node, children, insights, files, sessions
        FROM brain_cards WHERE repo_id = ${req.params.repoId}
        ORDER BY level, node_name
      `;
      res.json(cards);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/brain/cards/:repoId/:nodeName", async (req, res) => {
    try {
      const sql = getClient();
      const [card] = await sql`
        SELECT node_name, level, summary, parent_node, children, insights, files, related, sessions
        FROM brain_cards WHERE repo_id = ${req.params.repoId} AND node_name = ${req.params.nodeName}
      `;
      if (!card) { res.status(404).json({ error: "Card not found" }); return; }
      res.json(card);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Chat (SSE streaming) ──────────────────────────────────────────

  app.post("/api/chat", async (req, res) => {
    try {
      const { question, featureId, sessionId, topicId, history } = req.body;

      if (!question) {
        res.status(400).json({ error: "question is required" });
        return;
      }

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
        return;
      }

      // Build system prompt based on scope
      let systemPrompt = "";

      if (featureId) {
        // Feature-scoped: load all sessions for this feature
        const sql = getClient();
        const featureRows = await sql`SELECT * FROM features WHERE id = ${featureId}`;
        const featureName = featureRows[0]?.name ?? "Unknown Feature";

        const sessionRows = await sql`
          SELECT s.id FROM feature_sessions fs
          JOIN sessions s ON s.id = fs.session_id
          WHERE fs.feature_id = ${featureId}
          ORDER BY s.started_at ASC NULLS LAST`;

        const digests = [];
        for (const row of sessionRows) {
          try {
            const digest = await loadDigest(row.id);
            digests.push(digest);
          } catch {
            // Skip sessions without complete digests
          }
        }

        if (digests.length === 0) {
          systemPrompt = `You are an execution memory assistant for the feature "${featureName}". No session digests are available yet. Let the user know they need to tag sessions to this feature first.`;
        } else {
          const sessionContexts = digests.map((d, i) => {
            const prompt = buildSystemPrompt(d);
            // Extract just the digest section
            const digestStart = prompt.indexOf("## Session Digest");
            return `### Session ${i + 1}\n${digestStart >= 0 ? prompt.slice(digestStart) : prompt}`;
          }).join("\n\n---\n\n");

          systemPrompt = `You are an execution memory assistant. You have access to detailed digests of ${digests.length} coding sessions related to the feature "${featureName}". Answer questions about what happened across these sessions, how understanding evolved, what decisions were made and why.

${sessionContexts}

## Rules
- Answer based on the evidence in the digests. Don't speculate beyond what the data shows.
- When attributing decisions, use the agency field (developer vs ai vs collaborative).
- Quote the developer's actual words when available (from evidence).
- If asked about something not covered by the digests, say so.
- Keep responses concise but thorough. Use evidence to support your points.
- When referencing events, indicate which session they came from.`;
        }
      } else if (topicId) {
        // Topic-scoped: load insights and session digests for this topic
        const sql = getClient();
        const topicRows = await sql`SELECT * FROM topics WHERE id = ${topicId}`;
        const topicName = topicRows[0]?.name ?? "Unknown Topic";
        const topicSummary = topicRows[0]?.summary ?? "";

        const insightRows = await sql`
          SELECT i.statement, i.category, i.confidence
          FROM insights i
          WHERE i.topic_id = ${topicId} AND i.status = 'active'
          ORDER BY i.created_at DESC`;

        const sessionRows = await sql`
          SELECT s.id FROM topic_sessions ts
          JOIN sessions s ON s.id = ts.session_id
          WHERE ts.topic_id = ${topicId}
          ORDER BY s.started_at ASC NULLS LAST`;

        const digests = [];
        for (const row of sessionRows) {
          try {
            const digest = await loadDigest(row.id);
            digests.push(digest);
          } catch {
            // Skip sessions without complete digests
          }
        }

        const insightsText = insightRows.length > 0
          ? insightRows.map((i: any, idx: number) => `${idx + 1}. [${i.category}] (confidence: ${i.confidence}) ${i.statement}`).join("\n")
          : "No insights recorded yet.";

        const sessionContexts = digests.map((d, i) => {
          const prompt = buildSystemPrompt(d);
          const digestStart = prompt.indexOf("## Session Digest");
          return `### Session ${i + 1}\n${digestStart >= 0 ? prompt.slice(digestStart) : prompt}`;
        }).join("\n\n---\n\n");

        systemPrompt = `You are a brain assistant for the topic "${topicName}".${topicSummary ? ` Topic summary: ${topicSummary}` : ""}

## Known Insights
${insightsText}

${digests.length > 0 ? `## Session Digests (${digests.length} sessions contributed)\n${sessionContexts}` : "No session digests available yet."}

## Rules
- Answer based on the evidence in the insights and digests. Don't speculate beyond what the data shows.
- When attributing decisions, use the agency field (developer vs ai vs collaborative).
- Quote the developer's actual words when available (from evidence).
- If asked about something not covered by the data, say so.
- Keep responses concise but thorough. Use evidence to support your points.
- When referencing events, indicate which session they came from.`;
      } else if (sessionId) {
        // Session-scoped
        try {
          const digest = await loadDigest(sessionId);
          systemPrompt = buildSystemPrompt(digest);
        } catch (err) {
          systemPrompt = `You are an execution memory assistant. The session ${sessionId} could not be loaded: ${err instanceof Error ? err.message : String(err)}`;
        }
      } else {
        systemPrompt = `You are an execution memory assistant for AI-assisted development sessions. The user hasn't selected a specific feature or session yet. Help them navigate — suggest they select a feature or session from the sidebar to start exploring.`;
      }

      // Set up SSE
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const client = new Anthropic({ apiKey });

      // Build messages from history
      const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
      if (history && Array.isArray(history)) {
        for (const h of history.slice(-20)) {
          messages.push({ role: h.role, content: h.content });
        }
      }
      messages.push({ role: "user", content: question });

      const stream = client.messages.stream({
        model: SONNET_MODEL,
        max_tokens: 4096,
        temperature: 0,
        system: systemPrompt,
        messages,
      });

      stream.on("text", (text) => {
        res.write(`data: ${JSON.stringify({ type: "text", content: text })}\n\n`);
      });

      stream.on("end", () => {
        res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        res.end();
      });

      stream.on("error", (err) => {
        res.write(`data: ${JSON.stringify({ type: "error", content: String(err) })}\n\n`);
        res.end();
      });
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: String(err) });
      }
    }
  });

  // ── Timeline ─────────────────────────────────────────────────────

  app.get("/api/timeline", async (req, res) => {
    try {
      const repoId = req.query.repoId as string;
      if (!repoId) { res.status(400).json({ error: "repoId required" }); return; }

      const sql = getClient();

      // Get brain versions for this repo
      const versions = await sql`
        SELECT bv.id, bv.commit_sha, bv.created_at,
          (SELECT count(*)::int FROM topics t WHERE t.repo_id = bv.repo_id) as topic_count,
          (SELECT count(*)::int FROM insights i JOIN topics t ON i.topic_id = t.id WHERE t.repo_id = bv.repo_id) as insight_count
        FROM brain_versions bv
        WHERE bv.repo_id = ${repoId}
        ORDER BY bv.created_at DESC
      `;

      // Get project source_path to run git log
      const [project] = await sql`SELECT path FROM projects WHERE id = ${repoId}`;
      let commits: Array<{ sha: string; message: string; date: string }> = [];

      if (project?.path) {
        try {
          const { execSync } = await import("node:child_process");
          const log = execSync(
            'git log --pretty=format:"%H|%s|%aI" -20',
            { cwd: project.path, encoding: "utf-8" }
          );
          commits = log.trim().split("\n").filter(Boolean).map((line) => {
            const [sha, message, date] = line.split("|");
            return { sha, message, date };
          });
        } catch { /* not a git repo or no commits */ }
      }

      res.json({ commits, brainVersions: versions });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Brain Sync ─────────────────────────────────────────────────────

  // Sync status — lets the UI recover state after page refresh
  app.get("/api/brain/sync-status", (req, res) => {
    const repoId = req.query.repoId as string;
    if (!repoId) { res.status(400).json({ error: "repoId required" }); return; }
    const job = getActiveJob(repoId);
    res.json(job);
  });

  // Step 1: Discover — find new CC logs, digest them, score branch relevance
  app.post("/api/brain/discover", async (req, res) => {
    try {
      const { repoId } = req.body;
      if (!repoId) { res.status(400).json({ error: "repoId required" }); return; }

      upsertJob(repoId, { phase: "discovering", startedAt: Date.now() });

      const sql = getClient();
      const [project] = await sql`SELECT name, path FROM projects WHERE id = ${repoId}`;
      if (!project) {
        upsertJob(repoId, { phase: "error", error: "Project not found" });
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const projectName = project.name;
      const projectPathSlug = project.path.replace(/\//g, "-");

      // 1. Count undigested CC logs (don't digest them here — too slow)
      const { discoverLogs } = await import("../utils/log-discovery.js");
      const logPaths = await discoverLogs(20, projectPathSlug);
      // Check which are already digested by matching filename UUIDs
      const { basename } = await import("node:path");
      const allSourceHashes = await sql`SELECT source_hash FROM sessions WHERE source_hash IS NOT NULL`;
      const digestedHashes = new Set(allSourceHashes.map((r: any) => r.source_hash));
      const undigestedPaths = logPaths.filter(p => !digestedHashes.has(basename(p, ".jsonl")));
      const digestedCount = 0;

      // 2. Find unprocessed sessions for this repo
      const sessions = await sql`
        SELECT s.id, s.session_shape, LEFT(n.summary, 120) as summary,
               s.started_at, s.ended_at
        FROM sessions s
        LEFT JOIN narratives n ON n.session_id = s.id
        WHERE n.id IS NOT NULL
          AND (
            s.source_path LIKE ${"%" + projectName + "%"}
            OR s.source_path LIKE ${"%" + projectPathSlug + "%"}
          )
          AND NOT EXISTS (
            SELECT 1 FROM topic_sessions ts WHERE ts.session_id = s.id
          )
        ORDER BY s.started_at DESC
        LIMIT 10
      `;

      if (sessions.length === 0) {
        syncJobs.delete(repoId);
        res.json({ status: "up_to_date", digestedCount, undigestedCount: undigestedPaths.length, sessions: [] });
        return;
      }

      // 3. Compute branch relevance for each session
      let branchFiles: Set<string> = new Set();
      let commitTimestamps: Date[] = [];
      try {
        const { execSync } = await import("node:child_process");
        // Files changed on this branch vs main
        const mainBranch = execSync("git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || echo refs/heads/main",
          { cwd: project.path, encoding: "utf-8" }).trim().replace("refs/remotes/origin/", "").replace("refs/heads/", "");
        const diffFiles = execSync(`git diff ${mainBranch}...HEAD --name-only 2>/dev/null || true`,
          { cwd: project.path, encoding: "utf-8" }).trim();
        if (diffFiles) branchFiles = new Set(diffFiles.split("\n").filter(Boolean));

        // Commit timestamps on this branch
        const logOutput = execSync(`git log ${mainBranch}..HEAD --format="%aI" 2>/dev/null || true`,
          { cwd: project.path, encoding: "utf-8" }).trim();
        if (logOutput) commitTimestamps = logOutput.split("\n").filter(Boolean).map(d => new Date(d));
      } catch { /* not a git repo or no main branch */ }

      // Score each session
      const scoredSessions = [];
      for (const s of sessions) {
        // File overlap: session files ∩ branch files
        const sessionFiles = await sql`
          SELECT DISTINCT unnest(files_affected) as file_path
          FROM normalized_events
          WHERE session_id = ${s.id} AND files_affected IS NOT NULL
        `;
        const sessionFileSet = new Set(sessionFiles.map((f: any) => f.file_path));
        const fileOverlap = [...sessionFileSet].filter(f => {
          // Normalize: session files may be absolute, branch files relative
          const rel = f.replace(project.path + "/", "");
          return branchFiles.has(f) || branchFiles.has(rel);
        });
        const fileScore = sessionFileSet.size > 0 ? fileOverlap.length / sessionFileSet.size : 0;

        // Time overlap: session timerange ∩ commit timestamps
        const sessionStart = s.started_at ? new Date(s.started_at) : null;
        const sessionEnd = s.ended_at ? new Date(s.ended_at) : null;
        let timeScore = 0;
        if (sessionStart && sessionEnd && commitTimestamps.length > 0) {
          const overlapping = commitTimestamps.filter(ct =>
            ct >= sessionStart && ct <= new Date(sessionEnd.getTime() + 30 * 60 * 1000) // +30min buffer
          );
          timeScore = overlapping.length > 0 ? 1 : 0;
        }

        let confidence: "high" | "medium" | "low";
        if (fileScore > 0 && timeScore > 0) confidence = "high";
        else if (fileScore > 0 || timeScore > 0) confidence = "medium";
        else confidence = "low";

        scoredSessions.push({
          id: s.id,
          shape: s.session_shape,
          summary: s.summary,
          date: s.started_at,
          confidence,
          fileScore: Math.round(fileScore * 100),
          timeScore: Math.round(timeScore * 100),
          selected: confidence !== "low", // auto-select high + medium
        });
      }

      upsertJob(repoId, { phase: "selecting", sessions: scoredSessions, digestedCount });

      res.json({
        status: "sessions_found",
        digestedCount,
        undigestedCount: undigestedPaths.length,
        sessions: scoredSessions,
      });
    } catch (err) {
      upsertJob(repoId, { phase: "error", error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // ── SSE helper ──────────────────────────────────────────────────────
  function sendSSE(res: express.Response, data: any) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  // Step 2: Propose — dry run on selected sessions, return diff (SSE streaming)
  app.post("/api/brain/propose", async (req, res) => {
    try {
      const { repoId, sessionIds } = req.body;
      if (!repoId || !sessionIds?.length) {
        res.status(400).json({ error: "repoId and sessionIds required" });
        return;
      }

      // Set up SSE
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });

      upsertJob(repoId, { phase: "proposing" });

      sendSSE(res, { phase: "extracting", message: `Extracting fragments from ${sessionIds.length} session${sessionIds.length !== 1 ? "s" : ""}...` });

      const { synthesizeV2 } = await import("../pipeline/brain-synthesis.js");

      sendSSE(res, { phase: "organizing", message: "Building knowledge tree..." });

      const { plan, specs } = await synthesizeV2(sessionIds, repoId, { dryRun: true });

      sendSSE(res, { phase: "organizing", message: `Plan: ${plan.assignments.length} assignments, ${plan.merges.length} merge${plan.merges.length !== 1 ? "s" : ""}` });

      // Build human-readable diff
      const changes = plan.assignments.map((a: any) => ({
        type: a.action === "create" ? "add" : "update",
        spec: a.targetSpec,
        level: a.level,
        parent: a.parentSpec || null,
      }));

      const seen = new Set<string>();
      const uniqueChanges = changes.filter((c: any) => {
        if (seen.has(c.spec)) return false;
        seen.add(c.spec);
        return true;
      });

      const merges = plan.merges.map((m: any) => ({
        type: "merge" as const,
        from: m.specs,
        into: m.intoName,
        level: m.level,
        parent: m.parentSpec || null,
      }));

      const proposalResult = {
        status: "changes_proposed",
        sessionIds,
        changes: [...uniqueChanges, ...merges],
        plan,
        specs: specs.map((s: any) => ({
          name: s.name,
          summary: (s.summary || "").slice(0, 200),
          insightCount: s.insights?.length || 0,
        })),
      };

      upsertJob(repoId, {
        phase: "reviewing",
        proposal: proposalResult,
        selectedSessionIds: sessionIds,
        cachedPlan: plan,
        cachedSpecs: specs,
      });

      sendSSE(res, { phase: "done", proposal: proposalResult });
      res.end();
    } catch (err) {
      upsertJob(repoId, { phase: "error", error: String(err) });
      if (!res.headersSent) {
        res.status(500).json({ error: String(err) });
      } else {
        sendSSE(res, { phase: "error", message: String(err) });
        res.end();
      }
    }
  });

  // Step 3: Apply — commit the cached proposal (no re-synthesis)
  app.post("/api/brain/apply", async (req, res) => {
    try {
      const { repoId } = req.body;
      const job = getActiveJob(repoId);

      if (!repoId) {
        res.status(400).json({ error: "repoId required" });
        return;
      }

      // Get cached synthesis from propose phase — what was reviewed is what gets applied
      const plan = job?.cachedPlan;
      const specs = job?.cachedSpecs;
      const sessionIds = job?.selectedSessionIds ?? job?.proposal?.sessionIds ?? req.body.sessionIds;

      if (!plan || !specs || !sessionIds?.length) {
        res.status(400).json({ error: "No cached proposal found. Run Synthesize first." });
        return;
      }

      // Set up SSE
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });

      upsertJob(repoId, { phase: "applying" });

      sendSSE(res, { phase: "applying", message: `Applying ${specs.length} spec${specs.length !== 1 ? "s" : ""} to database...` });

      // Apply the cached plan+specs to DB (same code synthesizeV2 uses internally)
      const { applyGraphPlan, createBrainVersion, normalizeName } = await import("../pipeline/brain-synthesis.js");
      const sql = getClient();

      // Build moment ID map
      const momentIdMap = new Map<string, string>();
      for (const sessionId of sessionIds) {
        const momentRows = await sql`SELECT id FROM moments WHERE session_id = ${sessionId} ORDER BY id`;
        for (const m of momentRows) momentIdMap.set(m.id, m.id);
      }

      await applyGraphPlan(repoId, sessionIds[0], plan, specs, momentIdMap);

      // Link all sessions to their assigned topics
      for (const sessionId of sessionIds.slice(1)) {
        for (const a of plan.assignments) {
          const [topic] = await sql`
            SELECT id FROM topics WHERE repo_id = ${repoId} AND LOWER(TRIM(name)) = ${normalizeName(a.targetSpec)}
          `;
          if (topic) {
            await sql`
              INSERT INTO topic_sessions (topic_id, session_id) VALUES (${topic.id}, ${sessionId})
              ON CONFLICT DO NOTHING
            `;
          }
        }
      }

      // Create brain version
      let commitSha: string | undefined;
      try {
        const { execSync } = await import("node:child_process");
        commitSha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
      } catch { /* not a git repo */ }
      await createBrainVersion(repoId, commitSha);

      sendSSE(res, { phase: "exporting", message: "Exporting to .repo/ markdown..." });

      // Export markdown
      const { generateAllMarkdown } = await import("../brain/generate-markdown.js");
      const { writeFileSync, mkdirSync } = await import("node:fs");
      const { resolve } = await import("node:path");

      const { brainMd, topics } = await generateAllMarkdown(repoId);
      const outDir = resolve(process.cwd(), ".repo");
      mkdirSync(resolve(outDir, "topics"), { recursive: true });
      writeFileSync(resolve(outDir, "brain.md"), brainMd);
      for (const t of topics) {
        writeFileSync(resolve(outDir, "topics", `${t.slug}.md`), t.content);
      }

      upsertJob(repoId, { phase: "done" });

      sendSSE(res, { phase: "done", result: { status: "applied", specsWritten: specs.length, merges: plan.merges.length } });
      res.end();
    } catch (err) {
      upsertJob(repoId, { phase: "error", error: String(err) });
      if (!res.headersSent) {
        res.status(500).json({ error: String(err) });
      } else {
        sendSSE(res, { phase: "error", message: String(err) });
        res.end();
      }
    }
  });

  // Step 0: Digest — run digest pipeline on undigested CC logs (SSE streaming)
  app.post("/api/brain/digest", async (req, res) => {
    try {
      const { repoId } = req.body;
      if (!repoId) { res.status(400).json({ error: "repoId required" }); return; }

      const sql = getClient();
      const [project] = await sql`SELECT name, path FROM projects WHERE id = ${repoId}`;
      if (!project) { res.status(404).json({ error: "Project not found" }); return; }

      const projectPathSlug = project.path.replace(/\//g, "-");

      // Set up SSE
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });

      // Find undigested logs
      const { discoverLogs } = await import("../utils/log-discovery.js");
      const { basename } = await import("node:path");
      const logPaths = await discoverLogs(20, projectPathSlug);
      const allSourceHashes = await sql`SELECT source_hash FROM sessions WHERE source_hash IS NOT NULL`;
      const digestedHashes = new Set(allSourceHashes.map((r: any) => r.source_hash));
      const undigestedPaths = logPaths.filter(p => !digestedHashes.has(basename(p, ".jsonl")));

      // Track job state so page refresh can recover
      upsertJob(repoId, { phase: "digesting", digestedCount: 0, digestTotal: undigestedPaths.length, startedAt: Date.now() });

      sendSSE(res, { phase: "digesting", message: `Digesting ${undigestedPaths.length} session(s)...`, total: undigestedPaths.length });

      let digestedCount = 0;
      let errorCount = 0;
      for (const logPath of undigestedPaths) {
        const logName = basename(logPath, ".jsonl").slice(0, 8);
        sendSSE(res, { phase: "digesting", message: `Digesting session ${logName}... (${digestedCount + 1}/${undigestedPaths.length})`, progress: digestedCount, total: undigestedPaths.length });
        try {
          const { runPipeline } = await import("../pipeline/orchestrator.js");
          await runPipeline(logPath);
          digestedCount++;
          upsertJob(repoId, { phase: "digesting", digestedCount });
          sendSSE(res, { phase: "digesting", message: `Digested ${logName} ✓ (${digestedCount}/${undigestedPaths.length})`, progress: digestedCount, total: undigestedPaths.length });
        } catch (err: any) {
          if (!err.message?.includes("already digested")) {
            errorCount++;
            sendSSE(res, { phase: "digesting", message: `Error on ${logName}: ${err.message?.slice(0, 80)}` });
          } else {
            digestedCount++;
            upsertJob(repoId, { phase: "digesting", digestedCount });
          }
        }
      }

      upsertJob(repoId, { phase: "done", digestedCount });
      sendSSE(res, { phase: "done", digestedCount, errorCount });
      res.end();
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: String(err) });
      } else {
        sendSSE(res, { phase: "error", message: String(err) });
        res.end();
      }
    }
  });

  // SPA fallback — serve index.html for non-API routes
  app.get("/{*path}", (_req, res) => {
    res.sendFile(join(__dirname, "public", "index.html"));
  });

  app.listen(port, () => {
    console.log(`intent web dashboard running at http://localhost:${port}`);
  });
}
