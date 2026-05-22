import type { SessionChunk } from "../adapters/types.js";
import type { SessionShape, SessionMoment } from "../adapters/types.js";
import { callSonnet } from "../llm/client.js";
import {
  buildPass1Prompt,
  buildPass2Prompt,
  Pass1OutputSchema,
  Pass2OutputSchema,
  type Pass1Moment,
  type Pass2Moment,
} from "../llm/prompts/moments.js";
import type { SessionShape as PromptSessionShape } from "../llm/prompts/classify.js";

/**
 * Two-pass moment detection across session chunks.
 *
 * Pass 1: Extract candidate moments from each chunk in parallel (Sonnet).
 * Pass 2: Merge, deduplicate, and assign arcs across all candidates (Sonnet).
 */
export async function detectMoments(
  chunks: SessionChunk[],
  sessionShape: SessionShape,
): Promise<SessionMoment[]> {
  const shapeObj: PromptSessionShape = { shape: sessionShape };

  // ── Pass 1: per-chunk extraction in parallel ───────────────────────
  const pass1Results = await Promise.all(
    chunks.map(async (chunk) => {
      const { system, user } = buildPass1Prompt({
        chunk,
        sessionShape: shapeObj,
      });
      const result = await callSonnet(system, user, Pass1OutputSchema);
      return { chunkIndex: chunk.chunkIndex, moments: result.moments };
    }),
  );

  // ── Pass 2: cross-chunk merge & arc assignment ─────────────────────
  const { system, user } = buildPass2Prompt({
    pass1Moments: pass1Results,
    sessionShape: shapeObj,
    totalChunks: chunks.length,
  });
  const pass2Result = await callSonnet(system, user, Pass2OutputSchema);

  // Convert Pass2Moment[] → SessionMoment[]
  return pass2Result.moments.map((m, i) => toSessionMoment(m, i, chunks));
}

// ── Internal ──────────────────────────────────────────────────────────

function toSessionMoment(
  m: Pass2Moment,
  index: number,
  chunks: SessionChunk[],
): SessionMoment {
  // Use first chunk's id as a fallback chunkId
  const chunkId = chunks[0]?.id ?? "unknown";

  return {
    id: `moment-${index}`,
    chunkId,
    type: m.type,
    statement: m.statement,
    significance: m.significance,
    agency: m.agency === "collaborative" ? "collaborative" : m.agency,
    confidence: m.confidence,
    topicFingerprint: m.topicFingerprint,
    relatedMomentIds: m.relatedMomentIds.map((id) => `moment-${id}`),
    arcId: m.arcId,
    arcRole: mapArcRole(m.arcRole),
    evidence: m.evidence.map((e) => ({
      quote: e.quote,
      sourceEventId: e.sourceEventId ?? "",
      sourceType: mapSourceType(e.sourceType),
      quoteType: e.quoteType === "verbatim" ? "verbatim" : "summarized",
    })),
  };
}

function mapArcRole(
  role: string,
): "origin" | "escalation" | "turning_point" | "resolution" {
  switch (role) {
    case "origin":
      return "origin";
    case "turning_point":
      return "turning_point";
    case "resolution":
      return "resolution";
    default:
      return "escalation";
  }
}

function mapSourceType(
  st: string,
): "human_message" | "ai_message" | "tool_output" | "tool_input" {
  switch (st) {
    case "user":
      return "human_message";
    case "ai":
      return "ai_message";
    case "tool_output":
      return "tool_output";
    default:
      return "tool_input";
  }
}
