# Intent-AI: Org-Level Learning Layer for AI-Assisted Development

A TypeScript system that captures knowledge from AI coding sessions and makes it available to agents and humans. Ingests conversation logs, extracts execution memory into a journal of activity events, converges understanding on Features, and serves it via MCP to any agent mid-session.

## Quick Start

```bash
npm install
npx tsx src/cli/index.ts up          # start Postgres (Docker, port 5433)
npx tsx src/cli/index.ts digest      # digest latest CC session
npx tsx src/cli/index.ts digest --dry-run  # deterministic pipeline only, no LLM
npx tsx src/cli/index.ts web --port 3456   # start dashboard
```

Requires: `ANTHROPIC_API_KEY` and `DATABASE_URL` in `.env` (see `.env.example`).

## Vision

Intent-AI (product name: **Quire**) is an **organizational understanding engine**: it correlates **intent** — "what we want" (PRDs and, later, other signals) — with **implementation** — "what we have" (code and sessions) — and serves the current understanding to humans and agents over MCP. **The event river (Journal) is the substrate; Feature is the primary lens** — intent and implementation are two kinds of evidence sliced by it; **alignment** ("is what we built still what we wanted?") is the differentiator. Understanding is the umbrella; alignment is the spearhead. No trees, no graph-viz UI — time is the axis, search is the front door.

**Source of truth for product direction: [`docs/prd.md`](docs/prd.md) (PRD v0.3.1 — journal-as-product amendments).** Deferred bets live in [`docs/future-knowledge.md`](docs/future-knowledge.md).

The mechanism is a continuous loop:

1. **Capture** — ingest coding sessions (Claude Code today, Codex/Copilot/Jira/Slack later)
2. **Understand** — extract moments, transitions, outcomes, narrative arcs
3. **Observe** — LLM-driven observation layer notices patterns across sessions
4. **Learn** — approved observations become Feature understanding
5. **Serve** — MCP server makes the brain available to any agent mid-session
6. **Improve** — each session makes the brain smarter for the next

The MCP server is the integration surface — any tool that speaks MCP can query the brain. The Week-1 MVP proves feature-aware context measurably improves coding-agent performance (see the PRD's ETC/CVR measurement harness); intent ingestion and alignment/drift are Phase 2.

## Commands

```bash
# Session digestion
npx tsx src/cli/index.ts digest [path]       # digest a session
npx tsx src/cli/index.ts digest --dry-run    # stats only, no LLM
npx tsx src/cli/index.ts digest --last 3     # digest N most recent

# MCP brain (available to agents via .mcp.json)
npx tsx src/cli/index.ts mcp                        # start MCP server (stdio)
# Tools (Feature-keyed): brain_enter, brain_file_context, brain_feature_context,
#   brain_search, brain_report_observation, brain_report_unknown, brain_rate_context,
#   brain_propose_knowledge_delta (deferred per F7). The Topic ontology was
#   excised 2026-07-04 (PRD v0.3.1 / API review F1).

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
```

## Testing

```bash
npm test                    # run all tests (vitest)
npx vitest run              # same, explicit
npx tsc --noEmit            # type check
npx tsx run-fidelity.ts     # run fidelity eval (measurement-v2 baseline)
```

## Architecture

### Pipeline

```
CC log → parse → normalize (+ threading) → [classify + chunk + analyze] → sittings → chunks → extract → weave → verify → transitions → narrative → emit events
         │         │                          │          │        │            │          │         │        │        │         │            │           │
       adapter   deterministic             Haiku     deterministic        deterministic  determ  Sonnet×N  Sonnet×1  Sonnet×1  Sonnet×1    Sonnet×1   deterministic
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
    understand/    Understanding stage — sittings → chunks → extract → weave → verify
    emit-events.ts  Builds ActivityEvents from session digest
    observe-events.ts LLM-driven observation layer over event stream
  llm/
    client.ts      Anthropic SDK wrapper (streaming, retries, Zod validation)
    prompts/       Prompt builders per pipeline step
  storage/         Postgres via Drizzle ORM
  cli/             Commander.js CLI
  mcp/             MCP server — Feature context for agents (8 tools, stdio transport)
  eval/            Fidelity eval + measurement-v2 (mvp) harness
  web/             Dashboard server (Journal-first: river + lenses + Correspondence chat dock)
  daemon/          Background daemon for continuous session watching
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

1. Run eval, capture baseline: `npx tsx run-fidelity.ts`
2. Read the ACTUAL pipeline output — moments, narrative
3. Identify what's wrong
4. Modify code
5. Re-run eval and compare

Fixtures in `tests/eval/fixtures/`. Criteria in `tests/eval/fidelity-criteria.ts`. Fidelity harness in `src/eval/fidelity.ts`.

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
| `docs/prd.md` | **Product source of truth** — Brain PRD v0.3.1 (vision, journal-as-product model, MVP, measurement). Read first. |
| `docs/future-knowledge.md` | Consciously deferred hypotheses (the alignment moat, and more). |
| `docs/consolidation-iteration-0.md` | Triage of the prior-plan corpus → seeded MVP backlog + durable observations. |
| `.repo/brain.md` | **Frozen legacy export** — kept only as the measurement-v2 *baseline* document (the treatment arm must beat it). The Topic subsystem that generated it was excised 2026-07-04. |
| `docs/superpowers/specs/` | Kept design specs (execution-memory, activity-event backbone). Prior specs/plans archived. |
| `docs/archive/` | Superseded prior plans/specs/handoffs (historical; framing replaced by v0.3). |
| `docs/handoffs/` | Session handoffs for continuity. |
