# Intent-AI: Execution Memory System

A TypeScript CLI that ingests Claude Code conversation logs and produces execution memory — reconstructions of how understanding evolved during AI-assisted development.

## Quick Start

```bash
npm install
npx tsx src/cli/index.ts up          # start Postgres (Docker, port 5433)
npx tsx src/cli/index.ts digest      # digest latest CC session
npx tsx src/cli/index.ts digest --dry-run  # deterministic pipeline only, no LLM
npx tsx src/cli/index.ts web --port 3456   # start dashboard
```

Requires: `ANTHROPIC_API_KEY` and `DATABASE_URL` in `.env` (see `.env.example`).

## Commands

```bash
# Session digestion
npx tsx src/cli/index.ts digest [path]       # digest a session
npx tsx src/cli/index.ts digest --dry-run    # stats only, no LLM
npx tsx src/cli/index.ts digest --last 3     # digest N most recent

# Repo brain
npx tsx src/cli/index.ts brain <sessionId...>       # synthesize topics from sessions
npx tsx src/cli/index.ts brain-classify <sessionId>  # classify session relevance to topics
npx tsx src/cli/index.ts brain-export                # generate .repo/ markdown from DB

# Activity events
npx tsx src/cli/index.ts events                     # query activity event stream
npx tsx src/cli/index.ts events --category struggle  # filter by category prefix
npx tsx src/cli/index.ts events --repo intent-ai     # filter by repo
npx tsx src/cli/index.ts observe-events              # run observation layer over recent events
npx tsx src/cli/index.ts observe-events --dry-run    # show observations without emitting

# Infrastructure
npx tsx src/cli/index.ts up                  # start Postgres + migrate
npx tsx src/cli/index.ts down                # stop Postgres
npx tsx src/cli/index.ts web --port 3456     # start dashboard
npx tsx run-gen0.ts                          # run Gen 0 fitness evaluation
```

## Testing

```bash
npm test                    # run all tests (vitest)
npx vitest run              # same, explicit
npx tsc --noEmit            # type check
```

## Architecture

### Pipeline

```
CC log → parse → normalize (+ threading) → [classify + chunk + analyze] → moments p1 → moments p2 → transitions → narrative → emit events
         │         │                          │          │        │           │             │             │            │           │
       adapter   deterministic             Haiku     deterministic        Sonnet ×N     Sonnet ×1     Sonnet ×1    Sonnet ×1   deterministic
```

Each step enriches a shared context — never replaces upstream data. All types in `src/adapters/types.ts`. Read this file before modifying any pipeline step.

### Activity Event Backbone

A unified `activity_events` table captures every significant thing that happens — session moments, brain mutations, live observations — as time-ordered, searchable, RAG-ready events. Events are self-contained (denormalized session context). Categories and tags are freeform. See `docs/superpowers/specs/2026-06-21-activity-event-backbone-design.md`.

### Source Layout

```
src/
  adapters/        CC log parser (uses @constellos/claude-code-kit)
    types.ts       All domain types
  pipeline/        Processing steps (each is a function, no classes)
    orchestrator.ts End-to-end pipeline runner
    emit-events.ts  Builds ActivityEvents from session digest
    observe-events.ts LLM-driven observation layer over event stream
  llm/
    client.ts      Anthropic SDK wrapper (streaming, retries, Zod validation)
    prompts/       Prompt builders per pipeline step
  storage/         Postgres via Drizzle ORM
  cli/             Commander.js CLI
  eval/            Fitness scoring, LLM-as-judge, organism runner
  web/             Dashboard server (three-panel: Features | Sessions+Story | Chat)
  utils/           CC log discovery
```

## Conventions

- TypeScript ESM (`"type": "module"` in package.json)
- `.js` extensions in imports (ESM requirement)
- Vitest for testing
- Zod for LLM output validation (lenient schemas — `.optional().default()` and `.passthrough()`)
- No classes — pipeline steps are exported functions
- All types in `src/adapters/types.ts`
- Sonnet (`claude-sonnet-4-6`) for reasoning, moments, narrative
- Haiku (`claude-haiku-4-5`) for classification, critics, routing

## Database

Postgres 16 via Docker Compose on port **5433** (not 5432). Schema in `src/storage/schema.ts`, migrations in `drizzle/`.

## Anti-Patterns

### NO regex for behavioral/semantic classification

Use LLM with structured output (Haiku) instead of regex for anything semantic — engagement detection, intent classification, topic shifts. Regex is fine for structural parsing (IDs, file paths, JSON extraction).

## Eval Workflow (EDD)

Write eval criteria FIRST, run baseline, inspect failures, THEN change code.

1. Run eval, capture baseline: `npx tsx run-gen0.ts`
2. Read the ACTUAL pipeline output — moments, narrative
3. Identify what's wrong
4. Modify code
5. Re-run eval and compare

Fixtures in `tests/eval/fixtures/`. Criteria in `tests/eval/session-criteria.ts`. Fitness in `src/eval/fitness.ts`.

## How-To

### Add a pipeline node

1. Create `src/pipeline/<name>.ts` — export a function
2. Define types in `src/adapters/types.ts`
3. Create prompt builder in `src/llm/prompts/<name>.ts` if LLM-backed
4. Wire into `src/pipeline/orchestrator.ts`
5. Write tests in `tests/pipeline/<name>.test.ts`
6. Run eval to verify no regression

### Emit activity events from a new source

1. Import `emitEvents` from `src/storage/queries.ts` and `ActivityEvent` from `src/adapters/types.ts`
2. Build events with freeform `category`, `tags`, `actor`, `summary`, and structured `metadata`
3. Call `emitEvents(events)` wrapped in try/catch (never fail the parent operation)
4. Events auto-carry `repo`, `branch`, `worktree` when emitted from the pipeline

## Agent Skills (`.claude/skills/agents/`)

Structured guides for agentic pipeline work. **Read before modifying the pipeline or running experiments.**

| Directory | When to use |
|-----------|-------------|
| `playbooks/` | Step-by-step procedures — running experiments, reviewing results, managing complexity budgets |
| `strategies/` | Optimization approaches — prompts, topology, context composition, routing, judge tuning |
| `schemas/` | Structured output contracts — eval cases, judge output, node contracts, experiment reviews |
| `topologies/` | Graph patterns — single-node, supervisor-worker, plan-execute, reflection, verify-repair |
| `experiments/` | Experiment templates and results |

**Rule of thumb:** If you're changing how nodes connect → read `topologies/`. If you're changing what a node does → read `strategies/`. If you're running an eval experiment → read `playbooks/`.

## Reference

| Document | What |
|----------|------|
| `.repo/brain.md` | Repo knowledge graph — topics, insights, file map. Start here for codebase navigation. |
| `docs/superpowers/specs/` | Design specs (execution memory, causal threading, chromosome framework) |
| `docs/plans/` | Implementation plans |
| `docs/handoffs/` | Session handoffs for continuity |
