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
import { detectTopicShifts } from "./chunk.js";
import { understand } from "./understand/index.js";
import { buildSessionEvents } from "./emit-events.js";
import {
  storeSessionDigest,
  emitEvents,
  getSessionNarrative,
  getSessionMoments,
  getSessionTransitions,
  getSessionOutcomes,
  getSessionEndedAt,
  deleteSessionDigest,
} from "../storage/queries.js";
import type {
  SessionNarrative,
  SessionMoment,
  IntentTransition,
  AcceptedOutcome,
  RawDevEvent,
} from "../adapters/types.js";

export interface PipelineResult {
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
export function archiveRawSession(logPath: string, ccSessionId: string): void {
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

export function getGitContext(sourcePath: string): { repo?: string; branch?: string; worktree?: string } {
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

export async function runPipeline(
  logPath: string,
  opts?: { force?: boolean },
): Promise<PipelineResult> {
  // 0. Archive the raw log unconditionally — including on the already-digested
  //    path, so a resumed session's grown log keeps refreshing the archive even
  //    though its digest is stale (the known tail-loss hole stays re-derivable).
  const ccSessionId = basename(logPath, ".jsonl");
  archiveRawSession(logPath, ccSessionId);

  // 1. Parse first so we can compare timestamps for grown-log detection.
  log("[1/10] Parsing CC log...");
  const rawEvents = await parseClaudeCodeLog(logPath);

  // 0b. Idempotency + grown-log detection.
  //     Parse FIRST (above) so we can compare the raw-event max timestamp
  //     against the stored endedAt.
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
        : `  → Session log has grown (stored endedAt: ${storedEndedAt?.toISOString()}, new max: ${maxTs?.toISOString()}); re-digesting.`;
      log(reason);
      // TRADE-OFF (I3): delete-before-pipeline means an LLM failure mid-re-digest
      // leaves the session absent from the DB until the next digest run succeeds.
      // Recovery path: the raw log is archived unconditionally above (archiveRawSession),
      // and LLM failures throw loudly, so the next `digest` run will detect no stored
      // session and re-digest from scratch. Permanently lost data is not possible since
      // the source log is preserved. The preferred fix (compute-then-replace in
      // one tx) is deferred.
      await deleteSessionDigest(existingId);
      // fall through to full pipeline
    }
  }

  // 2. Generate sessionId
  const sessionId = crypto.randomUUID();

  // 3. Normalize
  log(`[2/10] Normalizing ${rawEvents.length} events...`);
  const normalizedEvents = normalize(rawEvents, sessionId);

  // Large session warning
  if (normalizedEvents.length > 300) {
    const estimatedChunks = Math.ceil(normalizedEvents.length / 60);
    const estimatedLlmCalls = estimatedChunks + 3;
    log(
      `  ⚠ Large session: ${normalizedEvents.length} events, ~${estimatedChunks} chunks, ~${estimatedLlmCalls} LLM calls`,
    );
  }

  // 4-5. Analyze + Classify + Topic-shift detection in parallel
  log("[3/10] Analyzing + classifying + detecting topic shifts (parallel)...");
  const [directives, sessionShape, topicShiftIds] = await Promise.all([
    analyzeInteractions(normalizedEvents),
    classifySession(normalizedEvents),
    detectTopicShifts(normalizedEvents),
  ]);
  log(`  Shape: ${sessionShape}, ${directives.exchangeSummary.totalExchanges} exchanges`);

  // 6-9. Understand stage: sittings → chunk → extract → weave → verify →
  //      transitions → narrative (all in understand())
  log("[6/10] Detecting moments (pass 1)...");
  log("[7/10] Detecting moments (pass 2)...");
  log("[8/10] Detecting transitions & outcomes...");
  log("[9/10] Generating narrative...");
  const result = await understand(
    normalizedEvents,
    sessionId,
    sessionShape,
    directives,
    topicShiftIds,
  );
  const { sittings, chunks: sessionChunks, moments: sessionMoments, transitions, outcomes, narrative } = result;
  narrative.sessionId = sessionId;
  log(`  Chunks: ${sessionChunks.length}, Moments: ${sessionMoments.length}`);

  // 10. Store
  log("[10/10] Storing to database...");

  // Derive timestamps from raw events
  const timestamps = rawEvents
    .map((e) => e.timestamp)
    .filter(Boolean)
    .map((t) => new Date(t));
  const startedAt = timestamps.length > 0 ? new Date(Math.min(...timestamps.map((d) => d.getTime()))) : null;
  const endedAt = timestamps.length > 0 ? new Date(Math.max(...timestamps.map((d) => d.getTime()))) : null;

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
      chunks: sessionChunks,
      moments: sessionMoments,
      transitions,
      outcomes,
      narrative,
      sittings,
    });
    digestStored = storeResult.stored;
  } catch (err) {
    log(
      `  ⚠ Database write failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    log("  Pipeline results are still available, just not persisted.");
  }

  // 11. Emit activity events — only when the digest was actually stored.
  // Skipping on store failure/conflict prevents activity_events rows from
  // referencing a sessionId with no corresponding sessions row (phantom events).
  if (!digestStored) {
    log("  ⚠ Skipping activity-event emission: digest was not stored (store failure or concurrency conflict).");
  } else {
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
        sessionEndedAt: endedAt,
      });
      await emitEvents(activityEvents);
      log(`  → Emitted ${activityEvents.length} activity events`);
    } catch (err) {
      log(`  ⚠ Failed to emit activity events: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    sessionId,
    narrative,
    moments: sessionMoments,
    transitions,
    outcomes,
  };
}

// ── latestTimestamp ───────────────────────────────────────────────────

/**
 * Return the maximum timestamp across raw events, or null if none are parseable.
 */
export function latestTimestamp(rawEvents: RawDevEvent[]): Date | null {
  let max: number | null = null;
  for (const e of rawEvents) {
    if (!e.timestamp) continue;
    const ms = Date.parse(e.timestamp);
    if (!isNaN(ms) && (max === null || ms > max)) {
      max = ms;
    }
  }
  return max !== null ? new Date(max) : null;
}

// ── Idempotency Helpers ──────────────────────────────────────────────

/**
 * Look up whether a CC session (by source hash) has already been digested.
 * Returns the stored session id, or null if not found. A DB error is treated
 * as "not digested" so a missing/unreachable database never blocks digestion.
 */
export async function findDigestedSession(
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
export async function loadStoredDigest(
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
