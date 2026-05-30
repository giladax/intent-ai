# Phase 1 Spec — Observe Channel + Live Companion

A local **daemon** that observes a live Claude Code session, ingests events on
the fly with debouncing, and surfaces prompt suggestions in the existing
dashboard's chat panel — letting the user understand, refine, and copy suggested
next prompts while the CC session is running.

-----

## Goal

1. **Observe** — HTTP hooks + JSONL tail → normalized, deduplicated event stream.
2. **Live ingest** — debounced event batches → Haiku digest → accumulating session
   state.
3. **Prompt companion** — suggestions shown in the dashboard chat panel (existing
   UI), where the user can copy, discuss, refine, or explain the suggested prompt
   before pasting it into Claude Code.

Done = start daemon, start CC session, do work, open `intent web` → sessions page
shows live session at top, click it → session detail with live moments appearing,
chat panel shows prompt suggestions you can copy/discuss. After session ends,
`intent digest` still produces quality output.

-----

## Why two sources

**Hooks give timing; the transcript gives content.** Every hook includes
`transcript_path` (verified in `BaseHookInput`). Hook = real-time trigger +
pointer to JSONL file. JSONL = authoritative content record.

-----

## Architecture

```
  Claude Code session
    │  HTTP hooks                           ┌─────────────────────────────────┐
    ├──────────────────────────────────────▶│  DAEMON (127.0.0.1:4317)        │
    │                                        │                                 │
    │  writes .jsonl                         │  hook-server ──┐                │
    └─────────────┐                          │  tail-watcher ─┤                │
                  └─────────────────────────▶│                ▼                │
                                             │  normalizer → correlator        │
                                             │                ▼                │
                                             │  event-queue (debounce 3s/10)   │
                                             │                ▼                │
                                             │  live-digest (Haiku per batch)  │
                                             │                ▼                │
                                             │  session-state (accumulator)    │
                                             │                ▼                │
                                             │  prompt-suggester (Haiku)       │
                                             │                ▼                │
                                             │  GET /live (dashboard polls)    │
                                             │  events.ndjson (file sink)      │
                                             └─────────────────────────────────┘

  Dashboard (intent web, port 3456)
    │  polls GET http://127.0.0.1:4317/live
    │  every 5s from chat panel
    ▼
  Sessions page: live session at top with pulsing indicator
  Session detail: moments appear as detected
  Chat panel: prompt suggestions + session-aware chat
```

-----

## Source layout

```
src/daemon/
  index.ts            # entry point, wires everything
  hook-server.ts      # POST /hooks + GET /live
  tail-watcher.ts     # JSONL follower
  normalizer.ts       # → ObservedEvent
  correlator.ts       # dedup on tool_use_id (5s window)
  event-queue.ts      # debounce: 3s quiet or 10 events
  live-digest.ts      # Haiku per batch → BatchDigest
  session-state.ts    # accumulator
  prompt-suggester.ts # Haiku → PromptSuggestion
  sink.ts             # DigestionSink interface + file logger
  types.ts            # ObservedEvent, SessionState, BatchDigest, PromptSuggestion
```

CLI: `intent observe [--port 4317]`

-----

## Components

### 1. Hook server

Node built-in `http`. Two endpoints:

- `POST /hooks` — receive hook events. **Respond 200 empty immediately** before
  any processing. Buffer body, respond, then parse. `UserPromptSubmit` blocks CC.
- `GET /live` — return current `SessionState` + latest `PromptSuggestion` as JSON.
  Dashboard polls this.

Bind `127.0.0.1` only. Configurable port (default 4317).

Extract `transcript_path` from first hook → start tail watcher.

Hook events: `UserPromptSubmit`, `PostToolUse`, `PostToolUseFailure`, `Stop`,
`SessionStart`, `SessionEnd`. All carry `BaseHookInput` common fields.

### 2. JSONL tail watcher

Follow `transcript_path`. Buffer partial lines. Handle missing file (wait),
truncation (re-open). `JSON.parse` per line. Known types: `user`, `assistant`,
`progress`, `file-history-snapshot`.

### 3. Normalizer

```ts
interface ObservedEvent {
  source: 'hook' | 'jsonl';
  sessionId: string | null;
  kind: string;           // user_prompt | tool_call | tool_result | tool_failure
                           // | assistant_text | assistant_stop | session_start
                           // | session_end | raw
  ts: number;
  transcriptPath?: string;
  raw: unknown;
  toolName?: string;
  toolInput?: unknown;
  toolResponse?: unknown;
  toolUseId?: string;
  prompt?: string;
}
```

Hook events → `kind` by `hook_event_name`. JSONL → explode content blocks.
Unknown → `raw`. Never drop.

### 4. Correlator

Match `tool_use_id` within 5s window. Hook authoritative, JSONL enriches.
Isolated in `correlator.ts` with fallback to hooks-only.

### 5. Event queue (debounce)

Buffer incoming events. Flush after **3 seconds of quiet** or **10 events**.
On flush → hand batch to live digest.

Purpose: a tool burst (Read × 5) batches into one digest call, not five.

### 6. Live digest (Haiku)

One Haiku call per batch. Question: **"What just happened and how does it change
the session's trajectory?"**

```ts
interface BatchDigest {
  summary: string;           // 1-2 sentences
  currentIntent: string;     // what user/agent is doing now
  filesInFocus: string[];
  openQuestions: string[];
  significantEvent: boolean; // pivot, error, completion?
}
```

### 7. Session accumulator

```ts
interface SessionState {
  sessionId: string;
  startedAt: number;
  transcriptPath: string;
  turnCount: number;
  currentIntent: string;
  intentHistory: string[];
  filesInFocus: string[];
  toolsUsed: Record<string, number>;
  recentDigests: BatchDigest[];  // last 5
  openQuestions: string[];
  significantEvents: string[];
  latestSuggestion: PromptSuggestion | null;
}
```

Reset on `session_start`. Updated after each digest. Exposed via `GET /live`.

### 8. Prompt suggester (Haiku)

Triggered after digest **if `significantEvent`** or every **3rd batch**.

Question: **"Given where this session is now, what should the user ask next?"**

```ts
interface PromptSuggestion {
  suggestions: Array<{
    prompt: string;        // ready to copy into CC
    reasoning: string;     // why (1 sentence)
    category: 'continue' | 'refine' | 'redirect' | 'verify' | 'explain';
  }>;
  sessionSummary: string;  // "here's where you are"
  updatedAt: number;
}
```

2-3 suggestions per call. ~$0.001/call.

### 9. Dashboard integration (existing UI extension)

**Current state:**
- `ChatPanel` is topic-scoped only (`topicId` + `topicName` props). When on
  session-detail view, `chatContext` is null → chat panel is empty/inactive.
- `SessionDetailPage` shows narrative + moments timeline, no live capability.
- `SessionsPage` shows digested sessions list.
- Chat API already accepts `sessionId` and builds session-scoped system prompts.

**Changes needed:**

#### a. Chat panel becomes context-aware (not just topic-scoped)

`ChatPanel` currently only works with `topicId`. Extend it to also accept
`sessionId` — the server-side `POST /api/chat` already supports `sessionId`
for building session-scoped prompts. When on session-detail view, pass
`sessionId` instead of `topicId`.

When the daemon is running (detected by polling `GET /live` and getting a
response), the chat panel shows a **suggestions section** above the message list:

- Session summary line (from `PromptSuggestion.sessionSummary`)
- 2-3 suggestion cards, each with:
  - The prompt text (copyable — click to copy)
  - Category badge (`continue`, `refine`, `redirect`, `verify`, `explain`)
  - Reasoning line underneath
- Click a suggestion → it populates the chat input for refinement/discussion
- User can ask follow-up questions about the suggestion via normal chat
- Suggestions auto-refresh every 5s poll

#### b. Sessions page shows live session

When `GET /live` returns a session, show it at the top of the sessions list with
a pulsing green dot and "Live" badge. Click → session detail in live mode.

#### c. Session detail shows live moments

When viewing the live session, `SessionDetailPage` polls `GET /live` and renders
`significantEvents` as moments appearing in real-time (same timeline UI, new dots
animate in). When session ends, the page shows a "Session complete — digest now"
button.

### 10. File sink + graceful shutdown

Every `ObservedEvent` → `events.ndjson`. `SIGINT`/`SIGTERM` → flush, close, stop.

-----

## Claude Code wiring

`.claude/settings.local.json` (not committed):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "http", "url": "http://127.0.0.1:4317/hooks", "timeout": 10 }] }
    ],
    "PostToolUse": [
      { "matcher": "*", "hooks": [{ "type": "http", "url": "http://127.0.0.1:4317/hooks", "timeout": 10 }] }
    ],
    "PostToolUseFailure": [
      { "matcher": "*", "hooks": [{ "type": "http", "url": "http://127.0.0.1:4317/hooks", "timeout": 10 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "http", "url": "http://127.0.0.1:4317/hooks", "timeout": 10 }] }
    ],
    "SessionStart": [
      { "hooks": [{ "type": "http", "url": "http://127.0.0.1:4317/hooks", "timeout": 10 }] }
    ],
    "SessionEnd": [
      { "hooks": [{ "type": "http", "url": "http://127.0.0.1:4317/hooks", "timeout": 10 }] }
    ]
  }
}
```

-----

## Acceptance criteria

1. Daemon starts, `POST /hooks` returns 200 empty in <50ms.
2. Events arrive and log to `events.ndjson`: session_start, user_prompt,
   tool_result, assistant_stop, session_end.
3. Tail watcher emits JSONL events. No duplicates (correlator works).
4. Unknown shapes → `kind: 'raw'`, never dropped.
5. Kill/restart → recovers on next hook.
6. **Live digest**: after turn completes, Haiku digest fires, `GET /live` returns
   updated session state.
7. **Prompt suggestions**: `GET /live` includes 2-3 prompt suggestions after
   significant events.
8. **Dashboard — sessions page**: live session appears at top with pulsing dot.
9. **Dashboard — session detail**: live moments appear in timeline as detected.
10. **Dashboard — chat panel**: shows suggestion cards on session-detail view,
    with copy + discuss capability. Chat works with session context.
11. **End-to-end**: after session ends, `intent digest <path>` + `intent web`
    shows correct session in Sessions page (existing pipeline is the judge).

-----

## Out of scope

- MCP server integration (daemon exposes tools via MCP — Phase 2)
- Auto-digest on SessionEnd (Phase 2)
- PTY ownership, terminal injection
- Multi-session (N=1)
- Hook decision responses (observe only)
- Prompt injection back into CC (user copies manually)

-----

## Stack

- Node `http` for daemon. Zero new deps.
- Haiku for live digest + suggestions (~$0.001/call, ~$0.10/50-turn session).
- Express in `src/web/` (existing).
- `fs.watch` for tail.

## Build notes

- **Respond before parsing** on UserPromptSubmit — buffer body, send 200, then
  JSON.parse.
- **Debounce tuning**: 3s/10 is starting point. Tool bursts should batch.
- **Chat panel refactor is the main UI work** — currently topic-only, needs to
  accept sessionId and show suggestions. The server-side already supports it.
- **`model` not in SessionStart hook** — extract from first JSONL assistant msg.
- **Correlator is soft spot** — isolate, iterate with real data.
