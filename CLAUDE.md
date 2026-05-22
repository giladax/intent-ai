# Intent-AI: Execution Memory System

## What This Is

A TypeScript CLI that ingests Claude Code conversation logs and produces execution memory — not summaries, but reconstructions of how understanding evolved during AI-assisted development.

## Quick Start

```bash
npm install
npx tsx src/cli/index.ts up          # start Postgres (Docker, port 5433)
npx tsx src/cli/index.ts digest      # digest latest CC session
npx tsx src/cli/index.ts digest --dry-run  # deterministic pipeline only, no LLM
```

Requires: `ANTHROPIC_API_KEY` and `DATABASE_URL` in `.env` (see `.env.example`).

## Architecture

### Pipeline Flow (current)

```
CC log → parse → normalize (+ threading) → [classify + chunk + analyze] → moments p1 → moments p2 → transitions → narrative
         │         │                          │          │        │           │             │             │            │
       adapter   deterministic             Haiku     deterministic        Sonnet ×N     Sonnet ×1     Sonnet ×1    Sonnet ×1
```

Steps 1-3 and chunking are deterministic (no LLM). Moments pass 1 fans out per chunk in parallel.

### Key Design Principles

1. **Pre-computation reduces LLM complexity** — each step pre-computes what the next step would otherwise infer. The LLM is an editor, not an analyst.
2. **Evidence flows through the pipeline** — never truncate or strip evidence between stages.
3. **Behavioral signals > content** — HOW the developer interacts (passive/challenge/delegation) matters more than WHAT was discussed.
4. **Eval-Driven Development** — write eval fixtures and criteria BEFORE implementation. Use real CC session data.

### Source Layout

```
src/
  adapters/        CC log parser (uses @constellos/claude-code-kit)
    types.ts       All domain types: NormalizedDevEvent, SessionMoment, PipelineDirectives, etc.
  pipeline/        Processing steps (each is a function, no classes)
    normalize.ts   Raw → Normalized events + causal threading (respondingTo, turnId)
    analyze.ts     Interaction analysis → PipelineDirectives (behavioral flags)
    classify.ts    Session shape classification (Haiku)
    chunk.ts       Deterministic chunking (pause, file shift, topic shift, size cap)
    moments.ts     Two-pass moment detection (Sonnet)
    transitions.ts Intent transitions + accepted outcomes (Sonnet)
    narrative.ts   Session narrative generation (Sonnet)
    orchestrator.ts End-to-end pipeline runner
  llm/
    client.ts      Anthropic SDK wrapper (lazy init, retries, Zod validation)
    prompts/       Prompt builders per pipeline step
  storage/         Postgres via Drizzle ORM
  cli/             Commander.js CLI (digest, explore, eval, up, down)
  eval/            Fitness function for chromosome evaluation
  utils/           CC log discovery
```

## Commands

```bash
npx tsx src/cli/index.ts digest [path]       # digest a session
npx tsx src/cli/index.ts digest --dry-run    # stats only, no LLM
npx tsx src/cli/index.ts digest --last 3     # digest N most recent
npx tsx src/cli/index.ts up                  # start Postgres + migrate
npx tsx src/cli/index.ts down                # stop Postgres
npx tsx run-gen0.ts                          # run Gen 0 fitness evaluation
```

## Testing

```bash
npm test                    # run all tests (vitest)
npx vitest run              # same, explicit
npx tsc --noEmit            # type check
```

86 tests across 11 files. All pipeline steps have tests. Moment/transition/narrative tests mock LLM calls.

## Specs & Plans

| Document | Status |
|----------|--------|
| `docs/superpowers/specs/2026-05-21-execution-memory-design.md` | Original system spec |
| `docs/superpowers/specs/2026-05-22-causal-threading-design.md` | Layer 0: causal threading (implemented) |
| `docs/superpowers/specs/2026-05-22-layer1-pipeline-redesign.md` | Layer 1: pre-computation, routing, critic (specced) |
| `docs/superpowers/specs/2026-05-22-chromosome-framework.md` | Chromosome framework for evolutionary optimization |
| `docs/plans/2026-05-21-execution-memory.md` | Original implementation plan |
| `docs/plans/2026-05-22-causal-threading.md` | Layer 0 implementation plan |

## Chromosome Framework

The pipeline is being optimized using a genetic algorithm approach. Each pipeline node is an **organism** composed of 4 chromosomes:

- **Chr 1: Instructions** — what the node does (system prompt or deterministic logic)
- **Chr 2: Format** — how input is rendered (flat, threaded, behavioral headers, change ledger)
- **Chr 3: Synthesis** — what's pre-computed (none, exchange pairs, full pre-computation, arc grouping)
- **Chr 4: Data Selection** — what raw data enters (conversation only, +actions, +results, +diffs)

The **topology** (how nodes connect) is also a variable: linear, routed, top-down, critic loop, or hybrid.

Eval fixtures from our real CC session data are in `tests/eval/fixtures/`. Criteria in `tests/eval/session-criteria.ts`.

## Models

- Sonnet: `claude-sonnet-4-6` (reasoning, moment detection, narrative)
- Haiku: `claude-haiku-4-5` (classification, critic)

## Database

Postgres 16 via Docker Compose on port **5433** (not 5432 — avoids conflict with other containers). Schema in `src/storage/schema.ts`, migrations in `drizzle/`.

## Conventions

- TypeScript ESM (`"type": "module"` in package.json)
- `.js` extensions in imports (ESM requirement)
- Vitest for testing
- Zod for LLM output validation (lenient schemas — `.optional().default()` and `.passthrough()` to handle LLM variance)
- No classes — pipeline steps are exported functions
- All types in `src/adapters/types.ts`
