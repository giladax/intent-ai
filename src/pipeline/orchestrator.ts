import crypto from "node:crypto";
import path from "node:path";
import { basename } from "node:path";
import { execSync } from "node:child_process";
import { parseClaudeCodeLog } from "../adapters/claude-code.js";
import { getClient } from "../storage/connection.js";
import { normalize } from "./normalize.js";
import { analyzeInteractions } from "./analyze.js";
import { classifySession } from "./classify.js";
import { chunkSession } from "./chunk.js";
import { detectMoments } from "./moments.js";
import { detectTransitionsAndOutcomes } from "./transitions.js";
import { generateNarrative } from "./narrative.js";
import { buildSessionEvents } from "./emit-events.js";
import { storeSessionDigest, emitEvents } from "../storage/queries.js";
import type {
  SessionNarrative,
  SessionMoment,
  IntentTransition,
  AcceptedOutcome,
} from "../adapters/types.js";

function log(step: string): void {
  process.stderr.write(`${step}\n`);
}

function getGitContext(sourcePath: string): { repo?: string; branch?: string; worktree?: string } {
  try {
    const dir = path.dirname(sourcePath);
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: dir, encoding: "utf-8" }).trim();
    const toplevel = execSync("git rev-parse --show-toplevel", { cwd: dir, encoding: "utf-8" }).trim();
    const repo = path.basename(toplevel);
    let worktree: string | undefined;
    try {
      const commonDir = execSync("git rev-parse --path-format=absolute --git-common-dir", { cwd: dir, encoding: "utf-8" }).trim().replace(/\/.git$/, "");
      if (commonDir !== toplevel) worktree = toplevel;
    } catch { /* not a worktree */ }
    return { repo, branch, worktree };
  } catch {
    return {};
  }
}

export async function runPipeline(logPath: string): Promise<{
  sessionId: string;
  narrative: SessionNarrative;
  moments: SessionMoment[];
  transitions: IntentTransition[];
  outcomes: AcceptedOutcome[];
}> {
  // 0. Check for duplicate — extract CC session UUID from filename
  const ccSessionId = basename(logPath, ".jsonl");
  const sql = getClient();
  const [existing] = await sql`SELECT id FROM sessions WHERE source_hash = ${ccSessionId}`;
  if (existing) {
    log(`  ⚠ Session already digested (${existing.id}). Skipping.`);
    throw new Error(`Session already digested: ${ccSessionId} → ${existing.id}`);
  }

  // 1. Parse
  log("[1/10] Parsing CC log...");
  const rawEvents = await parseClaudeCodeLog(logPath);

  // 2. Generate sessionId
  const sessionId = crypto.randomUUID();

  // 3. Normalize
  log(`[2/10] Normalizing ${rawEvents.length} events...`);
  const normalizedEvents = normalize(rawEvents, sessionId);

  // Large session warning
  if (normalizedEvents.length > 300) {
    const estimatedChunks = Math.ceil(normalizedEvents.length / 60);
    const estimatedLlmCalls = estimatedChunks + 3; // pass1 per chunk + classify + pass2 + transitions + narrative
    log(
      `  ⚠ Large session: ${normalizedEvents.length} events, ~${estimatedChunks} chunks, ~${estimatedLlmCalls} LLM calls`,
    );
  }

  // 4-5-6. Analyze + Classify + Chunk in parallel (all depend only on normalizedEvents)
  log("[3/10] Analyzing + classifying + chunking (parallel)...");
  const [directives, sessionShape, sessionChunks] = await Promise.all([
    analyzeInteractions(normalizedEvents),
    classifySession(normalizedEvents),
    Promise.resolve(chunkSession(normalizedEvents, sessionId)),
  ]);
  log(`  Shape: ${sessionShape}, ${sessionChunks.length} chunks, ${directives.exchangeSummary.totalExchanges} exchanges`);

  // 7. Detect moments (pass 1 + 2)
  log("[6/10] Detecting moments (pass 1)...");
  log("[7/10] Detecting moments (pass 2)...");
  const sessionMoments = await detectMoments(sessionChunks, sessionShape, directives, normalizedEvents);

  // 8. Transitions + outcomes
  log("[8/10] Detecting transitions & outcomes...");
  const { transitions, outcomes } = await detectTransitionsAndOutcomes(
    sessionMoments,
    sessionId,
    sessionChunks,
  );

  // 9. Narrative
  log("[9/10] Generating narrative...");
  const narrative = await generateNarrative(
    sessionMoments,
    transitions,
    outcomes,
    sessionShape,
  );
  narrative.sessionId = sessionId;

  // 10. Store
  log("[10/10] Storing to database...");

  // Derive timestamps from raw events
  const timestamps = rawEvents
    .map((e) => e.timestamp)
    .filter(Boolean)
    .map((t) => new Date(t));
  const startedAt = timestamps.length > 0 ? new Date(Math.min(...timestamps.map((d) => d.getTime()))) : null;
  const endedAt = timestamps.length > 0 ? new Date(Math.max(...timestamps.map((d) => d.getTime()))) : null;

  try {
    await storeSessionDigest({
      sessionId,
      sourceType: "claude-code",
      sourcePath: logPath,
      sourceHash: ccSessionId,
      sessionShape,
      startedAt,
      endedAt,
      rawEvents,
      normalizedEvents,
      chunks: sessionChunks,
      moments: sessionMoments,
      transitions,
      outcomes,
      narrative,
    });
  } catch (err) {
    log(
      `  ⚠ Database write failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    log("  Pipeline results are still available, just not persisted.");
  }

  // 11. Emit activity events
  try {
    const gitCtx = getGitContext(logPath);
    const activityEvents = buildSessionEvents({
      sessionId,
      repo: gitCtx.repo,
      branch: gitCtx.branch,
      worktree: gitCtx.worktree,
      moments: sessionMoments,
      transitions,
      outcomes,
      narrative,
    });
    await emitEvents(activityEvents);
    log(`  → Emitted ${activityEvents.length} activity events`);
  } catch (err) {
    log(`  ⚠ Failed to emit activity events: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    sessionId,
    narrative,
    moments: sessionMoments,
    transitions,
    outcomes,
  };
}
