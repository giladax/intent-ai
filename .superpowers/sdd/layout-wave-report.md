# Quire Feed Layout — Design Review Wave Implementation Report

**Date:** 2026-07-06  
**Branch:** feat/repo-brain  
**Scope:** 19 design review fixes (F1–F19) for the Quire feed layout

---

## Summary

All 19 fixes implemented. Build passes (`vite build` clean). TypeScript type check clean for all modified files (pre-existing errors in unrelated pipeline code are unchanged).

---

## Fixes Implemented

### F2 — CSS keyframe collision (FIRST)
- `@keyframes shimmer` → `@keyframes lc-shimmer` in `app-ink.css`
- Updated `.feed-now-edge .line` and `.feed-seam` to use `animation: lc-shimmer 7s linear infinite`
- `index.css`'s `@keyframes shimmer` was not touched (per spec)

### F1 — Real headline in FeedComposed
- `LedeSonnetSchema` updated: `text` → `headline` + `body` fields
- `FeedLede` interface: added `headline?: string`
- `composeFeedEditorial()`: LLM call requests `{ headline, body, citedSessionIds }`; maps to `{ headline: ledeResult.headline, text: ledeResult.body }`
- Deterministic fallback: headline from first event summary, ≤10 words
- `api.ts` `FeedComposed`: `lede: { headline?: string; text: string; ... }`
- `FeedStream.tsx`: uses `feed.lede.headline` when present, falls back to `splitLede`; applies `data-long` on h1 when >8 words
- Stagger cap: `animationDelay` capped at 2.8s for words; lede body cap at 2.8+0.2s
- `app-ink.css`: `.feed-lead h1` max-width 15ch → 24ch; added `.feed-lead h1[data-long]` rule (34px font clamp)

### F6 — Story h2 never feature name
- Story headline fallback: built from first event summary sentence (≤12 words) instead of `item.featureName`
- Appends `.` suffix for editorial finish

### F5 — Press pays off: deepHeadline + deep content
- `FeedStory` interface: added `deepHeadline?: string` and `deep?: string`
- `StorySonnetSchema`: added `deepHeadline` and `deep` optional fields
- LLM path (idx < 2): passes `deepHeadline` and `deep` from storyResult
- Deterministic path: builds `deep` from remaining event summaries (slice 1–4), `deepHeadline` from second summary first sentence
- `api.ts` `FeedStory`: added `deepHeadline?` and `deep?`
- `FeedStream.tsx` `UnfoldSection`: h3 uses `story.deepHeadline` when present and distinct; body renders `story.deep || story.dek` split on `\n\n` for multi-paragraph

### F7 — Column geometry
- `FeedStream.css`: added `width: 100%` to `.feed-stream`
- `LensChatMain.css`: `.lc-chat:has(.feed-stream) { max-width: 744px; }`

### F3 — Feed dimming when lens focused
- `feedVisible`: feed shows when org lens OR when lens focused but nothing selected
- `feedDimmed`: true when feedVisible but not feedMode (lens focused but nothing drilled into)
- Feed wrapped in `<div>` with opacity/filter/pointerEvents when dimmed

### F4 — Stale scope tag/placeholder mismatch
- `LensChatView.tsx` `handleLensFocus`: clears feature state when switching to timeline; clears timeRange when switching to feature
- `LensChatMain.tsx`: placeholder uses explicit lens checks instead of `scopeLabel` gate

### F8 — Feature opening: strip citation tokens
- `openingTurn` render: strips `[s:xxxx]` tokens and cleans double periods before splitting into paragraphs

### F9 — Chat replies: render markdown
- Added `renderMarkdown()` function: strips h1–h3, converts `**bold**` to `<strong>`, converts list dashes to `•`
- Applied to assistant `messages` in chat conversation via `dangerouslySetInnerHTML`

### F10 — Rail focused min-height
- `LensRail.css`: `.lc-lens--focused { min-height: 322px; }` → `min-height: 106px;`

### F11 — Large viewport column
- `LensChatMain.css`: added `@media (min-width: 1600px)` block with 860px max-width and 780px ask pill

### F12 — Feed ends abruptly: add briefs section
- `FeedStream.tsx`: added "ALSO THIS WEEK" briefs register after main cards (trending.slice(1))
- `FeedStream.css`: added `.feed-briefs`, `.feed-briefs-head`, `.feed-brief-item`, `.feed-brief-kick`, `.feed-brief-hed` CSS
- `LensChatMain.css`: bottom padding changed from `190px` to `clamp(80px, 15vh, 190px)`

### F13 — Long scope tag truncation
- `LensChatMain.css` `.lc-scopetag`: added `max-width: 200px`, `overflow: hidden`, `text-overflow: ellipsis`
- `.lc-x`: added `flex-shrink: 0`
- `LensChatMain.tsx`: `scopetag` button gets `title={selectedFeatureName ?? "Clear lens scope"}`
- `speakerScope`: simplified from `"lens: feature / NAME"` to just `NAME.toUpperCase()`

### F14 — Classic shell brand coherence
- `App.tsx`: `ledger ↗` → `Ledger ↗`; `← lens` → `← Feed`
- `NotifButton.tsx`: fallback label `"intent-ai · feat/repo-brain"` → `"Quire · feat/repo-brain"`

### F15 — Classic pages column alignment
- Classic pages already use Tailwind `mx-auto max-w-2xl px-8` — they are centered
- Added `.ink-reading-col` utility class to `app-ink.css` as documented pattern for future use

### F16 — "1 HOURS" pluralization
- `NotifButton.tsx`: `gapLabel` now uses `h === 1 ? "HOUR" : "HOURS"` correctly

### F17 — Ask pill background
- `LensChatMain.css` `.lc-askwrap`: gradient stop raised from 45% → 62%; added `backdrop-filter: blur(2px)`

### F18 — Rail feature list truncation
- `LensRail.css` `.lc-flist-item`: removed `white-space: nowrap`
- `.lc-flist-name`: `-webkit-line-clamp: 2` multi-line truncation replacing single-line ellipsis
- `.lc-flist-n`: added `min-width: 2ch; text-align: right; flex-shrink: 0`

### F19 — Zero-update notif card
- `NotifButton.tsx` `NotifCard`: "MARK READ" button only shown when `count > 0`; separate "CLOSE" button when `count === 0`

---

## Files Modified

| File | Fixes |
|------|-------|
| `src/web/ui/src/app-ink.css` | F2, F1, F15 |
| `src/web/feed-composer.ts` | F1, F5, F6 |
| `src/web/ui/src/api.ts` | F1, F5 |
| `src/web/ui/src/components/FeedStream.tsx` | F1, F5, F12 |
| `src/web/ui/src/components/FeedStream.css` | F7, F12 |
| `src/web/ui/src/components/LensChatMain.tsx` | F3, F4, F8, F9, F13 |
| `src/web/ui/src/components/LensChatMain.css` | F7, F11, F12, F13, F17 |
| `src/web/ui/src/components/LensChatView.tsx` | F4 |
| `src/web/ui/src/components/LensRail.css` | F10, F18 |
| `src/web/ui/src/components/NotifButton.tsx` | F14, F16, F19 |
| `src/web/ui/src/App.tsx` | F14 |
