import type {
  NormalizedDevEvent,
  SessionChunk,
  SessionMoment,
  IntentTransition,
  AcceptedOutcome,
  SessionNarrative,
  Sitting,
  SessionShape,
  PipelineDirectives,
} from "../../adapters/types.js";
import { detectSittings } from "./sittings.js";
import { chunkSession } from "../chunk.js";
import { extractChunk } from "./extract.js";
import { weaveMoments } from "./weave.js";
import { verifyMoments } from "./verify.js";
import { detectTransitionsAndOutcomes } from "../transitions.js";
import { generateNarrative } from "../narrative.js";
import { buildSessionDigest } from "../session-digest.js";
import type { SessionDigest } from "../session-digest.js";

export interface UnderstandResult {
  sittings: Sitting[];
  chunks: SessionChunk[];
  moments: SessionMoment[];
  transitions: IntentTransition[];
  outcomes: AcceptedOutcome[];
  narrative: SessionNarrative;
}

// ── buildDigestHeader ─────────────────────────────────────────────────
//
// Build the per-chunk context header string passed to extractChunk as
// digestHeader. Provides ~200-400 tokens of prior-chunk context so the
// extractor knows where it sits in the session.

function buildDigestHeader(
  chunkIndex: number,
  totalChunks: number,
  digest: SessionDigest,
): string {
  const lines: string[] = [];
  lines.push(`\n## Session Context (Chunk ${chunkIndex} of ${totalChunks - 1})`);

  const priorTopics = digest.topicFlow
    .filter((t) => t.chunkIndex < chunkIndex)
    .map((t) => `Chunk ${t.chunkIndex}: ${t.topicHint}`)
    .slice(-5);

  if (priorTopics.length > 0) {
    lines.push(`Prior topics: ${priorTopics.join(", ")}`);
  }

  const priorStatements = digest.developerStatements
    .filter((s) => s.chunkIndex < chunkIndex)
    .slice(-5)
    .map((s) => {
      const truncated = s.text.length > 80 ? s.text.slice(0, 80) + "..." : s.text;
      return `[${s.causalOrder}] "${truncated}"`;
    });

  if (priorStatements.length > 0) {
    lines.push(`Key developer statements: ${priorStatements.join(", ")}`);
  }

  const boundaries = digest.boundaryExchanges.filter(
    (b) => b.chunkA === chunkIndex || b.chunkB === chunkIndex,
  );
  if (boundaries.length > 0) {
    const boundaryNotes = boundaries.map(
      (b) => `Exchange spanning chunks ${b.chunkA}-${b.chunkB}`,
    );
    lines.push(`Boundary: ${boundaryNotes.join("; ")}`);
  }

  return lines.join("\n");
}

/**
 * Full understanding stage: sittings → chunk → extract → weave → verify →
 * transitions → narrative.
 *
 * Returns all intermediate artifacts so the orchestrator can store them.
 */
export async function understand(
  normalizedEvents: NormalizedDevEvent[],
  sessionId: string,
  sessionShape: SessionShape,
  directives: PipelineDirectives,
  topicShiftIds: Set<string>,
): Promise<UnderstandResult> {
  // 1. Detect sittings (idle-gap segmentation)
  const sittings = detectSittings(normalizedEvents);

  // 2. Sitting boundary causalOrders → hard chunk breaks
  const hardBreaks: number[] = sittings
    .slice(1)
    .map((s) => s.eventRange[0]);

  // 3. Chunk with hard breaks at sitting boundaries
  const chunks = chunkSession(normalizedEvents, sessionId, topicShiftIds, { hardBreaks });

  // 4. Build cross-chunk digest for context headers
  const digest = buildSessionDigest(chunks, normalizedEvents);

  // 5. Extract moments from each chunk in parallel
  const extractedPerChunk = await Promise.all(
    chunks.map((chunk) => {
      const digestHeader =
        chunks.length > 1
          ? buildDigestHeader(chunk.chunkIndex, chunks.length, digest)
          : undefined;
      return extractChunk(chunk, sessionShape, directives, digestHeader);
    }),
  );
  const extracted = extractedPerChunk.flat();

  // 6. Weave: dedup + arc assignment across all extracted moments
  const wovenMoments = await weaveMoments(extracted, chunks, sessionShape, sittings);

  // 7. Verify: check outcome claims against tool events
  const moments = await verifyMoments(wovenMoments, chunks);

  // 8. Transitions + outcomes
  const { transitions, outcomes } = await detectTransitionsAndOutcomes(
    moments,
    sessionId,
    chunks,
  );

  // 9. Narrative
  const narrative = await generateNarrative(
    moments,
    transitions,
    outcomes,
    sessionShape,
    sittings,
  );

  return { sittings, chunks, moments, transitions, outcomes, narrative };
}
