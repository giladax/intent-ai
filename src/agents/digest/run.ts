import crypto from "node:crypto";
import { basename } from "node:path";
import { parseClaudeCodeLog } from "../../adapters/claude-code.js";
import { normalize } from "../../pipeline/normalize.js";
import { classifySession } from "../../pipeline/classify.js";
import { detectSittings } from "../../pipeline/understand/sittings.js";
import { runAgent } from "../core/run.js";
import {
  storeSessionDigest,
  emitEvents,
  deleteSessionDigest,
  getSessionEndedAt,
} from "../../storage/queries.js";
import {
  findDigestedSession,
  latestTimestamp,
  loadStoredDigest,
  archiveRawSession,
  getGitContext,
  type PipelineResult,
} from "../../pipeline/orchestrator.js";
import { buildSessionEvents } from "../../pipeline/emit-events.js";
import {
  buildDigestAgentConfig,
  mapAgentOutputToPipelineResult,
  buildAgentTraceEvents,
} from "./agent.js";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { AgentResult } from "../core/types.js";
import type { DigestAgentOutput } from "./output-schema.js";

function log(step: string): void {
  process.stderr.write(`${step}\n`);
}

export async function digestWithAgent(
  logPath: string,
  opts?: { force?: boolean; _modelOverride?: BaseChatModel },
): Promise<PipelineResult & { _eventsEmitted?: number }> {
  const ccSessionId = basename(logPath, ".jsonl");

  // 0. Archive the raw log unconditionally (M2) — fail-safe, never blocks digestion.
  archiveRawSession(logPath, ccSessionId);

  // 1. Parse first
  log("[1/7] Parsing CC log...");
  const rawEvents = await parseClaudeCodeLog(logPath);

  // 2. Idempotency check (same as pipeline)
  const existingId = await findDigestedSession(ccSessionId);
  if (existingId) {
    const storedEndedAt = await getSessionEndedAt(existingId);
    const maxTs = latestTimestamp(rawEvents);
    const grown =
      storedEndedAt != null &&
      maxTs != null &&
      maxTs.getTime() > storedEndedAt.getTime() + 60_000;

    if (!grown && !opts?.force) {
      log(`  ⚠ Session already digested (${existingId}). Returning stored digest.`);
      const stored = await loadStoredDigest(existingId);
      if (stored) return stored;
      log("  ⚠ Stored digest incomplete; re-digesting.");
    } else {
      const reason = opts?.force
        ? `  → --force flag set; deleting stored digest for ${existingId} and re-digesting.`
        : `  → Session log has grown; re-digesting.`;
      log(reason);
      await deleteSessionDigest(existingId);
    }
  }

  const sessionId = crypto.randomUUID();

  // 3. Normalize
  log("[2/7] Normalizing events...");
  const normalizedEvents = normalize(rawEvents, sessionId);

  // 4. Classify + detect sittings
  log("[3/7] Classifying session...");
  const sessionShape = await classifySession(normalizedEvents);
  const sittings = detectSittings(normalizedEvents);
  log(`  Shape: ${sessionShape}, sittings: ${sittings.length}`);

  // 5. Build agent config and run
  log("[4/7] Running digest agent...");
  const agentConfig = buildDigestAgentConfig({ normalizedEvents, sittings, sessionShape });
  const agentInput = `Analyze this ${sessionShape} session with ${sittings.length} sitting(s) and ${normalizedEvents.length} events. Extract all meaningful moments, transitions, outcomes, and produce a narrative summary.`;

  const agentResult: AgentResult<DigestAgentOutput> = await runAgent(agentConfig, agentInput, opts?._modelOverride);

  if (agentResult.partial || !agentResult.output) {
    throw new Error(
      `Digest agent returned partial/null output. rawFinal: ${agentResult.rawFinal?.slice(0, 200)}`,
    );
  }

  log(
    `  Agent done: ${agentResult.stats.turns} turns, ${agentResult.stats.tokensUsed} tokens, ${agentResult.stats.toolCalls.length} tool calls`,
  );

  // 6. Map to pipeline result
  log("[5/7] Mapping agent output to pipeline format...");
  const { moments, chunks, transitions, outcomes, narrative } = mapAgentOutputToPipelineResult(
    agentResult.output,
    sessionId,
    sittings,
    normalizedEvents,
    sessionShape,
  );
  narrative.sessionId = sessionId;

  // Derive timestamps
  const timestamps = rawEvents
    .map((e) => e.timestamp)
    .filter(Boolean)
    .map((t) => new Date(t));
  const startedAt =
    timestamps.length > 0 ? new Date(Math.min(...timestamps.map((d) => d.getTime()))) : null;
  const endedAt =
    timestamps.length > 0 ? new Date(Math.max(...timestamps.map((d) => d.getTime()))) : null;

  // 7. Store
  log("[6/7] Storing to database...");
  let digestStored = false;
  try {
    const storeResult = await storeSessionDigest({
      sessionId,
      sourceType: "claude-code",
      sourcePath: logPath,
      sourceHash: ccSessionId,
      sessionShape,
      startedAt,
      endedAt,
      rawEvents,
      normalizedEvents,
      chunks,
      moments,
      transitions,
      outcomes,
      narrative,
      sittings,
    });
    digestStored = storeResult.stored;
  } catch (err) {
    log(`  ⚠ Database write failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 8. Emit activity events — only when digest was stored (C1 + M4).
  // Guard prevents phantom activity_events rows that reference a non-existent session.
  log("[7/7] Emitting activity events...");
  let totalEventsEmitted = 0;
  if (digestStored) {
    const gitCtx = getGitContext(logPath);

    // 8a. Session events (moments, transitions, outcomes, narrative) → river (C1)
    try {
      const sessionEvents = buildSessionEvents({
        sessionId,
        repo: gitCtx.repo,
        branch: gitCtx.branch,
        worktree: gitCtx.worktree,
        moments,
        transitions,
        outcomes,
        narrative,
        sessionEndedAt: endedAt,
      });
      await emitEvents(sessionEvents);
      totalEventsEmitted += sessionEvents.length;
      log(`  → Emitted ${sessionEvents.length} session events`);
    } catch (err) {
      log(`  ⚠ Failed to emit session events: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 8b. Agent-trace events (tool calls, run summary) with git context (M4)
    try {
      const traceEvents = buildAgentTraceEvents(
        sessionId,
        agentResult.stats.toolCalls,
        agentResult.stats,
        gitCtx,
      );
      await emitEvents(traceEvents);
      totalEventsEmitted += traceEvents.length;
      log(`  → Emitted ${traceEvents.length} agent-trace events`);
    } catch (err) {
      log(
        `  ⚠ Failed to emit agent-trace events: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    sessionId,
    narrative,
    moments,
    transitions,
    outcomes,
    _eventsEmitted: totalEventsEmitted,
  };
}
