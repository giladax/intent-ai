import { eq } from "drizzle-orm";
import { getDb } from "./connection.js";
import {
  sessions,
  rawEvents,
  normalizedEvents,
  chunks,
  moments,
  momentEvidence,
  momentRelations,
  transitions,
  transitionMoments,
  outcomes,
  outcomeMoments,
  outcomeFiles,
  narratives,
  narrativeArcs,
} from "./schema.js";
import type {
  RawDevEvent,
  NormalizedDevEvent,
  SessionChunk,
  SessionMoment,
  IntentTransition,
  AcceptedOutcome,
  SessionNarrative,
  SessionShape,
} from "../adapters/types.js";

// ── Store Full Session Digest ───────────────────────────────────────

export async function storeSessionDigest(data: {
  sessionId: string;
  sourceType: string;
  sourcePath: string;
  sessionShape: SessionShape;
  startedAt: Date | null;
  endedAt: Date | null;
  rawEvents: RawDevEvent[];
  normalizedEvents: NormalizedDevEvent[];
  chunks: SessionChunk[];
  moments: SessionMoment[];
  transitions: IntentTransition[];
  outcomes: AcceptedOutcome[];
  narrative: SessionNarrative;
}): Promise<void> {
  const db = getDb();

  // 1. sessions
  await db.insert(sessions).values({
    id: data.sessionId,
    sourceType: data.sourceType,
    sourcePath: data.sourcePath,
    sessionShape: data.sessionShape,
    startedAt: data.startedAt,
    endedAt: data.endedAt,
  });

  // 2. raw_events
  if (data.rawEvents.length > 0) {
    await db.insert(rawEvents).values(
      data.rawEvents.map((e) => ({
        id: e.id,
        sessionId: data.sessionId,
        source: e.source,
        timestamp: e.timestamp ? new Date(e.timestamp) : null,
        type: e.type,
        raw: e.raw,
      })),
    );
  }

  // 3. normalized_events
  if (data.normalizedEvents.length > 0) {
    await db.insert(normalizedEvents).values(
      data.normalizedEvents.map((e) => ({
        id: e.id,
        sessionId: data.sessionId,
        rawEventId: e.rawEventId,
        causalOrder: e.causalOrder,
        category: e.category,
        actor: e.actor,
        summary: e.content.summary,
        detail: e.content.detail,
        filesAffected: e.content.filesAffected ?? null,
      })),
    );
  }

  // 4. chunks
  if (data.chunks.length > 0) {
    await db.insert(chunks).values(
      data.chunks.map((c) => ({
        id: c.id,
        sessionId: data.sessionId,
        chunkIndex: c.chunkIndex,
        topicHint: c.topicHint,
        filesInScope: c.filesInScope,
        eventRangeStart: c.eventRange[0],
        eventRangeEnd: c.eventRange[1],
      })),
    );
  }

  // 5. moments
  if (data.moments.length > 0) {
    await db.insert(moments).values(
      data.moments.map((m) => ({
        id: m.id,
        sessionId: data.sessionId,
        chunkId: m.chunkId,
        type: m.type,
        statement: m.statement,
        significance: m.significance,
        agency: m.agency,
        confidence: m.confidence,
        topicFingerprint: m.topicFingerprint,
        arcId: m.arcId ?? null,
        arcRole: m.arcRole ?? null,
      })),
    );

    // 6. moment_evidence
    const evidenceRows = data.moments.flatMap((m) =>
      m.evidence.map((e) => ({
        momentId: m.id,
        quote: e.quote,
        sourceEventId: e.sourceEventId || null,
        sourceType: e.sourceType,
        quoteType: e.quoteType,
      })),
    );
    if (evidenceRows.length > 0) {
      await db.insert(momentEvidence).values(evidenceRows);
    }

    // 7. moment_relations
    const relationRows = data.moments.flatMap((m) =>
      m.relatedMomentIds.map((relId) => ({
        momentId: m.id,
        relatedMomentId: relId,
        relationType: "evolved_into" as const,
      })),
    );
    if (relationRows.length > 0) {
      await db.insert(momentRelations).values(relationRows);
    }
  }

  // 8. transitions
  if (data.transitions.length > 0) {
    await db.insert(transitions).values(
      data.transitions.map((t) => ({
        id: t.id,
        sessionId: data.sessionId,
        fromStatement: t.fromStatement,
        toStatement: t.toStatement,
        reason: t.reason,
        arcId: t.arcId ?? null,
        confidence: t.confidence,
      })),
    );

    // 9. transition_moments
    const tmRows = data.transitions.flatMap((t) =>
      t.originMomentIds.map((mId) => ({
        transitionId: t.id,
        momentId: mId,
      })),
    );
    if (tmRows.length > 0) {
      await db.insert(transitionMoments).values(tmRows);
    }
  }

  // 10. outcomes
  if (data.outcomes.length > 0) {
    await db.insert(outcomes).values(
      data.outcomes.map((o) => ({
        id: o.id,
        sessionId: data.sessionId,
        statement: o.statement,
        confidence: o.confidence,
      })),
    );

    // 11. outcome_moments
    const omRows = data.outcomes.flatMap((o) =>
      o.supportingMomentIds.map((mId) => ({
        outcomeId: o.id,
        momentId: mId,
      })),
    );
    if (omRows.length > 0) {
      await db.insert(outcomeMoments).values(omRows);
    }

    // 12. outcome_files
    const ofRows = data.outcomes.flatMap((o) =>
      o.supportingFiles.map((fp) => ({
        outcomeId: o.id,
        filePath: fp,
      })),
    );
    if (ofRows.length > 0) {
      await db.insert(outcomeFiles).values(ofRows);
    }
  }

  // 13. narratives
  const [narrativeRow] = await db
    .insert(narratives)
    .values({
      sessionId: data.sessionId,
      sessionShape: data.narrative.sessionShape,
      summary: data.narrative.summary,
      progression: data.narrative.progression,
      discoveries: data.narrative.discoveries,
      stabilizedDirections: data.narrative.stabilizedDirections,
      abandonedDirections: data.narrative.abandonedDirections,
    })
    .returning({ id: narratives.id });

  // 14. narrative_arcs
  if (data.narrative.arcs.length > 0) {
    await db.insert(narrativeArcs).values(
      data.narrative.arcs.map((arc) => ({
        narrativeId: narrativeRow.id,
        arcId: arc.arcId,
        title: arc.title,
        summary: arc.summary,
        resolution: arc.resolution,
        momentIds: arc.momentIds,
      })),
    );
  }
}

// ── Query Helpers ───────────────────────────────────────────────────

export async function getSessionNarrative(
  sessionId: string,
): Promise<SessionNarrative | null> {
  const db = getDb();

  const rows = await db
    .select()
    .from(narratives)
    .where(eq(narratives.sessionId, sessionId))
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0];

  const arcRows = await db
    .select()
    .from(narrativeArcs)
    .where(eq(narrativeArcs.narrativeId, row.id));

  return {
    sessionId,
    sessionShape: row.sessionShape as SessionShape,
    summary: row.summary,
    progression: row.progression ?? [],
    discoveries: row.discoveries ?? [],
    stabilizedDirections: row.stabilizedDirections ?? [],
    abandonedDirections: row.abandonedDirections ?? [],
    arcs: arcRows.map((a) => ({
      arcId: a.arcId,
      title: a.title,
      summary: a.summary ?? "",
      momentIds: a.momentIds ?? [],
      resolution: (a.resolution as "resolved" | "abandoned" | "open") ?? "open",
    })),
  };
}

export async function getSessionMoments(
  sessionId: string,
): Promise<SessionMoment[]> {
  const db = getDb();

  const momentRows = await db
    .select()
    .from(moments)
    .where(eq(moments.sessionId, sessionId));

  const result: SessionMoment[] = [];

  for (const m of momentRows) {
    const evidenceRows = await db
      .select()
      .from(momentEvidence)
      .where(eq(momentEvidence.momentId, m.id));

    const relationRows = await db
      .select()
      .from(momentRelations)
      .where(eq(momentRelations.momentId, m.id));

    result.push({
      id: m.id,
      chunkId: m.chunkId ?? "",
      type: m.type as SessionMoment["type"],
      statement: m.statement,
      significance: m.significance ?? "",
      agency: (m.agency as SessionMoment["agency"]) ?? "ambiguous",
      confidence: (m.confidence as SessionMoment["confidence"]) ?? "low",
      topicFingerprint: m.topicFingerprint ?? "",
      relatedMomentIds: relationRows.map((r) => r.relatedMomentId),
      arcId: m.arcId ?? undefined,
      arcRole: (m.arcRole as SessionMoment["arcRole"]) ?? undefined,
      evidence: evidenceRows.map((e) => ({
        quote: e.quote,
        sourceEventId: e.sourceEventId ?? "",
        sourceType: (e.sourceType as SessionMoment["evidence"][0]["sourceType"]) ?? "human_message",
        quoteType: (e.quoteType as "verbatim" | "summarized") ?? "summarized",
      })),
    });
  }

  return result;
}

export async function listSessions(): Promise<
  Array<{ id: string; shape: string; startedAt: Date | null; summary: string }>
> {
  const db = getDb();

  const sessionRows = await db.select().from(sessions);

  const result: Array<{
    id: string;
    shape: string;
    startedAt: Date | null;
    summary: string;
  }> = [];

  for (const s of sessionRows) {
    const narr = await db
      .select({ summary: narratives.summary })
      .from(narratives)
      .where(eq(narratives.sessionId, s.id))
      .limit(1);

    result.push({
      id: s.id,
      shape: s.sessionShape ?? "unknown",
      startedAt: s.startedAt,
      summary: narr[0]?.summary ?? "",
    });
  }

  return result;
}
