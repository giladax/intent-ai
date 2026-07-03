import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  getDefaultProjectId,
  listFeatures,
  getFeatureById,
  getFeatureFileRows,
  loadFeatureContext,
  insertObservation,
  type FeatureRecord,
} from "../storage/queries.js";
import {
  fuzzyScore,
  resolveFeature,
  resolveTask,
  formatCandidates,
  formatFeatureContext,
} from "./feature.js";
import {
  buildMcpReadEvent,
  emitMcpReadEvent,
  getRepoContext,
  type McpOutcome,
} from "./instrument.js";

// ── Feature-tool helpers (Postgres-backed) ───────────────────────────

function mcpText(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function featureContextResponse(featureId: string) {
  const ctx = await loadFeatureContext(featureId);
  if (!ctx) return mcpText(`Feature ${featureId} not found.`);
  return mcpText(formatFeatureContext(ctx));
}

async function featuresByIds(ids: string[], projectId: string | null): Promise<FeatureRecord[]> {
  // On 0 candidates, surface the full project Feature list so the agent
  // can pick — we never silently guess, but we do help it choose.
  if (ids.length === 0) return await listFeatures(projectId ?? undefined);
  const out: FeatureRecord[] = [];
  for (const id of ids) {
    const f = await getFeatureById(id);
    if (f) out.push(f);
  }
  return out;
}

// ── MCP Server ────────────────────────────────────────────────────

export function createBrainServer(): McpServer {
  const server = new McpServer({
    name: "intent-brain",
    version: "1.0.0",
  });

  // ── Self-instrumentation (Journal §7.3 / API review F5, F6) ─────
  // Every read emits an `mcp:<tool>` event, failure-safe. Actor comes from
  // MCP client info; repo/branch are stamped server-side.

  const repoCtx = getRepoContext();

  function actorName(): string {
    try {
      const client = server.server.getClientVersion();
      return client?.name ? `agent:${client.name}` : "agent:mcp-client";
    } catch {
      return "agent:mcp-client";
    }
  }

  async function emitRead(
    tool: string,
    startedAt: number,
    outcome: McpOutcome,
    summary: string,
    extra?: { sessionId?: string; featureId?: string; metadata?: Record<string, unknown> },
  ): Promise<void> {
    await emitMcpReadEvent(
      buildMcpReadEvent({
        tool,
        outcome,
        summary,
        latencyMs: Date.now() - startedAt,
        actor: actorName(),
        repo: repoCtx.repo,
        branch: repoCtx.branch,
        sessionId: extra?.sessionId,
        featureId: extra?.featureId,
        metadata: extra?.metadata,
      }),
    );
  }

  // ── brain_search (Feature-keyed, API review F1) ───────────────
  // One ontology: search matches Features by name, description, current
  // understanding, and file globs. Returns compact cards with ids.

  server.tool(
    "brain_search",
    "Search the Brain's Features — matches name, understanding, and file globs. Returns candidates with ids for brain_feature_context.",
    {
      query: z.string().describe("Search query — feature names, concepts, file paths"),
    },
    async ({ query }) => {
      const startedAt = Date.now();
      try {
        const projectId = await getDefaultProjectId();
        const features = await listFeatures(projectId ?? undefined);
        const fileRows = await getFeatureFileRows(projectId ?? undefined);
        const globsByFeature = new Map<string, string[]>();
        for (const r of fileRows) {
          const list = globsByFeature.get(r.featureId) ?? [];
          if (r.glob) list.push(r.glob);
          if (r.filePath) list.push(r.filePath);
          globsByFeature.set(r.featureId, list);
        }

        type Hit = { f: FeatureRecord; score: number; via: string };
        const hits: Hit[] = [];
        for (const f of features) {
          let best = 0;
          let via = "name";
          const consider = (text: string | null | undefined, weight: number, label: string) => {
            if (!text) return;
            const s = fuzzyScore(query, text) * weight;
            if (s > best) {
              best = s;
              via = label;
            }
          };
          consider(f.name, 2.0, "name");
          consider(f.description, 1.2, "description");
          consider(f.currentUnderstanding, 1.0, "understanding");
          for (const g of globsByFeature.get(f.id) ?? []) consider(g, 1.5, `file: ${g}`);
          if (best > 0.3) hits.push({ f, score: best, via });
        }
        hits.sort((a, b) => b.score - a.score);
        const top = hits.slice(0, 6);

        await emitRead(
          "search",
          startedAt,
          top.length > 0 ? "hit" : "miss",
          `Agent searched the Brain for "${query}" — ${top.length} feature${top.length === 1 ? "" : "s"}`,
          { metadata: { query, results: top.length } },
        );

        if (top.length === 0) {
          return mcpText(
            `No Features match "${query}". Try brain_enter(task: "...") for candidate resolution, or report what you were looking for with brain_report_unknown.`,
          );
        }

        const text = top
          .map(({ f, score, via }) => {
            const lines = [`### ${f.name}  [id: ${f.id}]`];
            if (f.description) lines.push(f.description.slice(0, 200));
            const understanding = (f.currentUnderstanding ?? "")
              .split("\n")
              .filter(Boolean)
              .slice(0, 3);
            for (const l of understanding) lines.push(l.startsWith("- ") ? l : `- ${l}`);
            lines.push(`_matched via ${via} (${(score * 100).toFixed(0)}%) — brain_feature_context("${f.id}") for the full context_`);
            return lines.join("\n");
          })
          .join("\n\n---\n\n");

        return mcpText(text);
      } catch (e) {
        return mcpText(`brain_search unavailable: ${errMsg(e)}`);
      }
    },
  );

  // ── brain_file_context (re-keyed onto Feature) ────────────────
  // Given a file path, resolve its Feature via the file↔Feature map
  // (longest-glob-wins) and return the Feature's served context. On 0 or
  // >1 matching Features, returns the candidate list — never guesses.

  server.tool(
    "brain_file_context",
    "Get Brain context for a source file — resolves the file's Feature and returns its current understanding, constraints, and relevant files. Use before editing unfamiliar code.",
    {
      file: z.string().describe("File path (relative or absolute)"),
      sessionId: z.string().optional().describe("Your session id, for provenance"),
    },
    async ({ file, sessionId }) => {
      const startedAt = Date.now();
      try {
        const projectId = await getDefaultProjectId();
        const rows = await getFeatureFileRows(projectId ?? undefined);
        const res = resolveFeature(file, rows);
        if (res.featureId) {
          await emitRead("file-context", startedAt, "hit", `Agent got feature context for ${file}`, {
            sessionId, featureId: res.featureId, metadata: { file },
          });
          return await featureContextResponse(res.featureId);
        }
        const outcome: McpOutcome = res.candidateIds.length === 0 ? "miss" : "candidates";
        await emitRead(
          "file-context",
          startedAt,
          outcome,
          outcome === "miss"
            ? `Agent asked for context on ${file} — no Feature maps it`
            : `Agent asked for context on ${file} — ${res.candidateIds.length} candidate Features`,
          { sessionId, metadata: { file, candidates: res.candidateIds.length } },
        );
        const candidates = await featuresByIds(res.candidateIds, projectId);
        return mcpText(formatCandidates(candidates, `file: ${file}`));
      } catch (err) {
        await emitRead("file-context", startedAt, "error", `brain_file_context failed for ${file}`, {
          sessionId, metadata: { file, error: errMsg(err) },
        });
        return mcpText(`brain_file_context unavailable: ${errMsg(err)}`);
      }
    },
  );

  // ── brain_enter ───────────────────────────────────────────────
  // The primary entry point for agents. Keyed by file OR task/goal.
  // Resolves to a Feature and returns its served context; on 0 or >1
  // matches returns the candidate list for the agent to pick.

  server.tool(
    "brain_enter",
    "Enter the Brain for a file or task. Returns the Feature's current understanding, constraints, relevant files, related sessions, and known unknowns. On 0 or >1 matches, returns the candidate list to pick from — never guesses.",
    {
      file: z.string().optional().describe("File path you are about to work on"),
      task: z.string().optional().describe("Task or goal description"),
      sessionId: z.string().optional().describe("Your session id, for provenance"),
    },
    async ({ file, task, sessionId }) => {
      const startedAt = Date.now();
      const target = file ? `file ${file}` : task ? `task "${task}"` : "nothing";
      try {
        const projectId = await getDefaultProjectId();
        if (file) {
          const rows = await getFeatureFileRows(projectId ?? undefined);
          const res = resolveFeature(file, rows);
          if (res.featureId) {
            await emitRead("enter", startedAt, "hit", `Agent entered the Brain for ${target}`, {
              sessionId, featureId: res.featureId, metadata: { file },
            });
            return await featureContextResponse(res.featureId);
          }
          const outcome: McpOutcome = res.candidateIds.length === 0 ? "miss" : "candidates";
          await emitRead(
            "enter",
            startedAt,
            outcome,
            outcome === "miss"
              ? `Agent entered for ${target} — no Feature maps it`
              : `Agent entered for ${target} — ${res.candidateIds.length} candidate Features`,
            { sessionId, metadata: { file, candidates: res.candidateIds.length } },
          );
          const candidates = await featuresByIds(res.candidateIds, projectId);
          return mcpText(formatCandidates(candidates, `file: ${file}`));
        }
        if (task) {
          const features = await listFeatures(projectId ?? undefined);
          const res = resolveTask(task, features);
          if (res.feature) {
            await emitRead("enter", startedAt, "hit", `Agent entered the Brain for ${target}`, {
              sessionId, featureId: res.feature.id, metadata: { task },
            });
            return await featureContextResponse(res.feature.id);
          }
          const outcome: McpOutcome = res.candidates.length === 0 ? "miss" : "candidates";
          await emitRead(
            "enter",
            startedAt,
            outcome,
            outcome === "miss"
              ? `Agent entered for ${target} — no Feature matched`
              : `Agent entered for ${target} — ${res.candidates.length} candidate Features`,
            { sessionId, metadata: { task, candidates: res.candidates.length } },
          );
          return mcpText(formatCandidates(res.candidates, `task: ${task}`));
        }
        return mcpText("Provide either `file` or `task` to enter the Brain.");
      } catch (err) {
        await emitRead("enter", startedAt, "error", `brain_enter failed for ${target}`, {
          sessionId, metadata: { file: file ?? null, task: task ?? null, error: errMsg(err) },
        });
        return mcpText(`brain_enter unavailable: ${errMsg(err)}`);
      }
    },
  );

  // ── brain_feature_context ─────────────────────────────────────
  // Fetch a Feature's served context directly by id (after picking from
  // a candidate list returned by brain_enter / brain_file_context).

  server.tool(
    "brain_feature_context",
    "Get the served context for a Feature by id: summary, current understanding, constraints, relevant files, related sessions, known unknowns, and agent instructions.",
    {
      featureId: z.string().describe("Feature id (from a candidate list)"),
      sessionId: z.string().optional().describe("Your session id, for provenance"),
    },
    async ({ featureId, sessionId }) => {
      const startedAt = Date.now();
      try {
        const ctx = await loadFeatureContext(featureId);
        await emitRead(
          "feature-context",
          startedAt,
          ctx ? "hit" : "miss",
          ctx
            ? `Agent got context for Feature "${ctx.feature.name}"`
            : `Agent requested Feature ${featureId} — not found`,
          { sessionId, featureId, metadata: {} },
        );
        if (!ctx) return mcpText(`Feature ${featureId} not found.`);
        return mcpText(formatFeatureContext(ctx));
      } catch (err) {
        await emitRead("feature-context", startedAt, "error", `brain_feature_context failed for ${featureId}`, {
          sessionId, featureId, metadata: { error: errMsg(err) },
        });
        return mcpText(`brain_feature_context unavailable: ${errMsg(err)}`);
      }
    },
  );

  // ── Write-side tools ──────────────────────────────────────────
  // Each inserts an activity_events row with category observation:<kind>,
  // feature_id set, review_status 'pending'. No automatic promotion — a
  // human reviews. Failures are reported, never thrown to the agent.

  server.tool(
    "brain_report_observation",
    "Report an observation about a Feature (something you noticed while working). Stored pending human review.",
    {
      featureId: z.string().optional().describe("Feature this observation is about"),
      summary: z.string().describe("The observation, in one or two sentences"),
      kind: z.string().optional().describe("Observation kind tag, e.g. tech-debt, decision, behavior"),
      tags: z.array(z.string()).optional().describe("Freeform tags"),
      files: z.array(z.string()).optional().describe("Related file paths"),
      sessionId: z.string().optional().describe("Your session id, for provenance"),
    },
    async ({ featureId, summary, kind, tags, files, sessionId }) => {
      try {
        const id = await insertObservation({
          kind: kind ?? "observation",
          summary,
          featureId: featureId ?? null,
          actor: actorName(),
          sessionId: sessionId ?? null,
          repo: repoCtx.repo ?? null,
          branch: repoCtx.branch ?? null,
          tags,
          files,
          metadata: { kind: kind ?? "observation" },
        });
        return mcpText(`Observation recorded (id: ${id}, status: pending review).`);
      } catch (err) {
        return mcpText(`Could not record observation: ${errMsg(err)}`);
      }
    },
  );

  server.tool(
    "brain_report_unknown",
    "Report an open question / unknown about a Feature — something Brain does not yet know. Stored pending human review.",
    {
      featureId: z.string().optional().describe("Feature this unknown relates to"),
      summary: z.string().describe("The open question or unknown"),
      files: z.array(z.string()).optional(),
      sessionId: z.string().optional().describe("Your session id, for provenance"),
    },
    async ({ featureId, summary, files, sessionId }) => {
      try {
        const id = await insertObservation({
          kind: "unknown",
          summary,
          featureId: featureId ?? null,
          actor: actorName(),
          sessionId: sessionId ?? null,
          repo: repoCtx.repo ?? null,
          branch: repoCtx.branch ?? null,
          files,
        });
        return mcpText(`Unknown recorded (id: ${id}, status: pending review).`);
      } catch (err) {
        return mcpText(`Could not record unknown: ${errMsg(err)}`);
      }
    },
  );

  server.tool(
    "brain_rate_context",
    "Rate how useful the Feature context was for your task (self-report). Stored as a pending observation.",
    {
      featureId: z.string().optional(),
      rating: z.number().int().min(1).max(5).describe("Usefulness rating, 1 (useless) to 5 (decisive)"),
      comment: z.string().optional().describe("Optional note about what was missing or helpful"),
      sessionId: z.string().optional().describe("Your session id, for provenance"),
    },
    async ({ featureId, rating, comment, sessionId }) => {
      try {
        const id = await insertObservation({
          kind: "context-rating",
          summary: comment ?? `Context usefulness rating: ${rating}`,
          featureId: featureId ?? null,
          actor: actorName(),
          sessionId: sessionId ?? null,
          repo: repoCtx.repo ?? null,
          branch: repoCtx.branch ?? null,
          metadata: { rating, comment: comment ?? null },
        });
        return mcpText(`Context rating recorded (id: ${id}).`);
      } catch (err) {
        return mcpText(`Could not record rating: ${errMsg(err)}`);
      }
    },
  );

  server.tool(
    "brain_propose_knowledge_delta",
    "Propose a change to a Feature's understanding (a reviewable delta). Stored pending human review — Brain never edits understanding silently.",
    {
      featureId: z.string().optional(),
      summary: z.string().describe("Proposed change to the understanding"),
      before: z.string().optional().describe("Current understanding being changed"),
      after: z.string().optional().describe("Proposed new understanding"),
      sessionId: z.string().optional().describe("Your session id, for provenance"),
    },
    async ({ featureId, summary, before, after, sessionId }) => {
      try {
        const id = await insertObservation({
          kind: "knowledge-delta",
          summary,
          featureId: featureId ?? null,
          actor: actorName(),
          sessionId: sessionId ?? null,
          repo: repoCtx.repo ?? null,
          branch: repoCtx.branch ?? null,
          metadata: { before: before ?? null, after: after ?? null },
        });
        return mcpText(`Knowledge delta proposed (id: ${id}, status: pending review).`);
      } catch (err) {
        return mcpText(`Could not propose knowledge delta: ${errMsg(err)}`);
      }
    },
  );

  return server;
}

// ── Entry point ───────────────────────────────────────────────────

export async function startMcpServer() {
  const server = createBrainServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
