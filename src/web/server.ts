import "dotenv/config";
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
               ) AS features
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

  // ── Chat (SSE streaming) ──────────────────────────────────────────

  app.post("/api/chat", async (req, res) => {
    try {
      const { question, featureId, sessionId, history } = req.body;

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

  // SPA fallback — serve index.html for non-API routes
  app.get("*", (_req, res) => {
    res.sendFile(join(__dirname, "public", "index.html"));
  });

  app.listen(port, () => {
    console.log(`intent web dashboard running at http://localhost:${port}`);
  });
}
