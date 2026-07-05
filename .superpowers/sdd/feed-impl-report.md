# Feed Implementation — Execution Report

**Plan:** `docs/plans/2026-07-05-feed-implementation.md` (13 tasks)
**Status:** COMPLETE — all 13 tasks executed, verified live, pushed.
**Date:** 2026-07-06

## Baselines

| Check | Baseline | Final |
|---|---|---|
| vitest | 667 passing | **702 passing** (+35 new) |
| `tsc --noEmit` errors | 9 (pre-existing) | 9 (unchanged) |
| `typecheck:ui` | clean | clean |

## Commits (in order)

| Hash | Task | What |
|---|---|---|
| `565c280` | 1 | Feed CSS extensions + heat-scoring module (computeHeatScore/rankTrending, 3 tests) |
| `ce26437` | 2 | feed-composer: cache helpers, FeedComposed types, feed_cache schema + migration 0004 |
| `8b9142d` | 3 | `/api/feed` endpoint + buildSkeletonFeed fail-safe + fetchFeed UI helper |
| `8411db9` | 4 | lens-opening-composer + `/api/lens/opening/:featureId` |
| `ae77b41` | 5 | notifications.ts (4 signal types, no LLM) + `/api/notifications` |
| `b508801` | 6 | LensRail: 00 ORG box, + ROLE LENS ghost, notif dot, 30s notification polling |
| `a60cedc` | 7 | FeedStream: editorial overview, press-and-unfold, avatars |
| `28d2f50` | 8 | Feature lens seeded opening + seam + inline approvals |
| `69fc801` | 9 | Notification bell + while-you-were-away card + notif-utils |
| `dcab84b` | 10 | Quire copy rename (UI + chat system prompts) + enforcement test |
| `8ca29b7` | 11 | UI bundle rebuild |
| `f8e1fa0` | fix | Composer grounded in real data (session-mapped features, evidence-fed prompts) |
| `6189db8` | 12 | Playwright verification + splitLede headline refinement + rebuild |

## What works end-to-end (verified live, real data, real Sonnet calls)

- **`/api/feed`** — composes the editorial feed from the real 484-event record: 1 Sonnet
  lede + 2 Sonnet stories (top 2 by heat), deterministic deks for the rest. Cached in
  `feed_cache` (presentation cache, staleness = new events OR >1h). `?refresh=1` recomposes.
  Fail-safe skeleton on any DB/LLM error — never 500.
- **The composed feed's actual opening line (verbatim from the live run):**
  > "The LangGraph agent loop (Task 3) is implemented and approved — 410 tests passing, with a SystemMessage mid-conversation bug caught and fixed in the process."
- **Press-and-unfold** — declarative: a press appends to a `pressedStories` list rendered
  in-stream (`.fs-unfold` sections, `.in`-gated transitions with u1–u7 stagger — no DOM
  cloning, no animation-fill-mode traps). Verified visually: unfold h3 computed opacity 1.
  Press = feature lens selection; ask-bar takes the scope tag; seeded opening follows below.
- **Seeded opening** — `/api/lens/opening/:featureId` returns real `current_understanding`
  (truncated to essence) + recent approved insights + pending count. Renders as the chat's
  first turn, then the seam, then inline approval cards.
- **Notifications** — `/api/notifications?lastSeen=` derives real area-activity signals
  (5 live during verification); bell badge, while-you-were-away card with EXPAND/DISMISS,
  `quire-last-seen` localStorage gap tracking.
- **Rail** — 00 ORG ink box (you are here / back to the feed), + ROLE LENS ghost
  (exec · product · eng — soon), vermilion notif dot on wordmark.
- **Quire rename** — all user-facing copy + chat system prompts ("You are Quire");
  internal identifiers untouched (brain_* MCP tools, brainCards, lc-turn-brain, /api/brain/ routes).
  Enforced by `tests/web/quire-copy.test.ts`.
- **Voice rule** — encoded in the composer's system prompt verbatim (say-it-out-loud test +
  banned-word list: river, sitting, ink, correspondence, edition, sittings, unfolded);
  Zod maxLength constraints on headline/dek/openQuestion.

## Stubbed / deferred

- **Sonnet polish of the seeded opening** (Task 4 step 5, sessionCount ≥ 3): endpoint returns
  the deterministic assembly with `polished: false`. Deterministic path is complete and live.
- **Contradicted-decision + hot-streak notification signals**: `buildNotifText` supports all
  4 types (tested); the endpoint wires pending_gate + area_activity (the two with real data
  paths today). No `verification='contradicted'` moments exist in the DB yet.
- **actorInitials**: derived from event actor strings (developer/collaborative → GK,
  ai/agent → AI) — real per-person attribution needs multi-user capture.

## Deviations from the plan (all recorded)

1. **`callSonnet` signature** is `(systemPrompt, userPrompt, schema)` — plan assumed an
   options object. Adapted.
2. **Trending/evidence/notification queries** join through `feature_sessions` —
   `activity_events.feature_id` is NULL for all real rows; the plan's SQL returned nothing.
3. **`/api/feed` uses `getDb()`** (drizzle) — plan's `getClient()` returns the raw postgres.js
   client, which lacks the drizzle API the composer needs.
4. **Edition number = digested session count** (mockup's "UPDATE 9") — the plan's day-based
   `Math.floor(Date.now()/86400000)` would render "No. 20640".
5. **Composer prompts carry real event summaries** (newest first) so headlines carry actual
   news — the plan's prompt only passed counts, which produced generic copy.
6. **Feed dissolve on rail-driven lens selection is an instant swap** (unmount) rather than
   the lc-dissolve animation — the dissolved feed would occupy ~3 viewport-heights of
   invisible space above the opening turn. Press-driven selection keeps the stream (mockup 02).
7. **`+ ROLE LENS` ghost has no `+` prefix span** — matches mockup markup exactly
   (`glabel` carries the +).
8. **quire-copy test strips `/api/brain/` route paths** — internal identifiers per the
   test's own stated intent.
9. **Screenshots to `.superpowers/sdd/shots-feed-impl/`** (user instruction) instead of
   `mockups/feed/shots/`; the dir is gitignored so shots are local artifacts, script committed
   with `-f`.
10. **JournalPage empty state** "The river is quiet" → "Quiet so far" — voice rule is binding;
    "river" must never reach the user.
11. **NotifCard/notifSlot as ReactNode prop** rather than a NotifCardData shape — same
    render result, simpler ownership (LensChatView owns the card state).
12. **notif-utils falls back to an in-memory store** when localStorage is unavailable
    (node test env) — keeps the roundtrip test honest without jsdom.

## Screenshots (`.superpowers/sdd/shots-feed-impl/`)

- `01-feed-arrival.png` — live feed, real composed headline + lede, masthead "QUIRE · NO. 9 · MONDAY, JULY 6", MOST ACTIVE rule
- `01-notif-open.png` — while-you-were-away card (30-hour gap, 4 real area-activity items)
- `02-press-and-unfold.png` — pressed story, stem, unfold (speaker/h3/dek/chips/ask-turn with wait dots), scoped ask-bar
- `03-feature-page.png` — rail-focused feature lens, seeded opening with real understanding, seam, scoped ask-bar

## Test summary

702 passed / 0 failed (72 files). New tests: feed-heat-score (3), feed-composer-cache (4),
feed-endpoint (2), lens-opening-composer (5 incl. voice rule), notifications (5),
lens-rail (2), feed-stream (4), notif-button (3), quire-copy (8) — 35 new + 667 baseline preserved.

---

# Feed Review Fix Wave — 2026-07-06
**Source:** feed-review-findings.md (2 Critical + 10 Important)
**Status:** COMPLETE — C2, C1, I1-I8 all fixed (I9 excluded per brief)

## C2 — Migration 0004 not in journal
Added idx=4 to `_journal.json`, created `0004_snapshot.json`, added `CREATE TABLE IF NOT EXISTS feed_cache` guard in `infra.ts`. **Verified:** drop table → `cli up` → table recreated. ✓

## C1 — Fabricated citations
Model-returned ids filtered against DB-derived `ev.sessionIds`; unknowns dropped. Lede always `[]`. Exported `filterCitations()`. **Test:** `tests/web/feed-citation.test.ts` (5 cases). ✓

## I7 — Byline promise / inert chips
Byline "every claim traces to the record" gated on `lede.citedSessionIds.length > 0`. Session chips become clickable `<button>` when `onSessionClick` prop provided. ✓

## I2 — "Nothing is blocked." unconditional
Derived from `pendingGateCount === 0` (filter on `n.type === 'pending_gate'`). ✓

## I3 — Deterministic dek grammar
Summary text gets `.` if not already ending `[.!?]` before the event-count suffix. ✓

## I10 — NotifButton hardcoded repo/branch
`/api/meta` endpoint returns `{ repo, branch }` from git. `LensChatView` fetches and passes props. Screenshots confirm live values. ✓

## I4 — Banned words + output scan
All 5 UI string replacements applied. `containsBannedWords()` guards Sonnet output; falls back to deterministic dek on violation. `ProvenancePanel.tsx` added to quire-copy scan. **Test:** `tests/web/feed-banned-words.test.ts` (9 cases). ✓

## I5 — Badge resurrects on 30s poll
`handleNotifDismiss` stamps `setLastSeenInStorage(now)`; poll reads `getLastSeenFromStorage()` dynamically each tick. ✓

## I1 — Trending double-attribution
`dedupTrending()` exported: suppresses stories with >50% session overlap vs higher-ranked story. `DISTINCT ON ae.id` in `queryFeatureEvidence`. Wired into `getFeedOrCompose`. ✓

## I6 — Lens opening queries all-NULL feature_id
`/api/lens/opening` recentInsights + pendingCount use UNION of direct `feature_id` + `feature_sessions` join (same pattern as trending). ✓

## I8 — Compose guards
In-flight dedup: `_composeInFlight` module lock. Min-age: `isCacheStale` returns false within 5 min. Degraded TTL: all-LLM-failed composes expire at 5 min. **Test:** `tests/web/feed-composer-fallback.test.ts`. ✓

## Minors
- `buildSkeletonFeed` fallback test added
- `heatLabel` + `heatTicks` tests added to `feed-heat-score.test.ts`
- `splitLede` em-dash uppercasing was already correct

## Summary
- Tests: 702 baseline → 727 final (25 added), all passing
- UI typecheck: clean; server tsc: 14 pre-existing (unchanged)
- UI rebuilt: `index-D6GlKzNz.js`
- Commits: `849a389` (C2+C1), `689039a` (I1+I6+I8), `de4dd65` (I2-I5+I7+I10)
- Screenshots: `.superpowers/sdd/shots-feed-impl/01.png` + `02.png`

## Follow-up commit (source-file recovery + I7 completion)
Commit `de4dd65` accidentally contained only the rebuilt UI artifact — the UI source
changes were left uncommitted in the working tree. This follow-up commit carries them:
App.tsx, DigestPanel.tsx, FeedStream.tsx, JournalPage.tsx, LensChatMain.tsx,
LensChatView.tsx, NotifButton.tsx, SessionDetailPage.tsx, quire-copy.test.ts.

It also **completes I7**: no parent was passing `onSessionClick` to FeedStream, so
citation chips were still inert. Now threaded App.tsx → LensChatView → LensChatMain →
FeedStream; chips render as buttons and navigate to the session detail page.

Live verification (Chrome, port 7899):
- Byline: "— written by Quire from the recorded sessions" (provenance claim dropped, lede uncited) — I7 ✓
- Trending: 1 distinct story (was 4 near-identical at heat 13.032 from one session) — I1 ✓
- Dek: full sentences, no mid-word truncation — I3 ✓
- Notif meta: "intent-ai · feat/repo-brain" served live from /api/meta — I10 ✓
- Chip click navigated to session detail; "section N · after gap" separators confirmed — I7 + I4 ✓
- C2 re-verified destructively: DROP TABLE feed_cache → `cli up` → table recreated with full schema ✓
- Corrected counts: server tsc = 9 errors (matches baseline exactly); tests 727 passing
- UI rebuilt: `index-DiMsoyie.js`; screenshots 01.png/02.png re-taken with final build

---

# Feed Fix-Wave Re-Review Closures — 2026-07-06

**Baseline:** 727 tests / 9 tsc errors / typecheck:ui clean
**Tasks:** I6 completion, I4 completion, dedupTrending advisory

## I6 — Feature-scoped inline approval cards

Extracted pure filter `filterPendingObsForLens` to `src/web/lens-obs-filter.ts`.
Logic: feature lens + selectedFeatureId → show only observations attributed to that
feature (null feature_id observations hidden); any other lens → org-level all (capped 5).

`LensChatView.tsx` updated: `pendingObsForChat` now calls `filterPendingObsForLens(pendingObs, focusedLens, selectedFeatureId)` instead of the prior unconditional `slice(0, 5)`.

**Test:** `tests/web/lens-obs-filter.test.ts` (8 cases — feature filter, null-feature hide, org fallback, caps).

## I4 — Voice banned-word scan in copy test

New test file: `tests/web/voice-word-scan.test.ts`.
Scans every `.tsx/.ts` in `src/web/ui/src/components/` (excl. ui/ shadcn primitives)
for banned words (`river`, `sittings`, `sitting`, `ink`, `correspondence`, `edition`, `unfolded`)
in JSX text nodes and user-facing prop string values (title, placeholder, aria-label, alt).

**First-run violation found and fixed:** `ChatDock.tsx` line 95 — `"The Correspondence"` was
the chat dock title. Renamed to `"Ask Quire"`. No other user-facing violations existed.
CSS variable strings (`var(--lc-ink)`) and JS identifier names are not flagged (scanner
extracts text between `>...<` and user-facing props only).

**Test suite:** 24 cases (1 sanity + 1 per component file). All pass on the fixed tree.
Regression proof: `>the river runs empty<` in any component JSX text would be caught.

## dedupTrending unit tests (advisory)

New test file: `tests/web/dedup-trending.test.ts` (7 cases):
- First item always kept
- >50% session overlap → suppressed
- exactly 50% overlap → kept (docstring says "more than 50%")
- no evidence → always kept
- hottest-first order preserved
- maxItems cap
- explicit empty sessionIds → treated as no evidence

**Bug found:** existing code used `< 0.5` (suppresses ≥50%), contradicting the docstring which
says ">50% suppressed, <50% kept". Fixed to `<= 0.5` so exactly 50% overlap is now kept,
matching the declared contract.

## Final counts

| Check | Baseline | Final |
|---|---|---|
| vitest | 727 tests / 75 files | **766 tests / 78 files** (+39 new) |
| `tsc --noEmit` errors | 9 | 9 (unchanged) |
| `typecheck:ui` | clean | clean |
| UI artifact | rebuilt | rebuilt (ChatDock + LensChatView changes)
