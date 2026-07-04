import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  getDefaultProjectId,
  listFeatures,
  getFeatureById,
  getFeatureFileRows,
  getFeatureMoments,
  getMomentById,
  getMomentEvidence,
  insertObservation,
  type FeatureRecord,
} from "../storage/queries.js";
import {
  fuzzyScore,
  resolveFeature,
  resolveTask,
  formatCandidates,
  selectKeyMoments,
  formatMomentList,
  formatMomentEvidence,
  formatSessionNarrative,
} from "./feature.js";
import { renderFeatureContext } from "./context.js";
import { getSessionNarrative } from "../storage/queries.js";
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

async function featureContextResponse(
  featureId: string,
  depth: "orientation" | "full" = "orientation",
) {
  const text = await renderFeatureContext(featureId, depth);
  if (!text) return mcpText(`Feature ${featureId} not found.`);
  return mcpText(text);
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
  // (longest-glob-wins) and return the Feature's orientation. On 0 or
  // >1 matching Features, returns the candidate list — never guesses.

  server.tool(
    "brain_file_context",
    "Get Brain context for a source file — resolves the file's Feature and returns a terse orientation (understanding verdict, constraints, drill handles). Use before editing unfamiliar code. Pass depth:\"full\" for the complete assembled block.",
    {
      file: z.string().describe("File path (relative or absolute)"),
      depth: z.enum(["orientation", "full"]).optional().describe("\"orientation\" (default) returns a terse 15-line summary with drill handles; \"full\" returns the complete assembled context block"),
      sessionId: z.string().optional().describe("Your session id, for provenance"),
    },
    async ({ file, depth, sessionId }) => {
      const startedAt = Date.now();
      const resolvedDepth = depth ?? "orientation";
      try {
        const projectId = await getDefaultProjectId();
        const rows = await getFeatureFileRows(projectId ?? undefined);
        const res = resolveFeature(file, rows);
        if (res.featureId) {
          await emitRead("file-context", startedAt, "hit", `Agent got feature context for ${file}`, {
            sessionId, featureId: res.featureId, metadata: { file, depth: resolvedDepth },
          });
          return await featureContextResponse(res.featureId, resolvedDepth);
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
  // Resolves to a Feature and returns a terse orientation by default;
  // depth:"full" returns the original assembled block for backward compat.

  server.tool(
    "brain_enter",
    "Enter the Brain for a file or task. Returns a terse orientation: verdict-grade understanding (2-3 sentences), constraints (if ≤3), and drill handles (moment/session counts + ids). Use brain_moments, brain_evidence, brain_narrative to pull depth on demand. Pass depth:\"full\" for the full assembled block. On 0 or >1 matches, returns the candidate list.",
    {
      file: z.string().optional().describe("File path you are about to work on"),
      task: z.string().optional().describe("Task or goal description"),
      depth: z.enum(["orientation", "full"]).optional().describe("\"orientation\" (default) returns a terse 15-line orientation with drill handles; \"full\" returns the complete assembled context block (understanding+moments+sessions+files)"),
      sessionId: z.string().optional().describe("Your session id, for provenance"),
    },
    async ({ file, task, depth, sessionId }) => {
      const startedAt = Date.now();
      const resolvedDepth = depth ?? "orientation";
      const target = file ? `file ${file}` : task ? `task "${task}"` : "nothing";
      try {
        const projectId = await getDefaultProjectId();
        if (file) {
          const rows = await getFeatureFileRows(projectId ?? undefined);
          const res = resolveFeature(file, rows);
          if (res.featureId) {
            await emitRead("enter", startedAt, "hit", `Agent entered the Brain for ${target}`, {
              sessionId, featureId: res.featureId, metadata: { file, depth: resolvedDepth },
            });
            return await featureContextResponse(res.featureId, resolvedDepth);
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
              sessionId, featureId: res.feature.id, metadata: { task, depth: resolvedDepth },
            });
            return await featureContextResponse(res.feature.id, resolvedDepth);
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
  // Fetch a Feature's orientation (or full context) directly by id
  // (after picking from a candidate list returned by brain_enter).

  server.tool(
    "brain_feature_context",
    "Get the Brain's context for a Feature by id. Default: terse orientation (verdict, constraints, drill handles). Pass depth:\"full\" for the complete assembled block (understanding + key moments with evidence + sessions + files + agent instructions).",
    {
      featureId: z.string().describe("Feature id (from a candidate list or brain_search)"),
      depth: z.enum(["orientation", "full"]).optional().describe("\"orientation\" (default) returns a terse 15-line orientation with drill handles; \"full\" returns the complete assembled context block"),
      sessionId: z.string().optional().describe("Your session id, for provenance"),
    },
    async ({ featureId, depth, sessionId }) => {
      const startedAt = Date.now();
      const resolvedDepth = depth ?? "orientation";
      try {
        const feature = await getFeatureById(featureId);
        await emitRead(
          "feature-context",
          startedAt,
          feature ? "hit" : "miss",
          feature
            ? `Agent got context for Feature "${feature.name}" (${resolvedDepth})`
            : `Agent requested Feature ${featureId} — not found`,
          { sessionId, featureId, metadata: { depth: resolvedDepth } },
        );
        if (!feature) return mcpText(`Feature ${featureId} not found.`);
        return await featureContextResponse(featureId, resolvedDepth);
      } catch (err) {
        await emitRead("feature-context", startedAt, "error", `brain_feature_context failed for ${featureId}`, {
          sessionId, featureId, metadata: { error: errMsg(err) },
        });
        return mcpText(`brain_feature_context unavailable: ${errMsg(err)}`);
      }
    },
  );

  // ── brain_moments ─────────────────────────────────────────────
  // Drill tool: terse moment statements + confidence/verification + moment ids.
  // No evidence quotes — call brain_evidence(momentId) to pull those.

  server.tool(
    "brain_moments",
    "List the key moments for a Feature — terse statements with confidence, verification status, and moment ids. Call brain_evidence(momentId) to pull anchored quotes for any moment.",
    {
      featureId: z.string().describe("Feature id"),
      limit: z.number().int().min(1).max(50).optional().describe("Max moments to return (default 12)"),
      sessionId: z.string().optional().describe("Your session id, for provenance"),
    },
    async ({ featureId, limit, sessionId }) => {
      const startedAt = Date.now();
      try {
        const feature = await getFeatureById(featureId);
        if (!feature) {
          await emitRead("moments", startedAt, "miss", `brain_moments: Feature ${featureId} not found`, { sessionId, featureId });
          return mcpText(`Feature ${featureId} not found.`);
        }
        const candidates = await getFeatureMoments(featureId);
        // relevantFiles for scoring: pull from feature_files
        const { loadFeatureContext } = await import("../storage/queries.js");
        const ctx = await loadFeatureContext(featureId);
        const patterns = ctx?.relevantFiles ?? [];
        const moments = selectKeyMoments(candidates, patterns, limit ?? 12);
        await emitRead(
          "moments",
          startedAt,
          moments.length > 0 ? "hit" : "miss",
          `Agent listed moments for Feature "${feature.name}" — ${moments.length} returned`,
          { sessionId, featureId, metadata: { count: moments.length } },
        );
        return mcpText(formatMomentList(moments));
      } catch (err) {
        await emitRead("moments", startedAt, "error", `brain_moments failed for ${featureId}`, {
          sessionId, featureId, metadata: { error: errMsg(err) },
        });
        return mcpText(`brain_moments unavailable: ${errMsg(err)}`);
      }
    },
  );

  // ── brain_evidence ────────────────────────────────────────────
  // Drill tool: anchored evidence quotes for one moment.
  // Use after brain_moments to pull the provenance chain for a specific claim.

  server.tool(
    "brain_evidence",
    "Get the anchored evidence quotes for a moment — verbatim transcript excerpts that ground the claim. Call after brain_moments to pull provenance for a specific moment id.",
    {
      momentId: z.string().describe("Moment id (from brain_moments output)"),
      sessionId: z.string().optional().describe("Your session id, for provenance"),
    },
    async ({ momentId, sessionId }) => {
      const startedAt = Date.now();
      try {
        const moment = await getMomentById(momentId);
        if (!moment) {
          await emitRead("evidence", startedAt, "miss", `brain_evidence: moment ${momentId} not found`, { sessionId });
          return mcpText(`Moment ${momentId} not found.`);
        }
        const evidence = await getMomentEvidence(momentId);
        await emitRead(
          "evidence",
          startedAt,
          evidence.length > 0 ? "hit" : "miss",
          `Agent pulled evidence for moment [${momentId.slice(0, 8)}…] — ${evidence.length} quote${evidence.length === 1 ? "" : "s"}`,
          { sessionId, metadata: { momentId, count: evidence.length } },
        );
        return mcpText(formatMomentEvidence(momentId, moment.statement, evidence));
      } catch (err) {
        await emitRead("evidence", startedAt, "error", `brain_evidence failed for ${momentId}`, {
          sessionId, metadata: { momentId, error: errMsg(err) },
        });
        return mcpText(`brain_evidence unavailable: ${errMsg(err)}`);
      }
    },
  );

  // ── brain_narrative ───────────────────────────────────────────
  // Drill tool: session narrative summary/progression for one session.
  // Use after brain_enter to pull story context for a specific session id.

  server.tool(
    "brain_narrative",
    "Get the narrative summary and progression for a session — what happened, key discoveries, how intent evolved. Call after brain_enter or brain_moments to understand a specific session's arc.",
    {
      sessionId: z.string().describe("Session id (from orientation drill handles or brain_moments)"),
      callerSessionId: z.string().optional().describe("Your own session id, for provenance"),
    },
    async ({ sessionId, callerSessionId }) => {
      const startedAt = Date.now();
      try {
        const narrative = await getSessionNarrative(sessionId);
        if (!narrative) {
          await emitRead("narrative", startedAt, "miss", `brain_narrative: no narrative for session ${sessionId}`, { sessionId: callerSessionId });
          return mcpText(`No narrative found for session ${sessionId}.`);
        }
        await emitRead(
          "narrative",
          startedAt,
          "hit",
          `Agent pulled narrative for session [${sessionId.slice(0, 8)}…]`,
          { sessionId: callerSessionId, metadata: { targetSessionId: sessionId } },
        );
        return mcpText(formatSessionNarrative({
          sessionId: narrative.sessionId,
          sessionShape: narrative.sessionShape,
          summary: narrative.summary,
          progression: narrative.progression ?? [],
          discoveries: narrative.discoveries ?? [],
        }));
      } catch (err) {
        await emitRead("narrative", startedAt, "error", `brain_narrative failed for ${sessionId}`, {
          sessionId: callerSessionId, metadata: { targetSessionId: sessionId, error: errMsg(err) },
        });
        return mcpText(`brain_narrative unavailable: ${errMsg(err)}`);
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
