# Feed Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Evolve the shipped lens-chat surface into THE FEED — an editorial org overview with trending detection, infinite-chat unfold, uniform lens mechanic with seeded openings, avatars, notifications, and a full "Quire" copy rename — matching `mockups/feed/` exactly.

**Architecture:** Build atop the shipped foundation (LensChatView, LensChatMain, LensRail, LensRail.css, LensChatMain.css, server.ts). The feed is a new top-level content model for LensChatMain; the rail gains a 00 ORG box and a + ROLE LENS ghost. The composer is a new server module (`src/web/feed-composer.ts`) with a `feed_cache` DB column/table for presentation cache. All LLM calls go via `src/llm/client.ts` `callSonnet`. No changes to `src/pipeline/`, `src/agents/`, or `src/mcp/`.

**Baseline (measure before Task 0 commit):**
- Tests: 667 passing (vitest)
- tsc: 9 pre-existing errors (do not introduce new ones)
- typecheck:ui: clean

---

## Task 0: Capture baseline

**Files:** read-only

**Step 1:**
```bash
cd /Users/giladkoch/dev/intent-ai && npx vitest run --reporter=dot 2>&1 | tail -6
```
Expected: 667 tests.

**Step 2:**
```bash
npx tsc --noEmit 2>&1 | grep "error TS" | wc -l
```
Expected: 9.

**Step 3:**
```bash
npm run typecheck:ui 2>&1
```
Expected: clean.

---

## Task 1: Feed CSS tokens and motion grammar

**Goal:** Add the feed-specific CSS extensions (new keyframes: emberbreathe, tickwave, shimmer, waitdot, badgepop, notifslide; new classes: .now-edge, .story, .heat, .edition, .lead, .avstack, .av, .notif-btn, .notif-card, .notif-badge, .notif-unfold) to `app-ink.css` alongside the existing `lc-*` tokens from lens-chat. These are additive — no existing rules change.

**Files:**
- Modify: `src/web/ui/src/app-ink.css` (append at end)

**Step 1: Write the test**

Create `tests/web/feed-heat-score.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeHeatScore, rankTrending } from "../../src/web/feed-composer.js";

describe("computeHeatScore", () => {
  it("returns 0 for empty event list", () => {
    expect(computeHeatScore([], new Date())).toBe(0);
  });
  it("recent events score higher than old ones", () => {
    const now = new Date();
    const recent = Array.from({ length: 10 }, (_, i) => ({
      timestamp: new Date(now.getTime() - i * 60_000).toISOString(),
      featureId: "f1",
    }));
    const old = Array.from({ length: 10 }, (_, i) => ({
      timestamp: new Date(now.getTime() - (i + 720) * 60_000).toISOString(),
      featureId: "f2",
    }));
    const scoreRecent = computeHeatScore(recent, now);
    const scoreOld = computeHeatScore(old, now);
    expect(scoreRecent).toBeGreaterThan(scoreOld);
  });
  it("rankTrending returns items sorted descending by heat", () => {
    const now = new Date();
    const items = [
      { featureId: "f1", featureName: "Alpha", events: [{ timestamp: new Date(now.getTime() - 300_000).toISOString(), featureId: "f1" }] },
      { featureId: "f2", featureName: "Beta", events: Array.from({ length: 20 }, (_, i) => ({ timestamp: new Date(now.getTime() - i * 30_000).toISOString(), featureId: "f2" })) },
    ];
    const ranked = rankTrending(items, now);
    expect(ranked[0].featureId).toBe("f2");
  });
});
```

**Step 2: Run test — expect FAIL** (module not yet created)
```bash
cd /Users/giladkoch/dev/intent-ai && npx vitest run tests/web/feed-heat-score.test.ts 2>&1 | tail -8
```

**Step 3: Create `src/web/feed-composer.ts`** — pure heat-scoring logic only (no DB, no LLM yet; those come in Task 2):

```typescript
// feed-composer.ts — deterministic heat scoring for the feed.
// LLM editorial generation lives in composeFeed() (Task 2).
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
```

**Step 4: Run test — expect PASS**
```bash
cd /Users/giladkoch/dev/intent-ai && npx vitest run tests/web/feed-heat-score.test.ts 2>&1 | tail -8
```
Expected: 3 tests pass.

**Step 5: Append feed CSS to `app-ink.css`**

Append to `src/web/ui/src/app-ink.css` (after the existing `lc-*` block):

```css
/* ── Feed design extensions ──────────────────────────────────────────────
   Evolves the lens-chat surface into THE FEED. Additive — no existing
   lc-* rules are modified. Source of truth: mockups/feed/*.html          */

/* ---- extra keyframes ---- */
@keyframes emberbreathe {
  0%,100% { transform:scale(1); opacity:.9; box-shadow:0 0 0 0 rgba(216,73,43,.35) }
  50%      { transform:scale(1.25); opacity:1; box-shadow:0 0 0 5px rgba(216,73,43,0) }
}
@keyframes tickwave {
  0%,100% { transform:scaleY(.72); opacity:.55 }
  50%     { transform:scaleY(1); opacity:1 }
}
@keyframes shimmer {
  0%   { background-position:-200% 0 }
  100% { background-position:300% 0 }
}
@keyframes waitdot {
  0%,100% { opacity:.25 }
  30%     { opacity:1 }
}
@keyframes badgepop {
  0%   { transform:scale(0); opacity:0 }
  70%  { transform:scale(1.25) }
  100% { transform:scale(1); opacity:1 }
}
@keyframes notifslide {
  from { opacity:0; transform:translateY(-18px) scale(.97); filter:blur(8px) }
  to   { opacity:1; transform:translateY(0) scale(1); filter:blur(0) }
}

/* ---- now-edge (the shimmer line where the river last moved) ---- */
.feed-now-edge { margin-bottom:34px }
.feed-now-edge .line {
  height:2px; border-radius:2px;
  background:linear-gradient(90deg,var(--lc-ink-12) 0%,var(--lc-moss) 42%,#7FB89F 50%,var(--lc-moss) 58%,var(--lc-ink-12) 100%);
  background-size:200% 100%;
  animation:shimmer 7s linear infinite;
}
.feed-now-edge .lab {
  margin-top:8px; font-family:'Spline Sans Mono',monospace; font-size:9.5px;
  letter-spacing:.14em; color:var(--lc-ink-40); text-transform:uppercase;
  display:flex; justify-content:space-between;
}
.feed-now-edge .lab b { color:var(--lc-moss); font-weight:600 }

/* ---- edition / lead ---- */
.feed-edition {
  display:flex; align-items:baseline; justify-content:space-between; gap:14px;
  font-family:'Spline Sans Mono',monospace; font-size:10px; letter-spacing:.14em;
  color:var(--lc-ink-40); text-transform:uppercase; margin-bottom:20px;
}
.feed-edition .k { color:var(--lc-ink); font-weight:600 }
.feed-lead h1 {
  font-weight:800; font-size:clamp(30px,3.8vw,44px); line-height:1.08;
  letter-spacing:-.028em; margin-bottom:20px; max-width:15ch;
}
.feed-lead .lede { font-size:17.5px; line-height:1.68; max-width:58ch; color:var(--lc-ink) }
.feed-lead .lede .dim { color:var(--lc-ink-60) }
.feed-handle {
  text-decoration:underline dashed var(--lc-ink-40); text-underline-offset:4px; cursor:pointer;
  transition:color .3s var(--lc-ease);
}
.feed-handle:hover { color:var(--lc-cobalt) }
.feed-byline {
  margin-top:16px; font-family:'Spline Sans Mono',monospace; font-size:10px;
  letter-spacing:.08em; color:var(--lc-ink-40);
  display:flex; align-items:center; gap:9px;
}
.feed-byline b { color:var(--lc-moss); font-weight:600 }

/* ---- trending rule ---- */
.feed-trendhead {
  display:flex; align-items:center; gap:10px; margin:52px 0 20px;
  font-family:'Spline Sans Mono',monospace; font-size:10px; letter-spacing:.18em;
  color:var(--lc-ink-60); text-transform:uppercase; font-weight:600;
}
.feed-trendhead .ember {
  width:8px; height:8px; border-radius:50%; background:var(--lc-vermilion);
  animation:emberbreathe 4.6s ease-in-out infinite;
}
.feed-trendhead .rule { flex:1; height:1px; background:var(--lc-ink-12) }
.feed-trendhead .note { font-weight:400; letter-spacing:.06em; color:var(--lc-ink-40); text-transform:none }

/* ---- story cards ---- */
.feed-story {
  position:relative; text-align:left; width:100%; font-family:inherit; color:var(--lc-ink);
  background:transparent; border:1.5px solid var(--lc-ink-12); border-radius:18px;
  padding:20px 22px 16px; margin-bottom:14px; cursor:pointer;
  transition:border-color .35s var(--lc-ease), background .35s var(--lc-ease),
             transform .35s var(--lc-ease), box-shadow .35s var(--lc-ease);
}
.feed-story:hover { border-color:var(--lc-ink-40); background:#F3EBD6; transform:translateY(-2px) }
.feed-story:active { transform:translateY(0) scale(.995) }
.feed-story.pressed {
  border-color:var(--lc-ink); border-width:2px;
}
.feed-story .kick {
  display:flex; align-items:center; gap:8px; margin-bottom:10px;
  font-family:'Spline Sans Mono',monospace; font-size:9.5px; font-weight:600;
  letter-spacing:.14em; text-transform:uppercase;
}
.feed-story .kick .sq { width:8px; height:8px; border-radius:2.5px }
.feed-story h2 { font-weight:800; font-size:23px; line-height:1.16; letter-spacing:-.015em; margin-bottom:9px; max-width:30ch }
.feed-story .dek { font-size:14.5px; line-height:1.6; color:var(--lc-ink-60); max-width:60ch }
.feed-story .foot {
  display:flex; align-items:center; gap:12px; margin-top:14px; padding-top:11px;
  border-top:1px solid rgba(28,26,21,.06);
  font-family:'Spline Sans Mono',monospace; font-size:9.5px; letter-spacing:.06em; color:var(--lc-ink-40);
}
.feed-story .press { margin-left:auto; color:var(--lc-ink-40); font-weight:500; letter-spacing:.12em; transition:color .3s var(--lc-ease) }
.feed-story:hover .press { color:var(--lc-ink) }

/* ---- heat ticks ---- */
.feed-heat { display:inline-flex; align-items:flex-end; gap:2px; height:11px }
.feed-heat i { width:3px; border-radius:1px; background:var(--lc-vermilion); transform-origin:bottom; animation:tickwave 3.8s ease-in-out infinite }
.feed-heat.cool i { background:var(--lc-ink-25); animation:none; opacity:.7 }

/* ---- unfold section (press-and-unfold) ---- */
.feed-unfold {
  border-left:2px solid var(--lc-ink-12); margin-left:12px; padding-left:20px; margin-bottom:24px;
  display:flex; flex-direction:column; gap:0;
}
.feed-unfold-speaker {
  font-family:'Spline Sans Mono',monospace; font-size:10px; letter-spacing:.1em;
  color:var(--lc-ink-40); text-transform:uppercase; margin-bottom:12px;
}
.feed-unfold-speaker .sq { display:inline-block; width:7px; height:7px; border-radius:2px; margin-right:6px; vertical-align:middle }
.feed-unfold h3 { font-weight:800; font-size:20px; line-height:1.2; letter-spacing:-.015em; margin-bottom:14px }
.feed-unfold p { font-size:15px; line-height:1.7; color:var(--lc-ink-60); max-width:62ch; margin-bottom:16px }
.feed-unfold .chips { display:flex; flex-wrap:wrap; gap:7px; margin-bottom:20px }
.feed-ask-turn { margin-top:24px; padding-top:20px; border-top:1px solid var(--lc-ink-12) }
.feed-ask-turn .q { font-weight:700; font-size:16px; line-height:1.4; max-width:50ch; margin-bottom:14px }
.feed-wait-dots { display:flex; gap:5px }
.feed-wait-dots span { width:5px; height:5px; border-radius:50%; background:var(--lc-ink-40); animation:waitdot 1.8s ease-in-out infinite }
.feed-wait-dots span:nth-child(2) { animation-delay:.3s }
.feed-wait-dots span:nth-child(3) { animation-delay:.6s }

/* ---- avatars (people system) ---- */
.av {
  display:inline-flex; align-items:center; justify-content:center;
  width:22px; height:22px; border-radius:50%; flex-shrink:0;
  font-family:'Spline Sans Mono',monospace; font-size:8px; font-weight:600;
  letter-spacing:.04em; color:var(--lc-bone); border:1.5px solid var(--lc-paper);
  cursor:default; position:relative;
}
.av--sm { width:18px; height:18px; font-size:7px }
.av--lg { width:28px; height:28px; font-size:10px }
.av--agent { border-radius:6px; background:var(--lc-ink-60) !important }
.av--agent::after {
  content:''; position:absolute; bottom:-2px; right:-2px;
  width:8px; height:8px; border-radius:50%;
  background:var(--lc-paper); border:1px solid var(--lc-ink-25);
  background-image:radial-gradient(circle, var(--lc-ink-40) 1px, transparent 1px);
  background-size:4px 4px; background-position:center;
}
.avstack { display:inline-flex; align-items:center }
.avstack .av { margin-left:-6px }
.avstack .av:first-child { margin-left:0 }
.avstack .av--more { background:var(--lc-paper-2) !important; color:var(--lc-ink-60); border-color:var(--lc-ink-12); font-size:7.5px; font-weight:500 }
.attrib {
  display:flex; align-items:center; gap:7px; margin-top:10px;
  font-family:'Spline Sans Mono',monospace; font-size:9.5px;
  letter-spacing:.05em; color:var(--lc-ink-40);
}

/* ---- notification surface ---- */
.notif-btn {
  position:fixed; top:20px; right:26px; z-index:10;
  display:flex; align-items:center; gap:8px;
  background:rgba(239,229,206,.92); backdrop-filter:blur(6px);
  border:1.5px solid var(--lc-ink-12); border-radius:10px;
  padding:7px 11px; cursor:pointer; font-family:inherit;
  transition:border-color .3s var(--lc-ease), box-shadow .3s var(--lc-ease);
}
.notif-btn:hover { border-color:var(--lc-ink-40); box-shadow:0 4px 14px -6px rgba(28,26,21,.18) }
.notif-btn .icon { font-size:14px; line-height:1; user-select:none }
.notif-btn .meta {
  font-family:'Spline Sans Mono',monospace; font-size:10px; color:var(--lc-ink-40);
  letter-spacing:.06em; text-align:right; line-height:1.5;
}
.notif-btn .meta a { color:var(--lc-ink-60); text-decoration:none; border-bottom:1px dashed var(--lc-ink-25) }
.notif-btn .meta a:hover { color:var(--lc-cobalt); border-color:var(--lc-cobalt) }
.notif-badge {
  position:absolute; top:-5px; right:-5px;
  width:16px; height:16px; border-radius:50%;
  background:var(--lc-vermilion); color:var(--lc-bone);
  font-family:'Spline Sans Mono',monospace; font-size:8.5px; font-weight:600;
  display:flex; align-items:center; justify-content:center;
  border:1.5px solid var(--lc-paper);
  animation:badgepop .5s var(--lc-spring) .8s both;
}
.notif-card {
  border:1.5px solid var(--lc-cobalt); border-radius:18px;
  background:rgba(43,73,216,.05); padding:18px 20px 14px;
  margin-bottom:24px; position:relative;
  animation:notifslide .7s var(--lc-ease) both;
}
.notif-card .nkick {
  display:flex; align-items:center; gap:8px; margin-bottom:11px;
  font-family:'Spline Sans Mono',monospace; font-size:9.5px; font-weight:600;
  letter-spacing:.14em; text-transform:uppercase; color:var(--lc-cobalt);
}
.notif-card .nkick .dot { width:7px; height:7px; border-radius:50%; background:var(--lc-cobalt); animation:breathe 3.8s ease-in-out infinite }
.notif-card .ntitle { font-weight:700; font-size:16px; line-height:1.4; margin-bottom:7px; max-width:44ch }
.notif-card .nbody { font-size:14px; line-height:1.6; color:var(--lc-ink-60); max-width:58ch; margin-bottom:12px }
.notif-card .nbody b { color:var(--lc-ink) }
.notif-card .nfoot {
  display:flex; align-items:center; gap:10px;
  font-family:'Spline Sans Mono',monospace; font-size:9.5px; letter-spacing:.06em; color:var(--lc-ink-40);
  border-top:1px solid rgba(28,26,21,.06); padding-top:10px; margin-top:10px;
}
.notif-card .dismiss {
  margin-left:auto; color:var(--lc-ink-40); background:none; border:none; cursor:pointer;
  font-family:'Spline Sans Mono',monospace; font-size:9.5px; letter-spacing:.08em;
  transition:color .3s var(--lc-ease);
}
.notif-card .dismiss:hover { color:var(--lc-ink) }
.notif-unfold {
  border:1.5px solid var(--lc-cobalt); border-radius:18px; padding:20px 22px 18px;
  margin-bottom:24px; background:rgba(43,73,216,.04);
}

/* ---- feature-page seam (the now-edge between editorial and chat) ---- */
.feed-seam {
  height:2px; border-radius:2px; margin:40px 0 32px;
  background:linear-gradient(90deg,var(--lc-ink-12) 0%,var(--lc-moss) 42%,#7FB89F 50%,var(--lc-moss) 58%,var(--lc-ink-12) 100%);
  background-size:200% 100%;
  animation:shimmer 7s linear infinite;
}

/* ---- state band (feature page) ---- */
.feed-state-band {
  border:1.5px solid var(--lc-ink-12); border-radius:14px; padding:16px 20px; margin-bottom:28px;
}
.feed-state-band .label {
  font-family:'Spline Sans Mono',monospace; font-size:9.5px; letter-spacing:.14em;
  text-transform:uppercase; color:var(--lc-ink-40); margin-bottom:8px;
}
.feed-state-band .value { font-weight:700; font-size:16px; line-height:1.3 }
.feed-state-band .open-q { font-size:14px; line-height:1.6; color:var(--lc-ink-60); margin-top:8px }

/* reduced motion */
@media (prefers-reduced-motion:reduce) {
  .feed-now-edge .line,
  .feed-seam { animation:none; background:var(--lc-moss); opacity:.4 }
  .feed-heat i,
  .feed-trendhead .ember,
  .notif-card,
  .notif-badge { animation:none }
  .feed-wait-dots span { animation:none; opacity:.5 }
}
```

**Step 6: Run typecheck**
```bash
cd /Users/giladkoch/dev/intent-ai && npm run typecheck:ui 2>&1
```
Expected: clean.

**Step 7: Commit**
```bash
cd /Users/giladkoch/dev/intent-ai && git add src/web/ui/src/app-ink.css src/web/feed-composer.ts tests/web/feed-heat-score.test.ts && git commit -m "$(cat <<'EOF'
feat(feed): CSS extensions + deterministic heat-scoring module

Appends feed keyframes (emberbreathe, tickwave, shimmer, waitdot,
badgepop, notifslide) and component classes (now-edge, story, heat,
trending rule, avatars, notification surface, seam, state-band) to
app-ink.css as additive rules — existing lc-* tokens unchanged.
Adds feed-composer.ts with computeHeatScore / rankTrending (pure math,
no DB/LLM) and 3 passing tests.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CT7KvNTVAGKSLmyGKVvVpM
EOF
)"
```

---

## Task 2: Feed composer — DB query + LLM editorial generation

**Goal:** Complete `src/web/feed-composer.ts` with:
1. `queryTrendingInputs(sql, windowHours)` — queries `activity_events` grouped by `feature_id`, returns `TrendingInput[]`.
2. `composeFeedEditorial(trendingItems, orgName)` — calls `callSonnet` once for the org overview lede and once per trending item story (max 3 items = max 3 Sonnet calls). Voice rule and banned-word list are ENCODED IN THE PROMPT. Returns a `FeedComposed` object.
3. `getCachedFeed(sql)` / `setCachedFeed(sql, feed)` — reads/writes a `feed_cache` JSONB column in a new `feed_cache` table (single row keyed by `id = 'org'`). Cache is stale when new events have arrived since `composed_at`.
4. `getFeedOrCompose(sql)` — the public entry point: returns cached feed if fresh, else recomposes and caches.

**DB schema note:** Add `feed_cache` table to `src/storage/schema.ts` (id text PK, payload jsonb, composed_at timestamp, event_count_at_compose integer). Write a Drizzle migration.

**Files:**
- Modify: `src/web/feed-composer.ts` (complete the module started in Task 1)
- Modify: `src/storage/schema.ts` (add feed_cache table)
- Create: `drizzle/0004_feed_cache.sql` (migration)

**Step 1: Write the test**

Create `tests/web/feed-composer-cache.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { isCacheStale, buildFeedCacheKey } from "../../src/web/feed-composer.js";

describe("isCacheStale", () => {
  it("returns true when currentEventCount > eventCountAtCompose", () => {
    expect(isCacheStale({ eventCountAtCompose: 100, composedAt: new Date() }, 101)).toBe(true);
  });
  it("returns false when counts match and compose is recent", () => {
    expect(isCacheStale({ eventCountAtCompose: 100, composedAt: new Date() }, 100)).toBe(false);
  });
  it("returns true when composedAt is older than 1 hour regardless of count", () => {
    const old = new Date(Date.now() - 3_700_000);
    expect(isCacheStale({ eventCountAtCompose: 100, composedAt: old }, 100)).toBe(true);
  });
});

describe("buildFeedCacheKey", () => {
  it("returns 'org' for org-level feed", () => {
    expect(buildFeedCacheKey()).toBe("org");
  });
});
```

**Step 2: Run test — expect FAIL**
```bash
cd /Users/giladkoch/dev/intent-ai && npx vitest run tests/web/feed-composer-cache.test.ts 2>&1 | tail -8
```

**Step 3: Add `feed_cache` to schema.ts**

In `src/storage/schema.ts`, add after the last `pgTable` export:

```typescript
export const feedCache = pgTable("feed_cache", {
  id: text("id").primaryKey(),          // 'org' for the org-level feed
  payload: jsonb("payload").notNull(),  // FeedComposed JSON — presentation cache, NOT fact
  composedAt: timestamp("composed_at", { withTimezone: true }).notNull(),
  eventCountAtCompose: integer("event_count_at_compose").notNull().default(0),
});
```

**Step 4: Create migration `drizzle/0004_feed_cache.sql`**

```sql
-- Feed presentation cache. This table stores LLM-generated editorial copy
-- keyed by lens ('org'). It is a PRESENTATION CACHE — not a fact table.
-- Clear it freely; it recomposes automatically on next /api/feed request.
CREATE TABLE IF NOT EXISTS "feed_cache" (
  "id" text PRIMARY KEY,
  "payload" jsonb NOT NULL,
  "composed_at" timestamptz NOT NULL,
  "event_count_at_compose" integer NOT NULL DEFAULT 0
);
```

**Step 5: Complete `src/web/feed-composer.ts`**

Add to the existing file (after the `rankTrending` export):

```typescript
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

// ── DB + LLM composition (imported lazily at runtime) ──────────────────
// These are NOT exported for testing; they require a live DB + Anthropic key.

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
```

Then add the DB query + LLM composition functions as server-only code in the same file. The key design points:

- `queryTrendingInputs`: `SELECT feature_id, COUNT(*) as event_count, MAX(timestamp) as last_at, array_agg(timestamp ORDER BY timestamp DESC) FILTER (WHERE timestamp >= now()-interval '48 hours') as recent_ts FROM activity_events WHERE feature_id IS NOT NULL GROUP BY feature_id`. Join to `features` table for `name`.
- `composeFeedEditorial`: Sonnet call 1 = org lede (given top trending features + real moment counts + last session narrative excerpt). Sonnet calls 2–4 = per-story (given feature moments + narrative). System prompt encodes voice rule verbatim: "State the value plainly. Say what happened and why it matters. Never be clever about the product itself. The test: would a straight-talking founder say this out loud to a colleague? If not, rewrite it. Tell the story, then leave a door open. Lead with the real event or finding; close with a concrete question or unresolved thread. Every claim traces to evidence. Headlines carry the actual news. Second person, specific. Terse. BANNED WORDS (never use): river, sitting, ink, correspondence, edition, sittings, unfolded."
- Zod schema for each Sonnet call enforces: `headline` max 80 chars, `dek` max 400 chars, `openQuestion` max 160 chars — schema constraints beat prompt instructions (per feedback_schema_constraints.md).
- `getFeedOrCompose`: query current event count; check cache; if stale, call `composeFeedEditorial`, write to `feed_cache`; return payload.

**Step 6: Run test — expect PASS**
```bash
cd /Users/giladkoch/dev/intent-ai && npx vitest run tests/web/feed-composer-cache.test.ts 2>&1 | tail -8
```
Expected: 4 tests pass (pure cache logic only; no DB/LLM in tests).

**Step 7: Run full vitest**
```bash
cd /Users/giladkoch/dev/intent-ai && npx vitest run --reporter=dot 2>&1 | tail -6
```
Expected: ≥671 tests (667 + 4 new); 0 failures.

**Step 8: Typecheck**
```bash
cd /Users/giladkoch/dev/intent-ai && npm run typecheck:ui 2>&1 && npx tsc --noEmit 2>&1 | grep "error TS" | wc -l
```
Expected: UI clean; server ≤9 errors.

**Step 9: Commit**
```bash
cd /Users/giladkoch/dev/intent-ai && git add src/web/feed-composer.ts src/storage/schema.ts drizzle/0004_feed_cache.sql tests/web/feed-composer-cache.test.ts && git commit -m "$(cat <<'EOF'
feat(feed): feed-composer — cache helpers, FeedComposed types, DB schema

Adds isCacheStale / buildFeedCacheKey (pure, tested). Defines FeedStory
and FeedComposed output shapes. Adds feed_cache pgTable (presentation
cache — not a fact table; clear freely). Migration 0004_feed_cache.sql.
LLM composition (queryTrendingInputs + composeFeedEditorial with voice
rule in prompt) wired; Sonnet calls ≤3 per refresh; stale = new events
OR > 1 hour. 4 new tests pass.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CT7KvNTVAGKSLmyGKVvVpM
EOF
)"
```

---

## Task 3: Server — `/api/feed` endpoint

**Goal:** Wire `getFeedOrCompose` into a GET `/api/feed` endpoint in `server.ts`. The endpoint returns the `FeedComposed` JSON. Fail-safe: if DB or LLM is unavailable, return a skeleton `FeedComposed` (empty `trending`, a canned lede — never 500). On-demand refresh: `?refresh=1` invalidates cache. Run DB migration at startup if `feed_cache` table missing.

**Files:**
- Modify: `src/web/server.ts`

**Step 1: Write the test**

Create `tests/web/feed-endpoint.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildSkeletonFeed } from "../../src/web/feed-composer.js";

describe("buildSkeletonFeed", () => {
  it("returns a valid FeedComposed with empty trending", () => {
    const f = buildSkeletonFeed();
    expect(f.trending).toHaveLength(0);
    expect(typeof f.lede.text).toBe("string");
    expect(f.lede.text.length).toBeGreaterThan(0);
    expect(typeof f.editionNumber).toBe("number");
  });
  it("does not contain banned words in the lede", () => {
    const banned = ["river", "sitting", "ink", "correspondence", "edition", "sittings"];
    const f = buildSkeletonFeed();
    for (const word of banned) {
      expect(f.lede.text.toLowerCase()).not.toContain(word);
    }
  });
});
```

**Step 2: Run test — expect FAIL**
```bash
cd /Users/giladkoch/dev/intent-ai && npx vitest run tests/web/feed-endpoint.test.ts 2>&1 | tail -8
```

**Step 3: Add `buildSkeletonFeed` to `feed-composer.ts`**

```typescript
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
```

**Step 4: Run test — expect PASS**
```bash
cd /Users/giladkoch/dev/intent-ai && npx vitest run tests/web/feed-endpoint.test.ts 2>&1 | tail -8
```
Expected: 2 tests pass.

**Step 5: Add `/api/feed` endpoint to `server.ts`**

Locate the `// ── Lens arrival brief` comment and add BEFORE it:

```typescript
// ── Feed endpoint ───────────────────────────────────────────────────────
// Returns the LLM-composed editorial feed. Cached in feed_cache table.
// Fail-safe: any DB/LLM error returns buildSkeletonFeed(), never 500.
// ?refresh=1 forces recompose on next call.

app.get("/api/feed", async (req, res) => {
  try {
    const forceRefresh = req.query["refresh"] === "1";
    const { getFeedOrCompose, buildSkeletonFeed: skeleton } = await import("./feed-composer.js");
    const sql = getClient();
    const feed = await getFeedOrCompose(sql, forceRefresh);
    res.json(feed);
  } catch (err) {
    // Fail-safe: skeleton feed, never 500
    const { buildSkeletonFeed: skeleton } = await import("./feed-composer.js").catch(() => ({ buildSkeletonFeed: () => ({ editionNumber: 0, composedAt: new Date().toISOString(), lede: { text: "Feed unavailable.", citedSessionIds: [] }, trending: [] }) }));
    res.json(skeleton());
  }
});
```

**Step 6: Add `fetchFeed` to `src/web/ui/src/api.ts`**

```typescript
export interface FeedStory {
  featureId: string;
  featureName: string;
  heatScore: number;
  heatLabel: "hot" | "still warm" | "cooling";
  eventCount: number;
  headline: string;
  dek: string;
  openQuestion: string;
  citedSessionIds: string[];
  actorInitials: string[];
}

export interface FeedComposed {
  editionNumber: number;
  composedAt: string;
  lede: { text: string; citedSessionIds: string[] };
  trending: FeedStory[];
}

export const fetchFeed = (refresh = false) =>
  json<FeedComposed>(`/api/feed${refresh ? "?refresh=1" : ""}`);
```

**Step 7: Typecheck + full test run**
```bash
cd /Users/giladkoch/dev/intent-ai && npm run typecheck:ui 2>&1 && npx tsc --noEmit 2>&1 | grep "error TS" | wc -l && npx vitest run --reporter=dot 2>&1 | tail -6
```
Expected: UI clean; ≤9 server errors; ≥673 tests passing.

**Step 8: Commit**
```bash
cd /Users/giladkoch/dev/intent-ai && git add src/web/server.ts src/web/feed-composer.ts src/web/ui/src/api.ts tests/web/feed-endpoint.test.ts && git commit -m "$(cat <<'EOF'
feat(feed): /api/feed endpoint + skeleton fail-safe + fetchFeed UI helper

GET /api/feed returns FeedComposed from cache or recomposes (≤3 Sonnet
calls). ?refresh=1 forces recompose. Any DB/LLM failure returns skeleton
('Nothing is digested yet…') — never 500. Skeleton is voice-rule clean
(no banned words). 2 new tests.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CT7KvNTVAGKSLmyGKVvVpM
EOF
)"
```

---

## Task 4: Lens opening composer — seeded opening for any lens

**Goal:** Add `/api/lens/opening/:lensType/:lensId` endpoint that returns the seeded opening content for any lens: top-level understanding (from features/moments/narratives), recent insights (from observations), and pending approvals count. This is the "chat already seeded" first turn. Mostly deterministic assembly; optional single Sonnet polish only if feature has enough material (≥3 sessions). The opening IS the chat's first turn — the UI renders it as a brain turn before any user message.

**Files:**
- Create: `src/web/lens-opening-composer.ts`
- Modify: `src/web/server.ts` (add endpoint)

**Step 1: Write the test**

Create `tests/web/lens-opening-composer.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildLensOpeningTurn, truncateToEssence } from "../../src/web/lens-opening-composer.js";

describe("truncateToEssence", () => {
  it("returns text under maxChars unchanged", () => {
    expect(truncateToEssence("short", 100)).toBe("short");
  });
  it("truncates at sentence boundary and appends ellipsis", () => {
    const long = "First sentence. Second sentence. Third sentence. Fourth sentence.";
    const result = truncateToEssence(long, 40);
    expect(result.length).toBeLessThanOrEqual(40 + 3);
    expect(result.endsWith("…")).toBe(true);
  });
});

describe("buildLensOpeningTurn", () => {
  it("returns a non-empty string for a feature with no data", () => {
    const turn = buildLensOpeningTurn({ featureName: "Test", understanding: null, recentInsights: [], pendingCount: 0 });
    expect(turn.length).toBeGreaterThan(10);
    expect(turn).not.toContain("undefined");
    expect(turn).not.toContain("null");
  });
  it("includes pending count when > 0", () => {
    const turn = buildLensOpeningTurn({ featureName: "Test", understanding: null, recentInsights: [], pendingCount: 3 });
    expect(turn).toContain("3");
  });
});
```

**Step 2: Run test — expect FAIL**
```bash
cd /Users/giladkoch/dev/intent-ai && npx vitest run tests/web/lens-opening-composer.test.ts 2>&1 | tail -8
```

**Step 3: Create `src/web/lens-opening-composer.ts`**

```typescript
// lens-opening-composer.ts — assembles the seeded opening turn for any lens.
// The opening carries: top-level understanding, recent insights, pending count.
// Mostly deterministic; Sonnet polish is optional (only if sessionCount >= 3).

export interface LensOpeningInput {
  featureName: string;
  understanding: string | null;     // from feature's narrative / brain cards
  recentInsights: string[];         // up to 3, from approved observations
  pendingCount: number;
}

export interface LensOpeningResult {
  turn: string;                     // the seeded first-turn text
  polished: boolean;                // true if Sonnet was invoked
  citedSessionIds: string[];
}

/**
 * Truncate to the nearest sentence boundary at or below maxChars.
 * If no boundary found, hard-truncate and append "…".
 */
export function truncateToEssence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  // find last sentence end (. ! ?) within maxChars
  const sub = text.slice(0, maxChars);
  const lastEnd = Math.max(sub.lastIndexOf(". "), sub.lastIndexOf("! "), sub.lastIndexOf("? "));
  if (lastEnd > maxChars * 0.4) {
    return text.slice(0, lastEnd + 1).trim() + "…";
  }
  return sub.trim() + "…";
}

/**
 * Build the deterministic opening turn text from the lens input.
 * Returns a plain-voice string ready to render as the brain's first turn.
 */
export function buildLensOpeningTurn(input: LensOpeningInput): string {
  const { featureName, understanding, recentInsights, pendingCount } = input;
  const parts: string[] = [];

  if (understanding && understanding.trim()) {
    parts.push(truncateToEssence(understanding.trim(), 600));
  } else {
    parts.push(`${featureName} is tracked here. No deep understanding built yet — start a session to add to it.`);
  }

  if (recentInsights.length > 0) {
    parts.push("Recent: " + recentInsights.slice(0, 3).join(" · "));
  }

  if (pendingCount > 0) {
    parts.push(`${pendingCount} thing${pendingCount === 1 ? "" : "s"} waiting for your approval — you can stamp them below.`);
  }

  return parts.join("\n\n");
}
```

**Step 4: Run test — expect PASS**
```bash
cd /Users/giladkoch/dev/intent-ai && npx vitest run tests/web/lens-opening-composer.test.ts 2>&1 | tail -8
```
Expected: 4 tests pass.

**Step 5: Add `/api/lens/opening/:featureId` endpoint to `server.ts`**

The endpoint:
1. Queries `features` by id → `featureName`, `understanding` (from `brain_cards` or `features.context`).
2. Queries `activity_events` for recent approved observations (category = `observation.*`, `review_status = 'approved'`, last 7 days, limit 3) → `recentInsights`.
3. Queries pending observations count for this feature.
4. Calls `buildLensOpeningTurn` deterministically.
5. If `sessionCount >= 3` and `ANTHROPIC_API_KEY` is set: optional single Sonnet call to polish the turn within the voice rule (same banned-word system prompt, max_tokens=300). If Sonnet fails: return deterministic result.
6. Always returns `{ turn, polished, citedSessionIds }`.
7. Fail-safe: any error returns `{ turn: "${featureName} — select to explore.", polished: false, citedSessionIds: [] }`.

**Step 6: Add `fetchLensOpening` to `api.ts`**

```typescript
export interface LensOpeningResult {
  turn: string;
  polished: boolean;
  citedSessionIds: string[];
}
export const fetchLensOpening = (featureId: string) =>
  json<LensOpeningResult>(`/api/lens/opening/${encodeURIComponent(featureId)}`);
```

**Step 7: Typecheck + test run**
```bash
cd /Users/giladkoch/dev/intent-ai && npm run typecheck:ui 2>&1 && npx vitest run --reporter=dot 2>&1 | tail -6
```

**Step 8: Commit**
```bash
cd /Users/giladkoch/dev/intent-ai && git add src/web/lens-opening-composer.ts src/web/server.ts src/web/ui/src/api.ts tests/web/lens-opening-composer.test.ts && git commit -m "$(cat <<'EOF'
feat(feed): lens opening composer — seeded first turn for any lens

Deterministic assembly: top-level understanding (truncated to essence),
recent insights (up to 3 approved observations), pending count call-to-
action. Optional single Sonnet polish when sessionCount >= 3. Fail-safe
on every path. 4 new tests. Endpoint: GET /api/lens/opening/:featureId.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CT7KvNTVAGKSLmyGKVvVpM
EOF
)"
```

---

## Task 5: Notification derivation — `/api/notifications`

**Goal:** Add a lightweight notification derivation endpoint. Derives notifications from existing DB tables — no LLM. Four signal types (per DESIGN.md taste rules):
1. Pending gates waiting on viewer (pending observations where viewer has approved before — use localStorage `last-actor` hint passed as query param, or default to most recent session actor).
2. Activity in viewer's areas since `lastSeen` (ISO timestamp from client, via query param).
3. A decision the viewer made was contradicted (moments with `verification='contradicted'` in features they last touched).
4. Hot streak in a feature they follow (heatScore ≥ 8 in last hour).

Fail-safe: any error returns `[]`. Never fires routine digest completions.

**Files:**
- Create: `src/web/notifications.ts`
- Modify: `src/web/server.ts`
- Modify: `src/web/ui/src/api.ts`

**Step 1: Write the test**

Create `tests/web/notifications.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildNotifText, dedupNotifications } from "../../src/web/notifications.js";

describe("buildNotifText", () => {
  it("pending gate — single", () => {
    const text = buildNotifText({ type: "pending_gate", featureName: "Digest Pipeline", count: 1 });
    expect(text).not.toContain("undefined");
    expect(text).toContain("Digest Pipeline");
    expect(text.length).toBeLessThan(120);
  });
  it("activity since — specific actor", () => {
    const text = buildNotifText({ type: "area_activity", featureName: "Dashboard", actorName: "Dana", count: 3 });
    expect(text).toContain("Dana");
    expect(text).toContain("Dashboard");
  });
  it("contradicted decision", () => {
    const text = buildNotifText({ type: "contradicted", featureName: "Feed Composer", momentSummary: "the cache is always fresh" });
    expect(text).toContain("Feed Composer");
  });
});

describe("dedupNotifications", () => {
  it("removes duplicate type+featureId pairs", () => {
    const notifs = [
      { type: "pending_gate" as const, featureId: "f1", text: "a" },
      { type: "pending_gate" as const, featureId: "f1", text: "b" },
      { type: "area_activity" as const, featureId: "f1", text: "c" },
    ];
    expect(dedupNotifications(notifs)).toHaveLength(2);
  });
});
```

**Step 2: Run test — expect FAIL**
```bash
cd /Users/giladkoch/dev/intent-ai && npx vitest run tests/web/notifications.test.ts 2>&1 | tail -8
```

**Step 3: Create `src/web/notifications.ts`**

Export `buildNotifText`, `dedupNotifications`, and `Notification` type. `buildNotifText` generates plain-voice, specific copy (no banned words). `dedupNotifications` keeps first occurrence per `type+featureId`.

Key voice rule for notification copy: plain and specific. "Dana commented on Digest Pipeline." Not "You have 2 notifications." Timestamps are relative when recent (< 24h: "4 hours ago"), absolute when older.

**Step 4: Run test — expect PASS**
```bash
cd /Users/giladkoch/dev/intent-ai && npx vitest run tests/web/notifications.test.ts 2>&1 | tail -8
```

**Step 5: Add `/api/notifications` to `server.ts`**

```
GET /api/notifications?lastSeen=<ISO>&actor=<initials>
Returns: { notifications: Notification[], unreadCount: number }
```
Queries are cheap: pending observations (1 query), recent activity by feature (1 query), contradicted moments (1 query). No LLM. Fail-safe: returns `{ notifications: [], unreadCount: 0 }` on any error.

**Step 6: Add `fetchNotifications` to `api.ts`**

**Step 7: Full check**
```bash
cd /Users/giladkoch/dev/intent-ai && npm run typecheck:ui 2>&1 && npx vitest run --reporter=dot 2>&1 | tail -6
```

**Step 8: Commit**
```bash
cd /Users/giladkoch/dev/intent-ai && git add src/web/notifications.ts src/web/server.ts src/web/ui/src/api.ts tests/web/notifications.test.ts && git commit -m "$(cat <<'EOF'
feat(feed): notification derivation — 4 signal types, no LLM

Derives: pending gate waiting on viewer, area activity since lastSeen,
contradicted decisions, hot-streak features. Plain-voice copy (no
banned words). Dedup by type+featureId. Fail-safe returns []. Endpoint:
GET /api/notifications?lastSeen=&actor=. 5 new tests.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CT7KvNTVAGKSLmyGKVvVpM
EOF
)"
```

---

## Task 6: Rail evolution — 00 ORG box + + ROLE LENS ghost

**Goal:** Evolve `LensRail.tsx` and `LensRail.css` to match `mockups/feed/`:
- Add 00 ORG box (`.lens--org`: ink background, bone text, mark rotated 90°, sub "you are here", non-clickable active state — pressing it returns to the org feed).
- Rename the existing ghost `+ LENS` to `+ ROLE LENS` with sub `exec · product · eng — soon`.
- Add a `.lc-notif-dot` to the wordmark (vermilion, `badgepop` animation) when `unreadCount > 0`.
- Prop additions: `onOrgSelect: () => void`, `unreadNotifCount: number`.
- The 00 ORG lens has `is-focus` styling when `focusedLens === null` (org feed is the default).

**Files:**
- Modify: `src/web/ui/src/components/LensRail.tsx`
- Modify: `src/web/ui/src/components/LensRail.css`

**Step 1: Write the test**

Add to `tests/web/lens-chat-scope.test.ts` (or a new file `tests/web/lens-rail.test.ts`):

```typescript
import { describe, it, expect } from "vitest";

// Pure logic tests — no DOM. LensRail is a presentation component;
// we test the derived label strings directly.

describe("LensRail label derivation", () => {
  it("00 ORG is active when focusedLens is null", () => {
    const isOrgActive = (focusedLens: string | null) => focusedLens === null;
    expect(isOrgActive(null)).toBe(true);
    expect(isOrgActive("feature")).toBe(false);
  });
  it("notif dot shows when unreadCount > 0", () => {
    const showDot = (count: number) => count > 0;
    expect(showDot(0)).toBe(false);
    expect(showDot(1)).toBe(true);
  });
});
```

**Step 2: Run test — expect PASS immediately** (pure logic, no imports needed)
```bash
cd /Users/giladkoch/dev/intent-ai && npx vitest run tests/web/lens-rail.test.ts 2>&1 | tail -8
```

**Step 3: Update `LensRail.css`**

Add to `LensRail.css` (copy exact styles from `mockups/feed/01-the-feed.html` `.lens--org` block):
- `.lc-lens--org` — `background:var(--lc-ink); color:var(--lc-bone)`
- `.lc-lens--org .lc-mark` — `transform:rotate(90deg)` (static, doesn't animate on hover)
- `.lc-lens--org .lc-sub` — `color:rgba(245,241,232,.7)`
- `.lc-notif-dot` — `width:8px; height:8px; border-radius:50%; background:var(--lc-vermilion); animation:badgepop .5s var(--lc-spring) .8s both`
- `+ ROLE LENS` ghost sub: `.lc-gsub` style if not already present.

**Step 4: Update `LensRail.tsx`**

Add `onOrgSelect: () => void` and `unreadNotifCount: number` to `LensRailProps`. Add the 00 ORG box as the FIRST lens in the list. Update wordmark to show `.lc-notif-dot` when `unreadNotifCount > 0`. The org lens shows `is-focus` styling (highlighted, not faded) when `focusedLens === null`. Update ghost box label to `+ ROLE LENS` with sub `exec · product · eng — soon`.

**Step 5: Update `LensChatView.tsx`**

Wire `onOrgSelect` (calls `handleClearScope`) and `unreadNotifCount` (from notifications fetch) into the LensRail props. Add notification polling: fetch `/api/notifications` on mount + every 30 seconds; store `unreadCount` in state; pass to LensRail.

**Step 6: Typecheck**
```bash
cd /Users/giladkoch/dev/intent-ai && npm run typecheck:ui 2>&1
```

**Step 7: Commit**
```bash
cd /Users/giladkoch/dev/intent-ai && git add src/web/ui/src/components/LensRail.tsx src/web/ui/src/components/LensRail.css src/web/ui/src/components/LensChatView.tsx tests/web/lens-rail.test.ts && git commit -m "$(cat <<'EOF'
feat(feed): LensRail — 00 ORG box, + ROLE LENS ghost, notif dot

00 ORG (ink bg) is the default active lens — returns to the org feed.
Ghost slot relabeled '+ ROLE LENS' with 'exec · product · eng — soon'
sub. Vermilion notif dot on wordmark when unreadNotifCount > 0 (badgepop
entrance). LensChatView polls /api/notifications every 30s.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CT7KvNTVAGKSLmyGKVvVpM
EOF
)"
```

---

## Task 7: FeedStream component — the editorial org overview

**Goal:** Replace the arrival-turn content in `LensChatMain` with the editorial feed when `focusedLens === null` (org view). The feed renders:
1. The now-edge shimmer line.
2. Edition label (Quire · No. N · today's date).
3. Lead lede (word-by-word entrance) with attribution stack.
4. TRENDING rule with ember dot.
5. Story cards (up to 5): kick label, headline, dek, heat ticks, `EXPAND ↓` footer, attribution stack.
6. Story press: card settles (`.pressed`), a colored stem draws, the unfold section materializes below (speaker → h3 → paragraphs → evidence chips → ask turn with wait dots), ask-bar takes scope tag. Multiple presses stack.

**Files:**
- Create: `src/web/ui/src/components/FeedStream.tsx`
- Create: `src/web/ui/src/components/FeedStream.css`
- Modify: `src/web/ui/src/components/LensChatMain.tsx` (swap arrival for FeedStream when `focusedLens === null`)

**Step 1: Write the test**

Create `tests/web/feed-stream.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatRelativeDate, buildEditionLabel } from "../../src/web/ui/src/components/feed-stream-utils.js";

describe("formatRelativeDate", () => {
  it("returns 'today' for today's date", () => {
    const today = new Date().toISOString();
    expect(formatRelativeDate(today)).toBe("today");
  });
  it("returns 'yesterday' for yesterday", () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    expect(formatRelativeDate(yesterday)).toBe("yesterday");
  });
});

describe("buildEditionLabel", () => {
  it("returns a string with 'No.' and the edition number", () => {
    const label = buildEditionLabel(9, new Date());
    expect(label).toContain("No. 9");
  });
  it("says Quire, not Brain", () => {
    const label = buildEditionLabel(1, new Date());
    expect(label.toLowerCase()).not.toContain("brain");
  });
});
```

**Step 2: Run test — expect FAIL**
```bash
cd /Users/giladkoch/dev/intent-ai && npx vitest run tests/web/feed-stream.test.ts 2>&1 | tail -8
```

**Step 3: Create `src/web/ui/src/components/feed-stream-utils.ts`**

Pure utility: `formatRelativeDate(iso)` → "today" / "yesterday" / locale date string. `buildEditionLabel(n, date)` → "Quire · No. N · [formatted date]".

**Step 4: Run test — expect PASS**
```bash
cd /Users/giladkoch/dev/intent-ai && npx vitest run tests/web/feed-stream.test.ts 2>&1 | tail -8
```

**Step 5: Create `FeedStream.css`**

Port `.feed-stream`, press-and-unfold interaction styles, `.stem` (the colored line between pressed card and unfold), and `.u1`–`.u7` stagger classes from `mockups/feed/02-press-and-unfold.html`. Key: the stem is `position:absolute; left:22px; width:2px; background:accent-color; transform-origin:top; animation: drawline .4s ease both`.

**Step 6: Create `FeedStream.tsx`**

Props: `feed: FeedComposed | null`, `loading: boolean`, `onStoryPress: (featureId: string, featureName: string) => void`. Manages `pressedStoryId` state (the unfolded story; null = nothing unfolded). On press: set `pressedStoryId`, render the unfold section in-stream below the card, scroll into view. `ask-bar` scope tag set by parent via `onStoryPress` callback. Unfold uses `<template>`-clone pattern via conditional rendering with stagger delays (`u1`–`u7`). Wait-dots show while parent is awaiting next user message in the scoped chat.

Avatar determinism: initials come from `actorInitials` in `FeedStory`. Color assignment: `G` → cobalt, `D` → vermilion, `R` → moss, `C` → marigold; any other → amber. Agent mark: if initials length is 3+ or initials contain `AI`, render `.av--agent` (rounded-square + circuit badge).

**Step 7: Modify `LensChatMain.tsx`**

Condition: when `focusedLens === null`, render `<FeedStream>` instead of the arrival turn. Pass `feed` prop (fetched via `fetchFeed()` on mount in `LensChatView`). When a story is pressed (`onStoryPress`), call `onLensFocus("feature")` on the parent and set the `selectedFeatureId` — the press IS the feature lens selection, which then triggers the seeded opening in the chat below the stream. The ask-bar scope tag updates accordingly.

When `focusedLens !== null`, the stream dissolves (same `lc-dissolve` class as the current arrival turn) and the seeded opening turn materializes.

**Step 8: Update `LensChatView.tsx`**

Add `feed: FeedComposed | null` state; fetch on mount via `fetchFeed()`; pass to `LensChatMain`. Expose `feedLoading` boolean.

**Step 9: Typecheck + test run**
```bash
cd /Users/giladkoch/dev/intent-ai && npm run typecheck:ui 2>&1 && npx vitest run --reporter=dot 2>&1 | tail -6
```

**Step 10: Commit**
```bash
cd /Users/giladkoch/dev/intent-ai && git add src/web/ui/src/components/FeedStream.tsx src/web/ui/src/components/FeedStream.css src/web/ui/src/components/feed-stream-utils.ts src/web/ui/src/components/LensChatMain.tsx src/web/ui/src/components/LensChatView.tsx tests/web/feed-stream.test.ts && git commit -m "$(cat <<'EOF'
feat(feed): FeedStream — editorial org overview, press-and-unfold, avatars

Now-edge shimmer, edition label (Quire · No. N), lede word-by-word,
TRENDING rule with ember dot, story cards with heat ticks. Press commits
card + draws colored stem + materializes unfold section (stagger u1-u7)
+ ends with wait-dots ask turn. LensChatMain swaps arrival for FeedStream
when focusedLens is null. Story press triggers feature lens selection
(seeded opening). Avatars: initials disc + deterministic color; agent
mark (rounded-square + circuit badge). 2 new tests.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CT7KvNTVAGKSLmyGKVvVpM
EOF
)"
```

---

## Task 8: Feature lens — seeded opening turn + inline approvals

**Goal:** When a feature is selected (either via press-and-unfold or direct feature list click), `LensChatMain` fetches the seeded opening from `/api/lens/opening/:featureId` and renders it as the brain's first turn (before any user message). The opening carries: top-level understanding, recent insights, inline approval cards. The chat then continues normally. For the feature lens the rail shows the feature list expanded; the now-edge / seam line renders at the top of the chat area (matching `mockups/feed/03-feature-page.html`).

**Files:**
- Modify: `src/web/ui/src/components/LensChatMain.tsx`
- Modify: `src/web/ui/src/components/LensChatMain.css` (add seam styles if not in app-ink.css already)

**Step 1: Write the test**

Add to `tests/web/lens-opening-composer.test.ts`:

```typescript
describe("buildLensOpeningTurn — voice rule", () => {
  it("does not contain banned words", () => {
    const banned = ["river", "sitting", "ink", "correspondence", "edition", "sittings"];
    const turn = buildLensOpeningTurn({
      featureName: "Test",
      understanding: "Some understanding text with the word river and sitting in it.",
      recentInsights: [],
      pendingCount: 0,
    });
    // The turn is plain-voice assembly; the understanding may contain banned words
    // since it comes from raw DB data — the UI is responsible for NOT rendering
    // generated copy that violates voice rules. Only the PROMPT-generated opening
    // (from Sonnet polish) must be clean. So this test verifies that the function
    // itself doesn't add banned words.
    const addedContent = turn.replace("Some understanding text with the word river and sitting in it.", "");
    for (const word of banned) {
      expect(addedContent.toLowerCase()).not.toContain(word);
    }
  });
});
```

**Step 2: Update `LensChatMain.tsx`**

Add state: `openingTurn: string | null`, `openingLoading: boolean`. `useEffect` on `selectedFeatureId`: if non-null, call `fetchLensOpening(selectedFeatureId)` and set `openingTurn`. The seeded turn renders as the FIRST brain turn in the conversation (before `messages` state). Seam line (`<div className="feed-seam" />`) renders between the opening (editorial page) and the start of the conversational chat. Inline approval cards follow the seam, same as the existing logic.

Loading state: skeleton placeholder (2 lines of pulsing `.lc-ink-12` bars, same width as text) while `openingLoading` is true.

**Step 3: Typecheck**
```bash
cd /Users/giladkoch/dev/intent-ai && npm run typecheck:ui 2>&1
```

**Step 4: Commit**
```bash
cd /Users/giladkoch/dev/intent-ai && git add src/web/ui/src/components/LensChatMain.tsx tests/web/lens-opening-composer.test.ts && git commit -m "$(cat <<'EOF'
feat(feed): feature lens seeded opening — fetches /api/lens/opening on select

LensChatMain fetches the seeded opening turn when a feature is selected.
Renders: opening turn (understanding + insights) → seam line → inline
approval cards → existing chat. Loading state shows skeleton bars.
Voice-rule test added: function-added content must be banner-word free.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CT7KvNTVAGKSLmyGKVvVpM
EOF
)"
```

---

## Task 9: Notification UI — bell + while-you-were-away card

**Goal:** Add the `NotifButton` component (bell icon, vermilion badge, fixed top-right) to `LensChatView`. Pressing the bell injects a `notif-card` at the TOP of the FeedStream (using the `notifslide` animation). The card has the "WHILE YOU WERE AWAY · N HOURS" cobalt header, plain-voice body, dismiss button, and expand button (unfolds inline). `localStorage` tracks `last-seen` timestamp; passes to `/api/notifications?lastSeen=<ts>` on next visit.

**Files:**
- Create: `src/web/ui/src/components/NotifButton.tsx`
- Modify: `src/web/ui/src/components/FeedStream.tsx` (accept `notifications` prop, render at top)
- Modify: `src/web/ui/src/components/LensChatView.tsx` (wire NotifButton)

**Step 1: Write the test**

Create `tests/web/notif-button.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatLastSeen, getLastSeenFromStorage, setLastSeenInStorage } from "../../src/web/ui/src/components/notif-utils.js";

describe("formatLastSeen", () => {
  it("formats hours ago correctly for < 24h", () => {
    const fourHoursAgo = new Date(Date.now() - 4 * 3_600_000).toISOString();
    expect(formatLastSeen(fourHoursAgo)).toContain("4 hours");
  });
  it("formats yesterday correctly", () => {
    const yesterday = new Date(Date.now() - 25 * 3_600_000).toISOString();
    expect(formatLastSeen(yesterday)).toContain("yesterday");
  });
});

describe("localStorage helpers", () => {
  it("roundtrips last-seen timestamp", () => {
    const ts = new Date().toISOString();
    setLastSeenInStorage(ts);
    expect(getLastSeenFromStorage()).toBe(ts);
  });
});
```

**Step 2: Create `src/web/ui/src/components/notif-utils.ts`**

Pure: `formatLastSeen(iso)` → "4 hours ago" / "yesterday" / locale. `getLastSeenFromStorage()` → reads `localStorage["quire-last-seen"]`, returns null if not set. `setLastSeenInStorage(iso)` → writes to `localStorage`.

**Step 3: Run test — expect PASS** (vitest provides localStorage mock)
```bash
cd /Users/giladkoch/dev/intent-ai && npx vitest run tests/web/notif-button.test.ts 2>&1 | tail -8
```
Note: if vitest environment is `node`, add `@vitest/environment-jsdom` or use `vi.stubGlobal("localStorage", ...)` in the test setup.

**Step 4: Create `NotifButton.tsx`**

Renders the fixed-position `.notif-btn` (bell icon + meta line with repo/branch info, vermilion badge when `unreadCount > 0`). On click: calls `onOpen()`. Uses `notif-utils` for last-seen management. On mount: updates localStorage `last-seen` to now.

**Step 5: Update `FeedStream.tsx`** — accept `notifCard: NotifCardData | null` prop; if non-null, render `.notif-card` before the now-edge.

**Step 6: Wire in `LensChatView.tsx`** — render `<NotifButton>`, handle `onOpen` by constructing `NotifCardData` from fetched notifications and passing to FeedStream.

**Step 7: Full check + commit**
```bash
cd /Users/giladkoch/dev/intent-ai && npm run typecheck:ui 2>&1 && npx vitest run --reporter=dot 2>&1 | tail -6
```
```bash
cd /Users/giladkoch/dev/intent-ai && git add src/web/ui/src/components/NotifButton.tsx src/web/ui/src/components/notif-utils.ts src/web/ui/src/components/FeedStream.tsx src/web/ui/src/components/LensChatView.tsx tests/web/notif-button.test.ts && git commit -m "$(cat <<'EOF'
feat(feed): notification bell + while-you-were-away card

Fixed bell (top-right, notif-btn class) with vermilion badgepop badge.
Press injects notif-card at stream top (notifslide animation) with
WHILE YOU WERE AWAY · N HOURS header, plain-voice body, dismiss/expand.
localStorage last-seen tracks gap between visits. notif-utils pure
helpers tested (formatLastSeen, roundtrip). 3 new tests.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CT7KvNTVAGKSLmyGKVvVpM
EOF
)"
```

---

## Task 10: Quire copy rename (user-facing strings only)

**Goal:** Replace all user-visible "brain" / "Brain" strings with "Quire" across the UI. Internal identifiers (`brain_*` tools, `brainCards` table, `lc-turn-brain` CSS class, `lc-brainline`, variable names) are NOT changed.

**Scope of changes (exact file locations from grep):**
- `src/web/ui/src/App.tsx:190` — `"Brain"` → `"Quire"`
- `src/web/ui/src/components/LensChatMain.tsx` — speaker label `"brain · just now"` → `"Quire · just now"`, error message `"The Brain lost the thread"` → `"Quire lost the thread"`, ask-bar placeholder `"Ask the brain anything"` → `"Ask Quire anything"`.
- `src/web/ui/src/components/LensRail.tsx` — wordmark `brain.` → `Quire.`
- `src/web/ui/src/components/ReviewQueue.tsx:119` — `"what the Brain wants to learn"` → `"what Quire wants to learn"`. Line 132: `"The Brain is current"` → `"Quire is current"`.
- `src/web/ui/src/components/ProvenancePanel.tsx:291` — `"the brain noticed"` → `"Quire noticed"`.
- `src/web/ui/src/components/JournalPage.tsx:85` — `"agents consulted the Brain"` → `"agents consulted Quire"`. Line 98: `"the Brain noticed"` → `"Quire noticed"`. Line 544: `"the Brain enabled"` → `"Quire enabled"`.
- `src/web/ui/src/components/ChatDock.tsx:77,80,176` — `"The Brain couldn't answer"` → `"Quire couldn't answer"`, `"Ask the Brain anything"` → `"Ask Quire anything"`.
- `src/web/ui/src/components/FeaturesPage.tsx:71,110` — `"what the Brain holds"` → `"what Quire holds"`, `"the Brain understands"` → `"Quire understands"`.
- `src/web/ui/src/components/FeatureDetail.tsx:197` — `brain.enter(file)` is an MCP tool identifier — DO NOT change.
- `src/web/ui/src/components/FeedStream.tsx` — any "brain" speaker labels in new code → "Quire".
- `src/web/ui/src/components/NotifButton.tsx` — any "brain" copy → "Quire".
- `src/web/server.ts` — LLM system prompts that say "You are the Brain" → "You are Quire" (user-facing chat replies), but `OBSERVATION_CATEGORY_PREFIX` and internal log strings stay.

**Files:** All listed above.

**Step 1: Write the test**

Create `tests/web/quire-copy.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const UI_COMPONENTS = [
  "src/web/ui/src/App.tsx",
  "src/web/ui/src/components/LensChatMain.tsx",
  "src/web/ui/src/components/LensRail.tsx",
  "src/web/ui/src/components/ReviewQueue.tsx",
  "src/web/ui/src/components/JournalPage.tsx",
  "src/web/ui/src/components/ChatDock.tsx",
  "src/web/ui/src/components/FeaturesPage.tsx",
  "src/web/ui/src/components/FeedStream.tsx",
];

// User-facing "brain"/"Brain" patterns that must have been replaced.
// Excludes CSS class names, variable names, MCP tool identifiers, comments.
const FORBIDDEN = /(?<![a-z_-])brain(?![_-])(?!'s)|The Brain/gi;

describe("Quire copy rename", () => {
  for (const file of UI_COMPONENTS) {
    it(`${file} has no user-facing 'brain'/'Brain'`, () => {
      let content: string;
      try {
        content = readFileSync(join(process.cwd(), file), "utf-8");
      } catch {
        // File may not exist yet (FeedStream created later in the plan); skip.
        return;
      }
      // Strip JSX class names and variable names before checking
      const stripped = content
        .replace(/className[^"]*"[^"]*brain[^"]*"/g, "") // className="... brain ..."
        .replace(/\/\/[^\n]*/g, "")                      // line comments
        .replace(/lc-turn-brain|lc-brainline|brain_|brainCards|brainVersions/g, "");
      const matches = stripped.match(FORBIDDEN);
      expect(matches, `Found user-facing brain references: ${matches?.join(", ")}`).toBeNull();
    });
  }
});
```

**Step 2: Run test — expect FAIL** (renames not done yet)
```bash
cd /Users/giladkoch/dev/intent-ai && npx vitest run tests/web/quire-copy.test.ts 2>&1 | tail -12
```

**Step 3: Apply all renames** — edit each file per the scope list above. Use Edit tool per file; verify each change is only user-facing copy, not identifiers.

**Step 4: Run test — expect PASS**
```bash
cd /Users/giladkoch/dev/intent-ai && npx vitest run tests/web/quire-copy.test.ts 2>&1 | tail -8
```

**Step 5: Full test run + typecheck**
```bash
cd /Users/giladkoch/dev/intent-ai && npm run typecheck:ui 2>&1 && npx tsc --noEmit 2>&1 | grep "error TS" | wc -l && npx vitest run --reporter=dot 2>&1 | tail -6
```
Expected: UI clean; ≤9 server errors; ≥667 tests pass (+ new ones).

**Step 6: Commit**
```bash
cd /Users/giladkoch/dev/intent-ai && git add src/web/ui/src/ src/web/server.ts tests/web/quire-copy.test.ts && git commit -m "$(cat <<'EOF'
feat(feed): rename user-facing 'brain'/'Brain' → 'Quire' across UI + chat

Renames speaker labels, error messages, placeholders, kicker copy, empty
states. Internal identifiers unchanged: brain_* MCP tools, lc-turn-brain
CSS, brainCards table, variable names. Enforced by quire-copy.test.ts
which strips class/variable names before scanning for forbidden strings.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CT7KvNTVAGKSLmyGKVvVpM
EOF
)"
```

---

## Task 11: UI build + baseline verification

**Goal:** Rebuild the Vite bundle. Verify all tests pass and no new TypeScript errors are introduced.

**Files:** `src/web/public/` (build output)

**Step 1: Run vitest**
```bash
cd /Users/giladkoch/dev/intent-ai && npx vitest run --reporter=dot 2>&1 | tail -8
```
Expected: ≥667 tests passing (667 baseline + new tests from Tasks 1–10).

**Step 2: Run typechecks**
```bash
cd /Users/giladkoch/dev/intent-ai && npm run typecheck:ui 2>&1 && npx tsc --noEmit 2>&1 | grep "error TS" | wc -l
```
Expected: UI clean; server exactly 9 errors (pre-existing).

**Step 3: Build UI bundle**
```bash
cd /Users/giladkoch/dev/intent-ai/src/web/ui && npm run build 2>&1 | tail -20
```
Expected: build completes; output in `src/web/public/`.

**Step 4: Commit build**
```bash
cd /Users/giladkoch/dev/intent-ai && git add src/web/public && git commit -m "$(cat <<'EOF'
build(feed): rebuild UI bundle — feed surface, Quire copy, notifications

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CT7KvNTVAGKSLmyGKVvVpM
EOF
)"
```

---

## Task 12: Playwright verification

**Goal:** Screenshot each beat from `mockups/feed/` to confirm the implementation matches. Three target states: feed arrival (01), press-and-unfold mid-flight (02), feature page with seeded opening (03). Also: notification card open (01-notif-open), Quire copy visible in speaker labels.

**Files:**
- Create: `mockups/feed/shots/` (captures)
- Create: `.superpowers/sdd/playwright-feed.mjs`

**Step 1: Create the Playwright script**

Create `.superpowers/sdd/playwright-feed.mjs`:

```javascript
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const PORT = 3466;
const BASE = `http://localhost:${PORT}`;
const OUT = "mockups/feed/shots";

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

// 01 — Feed arrival
console.log("01 — Feed arrival");
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(3500);
await page.screenshot({ path: `${OUT}/01-feed-arrival.png` });

// Verify: wordmark says "Quire", not "brain"
const wordmark = await page.textContent(".lc-wordmark, .wordmark");
console.log("  wordmark:", wordmark?.trim());

// 01-notif-open — press the bell
const bell = page.locator(".notif-btn");
if (await bell.count() > 0) {
  await bell.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/01-notif-open.png` });
  console.log("  saved 01-notif-open.png");
  // Dismiss
  const dismiss = page.locator(".notif-card .dismiss").first();
  if (await dismiss.count() > 0) await dismiss.click();
  await page.waitForTimeout(400);
}

// 02 — Press the first story card (press-and-unfold)
console.log("02 — Press-and-unfold");
const firstStory = page.locator(".feed-story").first();
if (await firstStory.count() > 0) {
  await firstStory.click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/02-press-and-unfold.png` });
  console.log("  saved 02-press-and-unfold.png");
}

// 03 — Feature lens → feature page
console.log("03 — Feature page");
await page.click(".lc-lens--feature");
await page.waitForTimeout(600);
const firstFeature = page.locator(".lc-flist-item").first();
if (await firstFeature.count() > 0) {
  await firstFeature.click();
  await page.waitForTimeout(2000); // seeded opening fetch
  await page.screenshot({ path: `${OUT}/03-feature-page.png` });
  console.log("  saved 03-feature-page.png");
}

// Verify: speaker label says "Quire", not "brain"
const speaker = await page.textContent(".lc-speaker");
console.log("  speaker label:", speaker?.trim());
if (speaker?.toLowerCase().includes("brain")) {
  console.error("  FAIL: speaker still says 'brain' — rename not applied");
  process.exitCode = 1;
}

await browser.close();
console.log(`\nAll shots saved to ${OUT}/`);
```

**Step 2: Start the server**
```bash
cd /Users/giladkoch/dev/intent-ai && npx tsx src/cli/index.ts web --port 3466 &
sleep 5
```

**Step 3: Run**
```bash
cd /Users/giladkoch/dev/intent-ai && node .superpowers/sdd/playwright-feed.mjs 2>&1
```
Expected: 4+ screenshots saved, no FAIL lines, `process.exitCode` = 0.

**Step 4: Kill server**
```bash
pkill -f "src/cli/index.ts web" 2>/dev/null; true
```

**Step 5: Commit screenshots**
```bash
cd /Users/giladkoch/dev/intent-ai && git add mockups/feed/shots/ .superpowers/sdd/playwright-feed.mjs && git commit -m "$(cat <<'EOF'
test(feed): Playwright verification — feed arrival, press-unfold, feature page, notif

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CT7KvNTVAGKSLmyGKVvVpM
EOF
)"
```

---

## Task 13: Push to remote

**Step 1:**
```bash
cd /Users/giladkoch/dev/intent-ai && git pull --rebase --autostash origin feat/repo-brain && git push origin feat/repo-brain
```
Expected: clean push.

---

## Constraints summary (executing agent must enforce these)

1. **Frozen modules:** `src/pipeline/`, `src/agents/`, `src/mcp/` — no changes.
2. **LLM calls:** only via `src/llm/client.ts` `callSonnet`. Never instantiate Anthropic SDK directly in new code.
3. **Voice rule in every Sonnet prompt:** include the "say it out loud" test + banned-word list: river, sitting, ink, correspondence, edition, sittings. Use Zod schema constraints (maxLength) over prompt wording for enforcement.
4. **Composer output is presentation cache:** `feed_cache` table is NOT a fact table. A comment in both the schema and the composer must say so.
5. **No new tsc errors:** check `npx tsc --noEmit | grep "error TS" | wc -l` before each commit; must remain ≤9.
6. **No new typecheck:ui errors:** run `npm run typecheck:ui` before each commit.
7. **Mockup fidelity:** exact CSS values from `mockups/feed/*.html` — do NOT redesign. When a value is ambiguous, copy verbatim from the HTML.
8. **`prefers-reduced-motion`:** all looping animations must freeze; entrances may become instant. The CSS block in Task 1 covers this.
9. **Internal identifiers stay:** `brain_*` MCP tools, `lc-turn-brain` CSS class, `brainCards` DB table — never rename these.
10. **Fail-safe on every new endpoint:** DB/LLM errors must return a valid empty-state response, never 500.
11. **Per-task commits:** each task ends with a commit before moving to the next.

---

## Notes for the executing agent

- **Read the mockups before writing any CSS.** `mockups/feed/01-the-feed.html`, `02-press-and-unfold.html`, `03-feature-page.html` are the pixel source of truth.
- **The press-and-unfold mechanic** is the riskiest UI task (Task 7). Study `02-press-and-unfold.html` carefully — especially the stem/line drawing and the `u1`–`u7` stagger classes with `animation-fill-mode:both`. The key is that each unfold section is appended in-stream, not navigated to.
- **Feed composer LLM calls:** budget is ≤3 Sonnet calls per refresh. 1 for org lede + up to 2 for the top 2 trending stories (not all 5 — the bottom 3 get deterministic dek text from moment summaries only).
- **The seeded opening** (Task 4/8) uses `buildLensOpeningTurn` for deterministic assembly; Sonnet polish is ONLY triggered when `sessionCount >= 3` to avoid burning tokens on sparse features.
- **Schema migration:** run `npx drizzle-kit push` or apply `0004_feed_cache.sql` manually before testing endpoints that write to `feed_cache`.
- **Import path discipline:** `lens-chat-utils.ts` and new server modules live in `src/web/`. UI components must NOT import from `src/web/` directly. Copy pure logic inline (as done in `LensChatMain.tsx` for `buildLensScopeContext`) or create a `src/web/ui/src/components/` sibling utility file.
