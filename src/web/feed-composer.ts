// feed-composer.ts — deterministic heat scoring for the feed.
// LLM editorial generation lives in composeFeed() (added below).
// This module exports the pure math so it is unit-testable without DB.

export interface HeatEvent {
  timestamp: string;
  featureId: string;
}

export interface TrendingInput {
  featureId: string;
  featureName: string;
  events: HeatEvent[];
}

export interface TrendingItem extends TrendingInput {
  heatScore: number;
  heatLabel: "hot" | "still warm" | "cooling";
  eventCount: number;
}

/**
 * Compute a recency-weighted heat score for a list of events.
 * Score = sum of exp(-age_hours / HALF_LIFE) for each event.
 * HALF_LIFE = 12 hours: an event 12 hours old contributes half of a fresh event.
 */
export function computeHeatScore(events: HeatEvent[], now: Date): number {
  const HALF_LIFE_HOURS = 12;
  let score = 0;
  for (const ev of events) {
    const ageMs = now.getTime() - new Date(ev.timestamp).getTime();
    const ageHours = ageMs / 3_600_000;
    score += Math.exp((-ageHours * Math.LN2) / HALF_LIFE_HOURS);
  }
  return score;
}

export function heatLabel(score: number): "hot" | "still warm" | "cooling" {
  if (score >= 8) return "hot";
  if (score >= 2) return "still warm";
  return "cooling";
}

/**
 * Rank an array of TrendingInput items by heat score (descending).
 * Returns up to maxItems.
 */
export function rankTrending(items: TrendingInput[], now: Date, maxItems = 5): TrendingItem[] {
  return items
    .map((item) => {
      const score = computeHeatScore(item.events, now);
      return {
        ...item,
        heatScore: score,
        heatLabel: heatLabel(score),
        eventCount: item.events.length,
      };
    })
    .sort((a, b) => b.heatScore - a.heatScore)
    .slice(0, maxItems);
}

// ── Cache helpers (pure — no DB import; exportable for testing) ────────

export interface CacheEntry {
  eventCountAtCompose: number;
  composedAt: Date;
}

const CACHE_MAX_AGE_MS = 60 * 60 * 1000;    // 1 hour — normal TTL
const CACHE_MIN_AGE_MS = 5 * 60 * 1000;     // 5 min — never recompose faster than this
const CACHE_DEGRADED_TTL_MS = 5 * 60 * 1000; // 5 min — degraded (all-LLM-failed) composes expire quickly

export function isCacheStale(entry: CacheEntry, currentEventCount: number, degraded = false): boolean {
  const age = Date.now() - entry.composedAt.getTime();
  // Never recompose more than once per 5 minutes regardless of event count.
  if (age < CACHE_MIN_AGE_MS) return false;
  const maxAge = degraded ? CACHE_DEGRADED_TTL_MS : CACHE_MAX_AGE_MS;
  if (age > maxAge) return true;
  return currentEventCount > entry.eventCountAtCompose;
}

export function buildFeedCacheKey(): string {
  return "org";
}

// ── Feed output types ──────────────────────────────────────────────────

export interface FeedStory {
  featureId: string;
  featureName: string;
  heatScore: number;
  heatLabel: "hot" | "still warm" | "cooling";
  eventCount: number;
  headline: string;          // ≤12 words, carries the actual news
  dek: string;               // ≤3 sentences, voice-rule compliant
  openQuestion: string;      // the door left open
  citedSessionIds: string[]; // provenance chain
  actorInitials: string[];   // up to 3 contributors' initials
  deepHeadline?: string;     // ≤12 words, distinct news angle
  deep?: string;             // 2-paragraph deeper cut, distinct from dek
}

export interface FeedLede {
  headline?: string;             // ≤10 words, carries the actual news
  text: string;              // 1 paragraph, voice-rule compliant
  citedSessionIds: string[];
}

export interface FeedComposed {
  editionNumber: number;
  composedAt: string;        // ISO
  lede: FeedLede;
  trending: FeedStory[];
}

// ── Server-only: DB query + LLM composition ────────────────────────────
// These require a live DB + Anthropic API key. Not tested via unit tests.

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql as drizzleSql } from "drizzle-orm";
import { z } from "zod";

const BANNED_OUTPUT_WORDS = ["river", "sitting", "ink", "correspondence", "edition", "sittings", "unfolded"];

/**
 * Returns true if the text contains any voice-rule banned words (case-insensitive, whole-word).
 * Used to detect LLM outputs that violate the voice rule — fall back to deterministic dek.
 */
export function containsBannedWords(text: string): boolean {
  return BANNED_OUTPUT_WORDS.some((w) =>
    new RegExp(`\\b${w}\\b`, "i").test(text),
  );
}

const VOICE_SYSTEM_PROMPT = `You are Quire, an organizational understanding engine. You generate editorial copy for a development team's feed.

VOICE RULES — these are mandatory:
- State the value plainly. Say what happened and why it matters.
- Never be clever about the product itself.
- The test: would a straight-talking founder say this out loud to a colleague? If not, rewrite it.
- Tell the story, then leave a door open.
- Lead with the real event or finding; close with a concrete question or unresolved thread.
- Every claim traces to evidence.
- Headlines carry the actual news.
- Second person, specific. Terse.

BANNED WORDS (never use): river, sitting, ink, correspondence, edition, sittings, unfolded

Output ONLY valid JSON matching the schema requested. No markdown, no explanation.`;

const LedeSonnetSchema = z.object({
  headline: z.string().max(72).describe("≤10 words, carries the actual news"),
  body: z.string().max(800).describe("1-2 paragraph body of the lede"),
  citedSessionIds: z.array(z.string()).default([]),
});

const StorySonnetSchema = z.object({
  headline: z.string().max(80).describe("The actual news in ≤12 words"),
  dek: z.string().max(400).describe("2-3 sentences explaining what happened and why it matters"),
  openQuestion: z.string().max(160).describe("The unresolved thread or next question"),
  deepHeadline: z.string().max(90).optional().describe("A second-angle headline, ≤12 words, distinct from headline"),
  deep: z.string().max(600).optional().describe("2 paragraphs grounded in evidence, distinct from dek, new information"),
  citedSessionIds: z.array(z.string()).default([]),
});

export async function queryTrendingInputs(db: PostgresJsDatabase<Record<string, never>>, windowHours = 48): Promise<TrendingInput[]> {
  // Events attach to features two ways: a direct feature_id on the event,
  // or (the common path) via the session → feature_sessions mapping.
  const rows = await db.execute(drizzleSql`
    SELECT
      sub.fid as feature_id,
      COALESCE(f.name, sub.fid) as feature_name,
      json_agg(
        json_build_object('timestamp', sub.ts, 'featureId', sub.fid)
        ORDER BY sub.ts DESC
      ) as events
    FROM (
      SELECT ae.feature_id as fid, ae.timestamp as ts
      FROM activity_events ae
      WHERE ae.feature_id IS NOT NULL
        AND ae.timestamp >= NOW() - make_interval(hours => ${windowHours})
      UNION ALL
      SELECT fs.feature_id::text as fid, ae.timestamp as ts
      FROM activity_events ae
      JOIN feature_sessions fs ON fs.session_id = ae.session_id
      WHERE ae.feature_id IS NULL
        AND ae.timestamp >= NOW() - make_interval(hours => ${windowHours})
    ) sub
    LEFT JOIN features f ON f.id::text = sub.fid
    GROUP BY sub.fid, f.name
    ORDER BY COUNT(*) DESC
    LIMIT 10
  `);

  return (rows as unknown as Array<{feature_id: string; feature_name: string; events: HeatEvent[] | null}>)
    .filter(r => r.events && r.events.length > 0)
    .map(r => ({
      featureId: r.feature_id,
      featureName: r.feature_name || r.feature_id,
      events: r.events || [],
    }));
}

// ── Feature evidence — real event summaries fed to the composer ────────

export interface FeatureEvidence {
  summaries: string[];       // recent event summaries, newest first
  sessionIds: string[];      // distinct session ids (provenance)
  actorInitials: string[];   // derived contributor initials
}

/** Map raw actor strings to display initials. AI actors get the agent mark. */
export function actorsToInitials(actors: string[]): string[] {
  const out = new Set<string>();
  for (const a of actors) {
    const norm = a.toLowerCase();
    if (norm === "developer" || norm === "collaborative") out.add("GK");
    if (norm === "ai" || norm === "collaborative" || norm.startsWith("agent")) out.add("AI");
  }
  return [...out];
}

export async function queryFeatureEvidence(
  db: PostgresJsDatabase<Record<string, never>>,
  featureId: string,
  windowHours = 48,
  limit = 12,
): Promise<FeatureEvidence> {
  const rows = await db.execute(drizzleSql`
    SELECT DISTINCT ON (ae.id) ae.summary, ae.actor, ae.session_id::text as session_id, ae.category
    FROM activity_events ae
    LEFT JOIN feature_sessions fs ON fs.session_id = ae.session_id
    WHERE (ae.feature_id = ${featureId} OR fs.feature_id::text = ${featureId})
      AND ae.timestamp >= NOW() - make_interval(hours => ${windowHours})
    ORDER BY ae.id, ae.timestamp DESC
    LIMIT ${limit}
  `);
  const list = rows as unknown as Array<{ summary: string; actor: string; session_id: string | null; category: string }>;
  const sessionIds = [...new Set(list.map((r) => r.session_id).filter((s): s is string => !!s))];
  return {
    summaries: list.map((r) => `[${r.category}] ${r.summary}`),
    sessionIds,
    actorInitials: actorsToInitials(list.map((r) => r.actor)),
  };
}

export async function composeFeedEditorial(
  trendingItems: TrendingItem[],
  orgName: string,
  evidenceByFeature?: Map<string, FeatureEvidence>,
  editionNumber?: number,
): Promise<FeedComposed> {
  const { callSonnet } = await import("../llm/client.js");

  const topItems = trendingItems.slice(0, 3);
  const topSummary = topItems.map(item => {
    const ev = evidenceByFeature?.get(item.featureId);
    const sample = ev?.summaries.slice(0, 4).map((s) => `    · ${s.slice(0, 180)}`).join("\n") ?? "";
    return `- ${item.featureName}: ${item.eventCount} events, heat=${item.heatScore.toFixed(1)}${sample ? `\n${sample}` : ""}`;
  }).join("\n");

  // Call 1: org lede
  // Deterministic fallback for headline: first sentence of top event summary, ≤10 words
  const topEv = evidenceByFeature?.get(topItems[0]?.featureId ?? "");
  const fallbackLedeHeadline = topEv?.summaries[0]
    ?.replace(/^\[[^\]]*\]\s*/, "")
    .split(/[.!?]/)[0]
    ?.trim()
    .split(" ").slice(0, 10).join(" ") ?? `${trendingItems.length} active features.`;
  let lede: FeedLede = {
    headline: fallbackLedeHeadline,
    text: `${orgName} has active work across ${trendingItems.length} features.`,
    citedSessionIds: [],
  };
  try {
    const ledeResult = await callSonnet(
      VOICE_SYSTEM_PROMPT,
      `Generate a 1-paragraph editorial overview for a development team feed.

Organization: ${orgName}
Active features (by heat, with recent recorded events as evidence):
${topSummary}
Total active features: ${trendingItems.length}

Generate a concise lede headline (≤10 words, carries the actual news) and body paragraph. Lead with the most significant real event from the evidence above. Every claim must trace to the evidence — never invent.
Return JSON: { "headline": "...", "body": "...", "citedSessionIds": [] }`,
      LedeSonnetSchema,
    );
    // Lede prompt never supplies session ids — any model-returned ids are fabricated.
    // Always use [] so the byline only claims provenance it can actually deliver.
    lede = { headline: ledeResult.headline, text: ledeResult.body, citedSessionIds: [] };
  } catch (_e) {
    // fail-safe: use default
  }

  // Calls 2-3: top 2 stories (bottom 3 get deterministic dek)
  const stories: FeedStory[] = await Promise.all(
    trendingItems.slice(0, 5).map(async (item, idx) => {
      const ev = evidenceByFeature?.get(item.featureId);
      // Build headline from top event summary, never the feature name (already in kick line).
      const fallbackHeadline = ev?.summaries[0]
        ?.replace(/^\[[^\]]*\]\s*/, "")  // strip category prefix
        .split(/[.!?]/)[0]               // first sentence
        ?.trim()
        .split(" ").slice(0, 12).join(" ") + "."
        || item.featureName;
      let headline = fallbackHeadline;
      const summaryRaw = ev?.summaries[0]?.replace(/^\[[^\]]*\]\s*/, "").slice(0, 200).trimEnd() ?? "";
      const summaryPart = summaryRaw
        ? (summaryRaw.match(/[.!?]$/) ? summaryRaw : summaryRaw + ".")
        : "";
      let dek = summaryPart
        ? `${summaryPart} ${item.eventCount} events in the last 48 hours.`
        : `${item.eventCount} events in the last 48 hours.`;
      let openQuestion = "What comes next?";
      let citedSessionIds: string[] = ev?.sessionIds.slice(0, 3) ?? [];
      let deepHeadline: string | undefined;
      let deep: string | undefined;

      // Deterministic deep: assemble from remaining event summaries (those after the first)
      const remainingSummaries = ev?.summaries.slice(1, 5).map((s) => s.replace(/^\[[^\]]*\]\s*/, "")) ?? [];
      const deepFallback = remainingSummaries.length > 0
        ? remainingSummaries.slice(0, 2).join(" ") + (remainingSummaries.length > 2 ? "\n\n" + remainingSummaries.slice(2).join(" ") : "")
        : undefined;
      const deepHeadlineFallback = ev?.summaries[1]
        ?.replace(/^\[[^\]]*\]\s*/, "")
        .split(/[.!?]/)[0]?.trim().split(" ").slice(0, 12).join(" ");

      if (idx < 2) {
        try {
          const evidenceBlock = ev?.summaries.slice(0, 10).map((s) => `- ${s.slice(0, 220)}`).join("\n") ?? "(no recorded summaries)";
          const storyResult = await callSonnet(
            VOICE_SYSTEM_PROMPT,
            `Generate editorial copy for a trending feature story.

Feature: ${item.featureName}
Heat: ${item.heatLabel} (score: ${item.heatScore.toFixed(1)})
Event count (48h): ${item.eventCount}
Recent recorded events (newest first — this is your only evidence):
${evidenceBlock}

The headline carries the actual news from the evidence. The dek explains what happened and why it matters in 2-3 sentences. The openQuestion is the concrete unresolved thread. The deepHeadline is a second-angle headline (≤12 words, distinct from headline). The deep is 2 paragraphs with new information grounded in the evidence.
Return JSON: { "headline": "...", "dek": "...", "openQuestion": "...", "deepHeadline": "...", "deep": "...", "citedSessionIds": [] }`,
            StorySonnetSchema,
          );
          // Voice-rule guard: if Sonnet output contains banned words, fall back to deterministic dek.
          if (!containsBannedWords(storyResult.headline) && !containsBannedWords(storyResult.dek)) {
            headline = storyResult.headline;
            dek = storyResult.dek;
            openQuestion = storyResult.openQuestion;
            deepHeadline = storyResult.deepHeadline;
            deep = storyResult.deep;
          }
          // Only trust ids from our DB evidence — any extra model ids are fabricated.
          if (storyResult.citedSessionIds.length > 0 && ev?.sessionIds?.length) {
            const knownSet = new Set(ev.sessionIds);
            const validated = storyResult.citedSessionIds.filter((id) => knownSet.has(id));
            if (validated.length > 0) citedSessionIds = validated;
          }
        } catch (_e) {
          // fail-safe: use defaults
          deepHeadline = deepHeadlineFallback;
          deep = deepFallback;
        }
      } else {
        deepHeadline = deepHeadlineFallback;
        deep = deepFallback;
      }

      return {
        featureId: item.featureId,
        featureName: item.featureName,
        heatScore: item.heatScore,
        heatLabel: item.heatLabel,
        eventCount: item.eventCount,
        headline,
        dek,
        openQuestion,
        citedSessionIds,
        actorInitials: ev?.actorInitials ?? [],
        deepHeadline,
        deep,
      };
    })
  );

  return {
    // Default: days since the epoch of the product (fallback when no count given)
    editionNumber: editionNumber ?? 1,
    composedAt: new Date().toISOString(),
    lede,
    trending: stories,
  };
}

export async function getCachedFeed(db: PostgresJsDatabase<Record<string, never>>): Promise<{ feed: FeedComposed | null; eventCount: number }> {
  const { feedCache } = await import("../storage/schema.js");
  const { eq } = await import("drizzle-orm");

  const currentCountResult = await db.execute(drizzleSql`SELECT COUNT(*)::integer as cnt FROM activity_events`);
  const eventCount = Number((currentCountResult as unknown as Array<{cnt: number}>)[0]?.cnt ?? 0);

  const rows = await db.select().from(feedCache).where(eq(feedCache.id, "org")).limit(1);
  if (rows.length === 0) return { feed: null, eventCount };

  const row = rows[0];
  const entry: CacheEntry = { eventCountAtCompose: row.eventCountAtCompose, composedAt: new Date(row.composedAt) };
  // Detect degraded compose: lede has no cited sessions AND no story has citations → all LLM calls failed.
  const cachedFeed = row.payload as FeedComposed;
  const degraded =
    cachedFeed.lede.citedSessionIds.length === 0 &&
    cachedFeed.trending.every((s) => s.citedSessionIds.length === 0 && s.eventCount === 0);
  if (isCacheStale(entry, eventCount, degraded)) return { feed: null, eventCount };

  return { feed: cachedFeed, eventCount };
}

export async function setCachedFeed(db: PostgresJsDatabase<Record<string, never>>, feed: FeedComposed, eventCount: number): Promise<void> {
  const { feedCache } = await import("../storage/schema.js");

  await db.insert(feedCache).values({
    id: "org",
    payload: feed as unknown as Record<string, unknown>,
    composedAt: new Date(),
    eventCountAtCompose: eventCount,
  }).onConflictDoUpdate({
    target: feedCache.id,
    set: {
      payload: feed as unknown as Record<string, unknown>,
      composedAt: new Date(),
      eventCountAtCompose: eventCount,
    },
  });
}

// Module-level in-flight lock: concurrent compose requests share one promise.
let _composeInFlight: Promise<FeedComposed> | null = null;

export async function getFeedOrCompose(db: PostgresJsDatabase<Record<string, never>>, forceRefresh = false): Promise<FeedComposed> {
  const { feed, eventCount } = await getCachedFeed(db);
  if (feed && !forceRefresh) return feed;

  // In-flight dedup: if a compose is already running, await it instead of
  // launching a second one. This handles concurrent stale-cache hits.
  if (_composeInFlight) return _composeInFlight;

  _composeInFlight = _doCompose(db, eventCount).finally(() => {
    _composeInFlight = null;
  });
  return _composeInFlight;
}

async function _doCompose(db: PostgresJsDatabase<Record<string, never>>, eventCount: number): Promise<FeedComposed> {
  // Compose: rank trending, gather real evidence for the top items, then
  // write the editorial copy (≤3 Sonnet calls: 1 lede + top 2 stories).
  const inputs = await queryTrendingInputs(db);
  const now = new Date();
  const ranked = rankTrending(inputs, now);

  const evidenceByFeature = new Map<string, FeatureEvidence>();
  await Promise.all(
    ranked.map(async (item) => {
      try {
        evidenceByFeature.set(item.featureId, await queryFeatureEvidence(db, item.featureId));
      } catch {
        /* evidence is optional — composition degrades gracefully */
      }
    }),
  );

  // Edition number = how many sessions have been digested (the mockup's "UPDATE 9").
  let editionNumber = 1;
  try {
    const sessRows = await db.execute(drizzleSql`SELECT COUNT(*)::integer as cnt FROM sessions`);
    editionNumber = Math.max(1, Number((sessRows as unknown as Array<{ cnt: number }>)[0]?.cnt ?? 1));
  } catch {
    /* fall back to 1 */
  }

  const deduped = dedupTrending(ranked, evidenceByFeature);
  const composed = await composeFeedEditorial(deduped, "Quire", evidenceByFeature, editionNumber);
  await setCachedFeed(db, composed, eventCount);
  return composed;
}

/**
 * Suppress stories whose session evidence overlaps heavily with a higher-ranked story.
 * "Heavily" = more than 50% of the candidate's session ids are already accounted for.
 * Items with no evidence are always kept (can't assess overlap).
 */
export function dedupTrending(
  items: TrendingItem[],
  evidenceByFeature: Map<string, FeatureEvidence>,
  maxItems = 5,
): TrendingItem[] {
  const seen = new Set<string>();
  const result: TrendingItem[] = [];
  for (const item of items) {
    const ev = evidenceByFeature.get(item.featureId);
    const sids = ev?.sessionIds ?? [];
    if (sids.length === 0) {
      result.push(item);
    } else {
      const overlap = sids.filter((s) => seen.has(s)).length;
      if (overlap / sids.length <= 0.5) {
        sids.forEach((s) => seen.add(s));
        result.push(item);
      }
    }
    if (result.length >= maxItems) break;
  }
  return result;
}

/**
 * Filter model-returned citation ids against the DB-derived known set.
 * Any id not in knownSessionIds is dropped as a fabricated reference.
 */
export function filterCitations(modelIds: string[], knownSessionIds: string[]): string[] {
  if (knownSessionIds.length === 0) return [];
  const known = new Set(knownSessionIds);
  return modelIds.filter((id) => known.has(id));
}

export function buildSkeletonFeed(): FeedComposed {
  return {
    editionNumber: 0,
    composedAt: new Date().toISOString(),
    lede: {
      text: "Nothing is digested yet — start a session to see the feed come to life.",
      citedSessionIds: [],
    },
    trending: [],
  };
}
