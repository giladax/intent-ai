import { eq, and, gte, lte, desc } from "drizzle-orm";
import { randomUUID } from "crypto";

function batchArray<T>(arr: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    batches.push(arr.slice(i, i + size));
  }
  return batches;
}
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

  // 1. sessions — use raw client for timestamp compatibility
  const client = (await import("./connection.js")).getClient();
  await client`INSERT INTO sessions (id, source_type, source_path, session_shape, started_at, ended_at, created_at)
    VALUES (${data.sessionId}, ${data.sourceType}, ${data.sourcePath}, ${data.sessionShape},
            ${data.startedAt?.toISOString() ?? null}, ${data.endedAt?.toISOString() ?? null}, NOW())`;

  // 2. raw_events — skip storing raw events to save space/time
  // The raw JSONL file is the source of truth; we don't need to duplicate it in Postgres.
  // If needed later, add a reference to the source file path (already in sessions table).

  // 3. normalized_events (batched)
  for (const batch of batchArray(data.normalizedEvents, 20)) {
    await db.insert(normalizedEvents).values(
      batch.map((e) => ({
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

  // 4. chunks — map pipeline IDs to UUIDs
  const chunkIdMap = new Map<string, string>();
  if (data.chunks.length > 0) {
    const chunkValues = data.chunks.map((c) => {
      const uuid = randomUUID();
      chunkIdMap.set(c.id, uuid);
      return {
        id: uuid,
        sessionId: data.sessionId,
        chunkIndex: c.chunkIndex,
        topicHint: c.topicHint,
        filesInScope: c.filesInScope,
        eventRangeStart: c.eventRange[0],
        eventRangeEnd: c.eventRange[1],
      };
    });
    await db.insert(chunks).values(chunkValues);
  }

  // 5. moments — map pipeline IDs to UUIDs
  const momentIdMap = new Map<string, string>();
  if (data.moments.length > 0) {
    const momentValues = data.moments.map((m) => {
      const uuid = randomUUID();
      momentIdMap.set(m.id, uuid);
      return {
        id: uuid,
        sessionId: data.sessionId,
        chunkId: chunkIdMap.get(m.chunkId) ?? null,
        type: m.type,
        statement: m.statement,
        significance: m.significance,
        agency: m.agency,
        confidence: m.confidence,
        topicFingerprint: m.topicFingerprint,
        arcId: m.arcId ?? null,
        arcRole: m.arcRole ?? null,
      };
    });
    await db.insert(moments).values(momentValues);

    // 6. moment_evidence — use mapped moment UUIDs, skip non-UUID sourceEventIds
    const evidenceRows = data.moments.flatMap((m) => {
      const momentUuid = momentIdMap.get(m.id)!;
      return m.evidence.map((e) => ({
        momentId: momentUuid,
        quote: e.quote,
        sourceEventId: null, // sourceEventId from pipeline isn't a UUID
        sourceType: e.sourceType,
        quoteType: e.quoteType,
      }));
    });
    if (evidenceRows.length > 0) {
      for (const batch of batchArray(evidenceRows, 20)) {
        await db.insert(momentEvidence).values(batch);
      }
    }

    // 7. moment_relations — map pipeline IDs to UUIDs
    const relationRows = data.moments.flatMap((m) =>
      m.relatedMomentIds
        .filter((relId) => momentIdMap.has(relId))
        .map((relId) => ({
          momentId: momentIdMap.get(m.id)!,
          relatedMomentId: momentIdMap.get(relId)!,
          relationType: "evolved_into" as const,
        })),
    );
    if (relationRows.length > 0) {
      await db.insert(momentRelations).values(relationRows);
    }
  }

  // 8. transitions — generate UUIDs
  const transitionIdMap = new Map<string, string>();
  if (data.transitions.length > 0) {
    await db.insert(transitions).values(
      data.transitions.map((t) => {
        const uuid = randomUUID();
        transitionIdMap.set(t.id, uuid);
        return {
          id: uuid,
          sessionId: data.sessionId,
          fromStatement: t.fromStatement,
          toStatement: t.toStatement,
          reason: t.reason,
          arcId: t.arcId ?? null,
          confidence: t.confidence,
        };
      }),
    );

    // 9. transition_moments — map both IDs
    const tmRows = data.transitions.flatMap((t) =>
      t.originMomentIds
        .filter((mId) => momentIdMap.has(mId))
        .map((mId) => ({
          transitionId: transitionIdMap.get(t.id)!,
          momentId: momentIdMap.get(mId)!,
        })),
    );
    if (tmRows.length > 0) {
      await db.insert(transitionMoments).values(tmRows);
    }
  }

  // 10. outcomes — generate UUIDs
  const outcomeIdMap = new Map<string, string>();
  if (data.outcomes.length > 0) {
    await db.insert(outcomes).values(
      data.outcomes.map((o) => {
        const uuid = randomUUID();
        outcomeIdMap.set(o.id, uuid);
        return {
          id: uuid,
          sessionId: data.sessionId,
          statement: o.statement,
          confidence: o.confidence,
        };
      }),
    );

    // 11. outcome_moments — map both IDs
    const omRows = data.outcomes.flatMap((o) =>
      o.supportingMomentIds
        .filter((mId) => momentIdMap.has(mId))
        .map((mId) => ({
          outcomeId: outcomeIdMap.get(o.id)!,
          momentId: momentIdMap.get(mId)!,
        })),
    );
    if (omRows.length > 0) {
      await db.insert(outcomeMoments).values(omRows);
    }

    // 12. outcome_files
    const ofRows = data.outcomes.flatMap((o) =>
      o.supportingFiles.map((fp) => ({
        outcomeId: outcomeIdMap.get(o.id)!,
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

// ── Transition & Outcome Queries ────────────────────────────────────

export async function getSessionTransitions(
  sessionId: string,
): Promise<IntentTransition[]> {
  const db = getDb();

  const transitionRows = await db
    .select()
    .from(transitions)
    .where(eq(transitions.sessionId, sessionId));

  const result: IntentTransition[] = [];

  for (const t of transitionRows) {
    const tmRows = await db
      .select()
      .from(transitionMoments)
      .where(eq(transitionMoments.transitionId, t.id));

    result.push({
      id: t.id,
      sessionId,
      fromStatement: t.fromStatement,
      toStatement: t.toStatement,
      reason: t.reason ?? "",
      originMomentIds: tmRows.map((r) => r.momentId),
      arcId: t.arcId ?? undefined,
      confidence: (t.confidence as IntentTransition["confidence"]) ?? "low",
    });
  }

  return result;
}

export async function getSessionOutcomes(
  sessionId: string,
): Promise<AcceptedOutcome[]> {
  const db = getDb();

  const outcomeRows = await db
    .select()
    .from(outcomes)
    .where(eq(outcomes.sessionId, sessionId));

  const result: AcceptedOutcome[] = [];

  for (const o of outcomeRows) {
    const omRows = await db
      .select()
      .from(outcomeMoments)
      .where(eq(outcomeMoments.outcomeId, o.id));

    const ofRows = await db
      .select()
      .from(outcomeFiles)
      .where(eq(outcomeFiles.outcomeId, o.id));

    result.push({
      id: o.id,
      sessionId,
      statement: o.statement,
      supportingMomentIds: omRows.map((r) => r.momentId),
      supportingFiles: ofRows.map((r) => r.filePath),
      confidence: (o.confidence as AcceptedOutcome["confidence"]) ?? "low",
    });
  }

  return result;
}

// ── Chunk Event Queries ─────────────────────────────────────────────

export async function getChunkEvents(
  sessionId: string,
  chunkId: string,
): Promise<NormalizedDevEvent[]> {
  const db = getDb();

  // Look up the chunk to get its event range
  const chunkRows = await db
    .select()
    .from(chunks)
    .where(and(eq(chunks.id, chunkId), eq(chunks.sessionId, sessionId)))
    .limit(1);

  if (chunkRows.length === 0) return [];

  const chunk = chunkRows[0];

  // Query normalized events by causalOrder range
  const eventRows = await db
    .select()
    .from(normalizedEvents)
    .where(
      and(
        eq(normalizedEvents.sessionId, sessionId),
        gte(normalizedEvents.causalOrder, chunk.eventRangeStart),
        lte(normalizedEvents.causalOrder, chunk.eventRangeEnd),
      ),
    );

  return eventRows.map((e) => ({
    id: e.id,
    sessionId,
    timestamp: "",
    causalOrder: e.causalOrder,
    category: e.category as NormalizedDevEvent["category"],
    actor: e.actor as NormalizedDevEvent["actor"],
    content: {
      summary: e.summary,
      detail: e.detail ?? "",
      filesAffected: e.filesAffected ?? undefined,
    },
    rawEventId: e.rawEventId ?? "",
    turnId: "",
  }));
}

// ── Most Recent Session ─────────────────────────────────────────────

export async function getMostRecentSession(): Promise<{
  id: string;
  shape: string;
  startedAt: Date | null;
  endedAt: Date | null;
} | null> {
  const db = getDb();

  const rows = await db
    .select()
    .from(sessions)
    .orderBy(desc(sessions.createdAt))
    .limit(1);

  if (rows.length === 0) return null;

  const s = rows[0];
  return {
    id: s.id,
    shape: s.sessionShape ?? "unknown",
    startedAt: s.startedAt,
    endedAt: s.endedAt,
  };
}
