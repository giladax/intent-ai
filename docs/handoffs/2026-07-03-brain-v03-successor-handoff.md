# Handoff — Brain v0.3 continuation (measurement v2 · Journal phase 2 · API v1.1 · cleanups)

> Follow-up handoff: decisions below are settled — don't relitigate them; the open problems are yours to solve. Read the linked sources before the code.

## Where things stand (all on `feat/repo-brain`, unpushed)

| Commit | What | State |
|---|---|---|
| `a6ef2b1` | PRD corrected (Brain-*derived* context hypothesis, two-repo scope, integrations table) + `docs/specs/2026-07-03-measurement-v2-spec.md` + `docs/specs/2026-07-03-brain-api-review.md` | accepted design, **nothing executed** |
| `1002c16` | `mcp:*` self-instrumentation + `review:*` events + write-path provenance (`src/mcp/instrument.ts`) | unit-tested, **never run against live Postgres** |
| `0f1956d` | `/api/journal` grouper (`src/web/journal.ts`) + Journal page | grouper fully unit-tested; **route SQL never executed** (DB down, `drizzle/0007` unapplied) |
| `1ac8554` + `7cb65c5` | Ink & paper: Journal editorial design, then the whole app re-skinned (`src/web/ui/src/app-ink.css`) | visually verified light+dark via headless Chrome against a mock API only |

Design doc of record for observability: `docs/plans/2026-07-03-observability-design.md` (phases, instrumentation contract §7). 396 tests green; `tsc --noEmit` has a **pre-existing 26-error baseline** — hold the line, don't add to it.

## The single most important next step

Nothing in this branch has touched a real database. **Apply `drizzle/0007`, start Postgres, digest the surviving sessions, seed 2–3 Features, run one live `brain_enter` end-to-end, open the Journal.** Every workstream below is blocked or hollow until that loop closes once (measurement spec §4 says the same).

## Workstreams (priority order)

1. **Measurement v2** — execute `docs/specs/2026-07-03-measurement-v2-spec.md`. The v1 task list is retired; live collection (§3.7) is the unowned long pole. Seed `story-time` with 5–10 real sessions early (its old logs are purged; ~30-day retention).
2. **New feature wanted: scheduled digestion with debounce.** Gilad wants session digestion on a cron: watch `~/.claude/projects/**` for new/updated JSONL, and digest a session only after it has been **quiet for a debounce window** (a session written to 2 minutes ago is probably still running — digesting mid-session wastes LLM calls and produces a truncated narrative). Note `src/daemon/` already watches sessions live and digest is now idempotent (`6919d59`), so the pieces exist; the design question — daemon-triggered vs. OS cron vs. in-process scheduler, and the right debounce signal (mtime quiet? SessionEnd hook?) — is yours. This also feeds the Journal: fresh rivers need fresh digestion. Emit `digest:run` events per the §7.3 contract while you're in there.
3. **Journal phase 2** (design doc §8): Review Deck with teaching receipt, `eval:run`/`digest:run` emitters, fix `emit-events.ts` digest-time stamping (the known intra-session chronology bug, §7.1).
4. **API v1.1** — `docs/specs/2026-07-03-brain-api-review.md` findings F1–F8: one ontology (retire Topic tools), structured candidate output, no silent task guess, `isError` on failures.

## Cleanups needed (before or alongside the above)

- **Working-tree strays, uncommitted:** `CLAUDE.md` (user-edited vision — commit it; also its MCP tool list still names 5 tools, now 11), `skills-lock.json`, and untracked `backfill-events.ts` / `list-sessions.ts` / `test-daemon.sh` / `.agents/` / `.claude/skills/to-prd` — triage: commit, move under `scripts/`, or delete. Ask Gilad only if content looks non-disposable.
- **Duplicate `globToRegExp`** with *different* semantics — `src/mcp/feature.ts:56` vs `src/eval/transcript-metrics.ts:143` (API review M1). Unify.
- **Token duplication:** `journal.css` re-declares the `--j-*` tokens that `app-ink.css` now owns app-wide — strip the journal copy, keep only its page-specific styles.
- **Dead UI code:** `sidebar-left.tsx`, `nav-*.tsx`, `team-switcher.tsx`, `calendars.tsx`, `date-picker.tsx` (unused shadcn scaffold); `OverviewPanel`, `KnowledgeTreePage`, `TopicList`, `TopicDetail`, `BrainCardView` are now nav-orphaned (Topic ontology retired). Delete the scaffold; for the Topic views, confirm with Gilad before deleting — they're the only UI over `.repo/` exports.
- **`/api/journal` has no repo scoping** — all repos share one river. Add `repoId` (needs a `repo` filter through the grouper; the UI already keys its cursor per repo).
- **`queryEvents` builds WHERE by string interpolation** (`src/storage/queries.ts:321-341`) — injection-prone; parameterize before anything externally reachable (already a P3 backlog item in `docs/consolidation-iteration-0.md`).
- **26 baseline tsc errors** (3 × `repoId` in `src/web/server.ts` ~1025+, `RowList` in `queries.ts:175`, rest) — burn down opportunistically.
- **`src/eval/mvp-task-criteria.ts` is retired but still committed** — measurement v2 requires the answer key out of the eval checkout; move criteria out of `src/` per spec §3.6.
- **The mock-API demo server** used for UI assessment lives at `/tmp/journal-demo/server.mjs` (throwaway) — worth recreating under `scripts/` if UI iteration continues; it can navigate, force dark mode, seed cursors.

## What good looks like

Work in the existing grain: pure functions, lenient Zod, events freeform (no enums), read-side adapters over legacy data (never backfills), commit per slice with tests at 396+ and tsc at ≤26. When you close the first live end-to-end loop, write down what actually broke — that list is worth more than any of the plans above.
