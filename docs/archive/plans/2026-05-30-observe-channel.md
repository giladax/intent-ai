# Observe Channel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Daemon observes live CC session, digests on the fly, surfaces prompt suggestions in existing dashboard chat panel.

**Architecture:** HTTP hooks + JSONL tail → normalize → debounce → Haiku digest → session state → prompt suggestions → dashboard polls `GET /live`.

**Tech Stack:** Node `http`, Haiku, existing Express dashboard, Vitest.

---

### Task 1: Types + sink interface

**Files:** Create `src/daemon/types.ts`, `src/daemon/sink.ts`

Define `ObservedEvent`, `BatchDigest`, `SessionState`, `PromptSuggestion`, `DigestionSink` interface. Stub sink: log one-line summary + append to `events.ndjson`.

**Test:** `tests/daemon/sink.test.ts` — sink writes valid NDJSON, one line per event.

**Commit:** `feat(daemon): types and file sink`

---

### Task 2: Normalizer

**Files:** Create `src/daemon/normalizer.ts`

Two functions: `normalizeHook(body: unknown): ObservedEvent` and `normalizeJsonlLine(line: unknown): ObservedEvent[]` (explodes content blocks). Unknown shapes → `kind: 'raw'`.

**Test:** `tests/daemon/normalizer.test.ts` — use fixtures from `tests/fixtures/sample-session.jsonl` line format + mock hook payloads. Verify kind mapping, tool_use_id extraction, unknown → raw.

**Commit:** `feat(daemon): normalizer for hooks and JSONL`

---

### Task 3: Correlator

**Files:** Create `src/daemon/correlator.ts`

`Correlator` class with `ingest(evt: ObservedEvent)` → emits deduplicated events via callback. Matches on `toolUseId` within 5s window. Hook authoritative, JSONL enriches. Unmatched JSONL emits standalone. Timer cleanup for expired pending.

**Test:** `tests/daemon/correlator.test.ts` — duplicate tool event deduped, unmatched JSONL emits, expired window emits standalone.

**Commit:** `feat(daemon): correlator with 5s dedup window`

---

### Task 4: Tail watcher

**Files:** Create `src/daemon/tail-watcher.ts`

`TailWatcher` class. Constructor takes file path + callback. Uses `fs.watch` + `fs.read` to follow appends. Buffers partial lines. Handles missing file (poll until exists). `stop()` for cleanup.

**Test:** `tests/daemon/tail-watcher.test.ts` — write lines to temp file, verify callback fires per line, partial line buffered until newline.

**Commit:** `feat(daemon): JSONL tail watcher`

---

### Task 5: Hook server

**Files:** Create `src/daemon/hook-server.ts`

Node `http.createServer`. `POST /hooks` → buffer body, respond 200 empty immediately, then parse + emit. `GET /live` → return session state JSON. `GET /health` → 200. Bind `127.0.0.1`.

**Test:** `tests/daemon/hook-server.test.ts` — POST returns 200 empty, body parsed and emitted via callback, GET /live returns state.

**Commit:** `feat(daemon): HTTP hook server`

---

### Task 6: Event queue (debounce)

**Files:** Create `src/daemon/event-queue.ts`

`EventQueue` class. `push(evt)` buffers. Flushes after 3s quiet or 10 events. Flush calls `onFlush(batch: ObservedEvent[])`. `flush()` for manual drain. `stop()` clears timers.

**Test:** `tests/daemon/event-queue.test.ts` — 10 events triggers flush, 3s quiet triggers flush, manual flush works.

**Commit:** `feat(daemon): debounced event queue`

---

### Task 7: Live digest + session state

**Files:** Create `src/daemon/live-digest.ts`, `src/daemon/session-state.ts`

`liveDigest(batch, state)` → Haiku call → `BatchDigest`. Zod-validated output.
`SessionState` class — `update(digest)` accumulates. `reset()` on session_start. `toJSON()` for GET /live.

**Test:** `tests/daemon/live-digest.test.ts` — mock Anthropic SDK, verify Zod validation, verify state accumulates intents and files.

**Commit:** `feat(daemon): Haiku live digest + session state`

---

### Task 8: Prompt suggester

**Files:** Create `src/daemon/prompt-suggester.ts`

`suggestPrompts(state: SessionState)` → Haiku call → `PromptSuggestion`. Called after digest if `significantEvent` or every 3rd batch. 2-3 suggestions with category + reasoning.

**Test:** `tests/daemon/prompt-suggester.test.ts` — mock Anthropic, verify Zod output shape, verify categories.

**Commit:** `feat(daemon): Haiku prompt suggester`

---

### Task 9: Daemon entry point + CLI

**Files:** Create `src/daemon/index.ts`. Modify `src/cli/index.ts`.

Wire: hook-server → normalizer → correlator → event-queue → live-digest → session-state → prompt-suggester → sink. SIGINT/SIGTERM → graceful shutdown (flush sink, close server, stop watcher).

Add `intent observe [--port]` command to CLI.

**Test:** Manual — start daemon, verify startup log, health endpoint, shutdown.

**Commit:** `feat(daemon): entry point + CLI command`

---

### Task 10: Chat panel — session context support

**Files:** Modify `src/web/ui/src/components/ChatPanel.tsx`, `src/web/ui/src/App.tsx`

ChatPanel currently only takes `topicId`. Add `sessionId` prop. When `sessionId` is set (session-detail view), chat scopes to that session. App.tsx passes `sessionId` when `view === 'session-detail'`.

**Test:** Manual — open session detail, chat panel shows "Ask about this session...", chat works with session context.

**Commit:** `feat(web): chat panel supports session context`

---

### Task 11: Dashboard — live session + suggestions

**Files:** Modify `SessionsPage.tsx`, `SessionDetailPage.tsx`, `ChatPanel.tsx`. Add to `src/web/ui/src/api.ts`.

- `api.ts`: add `fetchLiveState()` → `GET http://127.0.0.1:4317/live` (catch → null = daemon not running).
- `SessionsPage`: poll live state. If active, show at top with pulsing green dot + "Live" badge.
- `SessionDetailPage`: when viewing live session, poll and render `significantEvents` as live moments.
- `ChatPanel`: when live state has suggestions, render suggestion cards above messages — prompt text with copy button, category badge, reasoning. Click → populate chat input.

**Test:** Manual end-to-end — daemon + CC session + dashboard open. Verify suggestions appear, copy works, chat works.

**Commit:** `feat(web): live session + prompt suggestions in dashboard`

---

### Task 12: Claude Code hook wiring + end-to-end test

**Files:** Create `.claude/settings.local.json`

Install hook config. Run full flow: start daemon → start CC session → do 3-4 turns → check `events.ndjson` + dashboard. Verify:
- Events captured from both sources
- No duplicates
- Suggestions appear in chat panel
- After session: `intent digest` produces valid session in dashboard

**Commit:** `feat(daemon): hook wiring + e2e verification`

---

## Execution order

Tasks 1-6 are pure infrastructure, no LLM calls, testable in isolation → parallelize where possible.

Tasks 7-8 need Anthropic SDK → sequential, mock in tests.

Task 9 wires everything → depends on 1-8.

Tasks 10-11 are dashboard work → can start after task 5 (need GET /live shape).

Task 12 is integration → last.
