import { eq, desc } from "drizzle-orm";
import { getDb } from "./connection.js";
import { getClient } from "./connection.js";
import {
  sessions,
  narratives,
  narrativeArcs,
} from "./schema.js";
import { randomUUID } from "crypto";
import type {
  RawDevEvent,
  NormalizedDevEvent,
  SessionChunk,
  SessionMoment,
  IntentTransition,
  AcceptedOutcome,
  SessionNarrative,
  SessionShape,
  ActivityEvent,
} from "../adapters/types.js";

function batchArray<T>(arr: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    batches.push(arr.slice(i, i + size));
  }
  return batches;
}

// ── Store Full Session Digest ───────────────────────────────────────

export async function storeSessionDigest(data: {
  sessionId: string;
  sourceType: string;
  sourcePath: string;
  sourceHash?: string;
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
  const sql = getClient();

  // 1. session
  await sql`INSERT INTO sessions (id, source_type, source_path, source_hash, session_shape, started_at, ended_at, created_at)
    VALUES (${data.sessionId}, ${data.sourceType}, ${data.sourcePath}, ${data.sourceHash ?? null}, ${data.sessionShape},
            ${data.startedAt?.toISOString() ?? null}, ${data.endedAt?.toISOString() ?? null}, NOW())`;

  // 2. normalized_events (batched, skip raw_events — source JSONL is the truth)
  for (const batch of batchArray(data.normalizedEvents, 15)) {
    for (const e of batch) {
      await sql`INSERT INTO normalized_events (id, session_id, raw_event_id, causal_order, category, actor, summary, detail, files_affected)
        VALUES (${randomUUID()}, ${data.sessionId}, ${null}, ${e.causalOrder}, ${e.category}, ${e.actor},
                ${e.content.summary}, ${e.content.detail}, ${e.content.filesAffected ?? null})`;
    }
  }

  // 3. chunks
  const chunkIdMap = new Map<string, string>();
  for (const c of data.chunks) {
    const uuid = randomUUID();
    chunkIdMap.set(c.id, uuid);
    await sql`INSERT INTO chunks (id, session_id, chunk_index, topic_hint, files_in_scope, event_range_start, event_range_end)
      VALUES (${uuid}, ${data.sessionId}, ${c.chunkIndex}, ${c.topicHint}, ${c.filesInScope}, ${c.eventRange[0]}, ${c.eventRange[1]})`;
  }

  // 4. moments
  const momentIdMap = new Map<string, string>();
  for (const m of data.moments) {
    const uuid = randomUUID();
    momentIdMap.set(m.id, uuid);
    const chunkUuid = chunkIdMap.get(m.chunkId) ?? null;
    await sql`INSERT INTO moments (id, session_id, chunk_id, type, statement, significance, agency, confidence, topic_fingerprint, arc_id, arc_role)
      VALUES (${uuid}, ${data.sessionId}, ${chunkUuid}, ${m.type}, ${m.statement}, ${m.significance},
              ${m.agency}, ${m.confidence}, ${m.topicFingerprint}, ${m.arcId ?? null}, ${m.arcRole ?? null})`;

    // 5. moment_evidence
    for (const e of m.evidence) {
      await sql`INSERT INTO moment_evidence (id, moment_id, quote, source_type, quote_type)
        VALUES (${randomUUID()}, ${uuid}, ${e.quote}, ${e.sourceType}, ${e.quoteType})`;
    }
  }

  // 6. moment_relations
  for (const m of data.moments) {
    const fromUuid = momentIdMap.get(m.id);
    if (!fromUuid) continue;
    for (const relId of m.relatedMomentIds) {
      const toUuid = momentIdMap.get(relId);
      if (toUuid) {
        await sql`INSERT INTO moment_relations (moment_id, related_moment_id, relation_type)
          VALUES (${fromUuid}, ${toUuid}, 'evolved_into')
          ON CONFLICT DO NOTHING`;
      }
    }
  }

  // 7. transitions
  for (const t of data.transitions) {
    const uuid = randomUUID();
    await sql`INSERT INTO transitions (id, session_id, from_statement, to_statement, reason, arc_id, confidence)
      VALUES (${uuid}, ${data.sessionId}, ${t.fromStatement}, ${t.toStatement}, ${t.reason}, ${t.arcId ?? null}, ${t.confidence})`;
    for (const mId of t.originMomentIds) {
      const mUuid = momentIdMap.get(mId);
      if (mUuid) {
        await sql`INSERT INTO transition_moments (transition_id, moment_id) VALUES (${uuid}, ${mUuid})
          ON CONFLICT DO NOTHING`;
      }
    }
  }

  // 8. outcomes
  for (const o of data.outcomes) {
    const uuid = randomUUID();
    await sql`INSERT INTO outcomes (id, session_id, statement, confidence)
      VALUES (${uuid}, ${data.sessionId}, ${o.statement}, ${o.confidence})`;
    for (const mId of o.supportingMomentIds) {
      const mUuid = momentIdMap.get(mId);
      if (mUuid) {
        await sql`INSERT INTO outcome_moments (outcome_id, moment_id) VALUES (${uuid}, ${mUuid})
          ON CONFLICT DO NOTHING`;
      }
    }
    for (const fp of o.supportingFiles) {
      await sql`INSERT INTO outcome_files (outcome_id, file_path) VALUES (${uuid}, ${fp})`;
    }
  }

  // 9. narrative
  const narrativeUuid = randomUUID();
  await sql`INSERT INTO narratives (id, session_id, session_shape, summary, progression, discoveries, stabilized_directions, abandoned_directions)
    VALUES (${narrativeUuid}, ${data.sessionId}, ${data.narrative.sessionShape}, ${data.narrative.summary},
            ${data.narrative.progression}, ${data.narrative.discoveries},
            ${data.narrative.stabilizedDirections}, ${data.narrative.abandonedDirections})`;

  // 10. narrative_arcs
  for (const arc of data.narrative.arcs) {
    await sql`INSERT INTO narrative_arcs (id, narrative_id, arc_id, title, summary, resolution, moment_ids)
      VALUES (${randomUUID()}, ${narrativeUuid}, ${arc.arcId}, ${arc.title}, ${arc.summary}, ${arc.resolution}, ${arc.momentIds})`;
  }
}

// ── Read Queries ────────────────────────────────────────────────────

export async function getSessionNarrative(sessionId: string): Promise<SessionNarrative | null> {
  const sql = getClient();
  const rows = await sql`SELECT * FROM narratives WHERE session_id = ${sessionId} LIMIT 1`;
  if (rows.length === 0) return null;
  const n = rows[0];
  return {
    sessionId,
    sessionShape: n.session_shape as SessionShape,
    summary: n.summary,
    progression: n.progression ?? [],
    discoveries: n.discoveries ?? [],
    stabilizedDirections: n.stabilized_directions ?? [],
    abandonedDirections: n.abandoned_directions ?? [],
    arcs: [],
  };
}

export async function getSessionMoments(sessionId: string): Promise<SessionMoment[]> {
  const sql = getClient();
  const momentRows = await sql`SELECT * FROM moments WHERE session_id = ${sessionId} ORDER BY id`;
  const evidenceRows = await sql`SELECT me.* FROM moment_evidence me JOIN moments m ON me.moment_id = m.id WHERE m.session_id = ${sessionId}`;

  const evidenceByMoment = new Map<string, typeof evidenceRows>();
  for (const e of evidenceRows) {
    if (!evidenceByMoment.has(e.moment_id)) evidenceByMoment.set(e.moment_id, []);
    evidenceByMoment.get(e.moment_id)!.push(e);
  }

  return momentRows.map((m: any) => ({
    id: m.id,
    chunkId: m.chunk_id ?? "",
    type: m.type,
    statement: m.statement,
    significance: m.significance ?? "",
    agency: m.agency ?? "ambiguous",
    confidence: m.confidence ?? "medium",
    topicFingerprint: m.topic_fingerprint ?? "general",
    relatedMomentIds: [],
    arcId: m.arc_id,
    arcRole: m.arc_role,
    evidence: (evidenceByMoment.get(m.id) ?? []).map((e: any) => ({
      quote: e.quote,
      sourceEventId: e.source_event_id ?? "",
      sourceType: e.source_type ?? "human_message",
      quoteType: e.quote_type ?? "verbatim",
    })),
  }));
}

export async function getSessionTransitions(sessionId: string): Promise<IntentTransition[]> {
  const sql = getClient();
  const rows = await sql`SELECT * FROM transitions WHERE session_id = ${sessionId}`;
  return rows.map((t: any) => ({
    id: t.id,
    sessionId,
    fromStatement: t.from_statement,
    toStatement: t.to_statement,
    reason: t.reason ?? "",
    originMomentIds: [],
    arcId: t.arc_id,
    confidence: t.confidence ?? "medium",
  }));
}

export async function getSessionOutcomes(sessionId: string): Promise<AcceptedOutcome[]> {
  const sql = getClient();
  const rows = await sql`SELECT * FROM outcomes WHERE session_id = ${sessionId}`;
  return rows.map((o: any) => ({
    id: o.id,
    sessionId,
    statement: o.statement,
    supportingMomentIds: [],
    supportingFiles: [],
    confidence: o.confidence ?? "medium",
  }));
}

export async function listSessions(): Promise<Array<{ id: string; shape: string; startedAt: Date | null; summary: string }>> {
  const sql = getClient();
  const rows = await sql`SELECT s.id, s.session_shape, s.started_at, n.summary
    FROM sessions s LEFT JOIN narratives n ON n.session_id = s.id
    ORDER BY s.created_at DESC LIMIT 20`;
  return rows.map((r: any) => ({
    id: r.id,
    shape: r.session_shape,
    startedAt: r.started_at,
    summary: r.summary ?? "(no narrative)",
  }));
}

export async function getMostRecentSession(): Promise<{ id: string; shape: string } | null> {
  const sql = getClient();
  const rows = await sql`SELECT id, session_shape FROM sessions ORDER BY created_at DESC LIMIT 1`;
  if (rows.length === 0) return null;
  return { id: rows[0].id, shape: rows[0].session_shape };
}

export async function getChunkEvents(sessionId: string, chunkId: string): Promise<NormalizedDevEvent[]> {
  const sql = getClient();
  const chunkRows = await sql`SELECT event_range_start, event_range_end FROM chunks WHERE id = ${chunkId}`;
  if (chunkRows.length === 0) return [];
  const { event_range_start, event_range_end } = chunkRows[0];
  const rows = await sql`SELECT * FROM normalized_events WHERE session_id = ${sessionId} AND causal_order >= ${event_range_start} AND causal_order <= ${event_range_end} ORDER BY causal_order`;
  return rows.map((e: any) => ({
    id: e.id,
    sessionId: e.session_id,
    timestamp: "",
    causalOrder: e.causal_order,
    category: e.category,
    actor: e.actor,
    content: { summary: e.summary, detail: e.detail, filesAffected: e.files_affected },
    rawEventId: e.raw_event_id ?? "",
    turnId: "",
  }));
}

// ── Activity Events ─────────────────────────────────────────────────

export async function emitEvent(event: ActivityEvent): Promise<string> {
  const sql = getClient();
  const id = event.id ?? randomUUID();
  await sql`
    INSERT INTO activity_events (
      id, timestamp, category, tags, actor, summary, metadata,
      source_type, source_id, session_id, repo, branch, worktree,
      topic_ids, files
    ) VALUES (
      ${id},
      ${event.timestamp.toISOString()},
      ${event.category},
      ${event.tags ?? []},
      ${event.actor},
      ${event.summary},
      ${JSON.stringify(event.metadata ?? {})},
      ${event.sourceType ?? null},
      ${event.sourceId ?? null},
      ${event.sessionId ?? null},
      ${event.repo ?? null},
      ${event.branch ?? null},
      ${event.worktree ?? null},
      ${event.topicIds ?? []},
      ${event.files ?? []}
    )
  `;
  return id;
}

export async function emitEvents(events: ActivityEvent[]): Promise<string[]> {
  const ids: string[] = [];
  for (const event of events) {
    ids.push(await emitEvent(event));
  }
  return ids;
}

export interface EventQuery {
  categoryPrefix?: string;
  tags?: string[];
  actor?: string;
  sessionId?: string;
  repo?: string;
  branch?: string;
  files?: string[];
  topicIds?: string[];
  since?: Date;
  until?: Date;
  limit?: number;
  offset?: number;
}

export async function queryEvents(query: EventQuery): Promise<ActivityEvent[]> {
  const sql = getClient();
  const conditions: string[] = ["TRUE"];

  if (query.categoryPrefix) conditions.push(`category LIKE '${query.categoryPrefix}%'`);
  if (query.actor) conditions.push(`actor = '${query.actor}'`);
  if (query.sessionId) conditions.push(`session_id = '${query.sessionId}'`);
  if (query.repo) conditions.push(`repo = '${query.repo}'`);
  if (query.branch) conditions.push(`branch = '${query.branch}'`);
  if (query.since) conditions.push(`timestamp >= '${query.since.toISOString()}'`);
  if (query.until) conditions.push(`timestamp <= '${query.until.toISOString()}'`);
  if (query.tags?.length) conditions.push(`tags && ARRAY[${query.tags.map(t => `'${t}'`).join(",")}]::text[]`);
  if (query.files?.length) conditions.push(`files && ARRAY[${query.files.map(f => `'${f}'`).join(",")}]::text[]`);
  if (query.topicIds?.length) conditions.push(`topic_ids && ARRAY[${query.topicIds.map(id => `'${id}'`).join(",")}]::uuid[]`);

  const limit = query.limit ?? 100;
  const offset = query.offset ?? 0;
  const where = conditions.join(" AND ");

  const rows = await sql.unsafe(
    `SELECT * FROM activity_events WHERE ${where} ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}`
  );

  return rows.map(rowToActivityEvent);
}

function rowToActivityEvent(row: Record<string, unknown>): ActivityEvent {
  return {
    id: row.id as string,
    timestamp: new Date(row.timestamp as string),
    category: row.category as string,
    tags: (row.tags as string[]) ?? [],
    actor: row.actor as string,
    summary: row.summary as string,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    sourceType: row.source_type as string | undefined,
    sourceId: row.source_id as string | undefined,
    sessionId: row.session_id as string | undefined,
    repo: row.repo as string | undefined,
    branch: row.branch as string | undefined,
    worktree: row.worktree as string | undefined,
    topicIds: (row.topic_ids as string[]) ?? [],
    files: (row.files as string[]) ?? [],
  };
}
