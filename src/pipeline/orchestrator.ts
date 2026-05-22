import crypto from "node:crypto";
import { parseClaudeCodeLog } from "../adapters/claude-code.js";
import { normalize } from "./normalize.js";
import { analyzeInteractions } from "./analyze.js";
import { classifySession } from "./classify.js";
import { chunkSession } from "./chunk.js";
import { detectMoments } from "./moments.js";
import { detectTransitionsAndOutcomes } from "./transitions.js";
import { generateNarrative } from "./narrative.js";
import { storeSessionDigest } from "../storage/queries.js";
import type {
  SessionNarrative,
  SessionMoment,
  IntentTransition,
  AcceptedOutcome,
} from "../adapters/types.js";

function log(step: string): void {
  process.stderr.write(`${step}\n`);
}

export async function runPipeline(logPath: string): Promise<{
  sessionId: string;
  narrative: SessionNarrative;
  moments: SessionMoment[];
  transitions: IntentTransition[];
  outcomes: AcceptedOutcome[];
}> {
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

  // 4. Analyze interactions
  log("[3/10] Analyzing interactions...");
  const directives = analyzeInteractions(normalizedEvents);

  // 5. Classify
  log("[4/10] Classifying session shape...");
  const sessionShape = await classifySession(normalizedEvents);

  // 6. Chunk
  const sessionChunks = chunkSession(normalizedEvents, sessionId);
  log(`[5/10] Chunking into ${sessionChunks.length} windows...`);

  // 7. Detect moments (pass 1 + 2)
  log("[6/10] Detecting moments (pass 1)...");
  log("[7/10] Detecting moments (pass 2)...");
  const sessionMoments = await detectMoments(sessionChunks, sessionShape, directives);

  // 8. Transitions + outcomes
  log("[8/10] Detecting transitions & outcomes...");
  const { transitions, outcomes } = await detectTransitionsAndOutcomes(
    sessionMoments,
    sessionId,
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

  return {
    sessionId,
    narrative,
    moments: sessionMoments,
    transitions,
    outcomes,
  };
}
