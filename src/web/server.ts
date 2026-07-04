import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { getClient } from "../storage/connection.js";
import { OVERLAP } from "../pipeline/chunk.js";
import { computeWindowMembership } from "./window-membership.js";
import {
  getSessionNarrative,
  getSessionMoments,
  getSessionTransitions,
  getSessionOutcomes,
  getChunkEvents,
  emitEvents,
} from "../storage/queries.js";
import { buildSystemPrompt, loadDigest } from "../cli/explore.js";
import {
  composeCurrentUnderstanding,
  normalizeGlob,
  OBSERVATION_CATEGORY_PREFIX,
  buildReviewEvent,
  type ReviewAction,
  type ReviewedObservation,
} from "./observations.js";
import {
  buildJournal,
  type JournalEventRow,
  type JournalSessionRow,
} from "./journal.js";
import {
  joinArchive,
  readRawSessionArchive,
  type DigestedSessionRef,
} from "./archive.js";
import {
  buildStatsOverview,
  emptyStatsOverview,
  type CadenceDayRow,
  type SessionQualityRow,
  type FeatureMomentumRow,
} from "./stats.js";
import {
  buildProvenance,
  provenanceKind,
  isUuidLike,
  type ProvenanceKind,
} from "./provenance.js";

// Journal §7.3: the human's gate actions become timeline events. Failure-safe —
// a lost event never fails the review action itself.
async function emitReviewEvent(action: ReviewAction, obs: ReviewedObservation): Promise<void> {
  try {
    await emitEvents([buildReviewEvent(action, obs)]);
  } catch {
    // never fail the review on instrumentation
  }
}

// ── Pinned chat context ──────────────────────────────────────────────
// The chat dock pins page elements into the conversation. Each pinned item
// resolves server-side to real material: a feature dossier, a session digest,
// an activity event. Unknown kinds fall back to the label/summary the page sent.

interface PinnedItem {
  kind?: string;
  id?: string;
  label?: string;
  summary?: string;
}

async function buildPinnedContextSection(item: PinnedItem): Promise<string> {
  const sql = getClient();
  const label = item.label ?? "pinned item";
  let kind = item.kind ?? "note";
  let id = item.id ?? "";

  // Journal episode ids are prefixed: session:<uuid> · event:<uuid> · review:<uuid> · run:<id>
  if (kind === "episode") {
    const m = id.match(/^(session|event|review|run):(.+)$/);
    if (m) {
      kind = m[1] === "session" ? "session" : m[1] === "run" ? "run" : "event";
      id = m[2];
    } else {
      kind = "event";
    }
  }

  switch (kind) {
    case "feature": {
      const [f] = await sql`SELECT * FROM features WHERE id = ${id}`;
      if (!f) return `### Feature: ${label}\n(feature not found)`;
      const globs = await sql`SELECT glob FROM feature_files WHERE feature_id = ${id} ORDER BY length(glob) DESC LIMIT 20`;
      const narratives = await sql`
        SELECT n.summary FROM feature_sessions fs
        JOIN narratives n ON n.session_id = fs.session_id
        WHERE fs.feature_id = ${id}
        ORDER BY n.id DESC LIMIT 5`;
      const constraints = Array.isArray(f.constraints) ? f.constraints : [];
      const unknowns = Array.isArray(f.known_unknowns) ? f.known_unknowns : [];
      return [
        `### Feature: ${f.name}`,
        f.description ? `${f.description}` : "",
        f.current_understanding ? `**Current understanding:**\n${f.current_understanding}` : "**Current understanding:** (none yet)",
        constraints.length ? `**Constraints:**\n${constraints.map((c: string) => `- ${c}`).join("\n")}` : "",
        unknowns.length ? `**Known unknowns:**\n${unknowns.map((u: string) => `- ${u}`).join("\n")}` : "",
        globs.length ? `**File map:** ${globs.map((g: any) => g.glob).join(", ")}` : "",
        narratives.length ? `**Recent session narratives:**\n${narratives.map((n: any) => `- ${n.summary}`).join("\n")}` : "",
      ].filter(Boolean).join("\n\n");
    }
    case "session": {
      const digest = await loadDigest(id);
      const prompt = buildSystemPrompt(digest);
      const digestStart = prompt.indexOf("## Session Digest");
      return `### Session ${id.slice(0, 8)} (${label})\n${digestStart >= 0 ? prompt.slice(digestStart) : prompt}`;
    }
    case "observation":
    case "event": {
      const [e] = await sql`SELECT * FROM activity_events WHERE id = ${id}`;
      if (!e) return `### ${label}\n${item.summary ?? "(event not found)"}`;
      return [
        `### ${kind === "observation" ? "Observation" : "Activity event"}: ${label}`,
        `${e.summary}`,
        `category: ${e.category} · actor: ${e.actor} · at ${e.timestamp}${e.review_status ? ` · review: ${e.review_status}` : ""}`,
        e.metadata && Object.keys(e.metadata).length ? `metadata: ${JSON.stringify(e.metadata)}` : "",
      ].filter(Boolean).join("\n");
    }
    case "run": {
      const events = await sql`
        SELECT summary, category, actor FROM activity_events
        WHERE metadata->>'runId' = ${id}
        ORDER BY timestamp ASC LIMIT 20`;
      if (events.length === 0) return `### Run ${label}\n${item.summary ?? "(no events found)"}`;
      return `### Run: ${label}\n${events.map((e: any) => `- [${e.category}] ${e.summary}`).join("\n")}`;
    }
    default:
      return `### ${label}\n${item.summary ?? "(no detail — the user pinned this element from the page)"}`;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SONNET_MODEL = "claude-sonnet-4-6";

// ── In-memory digest job tracking (survives page refresh, not server restart) ──
interface DigestJob {
  id: string;
  repoId: string;
  phase: "digesting" | "done" | "error";
  digestedCount?: number;
  digestTotal?: number;
  error?: string;
  startedAt: number;
}
const digestJobs = new Map<string, DigestJob>();

function upsertJob(repoId: string, update: Partial<DigestJob>): DigestJob {
  const existing = digestJobs.get(repoId);
  const job: DigestJob = {
    id: existing?.id ?? crypto.randomUUID(),
    repoId,
    phase: "digesting",
    startedAt: existing?.startedAt ?? Date.now(),
    ...existing,
    ...update,
  };
  digestJobs.set(repoId, job);
  return job;
}

// ── Scheduled digestion (cron with elapse settings) ──────────────────
//
// An in-process scheduler: every `intervalMinutes` it scans ~/.claude/projects
// for each registered project and digests any JSONL that has been *quiet* for
// `debounceMinutes` (a log written moments ago is probably a live session —
// digesting mid-session wastes LLM calls and truncates the narrative).
// Settings persist to .intent/digest-schedule.json so they survive restarts.
// Emits digest:run events per the observability contract (§7.3).

interface DigestSchedule {
  enabled: boolean;
  intervalMinutes: number;
  debounceMinutes: number;
}

const SCHEDULE_PATH = join(process.cwd(), ".intent", "digest-schedule.json");
const DEFAULT_SCHEDULE: DigestSchedule = { enabled: false, intervalMinutes: 30, debounceMinutes: 10 };

function loadSchedule(): DigestSchedule {
  try {
    const raw = JSON.parse(readFileSync(SCHEDULE_PATH, "utf-8"));
    return {
      enabled: Boolean(raw.enabled),
      intervalMinutes: Math.max(1, Number(raw.intervalMinutes) || DEFAULT_SCHEDULE.intervalMinutes),
      debounceMinutes: Math.max(0, Number(raw.debounceMinutes) ?? DEFAULT_SCHEDULE.debounceMinutes),
    };
  } catch {
    return { ...DEFAULT_SCHEDULE };
  }
}

function saveSchedule(s: DigestSchedule): void {
  mkdirSync(dirname(SCHEDULE_PATH), { recursive: true });
  writeFileSync(SCHEDULE_PATH, JSON.stringify(s, null, 2));
}

let schedule: DigestSchedule = loadSchedule();
let scheduleTimer: ReturnType<typeof setInterval> | null = null;
let scheduleRunning = false;
let lastScheduledRun: { at: number; digested: number; skippedLive: number } | null = null;

async function runScheduledDigest(): Promise<void> {
  if (scheduleRunning) return; // never overlap runs
  scheduleRunning = true;
  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  const digestedIds: string[] = [];
  let skippedLive = 0;
  try {
    const sql = getClient();
    const projects = await sql`SELECT id, name, path FROM projects`;
    const { discoverLogs } = await import("../utils/log-discovery.js");
    const { basename } = await import("node:path");
    const { statSync } = await import("node:fs");
    const allSourceHashes = await sql`SELECT source_hash FROM sessions WHERE source_hash IS NOT NULL`;
    const digestedHashes = new Set(allSourceHashes.map((r: any) => r.source_hash));

    for (const project of projects) {
      const slug = project.path.replace(/\//g, "-");
      const logPaths = await discoverLogs(20, slug);
      for (const logPath of logPaths) {
        if (digestedHashes.has(basename(logPath, ".jsonl"))) continue;
        // Debounce: skip logs still being written to (probably a live session).
        try {
          const quietMs = Date.now() - statSync(logPath).mtimeMs;
          if (quietMs < schedule.debounceMinutes * 60 * 1000) {
            skippedLive++;
            continue;
          }
        } catch {
          continue;
        }
        try {
          const { runPipeline } = await import("../pipeline/orchestrator.js");
          const result = await runPipeline(logPath);
          digestedIds.push(result.sessionId);
        } catch (err: any) {
          if (!err?.message?.includes("already digested")) {
            console.error(`[digest-schedule] ${basename(logPath)}: ${err?.message ?? err}`);
          }
        }
      }
    }
  } catch (err) {
    console.error(`[digest-schedule] run failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    scheduleRunning = false;
    lastScheduledRun = { at: Date.now(), digested: digestedIds.length, skippedLive };
    if (digestedIds.length > 0) {
      try {
        await emitEvents([
          {
            timestamp: new Date(),
            category: "digest:run",
            tags: ["digest", "scheduled"],
            actor: "system:pipeline",
            summary: `Scheduled digestion caught up on ${digestedIds.length} session${digestedIds.length === 1 ? "" : "s"}${skippedLive > 0 ? ` (${skippedLive} still live, left for next pass)` : ""}.`,
            sourceType: "digest",
            sourceId: runId,
            metadata: { runId, sessionIds: digestedIds, durationMs: Date.now() - startedAt, skippedLive },
          },
        ]);
      } catch {
        // instrumentation never fails the run
      }
    }
  }
}

function applySchedule(): void {
  if (scheduleTimer) {
    clearInterval(scheduleTimer);
    scheduleTimer = null;
  }
  if (schedule.enabled) {
    scheduleTimer = setInterval(runScheduledDigest, schedule.intervalMinutes * 60 * 1000);
    // one pass shortly after enabling, so the user sees it work
    setTimeout(runScheduledDigest, 5_000);
  }
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

      // Feature↔file map (longest-glob-first, the resolver's precedence order).
      // Tolerate the table not existing yet (WS-A owns it) so the panel still loads.
      let files: any[] = [];
      try {
        files = await sql`
          SELECT id, glob, file_path, created_at
          FROM feature_files
          WHERE feature_id = ${req.params.id}
          ORDER BY length(glob) DESC, glob ASC`;
      } catch { files = []; }

      // Observations attached to this feature (approved + pending), newest first.
      let observations: any[] = [];
      try {
        observations = await sql`
          SELECT id, category, summary, review_status, created_at
          FROM activity_events
          WHERE feature_id = ${req.params.id}
            AND category LIKE ${OBSERVATION_CATEGORY_PREFIX + "%"}
          ORDER BY created_at DESC`;
      } catch { observations = []; }

      res.json({ feature, sessions, story, files, observations });
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

  // ── Feature Understanding (manual edit) ───────────────────────────
  // WS-B: lets a human set/curate Current Understanding, constraints, and
  // known-unknowns directly. Approving an observation also writes here.

  app.patch("/api/features/:id", async (req, res) => {
    try {
      const { currentUnderstanding, constraints, knownUnknowns } = req.body;
      const sql = getClient();

      if (currentUnderstanding !== undefined) {
        await sql`UPDATE features SET current_understanding = ${currentUnderstanding} WHERE id = ${req.params.id}`;
      }
      if (constraints !== undefined) {
        await sql`UPDATE features SET constraints = ${JSON.stringify(constraints)}::jsonb WHERE id = ${req.params.id}`;
      }
      if (knownUnknowns !== undefined) {
        await sql`UPDATE features SET known_unknowns = ${JSON.stringify(knownUnknowns)}::jsonb WHERE id = ${req.params.id}`;
      }

      const [feature] = await sql`SELECT * FROM features WHERE id = ${req.params.id}`;
      res.json({ feature });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Feature↔File Map ──────────────────────────────────────────────
  // WS-B: add/remove globs in feature_files. Resolver is longest-glob-wins
  // (implemented by WS-A in brain.enter); here we only manage the rows.

  app.get("/api/features/:id/files", async (req, res) => {
    try {
      const sql = getClient();
      const rows = await sql`
        SELECT id, glob, file_path, created_at
        FROM feature_files
        WHERE feature_id = ${req.params.id}
        ORDER BY length(glob) DESC, glob ASC`;
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/features/:id/files", async (req, res) => {
    try {
      const glob = normalizeGlob(req.body?.glob);
      if (!glob) {
        res.status(400).json({ error: "glob is required" });
        return;
      }
      // file_path is an optional concrete example/path; default to the glob.
      const filePath = (req.body?.filePath ?? req.body?.file_path ?? glob) as string;
      const sql = getClient();
      const [row] = await sql`
        INSERT INTO feature_files (feature_id, glob, file_path)
        VALUES (${req.params.id}, ${glob}, ${filePath})
        RETURNING id, glob, file_path, created_at`;
      res.json(row);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.delete("/api/features/:id/files/:fileId", async (req, res) => {
    try {
      const sql = getClient();
      await sql`DELETE FROM feature_files WHERE id = ${req.params.fileId} AND feature_id = ${req.params.id}`;
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Observation Review Queue ──────────────────────────────────────
  // WS-B: pending observations are activity_events rows with category
  // `observation:<kind>` and review_status = 'pending'. Approve promotes the
  // summary into features.current_understanding; reject sets rejected; edit
  // updates the summary. NO enum/CHECK on category or review_status — freeform.

  app.get("/api/observations/pending", async (req, res) => {
    try {
      const repoId = req.query.repoId as string | undefined;
      const sql = getClient();
      // Join through features (feature_id is denormalized TEXT) to surface the
      // feature name and to allow optional repo scoping. Compare f.id::text so a
      // non-uuid feature_id never throws a cast error. Unresolved observations
      // (null feature_id) are always included.
      const rows = repoId
        ? await sql`
          SELECT ae.id, ae.category, ae.summary, ae.feature_id, ae.review_status,
                 ae.created_at, f.name AS feature_name
          FROM activity_events ae
          LEFT JOIN features f ON f.id::text = ae.feature_id
          WHERE ae.review_status = 'pending'
            AND ae.category LIKE ${OBSERVATION_CATEGORY_PREFIX + "%"}
            AND (f.project_id = ${repoId} OR ae.feature_id IS NULL)
          ORDER BY ae.created_at DESC`
        : await sql`
          SELECT ae.id, ae.category, ae.summary, ae.feature_id, ae.review_status,
                 ae.created_at, f.name AS feature_name
          FROM activity_events ae
          LEFT JOIN features f ON f.id::text = ae.feature_id
          WHERE ae.review_status = 'pending'
            AND ae.category LIKE ${OBSERVATION_CATEGORY_PREFIX + "%"}
          ORDER BY ae.created_at DESC`;
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Approve — promote the observation summary into Current Understanding.
  app.post("/api/observations/:id/approve", async (req, res) => {
    try {
      const sql = getClient();
      const [obs] = await sql`
        SELECT id, summary, category, feature_id FROM activity_events WHERE id = ${req.params.id}`;
      if (!obs) {
        res.status(404).json({ error: "observation not found" });
        return;
      }

      // Promote into the feature's current understanding (if it resolves to one).
      let featureName: string | null = null;
      if (obs.feature_id) {
        const [feature] = await sql`
          SELECT id, name, current_understanding FROM features WHERE id::text = ${obs.feature_id}`;
        if (feature) {
          featureName = feature.name;
          const next = composeCurrentUnderstanding(feature.current_understanding, obs.summary);
          await sql`UPDATE features SET current_understanding = ${next} WHERE id = ${feature.id}`;
        }
      }

      await sql`UPDATE activity_events SET review_status = 'approved' WHERE id = ${req.params.id}`;
      await emitReviewEvent("approved", {
        id: obs.id,
        category: obs.category,
        featureId: obs.feature_id,
        featureName,
        summary: obs.summary,
      });
      res.json({ ok: true, status: "approved" });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Reject — mark rejected, no promotion.
  app.post("/api/observations/:id/reject", async (req, res) => {
    try {
      const sql = getClient();
      const result = await sql`
        UPDATE activity_events SET review_status = 'rejected'
        WHERE id = ${req.params.id} RETURNING id, summary, category, feature_id`;
      if (result.length === 0) {
        res.status(404).json({ error: "observation not found" });
        return;
      }
      await emitReviewEvent("rejected", {
        id: result[0].id,
        category: result[0].category,
        featureId: result[0].feature_id,
        summary: result[0].summary,
      });
      res.json({ ok: true, status: "rejected" });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Edit — update the observation summary (stays pending unless separately acted on).
  app.patch("/api/observations/:id", async (req, res) => {
    try {
      const summary = (req.body?.summary ?? "").toString();
      if (!summary.trim()) {
        res.status(400).json({ error: "summary is required" });
        return;
      }
      const sql = getClient();
      const result = await sql`
        UPDATE activity_events SET summary = ${summary}
        WHERE id = ${req.params.id} RETURNING id, summary, review_status, category, feature_id`;
      if (result.length === 0) {
        res.status(404).json({ error: "observation not found" });
        return;
      }
      await emitReviewEvent("edited", {
        id: result[0].id,
        category: result[0].category,
        featureId: result[0].feature_id,
        summary: result[0].summary,
      });
      res.json({ id: result[0].id, summary: result[0].summary, review_status: result[0].review_status });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Journal (design §8.3) ─────────────────────────────────────────
  // Read-side rendering over activity_events: episodes (grouped) + Pulse
  // (window stats). SQL stays thin — ALL grouping/pulse logic lives in the
  // pure journal.ts module. Session episode timing comes from the sessions
  // table (works around emit-events' digest-time timestamp collapse).

  app.get("/api/journal", async (req, res) => {
    try {
      const since = (req.query.since as string | undefined) || null;
      const actor = (req.query.actor as string | undefined) || undefined;
      const featureId = (req.query.featureId as string | undefined) || undefined;
      const limitRaw = parseInt((req.query.limit as string) ?? "", 10);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 200;

      const sql = getClient();

      // Window events — parameterized to avoid injection.
      const conds: string[] = ["TRUE"];
      const params: unknown[] = [];
      if (since) {
        params.push(since);
        conds.push(`timestamp >= $${params.length}`);
      }
      if (actor) {
        params.push(actor);
        conds.push(`actor = $${params.length}`);
      }
      if (featureId) {
        params.push(featureId);
        conds.push(`feature_id = $${params.length}`);
      }
      params.push(limit);
      const eventRows = await sql.unsafe(
        `SELECT id, timestamp, category, tags, actor, summary, metadata,
                source_type, session_id, feature_id, review_status
         FROM activity_events
         WHERE ${conds.join(" AND ")}
         ORDER BY timestamp DESC
         LIMIT $${params.length}`,
        params as any[],
      );

      const events: JournalEventRow[] = eventRows.map((r: any) => ({
        id: r.id as string,
        timestamp: new Date(r.timestamp as string).toISOString(),
        category: r.category as string,
        tags: (r.tags as string[]) ?? [],
        actor: r.actor as string,
        summary: r.summary as string,
        metadata: (r.metadata as Record<string, unknown>) ?? {},
        sourceType: (r.source_type as string | null) ?? null,
        sessionId: (r.session_id as string | null) ?? null,
        featureId: (r.feature_id as string | null) ?? null,
        reviewStatus: (r.review_status as string | null) ?? null,
      }));

      // Session timing from the sessions table (NOT event timestamps).
      const sessionIds = [...new Set(events.map((e) => e.sessionId).filter(Boolean))] as string[];
      let sessions: JournalSessionRow[] = [];
      if (sessionIds.length) {
        const sessionRows = await sql`
          SELECT s.id, s.started_at, s.ended_at, s.session_shape,
                 n.summary AS narrative_summary
          FROM sessions s
          LEFT JOIN narratives n ON n.session_id = s.id
          WHERE s.id = ANY(${sessionIds})`;
        sessions = sessionRows.map((r: any) => ({
          id: r.id as string,
          startedAt: r.started_at ? new Date(r.started_at as string).toISOString() : null,
          endedAt: r.ended_at ? new Date(r.ended_at as string).toISOString() : null,
          sessionShape: (r.session_shape as string | null) ?? null,
          narrativeSummary: (r.narrative_summary as string | null) ?? null,
        }));
      }

      // pendingReview is ALL-time (not window-bound) — a thin COUNT.
      const [{ count }] = await sql`
        SELECT COUNT(*)::int AS count FROM activity_events
        WHERE review_status = 'pending'
          AND category LIKE ${OBSERVATION_CATEGORY_PREFIX + "%"}`;

      const journal = buildJournal({
        events,
        sessions,
        since,
        pendingReview: Number(count) || 0,
      });
      res.json(journal);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Sessions ──────────────────────────────────────────────────────

  app.get("/api/sessions", async (req, res) => {
    try {
      const sql = getClient();
      const repoId = req.query.repoId as string | undefined;
      // Get project path slug for source_path matching
      const [proj] = repoId ? await sql`SELECT path FROM projects WHERE id = ${repoId}` : [null];
      const pathSlug = proj ? (proj.path as string).replace(/\//g, "-") : null;

      const rows = repoId && pathSlug
        ? await sql`
          SELECT s.id, s.source_type, s.source_path, s.session_shape, s.started_at, s.ended_at, s.created_at,
                 n.summary AS narrative_summary,
                 (SELECT COUNT(*) FROM moments m WHERE m.session_id = s.id) AS moment_count
          FROM sessions s
          LEFT JOIN narratives n ON n.session_id = s.id
          WHERE s.source_path LIKE ${"%" + pathSlug + "%"}
          ORDER BY s.created_at DESC`
        : await sql`
          SELECT s.id, s.source_type, s.source_path, s.session_shape, s.started_at, s.ended_at, s.created_at,
                 n.summary AS narrative_summary,
                 (SELECT COUNT(*) FROM moments m WHERE m.session_id = s.id) AS moment_count
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

  // ── Local session archive ─────────────────────────────────────────
  // `.intent/raw-sessions/` — raw CC logs preserved by digestion (PRD
  // v0.3.2: evidence outlives the ~30-day purge). Listed alongside the
  // sessions table so undigested evidence is visible. fs read is
  // fail-safe; a DB outage degrades to "digested unknown", never a 500.

  app.get("/api/archive", async (_req, res) => {
    const dir = join(process.cwd(), ".intent", "raw-sessions");
    const files = readRawSessionArchive(dir);
    let sessions: DigestedSessionRef[] = [];
    let dbAvailable = true;
    try {
      const sql = getClient();
      const rows = await sql`
        SELECT id, source_hash, started_at FROM sessions
        WHERE source_hash IS NOT NULL`;
      sessions = rows.map((r: any) => ({
        id: r.id as string,
        sourceHash: (r.source_hash as string | null) ?? null,
        startedAt: r.started_at ? new Date(r.started_at as string).toISOString() : null,
      }));
    } catch {
      dbAvailable = false;
    }
    res.json({ dbAvailable, entries: joinArchive(files, sessions) });
  });

  // ── Stats overview — the altitude layer ───────────────────────────
  // One cheap, read-only aggregate that lets every page read at C-level:
  // event cadence (fortnight strip), per-session provenance quality
  // (anchored evidence %, verification), feature momentum. Fail-safe: a DB
  // outage serves the empty shape, never a 500 — chrome must not break
  // the page it decorates. Cadence is repo-agnostic like /api/journal.

  app.get("/api/stats/overview", async (req, res) => {
    const windowDays = 14;
    try {
      const sql = getClient();
      const repoId = req.query.repoId as string | undefined;
      const [proj] = repoId ? await sql`SELECT path FROM projects WHERE id = ${repoId}` : [null];
      const pathSlug = proj ? (proj.path as string).replace(/\//g, "-") : null;

      const [cadence, quality, momentum] = await Promise.all([
        sql`
          SELECT to_char("timestamp", 'YYYY-MM-DD') AS day, COUNT(*)::int AS events
          FROM activity_events
          WHERE "timestamp" >= now() - make_interval(days => ${windowDays})
          GROUP BY 1`,
        pathSlug
          ? sql`
            SELECT s.id AS session_id,
                   COUNT(DISTINCT m.id)::int AS moments,
                   COUNT(e.id)::int AS quotes,
                   COUNT(e.source_event_id)::int AS anchored,
                   COUNT(DISTINCT m.id) FILTER (WHERE m.verification = 'supported')::int AS supported,
                   COUNT(DISTINCT m.id) FILTER (WHERE m.verification = 'contradicted')::int AS contradicted
            FROM sessions s
            LEFT JOIN moments m ON m.session_id = s.id
            LEFT JOIN moment_evidence e ON e.moment_id = m.id
            WHERE s.source_path LIKE ${"%" + pathSlug + "%"}
            GROUP BY s.id`
          : sql`
            SELECT s.id AS session_id,
                   COUNT(DISTINCT m.id)::int AS moments,
                   COUNT(e.id)::int AS quotes,
                   COUNT(e.source_event_id)::int AS anchored,
                   COUNT(DISTINCT m.id) FILTER (WHERE m.verification = 'supported')::int AS supported,
                   COUNT(DISTINCT m.id) FILTER (WHERE m.verification = 'contradicted')::int AS contradicted
            FROM sessions s
            LEFT JOIN moments m ON m.session_id = s.id
            LEFT JOIN moment_evidence e ON e.moment_id = m.id
            GROUP BY s.id`,
        sql`
          SELECT feature_id,
                 COUNT(*) FILTER (WHERE "timestamp" >= now() - make_interval(days => ${windowDays}))::int AS recent_events,
                 COUNT(*) FILTER (WHERE "timestamp" < now() - make_interval(days => ${windowDays})
                              AND "timestamp" >= now() - make_interval(days => ${windowDays * 2}))::int AS prior_events,
                 MAX("timestamp") AS last_activity
          FROM activity_events
          WHERE feature_id IS NOT NULL
          GROUP BY feature_id`,
      ]);

      const cadenceRows: CadenceDayRow[] = cadence.map((r: any) => ({
        day: r.day as string,
        events: Number(r.events) || 0,
      }));
      const sessionRows: SessionQualityRow[] = quality.map((r: any) => ({
        sessionId: r.session_id as string,
        moments: Number(r.moments) || 0,
        quotes: Number(r.quotes) || 0,
        anchored: Number(r.anchored) || 0,
        supported: Number(r.supported) || 0,
        contradicted: Number(r.contradicted) || 0,
      }));
      const featureRows: FeatureMomentumRow[] = momentum.map((r: any) => ({
        featureId: r.feature_id as string,
        recentEvents: Number(r.recent_events) || 0,
        priorEvents: Number(r.prior_events) || 0,
        lastActivity: r.last_activity ? new Date(r.last_activity as string).toISOString() : null,
      }));

      res.json(buildStatsOverview({ cadenceRows, sessionRows, featureRows, windowDays }));
    } catch {
      res.json(emptyStatsOverview(windowDays));
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

  // ── Provenance — every river event explains itself ────────────────
  // GET /api/events/:id/provenance resolves the full chain for an activity
  // event: event → moment(s) → evidence quotes → anchored transcript events →
  // session digest quality → the digester's own trace → related observations.
  // `:id` accepts an activity_events.id, a source_id, or a bare moments.id
  // (the session-detail surface). SQL stays thin; ALL shaping lives in the
  // pure provenance.ts module. Fail-safe: every missing link resolves to
  // null/[] — a broken chain renders as far as the record reaches, never 500.

  app.get("/api/events/:id/provenance", async (req, res) => {
    const id = req.params.id;
    const sql = getClient();
    const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await fn();
      } catch {
        return fallback;
      }
    };

    // (a) the root event — by id, then by source pointer.
    let event: any = null;
    if (isUuidLike(id)) {
      [event] = await safe(
        () => sql`SELECT * FROM activity_events WHERE id = ${id}` as any,
        [] as any[],
      );
    }
    if (!event) {
      [event] = await safe(
        () =>
          sql`SELECT * FROM activity_events WHERE source_id = ${id}
              ORDER BY timestamp DESC LIMIT 1` as any,
        [] as any[],
      );
    }

    // No event row? The caller may hold a bare moment id (session detail) —
    // synthesize the chain straight from the moment.
    let kindOverride: ProvenanceKind | undefined;
    let momentRows: any[] = [];
    let sessionId: string | null = event?.session_id ?? null;
    if (!event && isUuidLike(id)) {
      const [m] = await safe(() => sql`SELECT * FROM moments WHERE id = ${id}` as any, [] as any[]);
      if (m) {
        kindOverride = "moment";
        momentRows = [m];
        sessionId = m.session_id;
      }
    }
    if (!event && momentRows.length === 0) {
      res.status(404).json({ error: "event not found" });
      return;
    }

    const kind = kindOverride ?? provenanceKind(event?.source_type ?? null, event?.category ?? null);
    const meta = (event?.metadata ?? {}) as Record<string, unknown>;
    const sourceId = (event?.source_id as string | null) ?? "";

    // (b)(c) supporting moments. Statement-matching is the live path; the id
    // match is reserved for digestion-v2, which will emit DB uuids into
    // source_id. Both are indexed by session for fast resolution of
    // moments by statement; transitions/outcomes via their join tables
    // after resolving the parent row the same way.
    if (momentRows.length === 0 && sessionId) {
      if (kind === "moment") {
        momentRows = await safe(
          () =>
            sql`SELECT * FROM moments
                WHERE session_id = ${sessionId}
                  AND (id::text = ${sourceId} OR statement = ${event.summary})
                LIMIT 5` as any,
          [] as any[],
        );
      } else if (kind === "transition") {
        const from = typeof meta.from === "string" ? meta.from : "";
        const to = typeof meta.to === "string" ? meta.to : "";
        momentRows = await safe(
          () => {
            // Guard the from/to equality clause — only include when at least one is non-empty
            if (from === "" && to === "") {
              return sql`SELECT DISTINCT m.* FROM transitions t
                  JOIN transition_moments tm ON tm.transition_id = t.id
                  JOIN moments m ON m.id = tm.moment_id
                  WHERE t.session_id = ${sessionId}
                    AND t.id::text = ${sourceId}` as any;
            }
            return sql`SELECT DISTINCT m.* FROM transitions t
                JOIN transition_moments tm ON tm.transition_id = t.id
                JOIN moments m ON m.id = tm.moment_id
                WHERE t.session_id = ${sessionId}
                  AND (t.id::text = ${sourceId}
                       OR (t.from_statement = ${from} AND t.to_statement = ${to}))` as any;
          },
          [] as any[],
        );
      } else if (kind === "outcome") {
        momentRows = await safe(
          () =>
            sql`SELECT DISTINCT m.* FROM outcomes o
                JOIN outcome_moments om ON om.outcome_id = o.id
                JOIN moments m ON m.id = om.moment_id
                WHERE o.session_id = ${sessionId}
                  AND (o.id::text = ${sourceId} OR o.statement = ${event.summary})` as any,
          [] as any[],
        );
      } else if (kind === "narrative") {
        // the narrative summarizes the whole session — its support IS the moments
        momentRows = await safe(
          () =>
            sql`SELECT * FROM moments WHERE session_id = ${sessionId}
                ORDER BY occurred_at ASC NULLS LAST, id LIMIT 40` as any,
          [] as any[],
        );
      }
    }

    // Evidence rows + their anchored transcript events (timestamp from the raw
    // event when it survives; normalized events carry no clock of their own).
    const momentIds = momentRows.map((m: any) => m.id);
    let evidenceRows: any[] = [];
    let anchorRows: any[] = [];
    if (momentIds.length > 0) {
      evidenceRows = await safe(
        () =>
          sql`SELECT id, moment_id, quote, quote_type, source_type, source_event_id
              FROM moment_evidence WHERE moment_id = ANY(${momentIds})` as any,
        [] as any[],
      );
      const anchorIds = [...new Set(evidenceRows.map((e: any) => e.source_event_id).filter(Boolean))];
      if (anchorIds.length > 0) {
        anchorRows = await safe(
          () =>
            sql`SELECT ne.id, ne.causal_order, ne.summary, ne.category, ne.actor, re.timestamp
                FROM normalized_events ne
                LEFT JOIN raw_events re ON re.id = ne.raw_event_id
                WHERE ne.id = ANY(${anchorIds})` as any,
          [] as any[],
        );
      }
    }

    // (d) session + its digest-quality summary (the same counts the stats lens reads).
    let sessionRow: any = null;
    let qualityRow: any = null;
    let traceRows: any[] = [];
    if (sessionId) {
      [sessionRow] = await safe(
        () =>
          sql`SELECT id, session_shape, started_at, ended_at FROM sessions
              WHERE id = ${sessionId}` as any,
        [] as any[],
      );
      [qualityRow] = await safe(
        () =>
          sql`SELECT COUNT(DISTINCT m.id)::int AS moments,
                     COUNT(e.id)::int AS quotes,
                     COUNT(e.source_event_id)::int AS anchored,
                     COUNT(DISTINCT m.id) FILTER (WHERE m.verification = 'supported')::int AS supported,
                     COUNT(DISTINCT m.id) FILTER (WHERE m.verification = 'contradicted')::int AS contradicted
              FROM moments m
              LEFT JOIN moment_evidence e ON e.moment_id = m.id
              WHERE m.session_id = ${sessionId}` as any,
        [] as any[],
      );
      // (e) the digester's own reasoning, when it left a trace
      traceRows = await safe(
        () =>
          sql`SELECT id, timestamp, category, summary, metadata FROM activity_events
              WHERE session_id = ${sessionId} AND source_type = 'agent-trace'
              ORDER BY timestamp ASC LIMIT 40` as any,
        [] as any[],
      );
    }

    // (f) related observations — the "brain delta" slot.
    const featureId = (event?.feature_id as string | null) ?? null;
    let observationRows: any[] = [];
    if (sessionId || featureId) {
      observationRows = await safe(
        () =>
          sql`SELECT id, timestamp, category, summary, review_status, feature_id
              FROM activity_events
              WHERE category LIKE ${OBSERVATION_CATEGORY_PREFIX + "%"}
                AND (${sessionId ? sql`session_id = ${sessionId}` : sql`FALSE`}
                     OR ${featureId ? sql`feature_id = ${featureId}` : sql`FALSE`})
                AND id <> ${event?.id ?? "00000000-0000-0000-0000-000000000000"}
              ORDER BY timestamp DESC LIMIT 10` as any,
        [] as any[],
      );
    }

    res.json(
      buildProvenance({
        event: event
          ? {
              id: event.id,
              timestamp: new Date(event.timestamp).toISOString(),
              category: event.category,
              summary: event.summary,
              actor: event.actor,
              tags: event.tags ?? [],
              metadata: event.metadata ?? {},
              sourceType: event.source_type ?? null,
              sourceId: event.source_id ?? null,
              sessionId: event.session_id ?? null,
              featureId: event.feature_id ?? null,
              reviewStatus: event.review_status ?? null,
            }
          : null,
        kind: kindOverride,
        moments: momentRows.map((m: any) => ({
          id: m.id,
          type: m.type,
          statement: m.statement,
          significance: m.significance ?? null,
          agency: m.agency ?? null,
          confidence: m.confidence ?? null,
          verification: m.verification ?? null,
        })),
        evidence: evidenceRows.map((e: any) => ({
          id: e.id,
          momentId: e.moment_id,
          quote: e.quote,
          quoteType: e.quote_type ?? null,
          sourceType: e.source_type ?? null,
          sourceEventId: e.source_event_id ?? null,
        })),
        anchorEvents: anchorRows.map((a: any) => ({
          id: a.id,
          causalOrder: a.causal_order,
          summary: a.summary,
          category: a.category ?? null,
          actor: a.actor ?? null,
          timestamp: a.timestamp ? new Date(a.timestamp).toISOString() : null,
        })),
        session: sessionRow
          ? {
              id: sessionRow.id,
              sessionShape: sessionRow.session_shape ?? null,
              startedAt: sessionRow.started_at ? new Date(sessionRow.started_at).toISOString() : null,
              endedAt: sessionRow.ended_at ? new Date(sessionRow.ended_at).toISOString() : null,
            }
          : null,
        quality: qualityRow
          ? {
              moments: Number(qualityRow.moments) || 0,
              quotes: Number(qualityRow.quotes) || 0,
              anchored: Number(qualityRow.anchored) || 0,
              supported: Number(qualityRow.supported) || 0,
              contradicted: Number(qualityRow.contradicted) || 0,
            }
          : null,
        traceRows: traceRows.map((t: any) => ({
          id: t.id,
          timestamp: new Date(t.timestamp).toISOString(),
          category: t.category,
          summary: t.summary,
          metadata: t.metadata ?? {},
        })),
        observationRows: observationRows.map((o: any) => ({
          id: o.id,
          timestamp: new Date(o.timestamp).toISOString(),
          category: o.category,
          summary: o.summary,
          reviewStatus: o.review_status ?? null,
          featureId: o.feature_id ?? null,
        })),
      }),
    );
  });

  // ── Chat (SSE streaming) ──────────────────────────────────────────

  app.post("/api/chat", async (req, res) => {
    try {
      const { question, featureId, sessionId, history, contextItems } = req.body;

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

      if (Array.isArray(contextItems) && contextItems.length > 0) {
        // Dock-scoped: the user pinned page elements into the conversation.
        const sections: string[] = [];
        for (const item of contextItems.slice(0, 8)) {
          try {
            sections.push(await buildPinnedContextSection(item));
          } catch (err) {
            sections.push(`### ${item?.label ?? "pinned item"}\n(unavailable: ${err instanceof Error ? err.message : String(err)})`);
          }
        }
        systemPrompt = `You are the Brain — the organizational understanding engine for this repository. The user is reading the dashboard and has pinned specific elements of the page into this conversation. Treat the pinned material below as the working context; the conversation is *about* these things.

${sections.join("\n\n---\n\n")}

## Rules
- Ground answers in the pinned material and say so when something isn't covered by it.
- When attributing decisions, use the agency field where present (developer vs ai vs collaborative).
- Connect the dots across pinned items when the user asks how they relate.
- Keep responses concise but thorough; quote evidence where available.`;
      } else if (featureId) {
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

  // ── Digest schedule (cron elapse settings) ────────────────────────
  app.get("/api/digest/schedule", (_req, res) => {
    res.json({ ...schedule, lastRun: lastScheduledRun });
  });

  app.put("/api/digest/schedule", (req, res) => {
    try {
      const { enabled, intervalMinutes, debounceMinutes } = req.body ?? {};
      schedule = {
        enabled: Boolean(enabled),
        intervalMinutes: Math.min(24 * 60, Math.max(1, Number(intervalMinutes) || DEFAULT_SCHEDULE.intervalMinutes)),
        debounceMinutes: Math.min(120, Math.max(0, Number(debounceMinutes) ?? DEFAULT_SCHEDULE.debounceMinutes)),
      };
      saveSchedule(schedule);
      applySchedule();
      res.json({ ...schedule, lastRun: lastScheduledRun });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Discover — count undigested CC logs for this project (digest is Step 0)
  app.post("/api/brain/discover", async (req, res) => {
    try {
      const { repoId } = req.body;
      if (!repoId) { res.status(400).json({ error: "repoId required" }); return; }

      const sql = getClient();
      const [project] = await sql`SELECT name, path FROM projects WHERE id = ${repoId}`;
      if (!project) { res.status(404).json({ error: "Project not found" }); return; }

      const projectPathSlug = project.path.replace(/\//g, "-");
      const { discoverLogs } = await import("../utils/log-discovery.js");
      const { basename } = await import("node:path");
      const logPaths = await discoverLogs(20, projectPathSlug);
      const allSourceHashes = await sql`SELECT source_hash FROM sessions WHERE source_hash IS NOT NULL`;
      const digestedHashes = new Set(allSourceHashes.map((r: any) => r.source_hash));
      const undigestedPaths = logPaths.filter(p => !digestedHashes.has(basename(p, ".jsonl")));

      res.json({ status: undigestedPaths.length > 0 ? "sessions_found" : "up_to_date", undigestedCount: undigestedPaths.length });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── SSE helper ──────────────────────────────────────────────────────
  function sendSSE(res: express.Response, data: any) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

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

  // ── Session events with chunk-window membership hints ────────────────

  app.get("/api/sessions/:id/events-with-windows", async (req, res) => {
    try {
      const sql = getClient();
      const sessionId = req.params.id;

      const [eventRows, chunkRows, sittingRows] = await Promise.all([
        sql`SELECT id, causal_order, category, actor, summary
            FROM normalized_events
            WHERE session_id = ${sessionId}
            ORDER BY causal_order`,
        sql`SELECT chunk_index, event_range_start, event_range_end, topic_hint
            FROM chunks
            WHERE session_id = ${sessionId}
            ORDER BY chunk_index`,
        sql`SELECT sitting_index, event_range_start, event_range_end, started_at, ended_at
            FROM sittings
            WHERE session_id = ${sessionId}
            ORDER BY sitting_index`,
      ]);

      const eventsForMembership = eventRows.map((r: any) => ({
        causalOrder: r.causal_order as number,
      }));
      const chunksForMembership = chunkRows.map((r: any) => ({
        chunkIndex: r.chunk_index as number,
        eventRangeStart: r.event_range_start as number,
        eventRangeEnd: r.event_range_end as number,
      }));

      const membership = computeWindowMembership(eventsForMembership, chunksForMembership, OVERLAP);

      const events = eventRows.map((r: any) => ({
        id: r.id as string,
        causalOrder: r.causal_order as number,
        category: r.category as string,
        actor: r.actor as string,
        summary: r.summary as string,
        windows: membership.get(r.causal_order as number) ?? [],
      }));

      const chunks = chunkRows.map((r: any) => ({
        chunkIndex: r.chunk_index as number,
        eventRangeStart: r.event_range_start as number,
        eventRangeEnd: r.event_range_end as number,
        topicHint: (r.topic_hint as string | null) ?? null,
      }));

      const sittings = sittingRows.map((r: any) => ({
        sittingIndex: r.sitting_index as number,
        eventRangeStart: r.event_range_start as number,
        eventRangeEnd: r.event_range_end as number,
        startedAt: new Date(r.started_at as string).toISOString(),
        endedAt: new Date(r.ended_at as string).toISOString(),
      }));

      res.json({ events, chunks, sittings });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/{*path}", (_req, res) => {
    res.sendFile(join(__dirname, "public", "index.html"));
  });

  app.listen(port, () => {
    console.log(`intent web dashboard running at http://localhost:${port}`);
    applySchedule();
    if (schedule.enabled) {
      console.log(`scheduled digestion: every ${schedule.intervalMinutes}m (debounce ${schedule.debounceMinutes}m)`);
    }
  });
}
