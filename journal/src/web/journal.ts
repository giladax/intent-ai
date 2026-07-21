// Journal phase-1 — pure, DB-free grouper + Pulse computation (design §4.2, §8.3).
//
// The `activity_events` table is the substrate; the display unit is an *episode*
// (a session, a run, a review batch, or a singleton). Episodes are computed at
// READ TIME — there is no `episode_id` column. All logic here is a pure function
// over plain rows so it is unit-testable without Postgres.
//
// Category mapping is read-side only: categories stay freeform TEXT (backbone
// rule / CLAUDE.md anti-pattern). Legacy unnamespaced events are identified by
// `source_type` (moment | transition | outcome | narrative), per §7.1.

// ── Input rows (plain, DB-shaped but decoupled from the ORM) ─────────

export interface JournalEventRow {
  id: string;
  timestamp: string; // ISO
  category: string;
  tags?: string[];
  actor: string;
  summary: string;
  metadata?: Record<string, unknown> | null;
  sourceType?: string | null;
  sessionId?: string | null;
  featureId?: string | null;
  reviewStatus?: string | null;
}

export interface JournalSessionRow {
  id: string;
  startedAt: string | null; // ISO — the sessions table, NOT event timestamps
  endedAt: string | null; // ISO
  sessionShape?: string | null;
  narrativeSummary?: string | null;
}

// ── Output (the pinned API contract) ─────────────────────────────────

export type EpisodeKind = "session" | "run" | "review-batch" | "observation" | "event";

export interface JournalBeat {
  id: string;
  timestamp: string;
  category: string;
  summary: string;
  actor: string;
  metadata: Record<string, unknown>;
}

export interface JournalPending {
  id: string;
  summary: string;
  featureId: string | null;
  category: string;
}

export interface EpisodeCounts {
  beats: number;
  consults: number;
  consultMisses: number;
  observations: number;
  moments: number;
}

export interface JournalEpisode {
  id: string;
  kind: EpisodeKind;
  title: string;
  actor: string;
  startedAt: string;
  endedAt: string | null;
  featureIds: string[];
  counts: EpisodeCounts;
  pending: JournalPending[];
  beats: JournalBeat[];
}

export interface JournalPulse {
  since: string | null;
  sessionsDigested: number;
  consults: number;
  consultMisses: number;
  observationsNoticed: number;
  pendingReview: number;
  reviewActions: number;
  learnings: number;
}

export interface JournalResult {
  pulse: JournalPulse;
  episodes: JournalEpisode[];
}

// ── Category / classification helpers (read-side mapper) ─────────────

const TEN_MINUTES_MS = 10 * 60 * 1000;

function hasPrefix(category: string | null | undefined, prefix: string): boolean {
  return typeof category === "string" && category.startsWith(prefix);
}

export function isMcpCategory(category: string | null | undefined): boolean {
  return hasPrefix(category, "mcp:");
}

export function isObservationCategory(category: string | null | undefined): boolean {
  return hasPrefix(category, "observation:");
}

export function isReviewCategory(category: string | null | undefined): boolean {
  return hasPrefix(category, "review:");
}

/** A consult miss: an mcp:* beat whose metadata records a "miss" outcome. */
export function isConsultMiss(row: JournalEventRow): boolean {
  return isMcpCategory(row.category) && (row.metadata?.outcome as unknown) === "miss";
}

/** Legacy moment beat — unnamespaced category, identified by source_type. */
function isMomentBeat(row: JournalEventRow): boolean {
  return row.sourceType === "moment";
}

function runIdOf(row: JournalEventRow): string | null {
  const rid = row.metadata?.runId;
  return typeof rid === "string" && rid ? rid : null;
}

// ── Small utilities ──────────────────────────────────────────────────

function ms(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Optional numeric causal-order hint carried in metadata (see §7.1 workaround). */
function causalKey(row: JournalEventRow): number {
  const m = row.metadata ?? {};
  for (const k of ["causalOrder", "causal_order", "order", "seq"]) {
    const v = (m as Record<string, unknown>)[k];
    if (typeof v === "number") return v;
  }
  return Number.POSITIVE_INFINITY;
}

/** Beats read oldest-first: by timestamp, then causal-order hint, then input order. */
function sortBeatsAscending(rows: JournalEventRow[]): JournalEventRow[] {
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const ta = ms(a.row.timestamp);
      const tb = ms(b.row.timestamp);
      if (ta !== tb) return ta - tb;
      const ca = causalKey(a.row);
      const cb = causalKey(b.row);
      if (ca !== cb) return ca - cb;
      return a.i - b.i;
    })
    .map((x) => x.row);
}

function toBeat(row: JournalEventRow): JournalBeat {
  return {
    id: row.id,
    timestamp: row.timestamp,
    category: row.category,
    summary: row.summary,
    actor: row.actor,
    metadata: row.metadata ?? {},
  };
}

function countBeats(rows: JournalEventRow[]): EpisodeCounts {
  return {
    beats: rows.length,
    consults: rows.filter((r) => isMcpCategory(r.category)).length,
    consultMisses: rows.filter(isConsultMiss).length,
    observations: rows.filter((r) => isObservationCategory(r.category)).length,
    moments: rows.filter(isMomentBeat).length,
  };
}

function collectFeatureIds(rows: JournalEventRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const fid = r.featureId;
    if (fid && !seen.has(fid)) {
      seen.add(fid);
      out.push(fid);
    }
  }
  return out;
}

/** Pending observations awaiting review, in beat order. */
function collectPending(rows: JournalEventRow[]): JournalPending[] {
  return rows
    .filter((r) => isObservationCategory(r.category) && r.reviewStatus === "pending")
    .map((r) => ({
      id: r.id,
      summary: r.summary,
      featureId: r.featureId ?? null,
      category: r.category,
    }));
}

/** Episode actor: prefer an `agent:*`, else the most frequent actor. */
function pickActor(rows: JournalEventRow[]): string {
  const agent = rows.find((r) => hasPrefix(r.actor, "agent:"));
  if (agent) return agent.actor;
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.actor, (counts.get(r.actor) ?? 0) + 1);
  let best = rows[0]?.actor ?? "system:pipeline";
  let bestN = -1;
  for (const [actor, n] of counts) {
    if (n > bestN) {
      best = actor;
      bestN = n;
    }
  }
  return best;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ── Episode builders ─────────────────────────────────────────────────

function buildSessionEpisode(
  sessionId: string,
  rows: JournalEventRow[],
  session: JournalSessionRow | undefined,
): JournalEpisode {
  const ordered = sortBeatsAscending(rows);
  const counts = countBeats(ordered);

  const firstTs = ordered[0]?.timestamp ?? null;
  const lastTs = ordered[ordered.length - 1]?.timestamp ?? null;
  // Session timing comes from the sessions table — emit-events stamps digest
  // time on every beat (known bug), so beat timestamps collapse. Fall back to
  // beat timestamps only when the session row lacks timing.
  const startedAt = session?.startedAt ?? firstTs ?? new Date(0).toISOString();
  const endedAt = session?.endedAt ?? lastTs ?? null;

  const narrative = (session?.narrativeSummary ?? "").trim();
  const title = narrative
    ? narrative
    : `Session ${shortId(sessionId)} — ${counts.moments} moments, ${counts.consults} consults`;

  return {
    id: `session:${sessionId}`,
    kind: "session",
    title,
    actor: pickActor(ordered),
    startedAt,
    endedAt,
    featureIds: collectFeatureIds(ordered),
    counts,
    pending: collectPending(ordered),
    beats: ordered.map(toBeat),
  };
}

function buildRunEpisode(runId: string, rows: JournalEventRow[]): JournalEpisode {
  const ordered = sortBeatsAscending(rows);
  const counts = countBeats(ordered);
  const startedAt = ordered[0]?.timestamp ?? new Date(0).toISOString();
  const endedAt = ordered[ordered.length - 1]?.timestamp ?? null;

  return {
    id: `run:${runId}`,
    kind: "run",
    title: `Run ${shortId(runId)} — ${counts.beats} beats`,
    actor: pickActor(ordered),
    startedAt,
    endedAt,
    featureIds: collectFeatureIds(ordered),
    counts,
    pending: collectPending(ordered),
    beats: ordered.map(toBeat),
  };
}

function reviewActionLabel(rows: JournalEventRow[]): string {
  const n = rows.length;
  const plural = n === 1 ? "" : "s";
  const actions = new Set(rows.map((r) => r.category.slice("review:".length)));
  if (actions.size === 1) {
    const action = [...actions][0]; // approved | rejected | edited | …
    return `${capitalize(action)} ${n} observation${plural}`;
  }
  return `Reviewed ${n} observation${plural}`;
}

function buildReviewBatchEpisode(rows: JournalEventRow[]): JournalEpisode {
  const ordered = sortBeatsAscending(rows);
  const first = ordered[0];
  const startedAt = first?.timestamp ?? new Date(0).toISOString();
  const endedAt = ordered[ordered.length - 1]?.timestamp ?? null;

  return {
    id: `review:${first.id}`,
    kind: "review-batch",
    title: reviewActionLabel(ordered),
    actor: first.actor,
    startedAt,
    endedAt,
    featureIds: collectFeatureIds(ordered),
    counts: countBeats(ordered),
    pending: collectPending(ordered),
    beats: ordered.map(toBeat),
  };
}

function buildSingletonEpisode(row: JournalEventRow): JournalEpisode {
  const kind: EpisodeKind = isObservationCategory(row.category) ? "observation" : "event";
  return {
    id: `event:${row.id}`,
    kind,
    title: row.summary,
    actor: row.actor,
    startedAt: row.timestamp,
    endedAt: null,
    featureIds: collectFeatureIds([row]),
    counts: countBeats([row]),
    pending: collectPending([row]),
    beats: [toBeat(row)],
  };
}

/** Cluster review beats (no session/run) by actor, splitting on >10 min gaps. */
function buildReviewBatches(rows: JournalEventRow[]): JournalEpisode[] {
  const byActor = new Map<string, JournalEventRow[]>();
  for (const r of rows) {
    const list = byActor.get(r.actor) ?? [];
    list.push(r);
    byActor.set(r.actor, list);
  }

  const episodes: JournalEpisode[] = [];
  for (const list of byActor.values()) {
    const sorted = [...list].sort((a, b) => ms(a.timestamp) - ms(b.timestamp));
    let batch: JournalEventRow[] = [];
    const flush = () => {
      if (batch.length) episodes.push(buildReviewBatchEpisode(batch));
      batch = [];
    };
    for (const e of sorted) {
      const prev = batch[batch.length - 1];
      if (prev && ms(e.timestamp) - ms(prev.timestamp) > TEN_MINUTES_MS) flush();
      batch.push(e);
    }
    flush();
  }
  return episodes;
}

// ── Grouper (precedence order, §4.2) ─────────────────────────────────

export function groupEpisodes(
  events: JournalEventRow[],
  sessions: JournalSessionRow[] = [],
): JournalEpisode[] {
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  const sessionGroups = new Map<string, JournalEventRow[]>();
  const runGroups = new Map<string, JournalEventRow[]>();
  const reviewPool: JournalEventRow[] = [];
  const singletons: JournalEventRow[] = [];

  for (const e of events) {
    // 1. session_id present → session episode (legacy events fold in too).
    if (e.sessionId) {
      const list = sessionGroups.get(e.sessionId) ?? [];
      list.push(e);
      sessionGroups.set(e.sessionId, list);
      continue;
    }
    // 2. metadata.runId present (and no session_id) → run episode.
    const runId = runIdOf(e);
    if (runId) {
      const list = runGroups.get(runId) ?? [];
      list.push(e);
      runGroups.set(runId, list);
      continue;
    }
    // 3. review:* by same actor within 10 min → review-batch.
    if (isReviewCategory(e.category)) {
      reviewPool.push(e);
      continue;
    }
    // 4. everything else → singleton (observation | event).
    singletons.push(e);
  }

  const episodes: JournalEpisode[] = [];
  for (const [sessionId, rows] of sessionGroups) {
    episodes.push(buildSessionEpisode(sessionId, rows, sessionById.get(sessionId)));
  }
  for (const [runId, rows] of runGroups) {
    episodes.push(buildRunEpisode(runId, rows));
  }
  episodes.push(...buildReviewBatches(reviewPool));
  for (const row of singletons) {
    episodes.push(buildSingletonEpisode(row));
  }

  // Episodes are newest-first (a journal you catch up on).
  episodes.sort((a, b) => ms(b.startedAt) - ms(a.startedAt));
  return episodes;
}

// ── Pulse ────────────────────────────────────────────────────────────

export interface PulseOptions {
  since: string | null;
  /** ALL-time count of pending observations (from a thin SQL COUNT). */
  pendingReview: number;
}

export function buildPulse(events: JournalEventRow[], opts: PulseOptions): JournalPulse {
  const sessionIds = new Set<string>();
  let consults = 0;
  let consultMisses = 0;
  let observationsNoticed = 0;
  let reviewActions = 0;
  let learnings = 0;

  for (const e of events) {
    if (e.sessionId) sessionIds.add(e.sessionId);
    if (isMcpCategory(e.category)) {
      consults++;
      if (isConsultMiss(e)) consultMisses++;
    }
    if (isObservationCategory(e.category)) observationsNoticed++;
    if (isReviewCategory(e.category)) {
      reviewActions++;
      if (e.category === "review:approved") learnings++;
    }
  }

  return {
    since: opts.since ?? null,
    sessionsDigested: sessionIds.size,
    consults,
    consultMisses,
    observationsNoticed,
    pendingReview: opts.pendingReview,
    reviewActions,
    learnings,
  };
}

// ── Top-level assembly ───────────────────────────────────────────────

export function buildJournal(input: {
  events: JournalEventRow[];
  sessions?: JournalSessionRow[];
  since: string | null;
  pendingReview: number;
}): JournalResult {
  return {
    pulse: buildPulse(input.events, { since: input.since, pendingReview: input.pendingReview }),
    episodes: groupEpisodes(input.events, input.sessions ?? []),
  };
}
