// Pure builders for GET /api/stats/overview — the altitude layer.
// One cheap read gives every page its C-level glance: session cadence
// (the fortnight strip), digestion provenance quality (anchored evidence,
// verification), and feature momentum. SQL stays thin in server.ts; all
// shaping/classification lives here so it is unit-testable.

// ── Row shapes (as the thin SQL returns them) ─────────────────────────

export interface CadenceDayRow {
  /** Local calendar day, YYYY-MM-DD. */
  day: string;
  events: number;
}

export interface SessionQualityRow {
  sessionId: string;
  moments: number;
  /** Evidence quotes attached to this session's moments. */
  quotes: number;
  /** Quotes whose source_event_id resolved — code-verified provenance. */
  anchored: number;
  /** Moments the understanding pass marked verification='supported'. */
  supported: number;
  /** Moments marked verification='contradicted'. */
  contradicted: number;
}

export interface FeatureMomentumRow {
  featureId: string;
  /** Activity events in the trailing window. */
  recentEvents: number;
  /** Activity events in the window before that (same length). */
  priorEvents: number;
  lastActivity: string | null;
}

// ── Output shapes ─────────────────────────────────────────────────────

export interface CadenceDay {
  day: string;
  events: number;
}

export interface CadenceSummary {
  totalEvents: number;
  activeDays: number;
  /** Consecutive active days ending at the newest day (today counts only if active; an inactive today doesn't break yesterday's streak). */
  streak: number;
}

export interface SessionQuality extends SessionQualityRow {
  /** 0–100, null when the session has no evidence quotes. */
  anchoredPct: number | null;
}

export type MomentumTrend = "rising" | "steady" | "cooling" | "quiet";

export interface FeatureMomentum extends FeatureMomentumRow {
  trend: MomentumTrend;
}

export interface StatsOverview {
  /** Dense, oldest → newest, exactly windowDays entries. */
  cadence: CadenceDay[];
  cadenceSummary: CadenceSummary;
  sessions: SessionQuality[];
  /** Aggregate over every session in scope — the record's fidelity. */
  record: {
    sessions: number;
    moments: number;
    quotes: number;
    anchored: number;
    anchoredPct: number | null;
    supported: number;
    contradicted: number;
  };
  features: FeatureMomentum[];
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Local calendar-day key, YYYY-MM-DD (matches the journal's dayKey). */
export function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Densify sparse per-day rows into exactly `windowDays` entries ending at
 * `now`'s local day, oldest first. Missing days get zero events.
 */
export function fillCadence(rows: CadenceDayRow[], windowDays: number, now: Date = new Date()): CadenceDay[] {
  const byDay = new Map(rows.map((r) => [r.day, r.events] as const));
  const out: CadenceDay[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = localDayKey(d);
    out.push({ day: key, events: byDay.get(key) ?? 0 });
  }
  return out;
}

/**
 * Summarize a dense cadence (oldest → newest). The streak counts consecutive
 * active days back from the end; an inactive final day (today so far) is
 * skipped once so a live streak isn't zeroed at breakfast.
 */
export function cadenceSummary(cadence: CadenceDay[]): CadenceSummary {
  const totalEvents = cadence.reduce((n, d) => n + d.events, 0);
  const activeDays = cadence.filter((d) => d.events > 0).length;
  let i = cadence.length - 1;
  if (i >= 0 && cadence[i].events === 0) i--; // forgive a quiet today
  let streak = 0;
  for (; i >= 0 && cadence[i].events > 0; i--) streak++;
  return { totalEvents, activeDays, streak };
}

/** Share of evidence quotes anchored to the transcript, 0–100; null when there are no quotes. */
export function anchoredPct(anchored: number, quotes: number): number | null {
  if (quotes <= 0) return null;
  return Math.round((anchored / quotes) * 100);
}

/**
 * Classify a feature's motion from two adjacent windows of activity.
 * quiet: nothing either window · rising: ≥25% up (or from zero) ·
 * cooling: ≥25% down · steady: everything else.
 */
export function classifyMomentum(recentEvents: number, priorEvents: number): MomentumTrend {
  if (recentEvents <= 0 && priorEvents <= 0) return "quiet";
  if (priorEvents <= 0) return "rising";
  if (recentEvents >= priorEvents * 1.25) return "rising";
  if (recentEvents <= priorEvents * 0.75) return "cooling";
  return "steady";
}

// ── The builder ───────────────────────────────────────────────────────

export function buildStatsOverview(input: {
  cadenceRows: CadenceDayRow[];
  sessionRows: SessionQualityRow[];
  featureRows: FeatureMomentumRow[];
  windowDays?: number;
  now?: Date;
}): StatsOverview {
  const windowDays = input.windowDays ?? 14;
  const now = input.now ?? new Date();

  const cadence = fillCadence(input.cadenceRows, windowDays, now);

  const sessions: SessionQuality[] = input.sessionRows.map((r) => ({
    ...r,
    anchoredPct: anchoredPct(r.anchored, r.quotes),
  }));

  const sum = (f: (r: SessionQualityRow) => number) => input.sessionRows.reduce((n, r) => n + f(r), 0);
  const quotes = sum((r) => r.quotes);
  const anchored = sum((r) => r.anchored);

  return {
    cadence,
    cadenceSummary: cadenceSummary(cadence),
    sessions,
    record: {
      sessions: input.sessionRows.length,
      moments: sum((r) => r.moments),
      quotes,
      anchored,
      anchoredPct: anchoredPct(anchored, quotes),
      supported: sum((r) => r.supported),
      contradicted: sum((r) => r.contradicted),
    },
    features: input.featureRows.map((r) => ({
      ...r,
      trend: classifyMomentum(r.recentEvents, r.priorEvents),
    })),
  };
}

/** The fail-safe shape — served instead of a 500 when the DB is unreachable. */
export function emptyStatsOverview(windowDays = 14, now: Date = new Date()): StatsOverview {
  const cadence = fillCadence([], windowDays, now);
  return {
    cadence,
    cadenceSummary: cadenceSummary(cadence),
    sessions: [],
    record: { sessions: 0, moments: 0, quotes: 0, anchored: 0, anchoredPct: null, supported: 0, contradicted: 0 },
    features: [],
  };
}
