# Handoff — Brain, end of 2026-07-03 (loop closed · Correspondence shipped · journal-as-product)

> Decisions below are settled — don't relitigate. Open problems are yours to solve your way. Read linked sources before code.

## Where things stand

Branch `feat/repo-brain`, **large uncommitted working tree** — nothing from today is committed. The live loop the previous handoff called "the single most important next step" is **closed and verified**: fresh Postgres (colima VM, `postgres:16-alpine`, port 5433) → rebuilt baseline migration applied (29 tables, 12 indexes) → 3 real sessions digested (59 moments, 89 events) → dashboard live at `localhost:3456` → Correspondence chat answering about pinned page elements against real data. 396/396 tests green; `tsc --noEmit` holds the pre-existing 26-error baseline.

**Your first job: slice the working tree into commits.** The changes group naturally:

1. **Migration rebuild** — the legacy 0000–0007 chain was unsalvageable (journal `when` timestamps out of order silently skipped 0004/0005 on fresh DBs; 0007 dropped a constraint by a name that never existed in any real DB). Deleted, regenerated as one `drizzle/0000_baseline.sql` from `schema.ts`, which now declares all indexes. `parent_topic_id` excised from live code (brain-apply, generate-markdown, server, UI). `docker-compose.yml` pins `postgres:16-alpine`.
2. **Dead-code sweep** — shadcn scaffold + orphaned components deleted; `journal.css` token dedup; strays removed; `test-daemon.sh` → `scripts/`.
3. **The Correspondence** — always-live chat dock: `src/web/ui/src/chat-dock.tsx`, `components/ChatDock.tsx`, `components/TalkLayer.tsx` (any `data-talk*`-annotated element is j/k-navigable, `t`-pinnable, hover-affordanced — no imports needed in pages), auto-context follows the view, `/api/chat` resolves pinned `contextItems` server-side (`buildPinnedContextSection` in `src/web/server.ts`). ReviewQueue stamp thunk + inbox-zero ink flourish. `ChatPanel.tsx` deleted. Demo/screenshot driver: `scripts/snap-correspondence.mts` (playwright-core + installed Chrome).
4. **Docs** — this handoff, measurement-spec precondition update.

## Direction (settled today, in Gilad's words — the steering, not the solution)

**The Journal is the product; trees are dead.** The event river (`activity_events`) is the primary structure — a long-living journal of the entire org. Features are *lenses* (saved slices), not containers. No hierarchy as navigation, no graph-visualization UI — the graph lives in retrieval; time is the axis. Full reasoning: memory `project_journal_as_product` + PRD v0.3.1 (amended today — §The Model, §Journal, §MCP Surface).

**Editorial as brand, utilitarian as behavior.** B2B-utilizable: keyboard-first review, ⌘K palette (`cmdk` already in deps), exact timestamps, dense workhorse pages; ink language stays as skin. Shadcn goes, but keep a thin headless layer for menus/dialogs. Serif for headlines/prose only; stagger animation first-load only.

**Agents get full access.** Research *and* manipulation on Gilad's behalf over MCP — mirror the web API's ops (feature create/update, file-map globs, review approve/reject/edit, journal read) as MCP tools with `agent:` actor attribution. Prereqs: parameterize `queryEvents` (`queries.ts:321`, injection-prone) and land API-review F5 provenance. Do together with v1.1 (`docs/specs/2026-07-03-brain-api-review.md` F1–F8).

## Workstreams (priority order)

1. Commit the tree (above).
2. **Cut the Topic subsystem** (Gilad's mandate: outdated implementation distracts; code is source of truth as intent evolves — but only *after* the commit snapshot). Inventory: `src/brain/` + `src/pipeline/brain-{synthesis,apply,relevance}.ts` (~1,950 LOC) · CLI `brain`/`brain-classify`/`brain-export` · MCP `brain_overview`/`brain_get`/`brain_traverse` + topic-keyed `brain_search` (re-key onto Features per API-review F1, don't just delete search) · UI `KnowledgeTreePage`/`TopicDetail`/`BrainCardView`/`SyncDiffTree`/`BrainSync` + the `sync`/`topic`/`knowledge` views in App · ~16 topic-touching test files · `topics`/`insights`/`brain_cards`/`topic_*` tables (leave the tables; drop reads/writes — read-side adapters over legacy data, never destructive). **Two caveats:** `.repo/brain.md` stays untouched — it is the measurement-v2 *baseline* document the treatment arm must beat; and BrainSync is currently the only flow that ingests undigested sessions from the dashboard — preserve the digest-trigger part when removing the topic-synthesis part.
3. **Real search** — the Journal search box filters ~200 client-loaded episodes; it searches nothing. Hybrid: Postgres FTS/trigram now, pgvector on the existing `embedding` column next (embed at emit), fused with filters + neighborhood expansion (session/feature/runId/thread). One engine for Journal UI and `brain_search`.
4. **Comments as events** — `comment:*` with `sourceId` → target; replies point at comments; promotion path comment → observation → approval loop. No new tables.
5. **Cron digestion, configurable epochs** — `digest-watch` CLI, `--interval`/`--debounce` user-settable, mtime-quiet debounce, reuse `src/utils/log-discovery.ts`; emit `digest:run` per observability design §7.3. Caveat: resumed already-digested sessions won't re-digest (orchestrator keyed on CC session UUID).
6. Agent full-access MCP + API v1.1 (together).
7. Slack adapter → `integration:slack` events. Then measurement v2 (`docs/specs/2026-07-03-measurement-v2-spec.md`) — seed `story-time` early, ~30-day log retention.

## Gotchas that cost hours today

- **Docker runs on colima, not Docker Desktop.** Desktop half-starts, squats port 5433, and black-holes connections (TCP connects, no data). Keep it quit. `CONNECT_TIMEOUT` from host → colima's ssh port-forward died → `colima restart`.
- Host disk hit 100% and wedged the VM + corrupted Docker's layer store mid-pull (fixed by clearing DerivedData/npm/brew caches — watch free space).
- `review_status` defaults `'pending'` on **all** events — scope any review-queue query by `category LIKE 'observation:%'` or history becomes backlog.
- Pinning in the Correspondence focuses the composer (deliberate: pin→ask); keyboard page-nav resumes after Esc. Beats inside collapsed episodes aren't navigable until expanded.

## What good looks like

Work in the grain: pure functions, lenient Zod, events freeform, read-side adapters over legacy data. Tests ≥396, tsc ≤26. Close each loop live before building the next layer — today's biggest lesson: the plan said "apply the migration"; reality said the migration chain itself was the first thing the live loop exposed as broken. When something breaks, write it down here for the next one.
