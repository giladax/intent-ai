// MCP self-instrumentation (Journal design §7.3, API review F5/F6).
//
// Every Brain MCP *read* emits an `mcp:<tool>` activity event so the Journal
// can render consult beats, hit/miss stats, and the teaching receipt. Write
// tools are NOT instrumented here — the observation row they insert IS their
// event; a second one would double-count.
//
// Builders are pure (unit-testable without Postgres); emission is a thin
// failure-safe wrapper — instrumentation may never fail the instrumented call.

import { readFileSync } from "fs";
import { basename, join } from "path";
import { emitEvents } from "../storage/queries.js";
import type { ActivityEvent } from "../adapters/types.js";

export type McpOutcome = "hit" | "candidates" | "miss" | "error";

export interface McpReadCall {
  /** tool short-name, e.g. "enter" → category `mcp:enter` */
  tool: string;
  outcome: McpOutcome;
  /** one narratable sentence — the Journal renders it verbatim */
  summary: string;
  latencyMs: number;
  /** e.g. `agent:claude-code`; from MCP client info when available */
  actor: string;
  sessionId?: string;
  featureId?: string;
  repo?: string;
  branch?: string;
  metadata?: Record<string, unknown>;
}

/** Pure: build the `mcp:<tool>` event for a read call. */
export function buildMcpReadEvent(call: McpReadCall): ActivityEvent {
  return {
    timestamp: new Date(),
    category: `mcp:${call.tool}`,
    tags: ["mcp", call.outcome],
    actor: call.actor,
    summary: call.summary,
    sourceType: "mcp",
    sessionId: call.sessionId,
    repo: call.repo,
    branch: call.branch,
    metadata: {
      tool: call.tool,
      outcome: call.outcome,
      latencyMs: call.latencyMs,
      featureId: call.featureId ?? null,
      ...call.metadata,
    },
  };
}

/** Emit, failure-safe: never throws into the tool handler. */
export async function emitMcpReadEvent(event: ActivityEvent): Promise<void> {
  try {
    await emitEvents([event]);
  } catch {
    // instrumentation may never fail the instrumented operation
  }
}

// ── Server-side provenance context (API review F5) ───────────────────
//
// Stamped onto writes and mcp:* events: repo from cwd, branch from .git/HEAD.
// Read once, cached — no exec per tool call.

export interface RepoContext {
  repo?: string;
  branch?: string;
}

let cachedContext: RepoContext | null = null;

export function getRepoContext(cwd: string = process.cwd()): RepoContext {
  if (cachedContext) return cachedContext;
  const ctx: RepoContext = { repo: basename(cwd) };
  try {
    const head = readFileSync(join(cwd, ".git", "HEAD"), "utf-8").trim();
    const m = head.match(/^ref: refs\/heads\/(.+)$/);
    if (m) ctx.branch = m[1];
  } catch {
    // not a git repo / worktree HEAD elsewhere — repo name alone is fine
  }
  cachedContext = ctx;
  return ctx;
}

/** Test hook. */
export function resetRepoContextCache(): void {
  cachedContext = null;
}
