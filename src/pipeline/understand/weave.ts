import type { z } from "zod";
import type {
  ExtractedMoment,
  SessionChunk,
  SessionMoment,
  Sitting,
  EvidenceAnchor,
} from "../../adapters/types.js";
import { callSonnet } from "../../llm/client.js";
import {
  buildWeavePrompt,
  WeaveOutputSchema,
} from "../../llm/prompts/understand/weave.js";
import { dedupMoments, type DedupResult } from "../dedup-moments.js";

// ── arcRole mapping ───────────────────────────────────────────────────
// WeaveDecisionSchema uses "development"; SessionMoment.arcRole uses "escalation".

type WeaveArcRole = "origin" | "development" | "turning_point" | "resolution";
type SessionArcRole = NonNullable<SessionMoment["arcRole"]>;

function mapArcRole(role: WeaveArcRole): SessionArcRole {
  if (role === "development") return "escalation";
  return role as SessionArcRole;
}

// ── applyWeaveDecisions ───────────────────────────────────────────────

/**
 * Pure function: apply weave decisions to extracted moments, returning final SessionMoments.
 *
 * Rules:
 * - keep  → SessionMoment from the extract moment; evidence carried as-is
 * - merge → primary = first id; evidence = union in id order; occurredAt = earliest non-null
 * - drop  → excluded
 * - safety nets (code, not prompt):
 *   - ids present in input but missing from all decisions → implicit keep (arc "general")
 *   - decisions naming unknown ids → stderr warning + ignore
 *   - single-id merge → treated as keep
 * - final ids: moment-${index} over sorted output
 * - relatedTo resolves to final SessionMoment ids (two-pass)
 */
export function applyWeaveDecisions(
  decisions: z.infer<typeof WeaveOutputSchema>["decisions"],
  extracted: ExtractedMoment[],
  chunks: SessionChunk[],
): SessionMoment[] {
  // Build lookup: extractId → ExtractedMoment
  const extractedById = new Map<string, ExtractedMoment>(
    extracted.map((m) => [m.id, m]),
  );

  // Build lookup: chunkIndex → chunkId
  const chunkIdByIndex = new Map<number, string>(
    chunks.map((c) => [c.chunkIndex, c.id]),
  );

  // Track which extract ids have been claimed by a decision
  const claimedIds = new Set<string>();

  // Intermediate: resolved moments before final id assignment
  type IntermediateMoment = Omit<SessionMoment, "id" | "relatedMomentIds"> & {
    extractId: string;   // the primary extract id (used to resolve relatedTo)
    relatedExtractIds: string[]; // raw relatedTo from decision (extract ids)
  };

  const intermediate: IntermediateMoment[] = [];

  for (const decision of decisions) {
    const { action, momentIds } = decision;

    // Validate: filter to known ids, warn on unknown
    const knownIds = momentIds.filter((id) => {
      if (!extractedById.has(id)) {
        process.stderr.write(
          `[weave] warning: unknown moment id "${id}" in decision — ignored\n`,
        );
        return false;
      }
      return true;
    });

    if (knownIds.length === 0) continue;

    if (action === "drop") {
      for (const id of knownIds) claimedIds.add(id);
      continue;
    }

    // keep or merge (single-id merge → treat as keep)
    const primaryId = knownIds[0];
    const primaryMoment = extractedById.get(primaryId)!;

    for (const id of knownIds) claimedIds.add(id);

    if (action === "keep" || knownIds.length === 1) {
      // keep or single-id merge
      const chunkId = chunkIdByIndex.get(primaryMoment.chunkIndex) ?? primaryId;
      intermediate.push({
        extractId: primaryId,
        chunkId,
        type: primaryMoment.type,
        statement: primaryMoment.statement,
        significance: primaryMoment.significance,
        agency: primaryMoment.agency,
        confidence: primaryMoment.confidence ?? "low",
        topicFingerprint: primaryMoment.topicFingerprint,
        evidence: primaryMoment.evidence as unknown as SessionMoment["evidence"],
        occurredAt: primaryMoment.occurredAt,
        verification: null,
        arcId: decision.arcId ?? "general",
        arcRole: mapArcRole((decision.arcRole ?? "development") as WeaveArcRole),
        relatedExtractIds: decision.relatedTo ?? [],
      });
    } else {
      // genuine merge (2+ known ids)
      const allMoments = knownIds.map((id) => extractedById.get(id)!);

      // Evidence: union in id order (order of knownIds)
      const evidenceUnion: EvidenceAnchor[] = [];
      for (const m of allMoments) {
        evidenceUnion.push(...m.evidence);
      }

      // occurredAt: earliest non-null
      const times = allMoments
        .map((m) => m.occurredAt)
        .filter((t): t is string => t !== null);
      const occurredAt =
        times.length > 0 ? times.slice().sort()[0] : null;

      // statement: decision.statement if provided, else primary's statement
      const statement = decision.statement ?? primaryMoment.statement;

      const chunkId =
        chunkIdByIndex.get(primaryMoment.chunkIndex) ?? primaryId;

      intermediate.push({
        extractId: primaryId,
        chunkId,
        type: primaryMoment.type,
        statement,
        significance: primaryMoment.significance,
        agency: primaryMoment.agency,
        confidence: primaryMoment.confidence ?? "low",
        topicFingerprint: primaryMoment.topicFingerprint,
        evidence: evidenceUnion as unknown as SessionMoment["evidence"],
        occurredAt,
        verification: null,
        arcId: decision.arcId ?? "general",
        arcRole: mapArcRole((decision.arcRole ?? "development") as WeaveArcRole),
        relatedExtractIds: decision.relatedTo ?? [],
      });
    }
  }

  // Implicit keep: ids in extracted but not claimed by any decision
  for (const m of extracted) {
    if (!claimedIds.has(m.id)) {
      const chunkId = chunkIdByIndex.get(m.chunkIndex) ?? m.id;
      intermediate.push({
        extractId: m.id,
        chunkId,
        type: m.type,
        statement: m.statement,
        significance: m.significance,
        agency: m.agency,
        confidence: m.confidence ?? "low",
        topicFingerprint: m.topicFingerprint,
        evidence: m.evidence as unknown as SessionMoment["evidence"],
        occurredAt: m.occurredAt,
        verification: null,
        arcId: "general",
        arcRole: undefined,
        relatedExtractIds: [],
      });
    }
  }

  // Assign final ids: moment-${index}
  const finalIdByExtractId = new Map<string, string>(
    intermediate.map((m, i) => [m.extractId, `moment-${i}`]),
  );

  // Second pass: resolve relatedTo → final ids
  const result: SessionMoment[] = intermediate.map((m, i) => {
    const resolvedRelated = m.relatedExtractIds
      .map((extractId) => finalIdByExtractId.get(extractId))
      .filter((id): id is string => id !== undefined);

    return {
      id: `moment-${i}`,
      chunkId: m.chunkId,
      type: m.type,
      statement: m.statement,
      significance: m.significance,
      agency: m.agency,
      confidence: m.confidence,
      topicFingerprint: m.topicFingerprint,
      evidence: m.evidence,
      occurredAt: m.occurredAt,
      verification: m.verification,
      arcId: m.arcId,
      arcRole: m.arcRole,
      relatedMomentIds: resolvedRelated,
    };
  });

  return result;
}

// ── filterDedupSurvivors ──────────────────────────────────────────────

/**
 * Pure function: given the original extracted moments, the pass1 adapter input
 * (built from extracted), a reference map from pass1 moment object → extract id,
 * and the dedup result, return only those extracted moments whose identity was
 * NOT removed by dedup.
 *
 * Resolves removed moments by object identity (via pass1MomentToExtractId), NOT
 * by statement text — two distinct moments with identical statements but different
 * evidence will not be conflated.
 */
export function filterDedupSurvivors(
  extracted: ExtractedMoment[],
  pass1MomentToExtractId: Map<object, string>,
  dedupResult: DedupResult,
): ExtractedMoment[] {
  const removedExtractIds = new Set<string>();
  for (const { moment } of dedupResult.removed) {
    const extractId = pass1MomentToExtractId.get(moment);
    if (extractId !== undefined) {
      removedExtractIds.add(extractId);
    }
  }
  return extracted.filter((m) => !removedExtractIds.has(m.id));
}

// ── weaveMoments ──────────────────────────────────────────────────────

/**
 * Full weave stage: deduplicate extracted moments, call Sonnet for decisions,
 * then apply decisions deterministically.
 */
export async function weaveMoments(
  extracted: ExtractedMoment[],
  chunks: SessionChunk[],
  sessionShape: string,
  sittings: Sitting[],
): Promise<SessionMoment[]> {
  // Build Pass1Moment-compatible shape for dedupMoments.
  // We also build a reference map (pass1 moment object → extract id) so that
  // filterDedupSurvivors can resolve removed entries by object identity rather
  // than statement text — avoiding false exclusions when two distinct moments
  // in different chunks share the same statement.
  const pass1MomentToExtractId = new Map<object, string>();

  const pass1Input = chunks.map((chunk) => {
    const chunkMoments = extracted
      .filter((m) => m.chunkIndex === chunk.chunkIndex)
      .map((m) => {
        const pass1Moment = {
          type: m.type,
          statement: m.statement,
          significance: m.significance,
          agency: m.agency,
          confidence: (m.confidence ?? "low") as "high" | "medium" | "low",
          topicFingerprint: m.topicFingerprint,
          // Adapt: give dedupMoments a sourceEventId from eventIndex so overlap dedup works
          evidence: m.evidence.map((e) => ({
            quote: e.quote,
            sourceEventId:
              e.eventIndex !== null ? String(e.eventIndex) : undefined,
            sourceType: e.sourceType as "user" | "ai" | "tool_output",
            quoteType: "verbatim" as const,
          })),
        };
        pass1MomentToExtractId.set(pass1Moment, m.id);
        return pass1Moment;
      });
    return { chunkIndex: chunk.chunkIndex, moments: chunkMoments };
  });

  const dedupResult = dedupMoments(pass1Input, chunks);

  // Collect surviving extracted moments by object identity, not statement text
  const survivingExtracted = filterDedupSurvivors(
    extracted,
    pass1MomentToExtractId,
    dedupResult,
  );

  if (survivingExtracted.length === 0) {
    return [];
  }

  const { system, user } = buildWeavePrompt({
    moments: survivingExtracted,
    sessionShape,
    sittings,
  });

  const output = await callSonnet(system, user, WeaveOutputSchema);

  // Deduplicated moments that were removed never appear in the prompt — no decisions for them
  // Apply decisions over surviving extracted only
  return applyWeaveDecisions(output.decisions, survivingExtracted, chunks);
}
