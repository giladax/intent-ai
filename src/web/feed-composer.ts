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

const CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

export function isCacheStale(entry: CacheEntry, currentEventCount: number): boolean {
  if (currentEventCount > entry.eventCountAtCompose) return true;
  const age = Date.now() - entry.composedAt.getTime();
  return age > CACHE_MAX_AGE_MS;
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
}

export interface FeedLede {
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
  text: z.string().max(800).describe("1 paragraph summary of org activity"),
  citedSessionIds: z.array(z.string()).default([]),
});

const StorySonnetSchema = z.object({
  headline: z.string().max(80).describe("The actual news in ≤12 words"),
  dek: z.string().max(400).describe("2-3 sentences explaining what happened and why it matters"),
  openQuestion: z.string().max(160).describe("The unresolved thread or next question"),
  citedSessionIds: z.array(z.string()).default([]),
});

export async function queryTrendingInputs(db: PostgresJsDatabase<Record<string, never>>, windowHours = 48): Promise<TrendingInput[]> {
  const rows = await db.execute(drizzleSql`
    SELECT
      ae.feature_id,
      COALESCE(f.name, ae.feature_id) as feature_name,
      json_agg(
        json_build_object('timestamp', ae.timestamp, 'featureId', ae.feature_id)
        ORDER BY ae.timestamp DESC
      ) FILTER (WHERE ae.timestamp >= NOW() - (${windowHours} || ' hours')::interval) as events
    FROM activity_events ae
    LEFT JOIN features f ON f.id = ae.feature_id
    WHERE ae.feature_id IS NOT NULL
    GROUP BY ae.feature_id, f.name
    HAVING COUNT(*) > 0
    LIMIT 10
  `);

  return (rows as Array<{feature_id: string; feature_name: string; events: HeatEvent[] | null}>)
    .filter(r => r.events && r.events.length > 0)
    .map(r => ({
      featureId: r.feature_id,
      featureName: r.feature_name || r.feature_id,
      events: r.events || [],
    }));
}

export async function composeFeedEditorial(trendingItems: TrendingItem[], orgName: string): Promise<FeedComposed> {
  const { callSonnet } = await import("../llm/client.js");

  const topItems = trendingItems.slice(0, 3);
  const topSummary = topItems.map(item =>
    `- ${item.featureName}: ${item.eventCount} events, heat=${item.heatScore.toFixed(1)}`
  ).join("\n");

  // Call 1: org lede
  let lede: FeedLede = { text: `${orgName} has active work across ${trendingItems.length} features.`, citedSessionIds: [] };
  try {
    const ledeResult = await callSonnet(
      VOICE_SYSTEM_PROMPT,
      `Generate a 1-paragraph editorial overview for a development team feed.

Organization: ${orgName}
Active features (by heat score):
${topSummary}
Total active features: ${trendingItems.length}

Generate a concise lede paragraph that tells the team what is moving and why it matters.
Return JSON: { "text": "...", "citedSessionIds": [] }`,
      LedeSonnetSchema,
    );
    lede = { text: ledeResult.text, citedSessionIds: ledeResult.citedSessionIds };
  } catch (_e) {
    // fail-safe: use default
  }

  // Calls 2-3: top 2 stories (bottom 3 get deterministic dek)
  const stories: FeedStory[] = await Promise.all(
    trendingItems.slice(0, 5).map(async (item, idx) => {
      let headline = item.featureName;
      let dek = `${item.eventCount} events in the last 48 hours.`;
      let openQuestion = "What comes next?";
      let citedSessionIds: string[] = [];

      if (idx < 2) {
        try {
          const storyResult = await callSonnet(
            VOICE_SYSTEM_PROMPT,
            `Generate editorial copy for a trending feature story.

Feature: ${item.featureName}
Heat: ${item.heatLabel} (score: ${item.heatScore.toFixed(1)})
Event count (48h): ${item.eventCount}

Return JSON: { "headline": "...", "dek": "...", "openQuestion": "...", "citedSessionIds": [] }`,
            StorySonnetSchema,
          );
          headline = storyResult.headline;
          dek = storyResult.dek;
          openQuestion = storyResult.openQuestion;
          citedSessionIds = storyResult.citedSessionIds;
        } catch (_e) {
          // fail-safe: use defaults
        }
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
        actorInitials: [],
      };
    })
  );

  return {
    editionNumber: Math.floor(Date.now() / (1000 * 60 * 60 * 24)), // day-based edition number
    composedAt: new Date().toISOString(),
    lede,
    trending: stories,
  };
}

export async function getCachedFeed(db: PostgresJsDatabase<Record<string, never>>): Promise<{ feed: FeedComposed | null; eventCount: number }> {
  const { feedCache } = await import("../storage/schema.js");
  const { eq } = await import("drizzle-orm");

  const currentCountResult = await db.execute(drizzleSql`SELECT COUNT(*)::integer as cnt FROM activity_events`);
  const eventCount = Number((currentCountResult as Array<{cnt: number}>)[0]?.cnt ?? 0);

  const rows = await db.select().from(feedCache).where(eq(feedCache.id, "org")).limit(1);
  if (rows.length === 0) return { feed: null, eventCount };

  const row = rows[0];
  const entry: CacheEntry = { eventCountAtCompose: row.eventCountAtCompose, composedAt: new Date(row.composedAt) };
  if (isCacheStale(entry, eventCount)) return { feed: null, eventCount };

  return { feed: row.payload as FeedComposed, eventCount };
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

export async function getFeedOrCompose(db: PostgresJsDatabase<Record<string, never>>, forceRefresh = false): Promise<FeedComposed> {
  if (!forceRefresh) {
    const { feed, eventCount } = await getCachedFeed(db);
    if (feed) return feed;

    // Need to compose
    const inputs = await queryTrendingInputs(db);
    const now = new Date();
    const ranked = rankTrending(inputs, now);
    const composed = await composeFeedEditorial(ranked, "Quire");
    await setCachedFeed(db, composed, eventCount);
    return composed;
  }

  // Force refresh: clear cache and recompose
  const currentCountResult = await db.execute(drizzleSql`SELECT COUNT(*)::integer as cnt FROM activity_events`);
  const eventCount = Number((currentCountResult as Array<{cnt: number}>)[0]?.cnt ?? 0);
  const inputs = await queryTrendingInputs(db);
  const now = new Date();
  const ranked = rankTrending(inputs, now);
  const composed = await composeFeedEditorial(ranked, "Quire");
  await setCachedFeed(db, composed, eventCount);
  return composed;
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
