# Features as PRDs, the knowledge graph, and shared attention (owner, 2026-07-06)

Verbatim: "looking at the features we have for this repo, seems they are technical, which is not bad but I imagined feature as a prd. come to think about it as this is a knowledge graph, the connections are many to many, a prd or spec could be related, same technical feature may be related to many specs and prd. one more thing I see is that we dont allow to both expand a topic text its truncated, and you can select sessions view (another natural level list of recent sessions you can click a session and review it. we use what we have and the llm should be aware to the state of the ui in its own state and based on that we fetch context relevant to chat. I want some version of this in the mcp which is a killer feature."

## 1. Two node kinds, many-to-many
Today's seeded features are implementation-shaped (technical areas). The owner's mental model: **intent artifacts** (PRDs, specs) and **implementation features** (technical areas) are distinct node kinds in a knowledge graph, linked many-to-many — one PRD touches many technical features; one technical feature serves many PRDs/specs. This is the PRD's alignment moat surfacing as a data-model requirement (intent ↔ implementation edges are exactly what alignment queries walk). Direction: additive `intent_artifacts` (or generalized nodes) + link table; the docs/ specs and prd.md of this very repo are the first intent corpus; lenses can then be intent-shaped ("the feed for PRD X") as well as implementation-shaped.

## 2. UI gaps (functional)
- Truncated topic/understanding text must be expandable in place (essence: terse by default, FULL on demand — the demand affordance is missing).
- A sessions view reachable in the feed surface: recent sessions as a natural list level; click one to review it (exists in classic shell; surface it in the new shell's model — possibly as the TIMELINE lens's list mode).

## 3. Shared attention (the killer feature)
The LLM should know the state of the UI — current lens, selected feature, open session, expanded stories — and context-fetch for chat based on it. AND a version of this is exposed over MCP: an agent mid-session can ask what the user is looking at right now and receive the same assembled context. One mental model: the in-app chat and external agents share the brain AND share the user's current attention. v1 shape: UI reports view-state (debounced) → server holds current attention state → chat context assembler merges it (extends the existing lensScope) → new additive MCP tool exposes attention + relevant context. MCP freeze note: additive tool only; existing brain_* tools untouched (campaign coherence).

### 3.1 SHIPPED — v1 (2026-07-06, commits 019a323 · 5761023 · 3aa62fc · 474c2e0)

- **View-state shape** (`AttentionState`, `src/storage/attention-store.ts`): `{ surface: "feed"|"classic", lens: null|{type, featureId?, featureName?, timeRange?}, expandedStoryIds, openSessionId, pendingApprovalVisible, ts }`.
- **UI reporter**: `LensChatView` posts the state to `PUT /api/attention`, debounced 2s, fire-and-forget (a lost report never surfaces an error). Feed surface only in v1.
- **Cross-process bridge**: single-row `attention_state` table (migration `drizzle/0005_attention_state.sql`, upsert on id `'current'`) — the web server and MCP server are separate processes, so the slot lives in Postgres, not memory. Survives restarts. Sentinel `{}` = no attention.
- **Staleness**: attention older than 10 min (`STALE_MS`) is reported as stale, honestly marked in output.
- **Chat merge** (`src/web/attention-context.ts` + `/api/chat`): merges only on the no-explicit-scope fallback path — an explicit lensScope/featureId/sessionId always wins. Essence principle: a few targeted lines, and the speaker acknowledges attention only when it materially scoped the answer (no creepy narration).
- **MCP** (`brain_attention`, `src/mcp/server.ts` + pure formatter `src/mcp/attention-formatter.ts`): returns the attention state + the focused feature's orientation (drill handles included) + open-session narrative summary when present. No attention → honest "dashboard not open". Additive; instrumented like every other read (`mcp:attention` events).
- **Verified live**: Playwright drove the feed, focused a feature lens; the real MCP server (separate stdio process) returned that lens's orientation. Report: `.superpowers/sdd/shared-attention-report.md` (local, gitignored).

Deferred to v2: classic-shell reporting (`surface:"classic"`), expanded-story evidence in the chat merge, per-user slots (v1 is single-user), attention history ring (last 10).
