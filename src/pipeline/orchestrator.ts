import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { basename } from "node:path";
import { execSync } from "node:child_process";
import { parseClaudeCodeLog } from "../adapters/claude-code.js";
import { getClient } from "../storage/connection.js";
import { normalize } from "./normalize.js";
import { analyzeInteractions } from "./analyze.js";
import { classifySession } from "./classify.js";
import { chunkSession, detectTopicShifts } from "./chunk.js";
import { detectMomentsWithOrganism } from "../eval/organism.js";
import { DEFAULT_ORGANISM } from "./default-organism.js";
import { detectTransitionsAndOutcomes } from "./transitions.js";
import { generateNarrative } from "./narrative.js";
import { buildSessionEvents } from "./emit-events.js";
import {
  storeSessionDigest,
  emitEvents,
  getSessionNarrative,
  getSessionMoments,
  getSessionTransitions,
  getSessionOutcomes,
} from "../storage/queries.js";
import type {
  SessionNarrative,
  SessionMoment,
  IntentTransition,
  AcceptedOutcome,
} from "../adapters/types.js";

interface PipelineResult {
  sessionId: string;
  narrative: SessionNarrative;
  moments: SessionMoment[];
  transitions: IntentTransition[];
  outcomes: AcceptedOutcome[];
}

function log(step: string): void {
  process.stderr.write(`${step}\n`);
}

// ── Raw-session archive ───────────────────────────────────────────────
// Claude Code purges its logs on a ~30-day clock; the digest must never be
// the only survivor. Every digested log is copied into .intent/raw-sessions/
// keyed by CC session UUID — and re-copied when the source has grown (a
// resumed session), so the raw tail is preserved even where the stored
// digest is stale. Failure-safe: archiving never fails the digest.
function archiveRawSession(logPath: string, ccSessionId: string): void {
  try {
    const dir = path.join(process.cwd(), ".intent", "raw-sessions");
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `${ccSessionId}.jsonl`);
    const srcSize = fs.statSync(logPath).size;
    if (fs.existsSync(dest) && fs.statSync(dest).size >= srcSize) return;
    fs.copyFileSync(logPath, dest);
  } catch (err) {
    log(`  ⚠ raw-session archive failed (digest unaffected): ${err instanceof Error ? err.message : String(err)}`);
  }
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

export async function runPipeline(logPath: string): Promise<PipelineResult> {
  // 0. Idempotency — skip paths already digested (keyed on the CC session UUID
  //    from the filename). Re-digesting the same path returns the stored digest
  //    instead of re-running the LLM pipeline, so `digest` is idempotent and a
  //    batch run (`--last N`) never aborts on an already-processed session.
  const ccSessionId = basename(logPath, ".jsonl");
  // Archive the raw log unconditionally — including on the already-digested
  // path, so a resumed session's grown log keeps refreshing the archive even
  // though its digest is stale (the known tail-loss hole stays re-derivable).
  archiveRawSession(logPath, ccSessionId);
  const existingId = await findDigestedSession(ccSessionId);
  if (existingId) {
    log(`  ⚠ Session already digested (${existingId}). Returning stored digest.`);
    const stored = await loadStoredDigest(existingId);
    if (stored) return stored;
    log("  ⚠ Stored digest incomplete; re-digesting.");
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

  // 4-5-6. Analyze + Classify + Topic-shift detection in parallel
  //        (all depend only on normalizedEvents). Chunking consumes the
  //        topic-shift signal, so it runs right after.
  log("[3/10] Analyzing + classifying + detecting topic shifts (parallel)...");
  const [directives, sessionShape, topicShiftIds] = await Promise.all([
    analyzeInteractions(normalizedEvents),
    classifySession(normalizedEvents),
    detectTopicShifts(normalizedEvents),
  ]);
  const sessionChunks = chunkSession(normalizedEvents, sessionId, topicShiftIds);
  log(`  Shape: ${sessionShape}, ${sessionChunks.length} chunks, ${directives.exchangeSummary.totalExchanges} exchanges`);

  // 7. Detect moments using the promoted default organism (Gen 0 winner)
  log("[6/10] Detecting moments (pass 1)...");
  log("[7/10] Detecting moments (pass 2)...");
  const sessionMoments = await detectMomentsWithOrganism(
    DEFAULT_ORGANISM,
    rawEvents,
    sessionChunks,
    sessionShape,
    normalizedEvents,
  );

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

// ── Idempotency Helpers ──────────────────────────────────────────────

/**
 * Look up whether a CC session (by source hash) has already been digested.
 * Returns the stored session id, or null if not found. A DB error is treated
 * as "not digested" so a missing/unreachable database never blocks digestion.
 */
async function findDigestedSession(
  sourceHash: string,
): Promise<string | null> {
  try {
    const sql = getClient();
    const rows = await sql`SELECT id FROM sessions WHERE source_hash = ${sourceHash} LIMIT 1`;
    return rows.length > 0 ? (rows[0].id as string) : null;
  } catch (err) {
    log(
      `  ⚠ Duplicate check failed (${err instanceof Error ? err.message : String(err)}). Proceeding with digest.`,
    );
    return null;
  }
}

/**
 * Reconstruct a previously stored digest so a repeat run can return the same
 * result without re-running the LLM pipeline. Returns null if the stored data
 * is incomplete (e.g. narrative missing) so the caller can re-digest.
 */
async function loadStoredDigest(
  sessionId: string,
): Promise<PipelineResult | null> {
  try {
    const [narrative, moments, transitions, outcomes] = await Promise.all([
      getSessionNarrative(sessionId),
      getSessionMoments(sessionId),
      getSessionTransitions(sessionId),
      getSessionOutcomes(sessionId),
    ]);
    if (!narrative) return null;
    return { sessionId, narrative, moments, transitions, outcomes };
  } catch (err) {
    log(
      `  ⚠ Failed to load stored digest (${err instanceof Error ? err.message : String(err)}). Re-digesting.`,
    );
    return null;
  }
}
