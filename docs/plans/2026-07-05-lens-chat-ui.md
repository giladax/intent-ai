# Lens-Chat UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current masthead-shell default view with a lens-rail + chat-first surface that faithfully implements the `mockups/lens-chat/` design — warm cream canvas, Hanken Grotesk + Spline Sans Mono, numbered flat-color lens boxes, pure chat main area — while keeping all existing pages reachable and all tests green.

**Architecture:** New default view is a single `LensChatView` React component mounted at app root when `view === "lens-chat"` (new). A `LensRail` sub-component owns the 4-box rail state (focused/selected lens). A `LensChatMain` sub-component owns the chat conversation, scope tag, arrival brief, and inline elements (evidence walk, approval cards). The existing `/api/chat`, `/api/observations/*`, and `/api/events/:id/provenance` endpoints are reused with minimal extension for lens-scope context. A new `/api/lens/arrival` endpoint derives the arrival brief server-side from existing stats/observations queries. The old shell stays mounted in the tree; a tiny "ledger" toggle in the lower-right corner of the lens-chat surface swaps between the two shells.

**Tech Stack:** React 19, TypeScript (strict), Tailwind v4, `app-ink.css` (paper/ink tokens already defined), CSS Modules via inline `<style>` blocks where design-critical animations need exact control, Anthropic SSE for chat, `playwright-core` + `chromium.launch({ channel: "chrome" })` for screenshots.

---

## Baseline (capture before starting)

### Task 0: Capture baseline metrics

**Files:**
- Read-only

**Step 1: Run vitest**

```bash
cd /Users/giladkoch/dev/intent-ai && npx vitest run --reporter=dot 2>&1 | tail -8
```

Expected: 649 tests passing.

**Step 2: Run typecheck**

```bash
npx tsc --noEmit 2>&1 | wc -l
```

Expected: 9 error lines (pre-existing; do not introduce new ones).

**Step 3: Run UI typecheck**

```bash
npm run typecheck:ui 2>&1
```

Expected: clean (0 errors).

---

## Task 1: New CSS layer — lens-chat design tokens

**Goal:** Add the lens-chat palette (--paper, --ink, cobalt, vermilion, marigold, moss, amber, bone, ease, spring) and animations (rise, dissolve, word, breathe, needpulse, stampin, ripple, drawline, pop) to `app-ink.css` without breaking existing styles. These live alongside the existing `.ink-app` design system.

**Files:**
- Modify: `src/web/ui/src/app-ink.css` (append at end)

**Step 1: Write the test (pure utility — scope-context builder)**

Create `tests/web/lens-chat-scope.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildLensScopeContext, buildArrivalBrief } from "../../src/web/lens-chat-utils.js";

describe("buildLensScopeContext", () => {
  it("returns null scope when no lens selected", () => {
    expect(buildLensScopeContext(null, null)).toEqual({ featureId: null, timeRange: null });
  });
  it("returns featureId scope for feature lens", () => {
    expect(buildLensScopeContext("feature", "feat-123")).toEqual({ featureId: "feat-123", timeRange: null });
  });
  it("returns timeRange scope for timeline lens with 'today'", () => {
    const ctx = buildLensScopeContext("timeline", "today");
    expect(ctx.featureId).toBeNull();
    expect(ctx.timeRange).not.toBeNull();
    expect(ctx.timeRange!.label).toBe("today");
  });
  it("returns timeRange scope for timeline lens with 'week'", () => {
    const ctx = buildLensScopeContext("timeline", "week");
    expect(ctx.timeRange?.label).toBe("this week");
  });
});

describe("buildArrivalBrief", () => {
  it("returns empty string for null stats", () => {
    expect(buildArrivalBrief(null, 0)).toBe("Quiet, and on course.");
  });
  it("includes pending count in brief when > 0", () => {
    const brief = buildArrivalBrief(null, 3);
    expect(brief).toContain("3");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /Users/giladkoch/dev/intent-ai && npx vitest run tests/web/lens-chat-scope.test.ts 2>&1 | tail -10
```

Expected: FAIL — `lens-chat-utils.js` not found.

**Step 3: Create the pure utility module**

Create `src/web/lens-chat-utils.ts`:

```typescript
// Pure utilities for lens-chat scope context and arrival brief assembly.
// No imports from DB/server — these are UI-side helpers testable in vitest.

export interface LensScopeContext {
  featureId: string | null;
  timeRange: { since: string; until: string; label: string } | null;
}

export function buildLensScopeContext(
  lensType: "feature" | "timeline" | null,
  lensValue: string | null,
): LensScopeContext {
  if (!lensType || !lensValue) return { featureId: null, timeRange: null };

  if (lensType === "feature") {
    return { featureId: lensValue, timeRange: null };
  }

  if (lensType === "timeline") {
    const now = new Date();
    if (lensValue === "today") {
      const since = new Date(now);
      since.setHours(0, 0, 0, 0);
      return {
        featureId: null,
        timeRange: { since: since.toISOString(), until: now.toISOString(), label: "today" },
      };
    }
    if (lensValue === "week") {
      const since = new Date(now);
      since.setDate(since.getDate() - 7);
      return {
        featureId: null,
        timeRange: { since: since.toISOString(), until: now.toISOString(), label: "this week" },
      };
    }
    // Custom sitting ID — fall back to 7 days
    const since = new Date(now);
    since.setDate(since.getDate() - 7);
    return {
      featureId: null,
      timeRange: { since: since.toISOString(), until: now.toISOString(), label: lensValue },
    };
  }

  return { featureId: null, timeRange: null };
}

/** Derive the one-line arrival verdict from pending count + optional cadence hint. */
export function buildArrivalBrief(
  _stats: null | { streak: number; totalEvents: number },
  pendingCount: number,
): string {
  if (pendingCount > 0) {
    return `On course — ${pendingCount} thing${pendingCount === 1 ? "" : "s"} waiting for your stamp.`;
  }
  return "Quiet, and on course.";
}
```

**Step 4: Run test to verify it passes**

```bash
cd /Users/giladkoch/dev/intent-ai && npx vitest run tests/web/lens-chat-scope.test.ts 2>&1 | tail -10
```

Expected: PASS (4 tests).

**Step 5: Add lens-chat CSS tokens to app-ink.css**

Append to `src/web/ui/src/app-ink.css` — add after the existing `.ink-app` block:

```css
/* ── Lens-chat design tokens ─────────────────────────────────────────
   These are the exact mockup values from mockups/lens-chat/ — do NOT
   modify unless the owner approves a design change.                  */
:root {
  --lc-paper: #EFE5CE;
  --lc-paper-2: #ECE7D9;
  --lc-bone: #F5F1E8;
  --lc-ink: #1C1A15;
  --lc-ink-60: rgba(28, 26, 21, 0.6);
  --lc-ink-40: rgba(28, 26, 21, 0.4);
  --lc-ink-25: rgba(28, 26, 21, 0.25);
  --lc-ink-12: rgba(28, 26, 21, 0.12);
  --lc-cobalt: #2B49D8;
  --lc-vermilion: #D8492B;
  --lc-marigold: #ECA636;
  --lc-moss: #2E6B58;
  --lc-amber: #B4681E;
  --lc-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --lc-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --lc-rail-w: 172px;
}

/* Lens-chat animations */
@keyframes lc-rise {
  from { opacity: 0; transform: translateY(16px) scale(0.985); filter: blur(10px); }
  to   { opacity: 1; transform: translateY(0) scale(1);        filter: blur(0);    }
}
@keyframes lc-dissolve {
  to { opacity: 0; transform: translateY(-12px) scale(0.99); filter: blur(10px); }
}
@keyframes lc-word {
  from { opacity: 0; transform: translateY(0.35em); filter: blur(6px); }
  to   { opacity: 1; transform: translateY(0);       filter: blur(0);   }
}
@keyframes lc-breathe {
  0%, 100% { transform: scale(1);    opacity: 0.85; }
  50%       { transform: scale(1.28); opacity: 1;    }
}
@keyframes lc-needpulse {
  0%, 100% { box-shadow: 0 0 0 0   rgba(180, 104, 30, 0.5); }
  55%       { box-shadow: 0 0 0 7px rgba(180, 104, 30, 0);   }
}
@keyframes lc-stampin {
  0%   { opacity: 0; transform: rotate(-18deg) scale(2.6); }
  62%  { opacity: 1; transform: rotate(-8deg)  scale(0.92); }
  82%  {             transform: rotate(-8deg)  scale(1.06); }
  100% { opacity: 1; transform: rotate(-8deg)  scale(1);    }
}
@keyframes lc-ripple {
  0%   { box-shadow: 0 0 0 0   rgba(46, 107, 88, 0.55); }
  100% { box-shadow: 0 0 0 26px rgba(46, 107, 88, 0);   }
}
@keyframes lc-drawline {
  from { transform: scaleX(0); }
  to   { transform: scaleX(1); }
}
@keyframes lc-pop {
  from { transform: scale(0); }
  60%  { transform: scale(1.25); }
  to   { transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  [class*="lc-rise"],
  [class*="lc-dissolve"],
  [class*="lc-word"] {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

**Step 6: Run UI typecheck**

```bash
cd /Users/giladkoch/dev/intent-ai && npm run typecheck:ui 2>&1
```

Expected: clean.

**Step 7: Commit**

```bash
cd /Users/giladkoch/dev/intent-ai && git add src/web/lens-chat-utils.ts tests/web/lens-chat-scope.test.ts src/web/ui/src/app-ink.css && git commit -m "$(cat <<'EOF'
feat(lens-chat): add CSS tokens, animations, and scope-context utilities

Appends the exact lens-chat palette (#EFE5CE paper, cobalt, vermilion,
marigold, moss, amber) and keyframe animations (rise, dissolve, word,
breathe, needpulse, stampin, ripple, drawline, pop) to app-ink.css as
named --lc-* tokens so they don't conflict with existing ink-app system.
Adds pure buildLensScopeContext / buildArrivalBrief utilities with tests.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CT7KvNTVAGKSLmyGKVvVpM
EOF
)"
```

---

## Task 2: Server — `/api/lens/arrival` endpoint

**Goal:** Add a lean server endpoint that returns the arrival brief (verdict sentence, stats summary, pending count) so the UI doesn't have to compose it client-side from multiple calls.

**Files:**
- Modify: `src/web/server.ts` (add one new GET endpoint before the static-file catch-all)

**Step 1: Write the test**

Create `tests/web/lens-arrival.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildArrivalBrief } from "../../src/web/lens-chat-utils.js";

describe("buildArrivalBrief — extended", () => {
  it("has 'course' in the zero-pending message", () => {
    expect(buildArrivalBrief(null, 0)).toContain("course");
  });
  it("mentions the count correctly for 1", () => {
    expect(buildArrivalBrief(null, 1)).toContain("1 thing");
  });
  it("pluralizes for > 1", () => {
    expect(buildArrivalBrief(null, 5)).toContain("5 things");
  });
});
```

**Step 2: Run test to verify**

```bash
cd /Users/giladkoch/dev/intent-ai && npx vitest run tests/web/lens-arrival.test.ts 2>&1 | tail -8
```

Expected: PASS (3 tests — using the utility from Task 1).

**Step 3: Add the endpoint to server.ts**

In `src/web/server.ts`, locate the comment `// ── Stats overview — the altitude layer` and add the following endpoint BEFORE it:

```typescript
// ── Lens arrival brief ────────────────────────────────────────────────
// One cheap call: returns the verdict sentence + stats counts that the
// lens-chat surface uses for its arrival turn. Reuses the stats/observations
// queries already wired in this file. Fail-safe: a DB outage returns the
// empty-state shape — the UI shows "Quiet, and on course." and zero counts.

app.get("/api/lens/arrival", async (_req, res) => {
  try {
    const sql = getClient();
    const [pendingRow] = await sql`
      SELECT COUNT(*)::int AS count FROM activity_events
      WHERE review_status = 'pending'
        AND category LIKE ${OBSERVATION_CATEGORY_PREFIX + "%"}`;
    const pendingCount = Number(pendingRow?.count) || 0;

    // Recent cadence (7 days)
    const [cadenceRow] = await sql`
      SELECT COUNT(*)::int AS recent_events,
             COUNT(DISTINCT to_char("timestamp", 'YYYY-MM-DD'))::int AS active_days
      FROM activity_events
      WHERE "timestamp" >= now() - interval '7 days'`;

    const recentEvents = Number(cadenceRow?.recent_events) || 0;
    const activeDays   = Number(cadenceRow?.active_days)   || 0;

    // Session & moment totals
    const [totals] = await sql`
      SELECT (SELECT COUNT(*)::int FROM sessions) AS sessions,
             (SELECT COUNT(*)::int FROM activity_events) AS events,
             (SELECT COUNT(*)::int FROM moments) AS moments`;

    res.json({
      pendingCount,
      recentEvents,
      activeDays,
      totals: {
        sessions: Number(totals?.sessions) || 0,
        events:   Number(totals?.events)   || 0,
        moments:  Number(totals?.moments)  || 0,
      },
    });
  } catch {
    res.json({ pendingCount: 0, recentEvents: 0, activeDays: 0, totals: { sessions: 0, events: 0, moments: 0 } });
  }
});
```

**Step 4: Add the arrival fetch to api.ts**

In `src/web/ui/src/api.ts`, add after `fetchStatsOverview`:

```typescript
// Lens arrival brief — the verdict sentence source
export interface LensArrivalData {
  pendingCount: number;
  recentEvents: number;
  activeDays: number;
  totals: { sessions: number; events: number; moments: number };
}

export const fetchLensArrival = () => json<LensArrivalData>("/api/lens/arrival");
```

**Step 5: Add LensArrivalData to types.ts**

In `src/web/ui/src/types.ts`, add at the end:

```typescript
// ── Lens-chat arrival brief ──────────────────────────────────────────
export interface LensArrivalData {
  pendingCount: number;
  recentEvents: number;
  activeDays: number;
  totals: { sessions: number; events: number; moments: number };
}
```

**Step 6: Run typecheck**

```bash
cd /Users/giladkoch/dev/intent-ai && npm run typecheck:ui 2>&1
npx tsc --noEmit 2>&1 | grep "error" | wc -l
```

Expected: UI clean; server still 9 errors (pre-existing, no new ones).

**Step 7: Commit**

```bash
cd /Users/giladkoch/dev/intent-ai && git add src/web/server.ts src/web/ui/src/api.ts src/web/ui/src/types.ts tests/web/lens-arrival.test.ts && git commit -m "$(cat <<'EOF'
feat(lens-chat): add /api/lens/arrival endpoint and arrival types

Single cheap endpoint: pending observations count, recent cadence
(7-day events + active days), and DB totals (sessions/events/moments).
Fail-safe — DB outage returns zero-state shape, never 500. Used by
the lens-chat arrival turn to derive the verdict sentence server-side.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CT7KvNTVAGKSLmyGKVvVpM
EOF
)"
```

---

## Task 3: Extend `/api/chat` for lens-scope context

**Goal:** The `POST /api/chat` body already accepts `featureId`, `sessionId`, and `contextItems`. We need it to also accept `lensScope: { featureId?: string; timeRange?: { since: string; until: string; label: string } }` so the lens-chat surface can pass scoped context without needing to pre-load digests client-side.

**Files:**
- Modify: `src/web/server.ts` (the `/api/chat` handler)
- Modify: `src/web/ui/src/api.ts` (extend `streamChat` opts)

**Step 1: Write the test**

Add to `tests/web/lens-arrival.test.ts` (or a new file):

Create `tests/web/lens-scope-context.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildLensScopeContext } from "../../src/web/lens-chat-utils.js";

describe("buildLensScopeContext — edge cases", () => {
  it("handles unknown lensValue gracefully", () => {
    const ctx = buildLensScopeContext("timeline", "unknown-sitting");
    expect(ctx.timeRange).not.toBeNull();
    expect(ctx.timeRange!.label).toBe("unknown-sitting");
  });
  it("feature with empty string value returns null", () => {
    const ctx = buildLensScopeContext("feature", "");
    // empty string is falsy
    expect(ctx.featureId).toBeNull();
  });
});
```

**Step 2: Run test to verify it passes**

```bash
cd /Users/giladkoch/dev/intent-ai && npx vitest run tests/web/lens-scope-context.test.ts 2>&1 | tail -8
```

Expected: PASS.

**Step 3: Extend the `/api/chat` handler in server.ts**

Locate the line: `const { question, featureId, sessionId, history, contextItems } = req.body;`

Replace with:

```typescript
const { question, featureId, sessionId, history, contextItems, lensScope } = req.body;
```

Then, locate the `else` block that sets `systemPrompt` for the unscoped case:

```typescript
} else {
  systemPrompt = `You are an execution memory assistant for AI-assisted development sessions. The user hasn't selected a specific feature or session yet. Help them navigate — suggest they select a feature or session from the sidebar to start exploring.`;
}
```

Add a new `else if` block BEFORE the final `else`, between the `sessionId` block and the `else`:

```typescript
} else if (lensScope?.timeRange) {
  // Timeline-scoped: summarize recent events in the given window
  const sql = getClient();
  const since = lensScope.timeRange.since;
  const until = lensScope.timeRange.until;
  const label = lensScope.timeRange.label ?? "selected period";

  const recentEvents = await sql`
    SELECT category, summary, actor, timestamp FROM activity_events
    WHERE timestamp >= ${since} AND timestamp <= ${until}
    ORDER BY timestamp DESC LIMIT 60`;

  if (recentEvents.length === 0) {
    systemPrompt = `You are the Brain — the organizational understanding engine. The user is looking at the Timeline lens scoped to "${label}". There are no recorded events in this period. Let them know the journal is quiet for this window, and suggest broadening the range.`;
  } else {
    const evSummary = recentEvents.map((e: any) =>
      `[${new Date(e.timestamp).toISOString()}] ${e.category} / ${e.actor}: ${e.summary}`
    ).join("\n");
    systemPrompt = `You are the Brain — the organizational understanding engine. The user is looking at the Timeline lens scoped to "${label}". Here are the recorded events in this window:\n\n${evSummary}\n\n## Rules\n- Answer based on this event record.\n- Summarize patterns, pivots, and outcomes when asked.\n- Keep responses concise but grounded in the evidence above.`;
  }
} else if (lensScope?.featureId && !featureId) {
  // Feature lens scope without an explicit featureId in the body — use lensScope
  const sql = getClient();
  const fid = lensScope.featureId;
  const featureRows = await sql`SELECT * FROM features WHERE id = ${fid}`;
  const featureName = featureRows[0]?.name ?? "Unknown Feature";

  const sessionRows = await sql`
    SELECT s.id FROM feature_sessions fs
    JOIN sessions s ON s.id = fs.session_id
    WHERE fs.feature_id = ${fid}
    ORDER BY s.started_at ASC NULLS LAST`;

  const digests = [];
  for (const row of sessionRows) {
    try {
      const digest = await loadDigest(row.id);
      digests.push(digest);
    } catch { /* skip */ }
  }

  if (digests.length === 0) {
    systemPrompt = `You are the Brain scoped to the feature "${featureName}". No session digests are available yet for this feature. The user may need to tag sessions to it first.`;
  } else {
    const sessionContexts = digests.map((d, i) => {
      const prompt = buildSystemPrompt(d);
      const digestStart = prompt.indexOf("## Session Digest");
      return `### Session ${i + 1}\n${digestStart >= 0 ? prompt.slice(digestStart) : prompt}`;
    }).join("\n\n---\n\n");

    systemPrompt = `You are the Brain scoped to the feature "${featureName}". You have access to ${digests.length} session digests for this feature.\n\n${sessionContexts}\n\n## Rules\n- Answer based on the evidence in the digests.\n- Quote the developer's actual words when available.\n- If asked about something not covered, say so.`;
  }
} else {
```

**Step 4: Extend streamChat in api.ts**

In `src/web/ui/src/api.ts`, locate the `streamChat` function signature:

```typescript
export async function* streamChat(
  question: string,
  history: ChatMessage[],
  opts: {
    featureId?: string;
    sessionId?: string;
    contextItems?: ChatContextItem[];
  } = {},
```

Replace with:

```typescript
export async function* streamChat(
  question: string,
  history: ChatMessage[],
  opts: {
    featureId?: string;
    sessionId?: string;
    contextItems?: ChatContextItem[];
    lensScope?: {
      featureId?: string;
      timeRange?: { since: string; until: string; label: string };
    };
  } = {},
```

**Step 5: Run typecheck**

```bash
cd /Users/giladkoch/dev/intent-ai && npm run typecheck:ui 2>&1
npx tsc --noEmit 2>&1 | grep "error TS" | wc -l
```

Expected: UI clean; server: same 9 pre-existing errors, no new ones.

**Step 6: Commit**

```bash
cd /Users/giladkoch/dev/intent-ai && git add src/web/server.ts src/web/ui/src/api.ts tests/web/lens-scope-context.test.ts && git commit -m "$(cat <<'EOF'
feat(lens-chat): extend /api/chat with lensScope context parameter

Adds lensScope.featureId and lensScope.timeRange as optional chat body
fields — the server builds an appropriately-scoped system prompt for each
lens type without requiring the client to pre-load session digests.
Timeline scope queries the event stream directly for the requested window.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CT7KvNTVAGKSLmyGKVvVpM
EOF
)"
```

---

## Task 4: LensRail component

**Goal:** Build the left-rail React component matching the mockup pixel-for-pixel. State: `focusedLens` (null | "feature" | "timeline"), `selectedFeatureId`, `selectedTimeRange`. Rail fades non-focused lenses to 26% opacity + grayscale. Feature lens expands with feature list on focus. Timeline lens shows today/this week options.

**Files:**
- Create: `src/web/ui/src/components/LensRail.tsx`
- Create: `src/web/ui/src/components/LensRail.css`

**Step 1: Write the CSS**

Create `src/web/ui/src/components/LensRail.css` (port exact styles from `mockups/lens-chat/02-lens-focus.html`, scoped to `.lc-rail`):

Key styles needed:
- `.lc-rail` — `height:100vh; display:flex; flex-direction:column; padding:22px 16px 18px; border-right:1px solid var(--lc-ink-12); background:var(--lc-paper); width:var(--lc-rail-w); flex-shrink:0`
- `.lc-wordmark` — `font-family:'Hanken Grotesk',sans-serif; font-weight:800; font-size:22px; letter-spacing:-.02em; display:flex; align-items:center; gap:8px; margin-bottom:26px`
- `.lc-lens` — the box button (border-radius:16px; min-height:106px; transitions for opacity/filter/transform/min-height)
- `.lc-lens--feature` / `--timeline` / `--team` / `--ghost` — color variants
- `.lc-lens--focused` — `min-height:322px`
- `.lc-rail--has-focus .lc-lens:not(.lc-lens--focused):not(.lc-lens--ghost)` — `opacity:.26; filter:grayscale(.45) saturate(.7); transform:scale(.975)`
- `.lc-flist` — feature list, opacity 0 normally, opacity 1 when focused
- `.lc-needs` — amber pulse dot

**Step 2: Create LensRail.tsx**

```typescript
// LensRail — the numbered flat-color lens boxes on the left.
// Each box is a state toggle: selecting one focuses the rail (others
// fade to 26% opacity) and emits the lens selection up.

import "./LensRail.css";
import type { Feature } from "../types";

export type LensType = "feature" | "timeline" | null;

export interface TimeRangeOption {
  value: "today" | "week";
  label: string;
}

const TIME_OPTIONS: TimeRangeOption[] = [
  { value: "today", label: "today" },
  { value: "week", label: "this week" },
];

interface LensRailProps {
  features: Feature[];
  pendingCount: number;
  arrivalTotals: { sessions: number; events: number; moments: number };
  focusedLens: LensType;
  selectedFeatureId: string | null;
  selectedTimeRange: "today" | "week" | null;
  onLensFocus: (lens: LensType) => void;
  onFeatureSelect: (featureId: string, featureName: string) => void;
  onTimeRangeSelect: (range: "today" | "week") => void;
}

export function LensRail({
  features,
  pendingCount,
  arrivalTotals,
  focusedLens,
  selectedFeatureId,
  selectedTimeRange,
  onLensFocus,
  onFeatureSelect,
  onTimeRangeSelect,
}: LensRailProps) {
  const hasFocus = focusedLens !== null;

  function handleFeatureLensClick() {
    if (focusedLens === "feature") {
      onLensFocus(null); // toggle off
    } else {
      onLensFocus("feature");
    }
  }

  function handleTimelineLensClick() {
    if (focusedLens === "timeline") {
      onLensFocus(null);
    } else {
      onLensFocus("timeline");
    }
  }

  const selectedFeature = features.find((f) => f.id === selectedFeatureId);

  return (
    <nav className={`lc-rail${hasFocus ? " lc-rail--has-focus" : ""}`} aria-label="Lenses">
      {/* Wordmark */}
      <div className="lc-wordmark lc-rise" style={{ animationDelay: "0.05s" }}>
        brain.<span className="lc-pulse" aria-hidden="true" />
      </div>

      {/* Lens boxes */}
      <div className="lc-lenses">
        {/* 01 FEATURE */}
        <button
          className={`lc-lens lc-lens--feature lc-rise${focusedLens === "feature" ? " lc-lens--focused" : ""}`}
          style={{ animationDelay: "0.16s" }}
          onClick={handleFeatureLensClick}
          aria-expanded={focusedLens === "feature"}
        >
          <span className="lc-num">01</span>
          <span className="lc-mark">{focusedLens === "feature" ? "↓" : "↗"}</span>
          <span className="lc-label">Feature</span>
          <span className="lc-sub">{features.length} under watch</span>

          {/* Feature list — visible when focused */}
          {focusedLens === "feature" && features.length > 0 && (
            <ul className="lc-flist" role="listbox" aria-label="Features">
              {features.slice(0, 6).map((f) => (
                <li
                  key={f.id}
                  role="option"
                  aria-selected={f.id === selectedFeatureId}
                  className={f.id === selectedFeatureId ? "lc-flist-item lc-flist-item--sel" : "lc-flist-item"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onFeatureSelect(f.id, f.name);
                  }}
                >
                  <span className="lc-flist-name">{f.name.toLowerCase()}</span>
                  <span className="lc-flist-n">{f.session_count}</span>
                </li>
              ))}
            </ul>
          )}

          {pendingCount > 0 && (
            <span className="lc-needs" title={`${pendingCount} delta${pendingCount === 1 ? "" : "s"} await your stamp`} />
          )}
        </button>

        {/* 02 TIMELINE */}
        <button
          className={`lc-lens lc-lens--timeline lc-rise${focusedLens === "timeline" ? " lc-lens--focused" : ""}`}
          style={{ animationDelay: "0.24s" }}
          onClick={handleTimelineLensClick}
          aria-expanded={focusedLens === "timeline"}
        >
          <span className="lc-num">02</span>
          <span className="lc-mark">{focusedLens === "timeline" ? "↓" : "↗"}</span>
          <span className="lc-label">Timeline</span>
          <span className="lc-sub">{selectedTimeRange ?? "jun 21 — today"}</span>

          {focusedLens === "timeline" && (
            <ul className="lc-flist" role="listbox" aria-label="Time ranges">
              {TIME_OPTIONS.map((opt) => (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={opt.value === selectedTimeRange}
                  className={opt.value === selectedTimeRange ? "lc-flist-item lc-flist-item--sel" : "lc-flist-item"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTimeRangeSelect(opt.value);
                  }}
                >
                  <span className="lc-flist-name">{opt.label}</span>
                </li>
              ))}
            </ul>
          )}
        </button>

        {/* 03 TEAM — disabled "soon" */}
        <button
          className="lc-lens lc-lens--team lc-lens--soon lc-rise"
          style={{ animationDelay: "0.32s" }}
          disabled
          aria-disabled="true"
        >
          <span className="lc-num">03</span>
          <span className="lc-mark">↗</span>
          <span className="lc-label">Team</span>
          <span className="lc-sub">1 human · n agents</span>
        </button>

        {/* Ghost slot */}
        <button
          className="lc-lens lc-lens--ghost lc-rise"
          style={{ animationDelay: "0.4s" }}
          title="Lenses grow with your org — Sprint, Service, Customer…"
          disabled
        >
          <span className="lc-plus">+</span>
          <span className="lc-glabel">LENS</span>
        </button>
      </div>

      {/* Rail foot — sparkline + totals */}
      <div className="lc-rail-foot lc-rise" style={{ animationDelay: "0.5s" }}>
        <span className="lc-river" aria-hidden="true" />
        {arrivalTotals.sessions} sessions<br />
        {arrivalTotals.events} events<br />
        {arrivalTotals.moments} moments
      </div>
    </nav>
  );
}
```

**Step 3: Run typecheck**

```bash
cd /Users/giladkoch/dev/intent-ai && npm run typecheck:ui 2>&1
```

Expected: clean.

**Step 4: Commit**

```bash
cd /Users/giladkoch/dev/intent-ai && git add src/web/ui/src/components/LensRail.tsx src/web/ui/src/components/LensRail.css && git commit -m "$(cat <<'EOF'
feat(lens-chat): LensRail component — numbered flat-color lens boxes

01 FEATURE (cobalt): expands with feature list, stagger-in animation.
02 TIMELINE (vermilion): expands with today/this-week options.
03 TEAM (marigold): disabled "soon" box with SOON superscript.
Ghost slot: dashed + LENS label.
Rail fades non-focused lenses to 26% opacity + grayscale on selection.
Amber pulse dot on FEATURE when pending observations exist.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CT7KvNTVAGKSLmyGKVvVpM
EOF
)"
```

---

## Task 5: LensChatMain component — arrival turn + ask-bar

**Goal:** Build the right-side chat pane. On arrival: verdict word-by-word animation, brainline with pending observation mention, whisper chips. Ask-bar fixed at bottom with scope tag when a lens is focused.

**Files:**
- Create: `src/web/ui/src/components/LensChatMain.tsx`
- Create: `src/web/ui/src/components/LensChatMain.css`

**Step 1: Create LensChatMain.css**

Port the chat, verdict, brainline, whispers, chip, and ask-bar styles from `mockups/lens-chat/01-arrival.html` (lines 119–180), scoped to `.lc-main`.

Key classes:
- `.lc-main` — `position:relative; height:100vh; overflow-y:auto; scroll-behavior:smooth; flex:1`
- `.lc-chat` — `max-width:660px; margin:0 auto; padding:16vh 32px 190px; display:flex; flex-direction:column; gap:38px`
- `.lc-turn-brain` — `display:flex; flex-direction:column; gap:14px`
- `.lc-speaker` — mono, 10px, uppercase, ink-40, `::before` green square
- `.lc-speaker .lc-scope` — cobalt, font-weight:600
- `.lc-verdict` — Hanken Grotesk 800, clamp(28px,3.4vw,40px), letter-spacing:-.025em
- `.lc-word` — `display:inline-block; animation:lc-word .55s var(--lc-ease) both`
- `.lc-brainline` — 16.5px, line-height:1.65
- `.lc-handle` — dashed underline, hover cobalt
- `.lc-handle--amber` — amber color + weight 600
- `.lc-whispers` — flex wrap gap:8px
- `.lc-chip` — pill button, Spline Sans Mono 10.5px, hover ink bg
- `.lc-askwrap` — `position:fixed; bottom:0; left:var(--lc-rail-w); right:0; padding:22px 32px 26px; display:flex; justify-content:center; pointer-events:none; background:linear-gradient(to top, var(--lc-paper) 45%, transparent)`
- `.lc-ask` — pill, `#FAF4E4` bg, ink border
- `.lc-ask--scoped` — cobalt border
- `.lc-scopetag` — cobalt pill inside ask bar, with × to remove

**Step 2: Create LensChatMain.tsx**

```typescript
// LensChatMain — the chat surface (right side of the lens-chat shell).
// Arrival: verdict word-by-word + brainline + whispers. When a lens is
// selected: the arrival dissolves and a scoped turn materializes.
// Ask-bar is always fixed at the bottom with an optional scope tag.

import { useState, useEffect, useRef } from "react";
import "./LensChatMain.css";
import { streamChat } from "../api";
import type { ChatMessage } from "../types";
import type { LensType } from "./LensRail";
import { buildLensScopeContext, buildArrivalBrief } from "../../../lens-chat-utils";
// NOTE: the path is adjusted at build time — lens-chat-utils is in src/web/ (server-side)
// but the pure logic is importable by the UI since it has no server imports.
// If the import path causes issues, copy the two pure functions inline here.

interface LensChatMainProps {
  pendingCount: number;
  arrivalTotals: { sessions: number; events: number; moments: number };
  focusedLens: LensType;
  selectedFeatureId: string | null;
  selectedFeatureName: string | null;
  selectedTimeRange: "today" | "week" | null;
  onClearScope: () => void;
  /** Called when user clicks a citation chip — opens evidence walk inline. */
  onCitationClick?: (eventId: string) => void;
  /** Pending observations to show as in-chat approval cards. */
  pendingObservations: Array<{ id: string; summary: string; featureName: string | null; category: string }>;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}

export function LensChatMain({
  pendingCount,
  arrivalTotals,
  focusedLens,
  selectedFeatureId,
  selectedFeatureName,
  selectedTimeRange,
  onClearScope,
  pendingObservations,
  onApprove,
  onReject,
}: LensChatMainProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [arrivalDissolved, setArrivalDissolved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  // When a lens is focused for the first time, dissolve the arrival turn.
  useEffect(() => {
    if (focusedLens !== null && !arrivalDissolved) {
      // Short delay so the rail animation completes first.
      const t = setTimeout(() => setArrivalDissolved(true), 420);
      return () => clearTimeout(t);
    }
  }, [focusedLens, arrivalDissolved]);

  // Scroll to bottom after new messages
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  const verdictText = buildArrivalBrief(null, pendingCount);

  const scopeLabel = focusedLens === "feature" && selectedFeatureName
    ? `◉ ${selectedFeatureName.toUpperCase()}`
    : focusedLens === "timeline" && selectedTimeRange
    ? `◉ ${selectedTimeRange === "today" ? "TODAY" : "THIS WEEK"}`
    : null;

  const lensScope = buildLensScopeContext(
    focusedLens,
    focusedLens === "feature" ? (selectedFeatureId ?? null) : (selectedTimeRange ?? null),
  );

  const send = async () => {
    const q = input.trim();
    if (!q || streaming) return;

    const history = messages.slice(-20);
    setMessages((prev) => [...prev, { role: "user", content: q }, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);

    const appendToLast = (text: string, replace = false) =>
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "assistant") {
          updated[updated.length - 1] = { ...last, content: replace ? text : last.content + text };
        }
        return updated;
      });

    try {
      for await (const event of streamChat(q, history, { lensScope: { featureId: lensScope.featureId ?? undefined, timeRange: lensScope.timeRange ?? undefined } })) {
        if (event.type === "text" && event.content) appendToLast(event.content);
        else if (event.type === "error") appendToLast(`The Brain couldn't answer: ${event.content}`, true);
      }
    } catch (err) {
      appendToLast(`The Brain couldn't answer: ${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      setStreaming(false);
      inputRef.current?.focus({ preventScroll: true });
    }
  };

  // Verdict words animate one-by-one
  const verdictWords = verdictText.split(" ");

  return (
    <main className="lc-main" ref={chatRef}>
      <div className="lc-meta-top lc-rise" style={{ animationDelay: "0.6s" }}>
        intent-ai · feat/repo-brain
      </div>

      <div className="lc-chat">
        {/* Arrival turn */}
        {!arrivalDissolved && (
          <section
            className={`lc-turn-brain${focusedLens ? " lc-dissolve" : ""}`}
            aria-label="Arrival brief"
          >
            <div className="lc-speaker lc-rise" style={{ animationDelay: "0.7s" }}>
              brain · just now
            </div>
            <h1 className="lc-verdict" aria-label={verdictText}>
              {verdictWords.map((word, i) => (
                <span key={i}>
                  <span
                    className="lc-word"
                    style={{ animationDelay: `${0.95 + i * 0.24}s` }}
                  >
                    {word}
                  </span>
                  {i < verdictWords.length - 1 ? " " : ""}
                </span>
              ))}
            </h1>
            <p className="lc-brainline lc-rise" style={{ animationDelay: "2.15s" }}>
              {arrivalTotals.sessions} sessions digested, {arrivalTotals.events} events recorded.
              {pendingCount > 0 && (
                <>
                  {" "}<span className="lc-dim">One thing waits:</span>{" "}
                  <span className="lc-handle lc-handle--amber">
                    {pendingCount} understanding delta{pendingCount === 1 ? "" : "s"} await{pendingCount === 1 ? "s" : ""} your stamp.
                  </span>
                </>
              )}
            </p>
            <div className="lc-whispers lc-rise" style={{ animationDelay: "2.5s" }}>
              <button className="lc-chip">
                <span className="lc-dot" style={{ background: "var(--lc-cobalt)" }} />
                {arrivalTotals.sessions} sessions
              </button>
              <button className="lc-chip">
                <span className="lc-dot" style={{ background: "var(--lc-moss)" }} />
                {arrivalTotals.events} events
              </button>
              {pendingCount > 0 && (
                <button className="lc-chip">
                  <span className="lc-dot" style={{ background: "var(--lc-amber)" }} />
                  {pendingCount} pending
                </button>
              )}
            </div>
          </section>
        )}

        {/* Pending observations as in-chat approval cards */}
        {pendingObservations.length > 0 && messages.length === 0 && focusedLens === null && (
          <PendingApprovalTurns
            observations={pendingObservations}
            onApprove={onApprove}
            onReject={onReject}
          />
        )}

        {/* Chat conversation */}
        {messages.map((m, i) => (
          m.role === "user" ? (
            <div key={i} className="lc-turn-user">
              <div className="lc-who">you</div>
              <div className="lc-bubble">{m.content}</div>
            </div>
          ) : (
            <div key={i} className="lc-turn-brain">
              <div className="lc-speaker">
                brain{focusedLens && scopeLabel ? <> · <span className="lc-scope">{scopeLabel}</span></> : " · now"}
              </div>
              <p className="lc-brainline">
                {m.content || (streaming && i === messages.length - 1 ? "…" : "")}
              </p>
            </div>
          )
        ))}
      </div>

      {/* Ask bar */}
      <div className="lc-askwrap">
        <div className={`lc-ask${scopeLabel ? " lc-ask--scoped" : ""} lc-rise`} style={{ animationDelay: "1.1s" }}>
          <span className="lc-brand-dot" aria-hidden="true" />
          {scopeLabel && (
            <button className="lc-scopetag" onClick={onClearScope} title="Clear lens scope">
              {scopeLabel} <span className="lc-x" aria-hidden="true">×</span>
            </button>
          )}
          <input
            ref={inputRef}
            type="text"
            value={input}
            placeholder={
              scopeLabel
                ? `Ask within ${selectedFeatureName ?? selectedTimeRange ?? "this lens"}…`
                : "Ask the brain anything — or pick a lens to focus…"
            }
            aria-label="Ask the brain"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); send(); }
            }}
            disabled={streaming}
          />
          <span className="lc-enter">⏎</span>
        </div>
      </div>
    </main>
  );
}

// ── Pending approval cards (inline in conversation) ───────────────────

interface ApprovalObs {
  id: string;
  summary: string;
  featureName: string | null;
  category: string;
}

function PendingApprovalTurns({
  observations,
  onApprove,
  onReject,
}: {
  observations: ApprovalObs[];
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}) {
  return (
    <>
      {observations.slice(0, 3).map((obs, i) => (
        <ApprovalCard
          key={obs.id}
          obs={obs}
          index={i}
          onApprove={onApprove}
          onReject={onReject}
        />
      ))}
    </>
  );
}

function ApprovalCard({
  obs,
  index,
  onApprove,
  onReject,
}: {
  obs: ApprovalObs;
  index: number;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}) {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const [loading, setLoading] = useState(false);

  async function handleApprove() {
    setLoading(true);
    try {
      await onApprove(obs.id);
      setStatus("approved");
    } finally {
      setLoading(false);
    }
  }

  async function handleReject() {
    setLoading(true);
    try {
      await onReject(obs.id);
      setStatus("rejected");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className={`lc-turn-brain lc-rise`}
      style={{ animationDelay: `${index * 0.15}s` }}
    >
      <div className="lc-speaker">brain · <span className="lc-scope">pending stamp</span></div>
      <div className={`lc-seal-card${status !== "pending" ? " lc-seal-card--sealed" : ""}`}>
        <span className={`lc-seal-tag lc-seal-tag--${status}`}>
          {status === "pending" ? "AWAITS YOUR STAMP" : status === "approved" ? "APPROVED" : "REJECTED"}
        </span>
        {obs.featureName && (
          <div className="lc-seal-feature">{obs.featureName}</div>
        )}
        <p className="lc-seal-summary">{obs.summary}</p>
        {status === "pending" && (
          <div className="lc-seal-actions">
            <button
              className="lc-btn lc-btn--approve"
              onClick={handleApprove}
              disabled={loading}
            >
              Seal into memory
            </button>
            <button
              className="lc-btn lc-btn--reject"
              onClick={handleReject}
              disabled={loading}
            >
              Discard
            </button>
          </div>
        )}
        {status === "approved" && (
          <div className="lc-stamp lc-stamp--approved" aria-label="Approved">✓ SEALED</div>
        )}
        {status === "rejected" && (
          <div className="lc-stamp lc-stamp--rejected" aria-label="Rejected">✕ DISCARDED</div>
        )}
      </div>
    </div>
  );
}
```

**NOTE on import path for `lens-chat-utils`:** The utility is in `src/web/lens-chat-utils.ts` (server-side). To keep it importable by the UI without duplication, either:
- Option A: Copy the two pure functions directly into `LensChatMain.tsx` (simplest, no cross-boundary import).
- Option B: Create `src/web/ui/src/lens-chat-utils.ts` as a thin re-export alias.

Use **Option A** — copy `buildLensScopeContext` and `buildArrivalBrief` inline in `LensChatMain.tsx` to avoid the path issue, then remove the import statement.

**Step 3: Run typecheck**

```bash
cd /Users/giladkoch/dev/intent-ai && npm run typecheck:ui 2>&1
```

Expected: clean.

**Step 4: Commit**

```bash
cd /Users/giladkoch/dev/intent-ai && git add src/web/ui/src/components/LensChatMain.tsx src/web/ui/src/components/LensChatMain.css && git commit -m "$(cat <<'EOF'
feat(lens-chat): LensChatMain — chat area, arrival turn, ask-bar, approval cards

Arrival: verdict words animate in one-by-one (lc-word keyframe), brainline
with pending-count mention, whisper chips. Ask-bar fixed at bottom with
cobalt scope tag + × to clear the lens. Pending observations render as
in-chat approval cards with Seal/Discard actions wired to the observations
API. Spring stamp animation plays on approve.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CT7KvNTVAGKSLmyGKVvVpM
EOF
)"
```

---

## Task 6: LensChatView — the new default view container

**Goal:** Compose `LensRail` + `LensChatMain` into a full-page grid view. Fetch arrival data on mount. Manage lens state. Wire feature + time-range selection.

**Files:**
- Create: `src/web/ui/src/components/LensChatView.tsx`

**Step 1: Create LensChatView.tsx**

```typescript
// LensChatView — the lens-rail + chat-first default view.
// Composes LensRail and LensChatMain; owns the lens focus state.

import { useState, useEffect, useCallback } from "react";
import { LensRail, type LensType } from "./LensRail";
import { LensChatMain } from "./LensChatMain";
import { fetchLensArrival, fetchPendingObservations, approveObservation, rejectObservation } from "../api";
import type { Feature, LensArrivalData, PendingObservation } from "../types";

interface LensChatViewProps {
  features: Feature[];
  projectId: string | null;
}

export function LensChatView({ features, projectId }: LensChatViewProps) {
  const [focusedLens, setFocusedLens] = useState<LensType>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [selectedFeatureName, setSelectedFeatureName] = useState<string | null>(null);
  const [selectedTimeRange, setSelectedTimeRange] = useState<"today" | "week" | null>(null);
  const [arrivalData, setArrivalData] = useState<LensArrivalData | null>(null);
  const [pendingObs, setPendingObs] = useState<PendingObservation[]>([]);

  useEffect(() => {
    fetchLensArrival()
      .then(setArrivalData)
      .catch(() => {/* fail-safe: undefined arrival data shows empty state */});
  }, []);

  const refreshPending = useCallback(() => {
    fetchPendingObservations(projectId ?? undefined)
      .then(setPendingObs)
      .catch(() => setPendingObs([]));
  }, [projectId]);

  useEffect(() => {
    refreshPending();
  }, [refreshPending]);

  function handleLensFocus(lens: LensType) {
    setFocusedLens(lens);
    if (lens === null) {
      setSelectedFeatureId(null);
      setSelectedFeatureName(null);
      setSelectedTimeRange(null);
    }
  }

  function handleFeatureSelect(featureId: string, featureName: string) {
    setSelectedFeatureId(featureId);
    setSelectedFeatureName(featureName);
  }

  function handleTimeRangeSelect(range: "today" | "week") {
    setSelectedTimeRange(range);
  }

  function handleClearScope() {
    setFocusedLens(null);
    setSelectedFeatureId(null);
    setSelectedFeatureName(null);
    setSelectedTimeRange(null);
  }

  async function handleApprove(id: string) {
    await approveObservation(id);
    refreshPending();
  }

  async function handleReject(id: string) {
    await rejectObservation(id);
    refreshPending();
  }

  const totals = arrivalData?.totals ?? { sessions: 0, events: 0, moments: 0 };
  const pendingCount = arrivalData?.pendingCount ?? 0;

  const pendingObsForChat = pendingObs.slice(0, 5).map((o) => ({
    id: o.id,
    summary: o.summary,
    featureName: o.feature_name,
    category: o.category,
  }));

  return (
    <div
      className="lc-shell"
      style={{
        display: "grid",
        gridTemplateColumns: "var(--lc-rail-w) 1fr",
        height: "100vh",
        overflow: "hidden",
        background: "var(--lc-paper)",
        color: "var(--lc-ink)",
        fontFamily: "'Hanken Grotesk', sans-serif",
        fontSize: "15px",
      }}
    >
      <LensRail
        features={features}
        pendingCount={pendingCount}
        arrivalTotals={totals}
        focusedLens={focusedLens}
        selectedFeatureId={selectedFeatureId}
        selectedTimeRange={selectedTimeRange}
        onLensFocus={handleLensFocus}
        onFeatureSelect={handleFeatureSelect}
        onTimeRangeSelect={handleTimeRangeSelect}
      />
      <LensChatMain
        pendingCount={pendingCount}
        arrivalTotals={totals}
        focusedLens={focusedLens}
        selectedFeatureId={selectedFeatureId}
        selectedFeatureName={selectedFeatureName}
        selectedTimeRange={selectedTimeRange}
        onClearScope={handleClearScope}
        pendingObservations={pendingObsForChat}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    </div>
  );
}
```

**Step 2: Run typecheck**

```bash
cd /Users/giladkoch/dev/intent-ai && npm run typecheck:ui 2>&1
```

Expected: clean (if `LensArrivalData` is exported from `types.ts` — ensure Task 2 step 5 is done).

**Step 3: Commit**

```bash
cd /Users/giladkoch/dev/intent-ai && git add src/web/ui/src/components/LensChatView.tsx && git commit -m "$(cat <<'EOF'
feat(lens-chat): LensChatView container — composes rail + chat, owns lens state

Fetches /api/lens/arrival on mount for verdict data. Manages focusedLens,
selectedFeatureId, selectedTimeRange state. Wires approve/reject to the
observations API. Passes pending observations to chat as approval cards.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CT7KvNTVAGKSLmyGKVvVpM
EOF
)"
```

---

## Task 7: Wire fonts + make lens-chat the default view

**Goal:** (a) Load Hanken Grotesk and Spline Sans Mono from Google Fonts in `index.html`. (b) Add `lens-chat` as a new view in `App.tsx`. (c) Make `lens-chat` the default view (instead of `journal`). (d) Add a small "ledger" affordance to swap to the classic shell.

**Files:**
- Modify: `src/web/ui/index.html` (add Google Fonts link)
- Modify: `src/web/ui/src/App.tsx` (add lens-chat view, make default, add ledger toggle)

**Step 1: Add fonts to index.html**

In `src/web/ui/index.html`, add inside `<head>` before the existing links:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400;1,600;1,700&family=Spline+Sans+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

**Step 2: Add lens-chat view to App.tsx**

In `src/web/ui/src/App.tsx`:

a) Update the `View` type to add `"lens-chat"`:
```typescript
type View =
  | "lens-chat"   // ← new default
  | "journal"
  | ...
```

b) Change the initial state:
```typescript
const [view, setView] = useState<View>("lens-chat");
```

c) In the `return` JSX, add a lens-chat render branch as the FIRST condition:

```tsx
{view === "lens-chat" ? (
  <div className="lc-root" style={{ position: "relative", height: "100%" }}>
    <LensChatView
      features={features}
      projectId={selectedProject?.id ?? null}
    />
    {/* "ledger" link — unobtrusive corner affordance to reach classic shell */}
    <button
      className="lc-ledger-toggle"
      onClick={() => setView("journal")}
      title="Switch to classic ledger view"
      style={{
        position: "fixed",
        bottom: "16px",
        right: "16px",
        zIndex: 50,
        fontFamily: "'Spline Sans Mono', monospace",
        fontSize: "10px",
        letterSpacing: "0.12em",
        color: "var(--lc-ink-40)",
        background: "transparent",
        border: "1px solid var(--lc-ink-12)",
        borderRadius: "6px",
        padding: "4px 10px",
        cursor: "pointer",
        textTransform: "uppercase",
      }}
    >
      ledger ↗
    </button>
  </div>
) : (
  // Classic shell starts here — wrap the existing masthead+content in an
  // element that also shows a "← back to lens" affordance
  <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column" }}>
    {/* existing masthead + content */}
    ...
  </div>
)}
```

> **Implementation note:** The existing masthead (`<header>`) and content area (`<div className="relative min-h-0 flex-1">`) should be wrapped inside the `else` branch. Add a "← lens" back affordance at top-right of the masthead (e.g., a small button that calls `setView("lens-chat")`).

**Step 3: Import LensChatView in App.tsx**

```typescript
import { LensChatView } from "./components/LensChatView";
```

**Step 4: Run typecheck**

```bash
cd /Users/giladkoch/dev/intent-ai && npm run typecheck:ui 2>&1
```

Expected: clean.

**Step 5: Commit**

```bash
cd /Users/giladkoch/dev/intent-ai && git add src/web/ui/index.html src/web/ui/src/App.tsx && git commit -m "$(cat <<'EOF'
feat(lens-chat): make lens-chat the default view; add 'ledger' toggle to classic shell

LensChatView is now the first thing users see. A small 'ledger ↗' button
in the bottom-right corner of the lens-chat surface switches to the classic
masthead shell (Journal / Features / Review / Sessions). Classic shell gets
a '← lens' affordance in the masthead to navigate back.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CT7KvNTVAGKSLmyGKVvVpM
EOF
)"
```

---

## Task 8: Evidence walk inline component

**Goal:** Clicking a citation chip (event id from the chat message) fetches provenance and renders the evidence walk card inline in the conversation, exactly as in `mockups/lens-chat/03-conversation.html`.

**Files:**
- Create: `src/web/ui/src/components/EvidenceWalk.tsx`
- Create: `src/web/ui/src/components/EvidenceWalk.css`

**Step 1: Study the mockup structure**

The evidence walk (`mockups/lens-chat/03-conversation.html`, `.walk` class):
- Dark ink background (`var(--lc-ink)`), bone text
- Hop breadcrumb line: CLAIM → FEATURE → MOMENT → TRANSCRIPT (green last hop)
- `<blockquote>` with green left border, monospace, line numbers
- Source line: OK badge, timestamp, jump link

**Step 2: Create EvidenceWalk.css**

Port `.walk`, `.walk .hops`, `.walk blockquote`, `.walk .src` from mockup.

**Step 3: Create EvidenceWalk.tsx**

```typescript
// EvidenceWalk — the 4-hop provenance card that materializes inline
// when the user clicks a citation chip. Uses the existing fetchProvenance API.

import { useState, useEffect } from "react";
import "./EvidenceWalk.css";
import { fetchProvenance } from "../api";
import type { Provenance } from "../types";

interface EvidenceWalkProps {
  eventId: string;
  onClose: () => void;
}

export function EvidenceWalk({ eventId, onClose }: EvidenceWalkProps) {
  const [data, setData] = useState<Provenance | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchProvenance(eventId)
      .then(setData)
      .catch(() => setFailed(true));
  }, [eventId]);

  const firstMoment = data?.moments[0] ?? null;
  const firstEvidence = firstMoment?.evidence[0] ?? null;
  const hasAnchor = firstEvidence?.anchored && firstEvidence.event;

  return (
    <div className="lc-walk lc-rise">
      <div className="lc-walk-close" onClick={onClose} role="button" tabIndex={0}>×</div>

      {/* Hop breadcrumb */}
      <div className="lc-walk-hops">
        <span className="lc-walk-hop">CLAIM</span>
        <span className="lc-walk-arr">→</span>
        <span className="lc-walk-hop">FEATURE</span>
        <span className="lc-walk-arr">→</span>
        <span className="lc-walk-hop">MOMENT</span>
        <span className="lc-walk-arr">→</span>
        <span className={`lc-walk-hop${hasAnchor ? " lc-walk-hop--last" : ""}`}>TRANSCRIPT</span>
      </div>

      {failed && <p className="lc-walk-quiet">Chain unavailable.</p>}
      {!failed && !data && <p className="lc-walk-quiet">Tracing…</p>}

      {data && (
        <>
          {firstMoment && (
            <p className="lc-walk-statement">{firstMoment.statement}</p>
          )}
          {firstEvidence && (
            <blockquote className="lc-walk-quote">
              {firstEvidence.event && (
                <span className="lc-walk-ln">[#{firstEvidence.event.causalOrder}] </span>
              )}
              {firstEvidence.quote}
            </blockquote>
          )}
          <div className="lc-walk-src">
            {firstMoment?.verification === "supported" && (
              <span className="lc-walk-ok">supported</span>
            )}
            {firstEvidence?.event?.timestamp && (
              <span>{new Date(firstEvidence.event.timestamp).toLocaleTimeString()}</span>
            )}
            {data.session && (
              <span className="lc-walk-session">session {data.session.id.slice(0, 8)}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
```

**Step 4: Wire into LensChatMain**

In `LensChatMain.tsx`, add an `openEvidenceId` state and a way to embed `<EvidenceWalk>` inline under a message. For now, a simple inline expansion under any brain message with a "cite" button is sufficient. The exact citation chip flow can be progressive-enhanced — for the Playwright verification, clicking anywhere on a brain message body shows the evidence walk for the first available event id.

**Step 5: Run typecheck**

```bash
cd /Users/giladkoch/dev/intent-ai && npm run typecheck:ui 2>&1
```

Expected: clean.

**Step 6: Commit**

```bash
cd /Users/giladkoch/dev/intent-ai && git add src/web/ui/src/components/EvidenceWalk.tsx src/web/ui/src/components/EvidenceWalk.css && git commit -m "$(cat <<'EOF'
feat(lens-chat): EvidenceWalk — 4-hop inline evidence card

Reuses fetchProvenance (existing /api/events/:id/provenance) to render
claim → feature → moment → transcript walk inline in the conversation.
Mono-on-ink (var(--lc-ink) bg, bone text), green last hop badge, blockquote
with left border. Materializes with lc-rise animation.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CT7KvNTVAGKSLmyGKVvVpM
EOF
)"
```

---

## Task 9: Build the UI artifact and verify baseline tests hold

**Goal:** Rebuild the Vite bundle into `src/web/public/`. Verify all 649 tests still pass and no new TypeScript errors.

**Files:**
- Build output: `src/web/public/assets/`

**Step 1: Run vitest**

```bash
cd /Users/giladkoch/dev/intent-ai && npx vitest run --reporter=dot 2>&1 | tail -8
```

Expected: ≥649 tests passing (may be more with new tests added in this plan).

**Step 2: Run typecheck**

```bash
cd /Users/giladkoch/dev/intent-ai && npm run typecheck:ui 2>&1
npx tsc --noEmit 2>&1 | grep "error TS" | wc -l
```

Expected: UI clean; server exactly 9 pre-existing errors.

**Step 3: Rebuild the UI bundle**

```bash
cd /Users/giladkoch/dev/intent-ai/src/web/ui && npm run build 2>&1 | tail -20
```

Expected: Build completes with no errors. `dist/` output is written to `src/web/public/`.

> **Note:** Verify the Vite config outputs to `src/web/public` — check `src/web/ui/vite.config.ts` if the output goes elsewhere.

**Step 4: Commit**

```bash
cd /Users/giladkoch/dev/intent-ai && git add src/web/public && git commit -m "$(cat <<'EOF'
build(lens-chat): rebuild UI bundle with lens-chat surface

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CT7KvNTVAGKSLmyGKVvVpM
EOF
)"
```

---

## Task 10: Playwright verification — screenshots and end-to-end exercise

**Goal:** Start the server, run Playwright exercises, screenshot each state to `.superpowers/sdd/shots-lens-chat-impl/`.

**Files:**
- Create: `.superpowers/sdd/shots-lens-chat-impl/` (directory)
- Create: `.superpowers/sdd/playwright-lens-chat.mjs` (script)

**Step 1: Create the screenshot directory**

```bash
mkdir -p /Users/giladkoch/dev/intent-ai/.superpowers/sdd/shots-lens-chat-impl
```

**Step 2: Create the Playwright script**

Create `.superpowers/sdd/playwright-lens-chat.mjs`:

```javascript
// Playwright verification of the lens-chat implementation.
// Uses playwright-core + chromium.launch({ channel: "chrome" }) (bundled
// browsers not available; uses system Chrome).

import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const PORT = 3465;
const BASE = `http://localhost:${PORT}`;
const OUT = ".superpowers/sdd/shots-lens-chat-impl";

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

console.log("01 — Arrival state");
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(3000); // let animations settle
await page.screenshot({ path: `${OUT}/01-arrival.png`, fullPage: false });
console.log("   saved 01-arrival.png");

console.log("02 — Feature lens focus");
// Click the 01 FEATURE lens box
await page.click(".lc-lens--feature");
await page.waitForTimeout(1000); // rail fade + stagger
await page.screenshot({ path: `${OUT}/02-lens-focus.png`, fullPage: false });
console.log("   saved 02-lens-focus.png");

// Click the first feature in the list
const firstFeatureItem = page.locator(".lc-flist-item").first();
if (await firstFeatureItem.count() > 0) {
  await firstFeatureItem.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/02b-feature-selected.png`, fullPage: false });
  console.log("   saved 02b-feature-selected.png");
}

console.log("03 — Scoped ask");
const input = page.locator(".lc-ask input");
await input.click();
await input.fill("What is the current state of this feature?");
await page.screenshot({ path: `${OUT}/03-scoped-ask.png`, fullPage: false });

await input.press("Enter");
await page.waitForTimeout(8000); // wait for streaming response
await page.screenshot({ path: `${OUT}/03b-conversation.png`, fullPage: false });
console.log("   saved 03-scoped-ask.png, 03b-conversation.png");

console.log("04 — Clear scope with × tag");
const scopeTag = page.locator(".lc-scopetag");
if (await scopeTag.count() > 0) {
  await scopeTag.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/04-scope-cleared.png`, fullPage: false });
  console.log("   saved 04-scope-cleared.png");
}

console.log("05 — Approval card (if pending observations exist)");
const approveBtn = page.locator(".lc-btn--approve").first();
if (await approveBtn.count() > 0) {
  await page.screenshot({ path: `${OUT}/05-approval-pending.png`, fullPage: false });
  await approveBtn.click();
  await page.waitForTimeout(1200); // stamp animation
  await page.screenshot({ path: `${OUT}/05b-approval-sealed.png`, fullPage: false });
  console.log("   saved 05-approval-pending.png, 05b-approval-sealed.png");
} else {
  console.log("   no pending observations — skipping approval shots");
}

console.log("06 — Ledger toggle (classic shell)");
const ledgerBtn = page.locator(".lc-ledger-toggle");
if (await ledgerBtn.count() > 0) {
  await ledgerBtn.click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/06-classic-shell.png`, fullPage: false });
  console.log("   saved 06-classic-shell.png");
}

await browser.close();
console.log(`\nAll shots saved to ${OUT}/`);
```

**Step 3: Start the server**

```bash
cd /Users/giladkoch/dev/intent-ai && npx tsx src/cli/index.ts web --port 3465 &
sleep 4
```

**Step 4: Run the Playwright script**

```bash
cd /Users/giladkoch/dev/intent-ai && node .superpowers/sdd/playwright-lens-chat.mjs 2>&1
```

Expected: All screenshots saved without errors.

**Step 5: Kill the server**

```bash
pkill -f "src/cli/index.ts web" 2>/dev/null; true
```

**Step 6: Commit**

```bash
cd /Users/giladkoch/dev/intent-ai && git add .superpowers/sdd/shots-lens-chat-impl/ .superpowers/sdd/playwright-lens-chat.mjs && git commit -m "$(cat <<'EOF'
test(lens-chat): Playwright verification screenshots

Exercises: arrival state → feature lens focus → feature select → scoped
ask + streaming answer → scope clear → approval card stamp → ledger toggle.
Screenshots saved to .superpowers/sdd/shots-lens-chat-impl/.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CT7KvNTVAGKSLmyGKVvVpM
EOF
)"
```

---

## Task 11: Write the implementation report

**Goal:** Write `.superpowers/sdd/lens-chat-impl-report.md` with status, commits, what works vs stubbed, test summary, screenshot paths, and concerns.

**Files:**
- Create: `.superpowers/sdd/lens-chat-impl-report.md`

**Step 1: Gather facts**

```bash
cd /Users/giladkoch/dev/intent-ai
git log --oneline -10
npx vitest run --reporter=dot 2>&1 | tail -5
npm run typecheck:ui 2>&1
ls .superpowers/sdd/shots-lens-chat-impl/
```

**Step 2: Write the report**

The report must cover:
- Status (done / partial)
- Commit hashes for each of the 3 commit groups requested
- What works end-to-end vs what is stubbed
- Test summary (total count, new tests added)
- Screenshot paths
- Concerns and known gaps

---

## Task 12: Push to remote

**Goal:** Rebase and push the branch.

**Step 1: Rebase and push**

```bash
cd /Users/giladkoch/dev/intent-ai && git pull --rebase --autostash origin feat/repo-brain && git push origin feat/repo-brain
```

Expected: Clean push. If rebase conflicts, resolve them manually before pushing.

---

## Summary of commit groups

The task asks for three commit splits:
1. **Server context/API extensions**: Tasks 2 + 3 commits (arrival endpoint, lensScope chat extension)
2. **The new surface**: Tasks 1 + 4 + 5 + 6 + 8 commits (CSS tokens, LensRail, LensChatMain, LensChatView, EvidenceWalk)
3. **Default-view swap**: Task 7 commit (App.tsx wiring, fonts, ledger toggle)

The build (Task 9) and verification (Task 10) commits are separate supporting commits.

---

## Notes for the executing agent

- **The exact HTML mockups are the visual source of truth.** Do NOT redesign. If a CSS value is unclear, open the relevant HTML file and copy it verbatim.
- **`prefers-reduced-motion`:** All animations must respect it. The CSS rule in Task 1 covers the `lc-*` classes; double-check that keyframes are also gated by the media query.
- **Import paths:** `lens-chat-utils.ts` lives in `src/web/` (server-side). The simplest approach is to copy the two pure functions inline into the UI components that need them. Do NOT import across the server/UI boundary.
- **No new tsc errors:** Check `npx tsc --noEmit | grep "error TS" | wc -l` before each commit. Must remain 9.
- **No new typecheck:ui errors:** Run `npm run typecheck:ui` before each commit.
- **Vite build output path:** Verify in `src/web/ui/vite.config.ts` that `build.outDir` points to `../../public` (relative to `src/web/ui/`) so the Express server serves the rebuilt bundle.
