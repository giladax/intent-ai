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
  Sitting,
  EvidenceAnchor,
} from "../adapters/types.js";

// ── Pure helper: resolve evidence source UUIDs ──────────────────────
// For each EvidenceAnchor: if anchored=true AND its eventIndex is in the
// causalOrder→uuid map, return the uuid. Otherwise return null.

export function resolveEvidenceSourceIds(
  evidence: EvidenceAnchor[],
  idByCausalOrder: Map<number, string>,
): (string | null)[] {
  return evidence.map((e) => {
    if (!e.anchored) return null;
    if (e.eventIndex == null) return null;
    return idByCausalOrder.get(e.eventIndex) ?? null;
  });
}

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
  sittings?: Sitting[];
}): Promise<void> {
  const sql = getClient();

  // 1. session — ON CONFLICT (source_hash) DO NOTHING guards against concurrent
  //    digest runs of the same session file. The index is partial (source_hash IS NOT NULL)
  //    so NULL-hash rows are unaffected. Check .count to detect the conflict case.
  const sessionResult = await sql`INSERT INTO sessions (id, source_type, source_path, source_hash, session_shape, started_at, ended_at, created_at)
    VALUES (${data.sessionId}, ${data.sourceType}, ${data.sourcePath}, ${data.sourceHash ?? null}, ${data.sessionShape},
            ${data.startedAt?.toISOString() ?? null}, ${data.endedAt?.toISOString() ?? null}, NOW())
    ON CONFLICT (source_hash) WHERE source_hash IS NOT NULL DO NOTHING`;

  if (sessionResult.count === 0) {
    process.stderr.write(
      "⚠ concurrent digest detected — another digest of this session landed first; discarding this run's write\n",
    );
    return;
  }

  // 2. normalized_events — batched insert; build causalOrder→uuid map for evidence resolution
  const idByCausalOrder = new Map<number, string>();
  for (const batch of batchArray(data.normalizedEvents, 15)) {
    for (const e of batch) {
      const eventUuid = randomUUID();
      idByCausalOrder.set(e.causalOrder, eventUuid);
      await sql`INSERT INTO normalized_events (id, session_id, raw_event_id, causal_order, category, actor, summary, detail, files_affected)
        VALUES (${eventUuid}, ${data.sessionId}, ${null}, ${e.causalOrder}, ${e.category}, ${e.actor},
                ${e.content.summary}, ${e.content.detail}, ${e.content.filesAffected ?? null})`;
    }
  }

  // 2b. sittings (optional — empty until understanding-stage orchestrator passes them)
  for (const s of data.sittings ?? []) {
    await sql`INSERT INTO sittings (id, session_id, sitting_index, started_at, ended_at, event_range_start, event_range_end)
      VALUES (${randomUUID()}, ${data.sessionId}, ${s.sittingIndex}, ${s.startedAt}, ${s.endedAt},
              ${s.eventRange[0]}, ${s.eventRange[1]})`;
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
    const occurredAt = m.occurredAt ?? null;
    const verification = m.verification ?? null;
    await sql`INSERT INTO moments (id, session_id, chunk_id, type, statement, significance, agency, confidence, topic_fingerprint, arc_id, arc_role, occurred_at, verification)
      VALUES (${uuid}, ${data.sessionId}, ${chunkUuid}, ${m.type}, ${m.statement}, ${m.significance},
              ${m.agency}, ${m.confidence}, ${m.topicFingerprint}, ${m.arcId ?? null}, ${m.arcRole ?? null},
              ${occurredAt}, ${verification})`;

    // 5. moment_evidence — detect anchor-shaped vs legacy evidence
    for (let i = 0; i < m.evidence.length; i++) {
      const e = m.evidence[i];
      let sourceEventId: string | null = null;
      if ("anchored" in e) {
        // EvidenceAnchor shape — resolve via causalOrder map
        const anchor = e as unknown as EvidenceAnchor;
        const resolved = resolveEvidenceSourceIds([anchor], idByCausalOrder);
        sourceEventId = resolved[0];
      }
      // quoteType may not exist on EvidenceAnchor — cast safely
      const quoteType = ("quoteType" in e) ? (e as any).quoteType : null;
      await sql`INSERT INTO moment_evidence (id, moment_id, quote, source_event_id, source_type, quote_type)
        VALUES (${randomUUID()}, ${uuid}, ${e.quote}, ${sourceEventId}, ${e.sourceType}, ${quoteType})`;
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
    occurredAt: (m.occurred_at as string | null) ?? null,
    verification: (m.verification as "supported" | "contradicted" | "unverified" | null | undefined) ?? null,
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
    confidence: t.confidence ?? null,
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
    confidence: o.confidence ?? null,
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

/**
 * Return the stored session endedAt timestamp, or null if the session doesn't
 * exist or the column is NULL.
 */
export async function getSessionEndedAt(sessionId: string): Promise<Date | null> {
  const sql = getClient();
  const rows = await sql`SELECT ended_at FROM sessions WHERE id = ${sessionId} LIMIT 1`;
  if (rows.length === 0) return null;
  const raw = rows[0].ended_at;
  if (!raw) return null;
  return new Date(raw as string);
}

/**
 * Delete all stored data for a session so it can be re-digested cleanly.
 *
 * Deletion order matters due to FK constraints:
 *   1. activity_events (no FK to sessions)
 *   2. feature_sessions (FK to sessions without ON DELETE CASCADE)
 *   3. sessions (cascades the rest: normalized_events, chunks, moments, etc.)
 */
export async function deleteSessionDigest(sessionId: string): Promise<void> {
  const sql = getClient();
  await sql.begin(async (tx) => {
    await tx`DELETE FROM activity_events WHERE session_id = ${sessionId}`;
    await tx`DELETE FROM feature_sessions WHERE session_id = ${sessionId}`;
    await tx`DELETE FROM sessions WHERE id = ${sessionId}`;
  });
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

// ── Features (PRD v0.3 — the primary node) ──────────────────────────
//
// The Feature is the unit understanding converges on. These read/write
// helpers back the MCP `brain.enter` / `brain.featureContext` tools and
// the write-side observation loop. activity_events stay denormalized and
// self-contained — `feature_id` is a plain text column, NOT a foreign key.

export interface FeatureRecord {
  id: string;
  name: string;
  description: string;
  currentUnderstanding: string | null;
  constraints: string[];
  knownUnknowns: string[];
}

/** A row of the file↔Feature map. Either `glob` or `filePath` is set. */
export interface FeatureFileRow {
  featureId: string;
  glob: string | null;
  filePath: string | null;
}

export interface RelatedSession {
  id: string;
  shape: string | null;
  summary: string;
  role: string;
  startedAt: Date | null;
}

export interface FeatureObservation {
  id: string;
  category: string;
  summary: string;
  reviewStatus: string;
  timestamp: Date;
}

/** Assembled, served view of a Feature — the data behind featureContext(). */
export interface FeatureContextData {
  feature: FeatureRecord;
  relevantFiles: string[];
  relatedSessions: RelatedSession[];
  approvedObservations: FeatureObservation[];
  reportedUnknowns: FeatureObservation[];
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v));
    } catch {
      /* fall through */
    }
  }
  return [];
}

function rowToFeature(row: Record<string, unknown>): FeatureRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? "",
    currentUnderstanding: (row.current_understanding as string | null) ?? null,
    constraints: toStringArray(row.constraints),
    knownUnknowns: toStringArray(row.known_unknowns),
  };
}

/** Resolve the default project — first by created_at. Used when the MCP
 *  caller provides no explicit project context. Returns null if none. */
export async function getDefaultProjectId(): Promise<string | null> {
  const sql = getClient();
  const rows = await sql`SELECT id FROM projects ORDER BY created_at LIMIT 1`;
  return rows.length ? (rows[0].id as string) : null;
}

export async function listFeatures(projectId?: string): Promise<FeatureRecord[]> {
  const sql = getClient();
  const rows = projectId
    ? await sql`SELECT * FROM features WHERE project_id = ${projectId} ORDER BY name`
    : await sql`SELECT * FROM features ORDER BY name`;
  return rows.map(rowToFeature);
}

export async function getFeatureById(featureId: string): Promise<FeatureRecord | null> {
  const sql = getClient();
  const rows = await sql`SELECT * FROM features WHERE id = ${featureId} LIMIT 1`;
  return rows.length ? rowToFeature(rows[0]) : null;
}

/** All file↔Feature mappings, optionally scoped to one project. */
export async function getFeatureFileRows(projectId?: string): Promise<FeatureFileRow[]> {
  const sql = getClient();
  const rows = projectId
    ? await sql`SELECT ff.feature_id, ff.glob, ff.file_path FROM feature_files ff
        JOIN features f ON f.id = ff.feature_id WHERE f.project_id = ${projectId}`
    : await sql`SELECT feature_id, glob, file_path FROM feature_files`;
  return rows.map((r: any) => ({
    featureId: r.feature_id as string,
    glob: (r.glob as string | null) ?? null,
    filePath: (r.file_path as string | null) ?? null,
  }));
}

/** Insert a file↔Feature mapping. Pass a glob OR an exact file path. */
export async function addFeatureFile(
  featureId: string,
  pattern: { glob?: string; filePath?: string },
): Promise<string> {
  const sql = getClient();
  const id = randomUUID();
  await sql`INSERT INTO feature_files (id, feature_id, glob, file_path, created_at)
    VALUES (${id}, ${featureId}, ${pattern.glob ?? null}, ${pattern.filePath ?? null}, NOW())`;
  return id;
}

export async function getFeatureSessions(featureId: string): Promise<RelatedSession[]> {
  const sql = getClient();
  const rows = await sql`
    SELECT s.id, s.session_shape, s.started_at, fs.role, n.summary
    FROM feature_sessions fs
    JOIN sessions s ON s.id = fs.session_id
    LEFT JOIN narratives n ON n.session_id = s.id
    WHERE fs.feature_id = ${featureId}
    ORDER BY s.started_at DESC NULLS LAST`;
  return rows.map((r: any) => ({
    id: r.id as string,
    shape: (r.session_shape as string | null) ?? null,
    summary: (r.summary as string | null) ?? "(no narrative)",
    role: (r.role as string) ?? "evidence",
    startedAt: r.started_at ? new Date(r.started_at) : null,
  }));
}

/** Observations attached to a Feature, filtered by review status. */
export async function getFeatureObservations(
  featureId: string,
  reviewStatus?: string,
): Promise<FeatureObservation[]> {
  const sql = getClient();
  const rows = reviewStatus
    ? await sql`SELECT id, category, summary, review_status, timestamp
        FROM activity_events
        WHERE feature_id = ${featureId} AND review_status = ${reviewStatus}
          AND category LIKE 'observation:%'
        ORDER BY timestamp DESC`
    : await sql`SELECT id, category, summary, review_status, timestamp
        FROM activity_events
        WHERE feature_id = ${featureId} AND category LIKE 'observation:%'
        ORDER BY timestamp DESC`;
  return rows.map((r: any) => ({
    id: r.id as string,
    category: r.category as string,
    summary: r.summary as string,
    reviewStatus: (r.review_status as string) ?? "pending",
    timestamp: new Date(r.timestamp as string),
  }));
}

/** Pending observations across the repo (review-queue feed for the UI). */
export async function getPendingObservations(featureId?: string): Promise<FeatureObservation[]> {
  const sql = getClient();
  const rows = featureId
    ? await sql`SELECT id, category, summary, review_status, timestamp FROM activity_events
        WHERE category LIKE 'observation:%' AND review_status = 'pending' AND feature_id = ${featureId}
        ORDER BY timestamp DESC`
    : await sql`SELECT id, category, summary, review_status, timestamp FROM activity_events
        WHERE category LIKE 'observation:%' AND review_status = 'pending'
        ORDER BY timestamp DESC`;
  return rows.map((r: any) => ({
    id: r.id as string,
    category: r.category as string,
    summary: r.summary as string,
    reviewStatus: (r.review_status as string) ?? "pending",
    timestamp: new Date(r.timestamp as string),
  }));
}

/** Assemble the served view of a Feature. */
export async function loadFeatureContext(featureId: string): Promise<FeatureContextData | null> {
  const feature = await getFeatureById(featureId);
  if (!feature) return null;
  const sql = getClient();
  const fileRows = await sql`SELECT glob, file_path FROM feature_files WHERE feature_id = ${featureId}`;
  const relevantFiles = fileRows
    .map((r: any) => (r.glob as string | null) ?? (r.file_path as string | null))
    .filter((p: string | null): p is string => !!p);
  const [relatedSessions, approvedObservations, reportedUnknowns] = await Promise.all([
    getFeatureSessions(featureId),
    getFeatureObservations(featureId, "approved"),
    getFeatureObservations(featureId, "pending"),
  ]);
  return {
    feature,
    relevantFiles,
    relatedSessions,
    approvedObservations,
    reportedUnknowns: reportedUnknowns.filter((o) => o.category === "observation:unknown"),
  };
}

// ── Write-side observation loop ─────────────────────────────────────
//
// MCP write tools insert activity_events with category `observation:<kind>`,
// `feature_id` set, and `review_status` = 'pending'. No automatic promotion —
// a human approves, which sets 'approved' and promotes the text into the
// Feature's current_understanding. review_status is freeform TEXT: no
// enum, no CHECK.

export interface ObservationInput {
  kind: string;
  category?: string;
  summary: string;
  featureId?: string | null;
  actor?: string;
  tags?: string[];
  files?: string[];
  sessionId?: string | null;
  repo?: string | null;
  branch?: string | null;
  worktree?: string | null;
  metadata?: Record<string, unknown>;
}

export async function insertObservation(input: ObservationInput): Promise<string> {
  const sql = getClient();
  const id = randomUUID();
  const category = input.category ?? `observation:${input.kind}`;
  await sql`
    INSERT INTO activity_events (
      id, timestamp, category, tags, actor, summary, metadata,
      source_type, session_id, repo, branch, worktree, files,
      feature_id, review_status
    ) VALUES (
      ${id}, NOW(), ${category}, ${input.tags ?? []}, ${input.actor ?? "agent"},
      ${input.summary}, ${JSON.stringify(input.metadata ?? {})},
      ${"mcp"}, ${input.sessionId ?? null}, ${input.repo ?? null},
      ${input.branch ?? null}, ${input.worktree ?? null}, ${input.files ?? []},
      ${input.featureId ?? null}, ${"pending"}
    )`;
  return id;
}

export async function setObservationReviewStatus(eventId: string, status: string): Promise<void> {
  const sql = getClient();
  await sql`UPDATE activity_events SET review_status = ${status} WHERE id = ${eventId}`;
}

export async function updateObservationSummary(eventId: string, summary: string): Promise<void> {
  const sql = getClient();
  await sql`UPDATE activity_events SET summary = ${summary} WHERE id = ${eventId}`;
}

/** Approve an observation: mark approved and promote its text into the
 *  Feature's current_understanding (appended). */
export async function approveObservation(eventId: string): Promise<void> {
  const sql = getClient();
  const rows = await sql`SELECT summary, feature_id FROM activity_events WHERE id = ${eventId} LIMIT 1`;
  if (!rows.length) return;
  const summary = rows[0].summary as string;
  const featureId = rows[0].feature_id as string | null;
  await sql`UPDATE activity_events SET review_status = 'approved' WHERE id = ${eventId}`;
  if (featureId) {
    await sql`UPDATE features
      SET current_understanding =
        CASE
          WHEN current_understanding IS NULL OR current_understanding = ''
          THEN ${summary}
          ELSE current_understanding || E'\n- ' || ${summary}
        END
      WHERE id = ${featureId}`;
  }
}
