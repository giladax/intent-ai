# Successor Prompt

Read these docs in order, then execute:

1. `CLAUDE.md` — project standards, commands, conventions
2. `docs/handoffs/2026-05-23-repo-brain-session-2.md` — what's built, what's not, pipeline design
3. `docs/handoffs/2026-05-23-code-changes-brain-graph.md` — the vision (versioned knowledge, mutation loop, insight model, drill-down)
4. `docs/superpowers/specs/2026-05-23-repo-brain-design.md` — spec (data model, categories, dashboard layout)

## Current state

Branch `feat/repo-brain` has the working vertical slice:
- `intent brain <sessionId...>` — synthesizes topics from sessions, stores to DB, creates brain version
- `intent brain-classify <sessionId>` — Haiku relevance matching (session ↔ topics)
- `intent brain-export` — generates `.repo/brain.md` + `.repo/topics/*.md`
- Brain versioning works — each run creates a version with parent chain
- 6 topics in DB, 2 brain versions, 120 tests passing

## What to do next

### Priority 1: Wire the full two-stage pipeline

The classifier and synthesizer exist independently. Connect them into `intent brain-sync`:

```
classify (Haiku) → assemble scoped context per topic → synthesize (Sonnet, parallel per topic) → merge (deterministic) → verify (Haiku) → store + version
```

Key: the classifier uses SEMANTIC matching (session narrative/arcs/moments/outcomes against topic insights), NOT file overlap. Each Sonnet call gets scoped context — only moments relevant to that topic, not the full session.

Read `src/pipeline/brain-relevance.ts` and `src/pipeline/brain-synthesis.ts` — these are the two halves to connect.

### Priority 2: Dashboard redesign

The current dashboard (`src/web/`) is a flat session list. Needs two tabs:

**Brain tab** (new):
- Topic list with activity counts (sessions, moments, brain updates per topic)
- Topic detail panel: insights by category, files, evidence sessions
- Click topic → related files highlight. Click file → related topics show.
- Filter by category or file (bidirectional)
- Chat scoped to selected topic

**Sessions tab** (existing, improved):
- Group by repo (repo selector at top)
- Add topic badges per session (which topics it contributed to)
- Click badge → jumps to brain tab

Layout agreed in spec:
```
[Repo selector]          [Brain] [Sessions]
┌─────────────┬──────────────────┬──────────────┐
│ Topics list │ Topic/Session    │ Chat         │
│ with counts │ detail panel     │              │
└─────────────┴──────────────────┴──────────────┘
```

Read `src/web/server.ts` for existing API structure. Brain tab needs new endpoints:
- `GET /api/topics?repoId=` — topics with counts
- `GET /api/topics/:id` — topic detail with insights, files, evidence sessions
- `GET /api/topics/:id/sessions` — sessions that contributed to this topic
- `GET /api/files/:path/topics` — reverse lookup: which topics touch this file

### Priority 3: Mutation tracking

Brain versions exist but don't record WHAT changed. Add a `brain_mutations` table that stores created/updated/deprecated insights per version. This enables the mutation report from the vision doc.

## Important design decisions (don't undo these)

- Topics are CONCEPTS, not files — "digestion pipeline" not "src/pipeline/"
- 6 insight categories (structure/decision/constraint/behavior/risk/interface) — each changes agent behavior
- Semantic matching via Haiku, not file overlap — files are weak signals
- Brain evolves through versions, never regenerated from scratch
- Sessions are primary evidence; diff analysis is fallback for sessionless commits
- CLAUDE.md stays clean — no planning, no next steps, only project standards
- EDD workflow: iterate on real data, human review first, then LLM-as-judge

## How to verify your environment

```bash
npm install
npx tsx src/cli/index.ts up                    # start Postgres
npx vitest run                                  # 120 tests should pass
npx tsx src/cli/index.ts brain-export          # should generate .repo/ files
npx tsx src/cli/index.ts web --port 3456       # dashboard at localhost:3456
```

DB has 8 digested sessions and 6 brain topics ready to work with.
