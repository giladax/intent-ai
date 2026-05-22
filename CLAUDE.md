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

### Pipeline as a Configurable Graph

The pipeline is NOT a fixed sequence. It's a **graph of nodes**, where each node dynamically composes its behavior at runtime.

**A node** is a processing unit that can be:
- 0 LLM calls (deterministic — normalize, chunk, pre-compute)
- 1 LLM call (classify, detect moments)
- Multiple LLM calls (fan-out per chunk, critic loop, router → specialists)

**Each node is an organism** — 4 chromosomes composed in parallel:

```
          ┌─ Chr 1: Instructions ─────┐
          │   (prompt, or deterministic │
          │    logic, or router)        │
          │                            │
          ├─ Chr 2: Format ────────────┤
          │   (how input is rendered    ├──▶  NODE OUTPUT
          │    for this node)           │
          │                            │
          ├─ Chr 3: Synthesis ─────────┤
          │   (what's pre-computed)     │
          │                            │
          └─ Chr 4: Data Selection ───┘
              (what raw data enters)
```

**Chromosomes are independent** — they don't feed each other. They're all assembled into one processing unit. A node can select its prompt, format, synthesis strategy, and data filter **dynamically** based on upstream analysis (e.g., a router node picks which prompt allele to use based on session shape).

**The topology** (how nodes connect) is also a variable:

```
Linear:    A → B → C → D
Routed:    A → router → {B_simple | B_full} → C
Top-down:  A → planner → fan-out [B₁, B₂, B₃] → merge → C
Critic:    A → B → critic → {pass: C | fail: revise → critic}
Hybrid:    All of the above combined
```

### Current Implementation (static, being evolved)

```
CC log → parse → normalize (+ threading) → [classify + chunk + analyze] → moments p1 → moments p2 → transitions → narrative
         │         │                          │          │        │           │             │             │            │
       adapter   deterministic             Haiku     deterministic        Sonnet ×N     Sonnet ×1     Sonnet ×1    Sonnet ×1
```

This is the baseline (Topology L, all nodes using default organisms). The chromosome framework evolves toward better configurations by testing combinations against real eval fixtures.

### Pipeline State Flow

Each step enriches a shared context — never replaces upstream data.

| After step | Data available | Type |
|------------|---------------|------|
| parse | `rawEvents` | `RawDevEvent[]` |
| normalize | `normalizedEvents` | `NormalizedDevEvent[]` (with `causalOrder`, `respondingTo`, `turnId`) |
| analyze | `directives` | `PipelineDirectives` (behavioral flags + exchange summary) |
| classify | `sessionShape` | `SessionShape` |
| chunk | `sessionChunks` | `SessionChunk[]` (with `topicHint`, `filesInScope`) |
| moments | `sessionMoments` | `SessionMoment[]` (with arc assignments) |
| transitions | `transitions`, `outcomes` | `IntentTransition[]`, `AcceptedOutcome[]` |
| narrative | `narrative` | `SessionNarrative` |

**State enrichment pattern:** Each step adds — never replaces. For example, `directives` from analyze flow into `detectMoments()` alongside chunks and session shape. The directives conditionally inject prompt sections (e.g., if `detectPassiveAcceptance` is true, the moments prompt gets an "Interaction Signals" block).

**All types** are in `src/adapters/types.ts`. Read this file before modifying any pipeline step.

### Dynamic Composition (how it works today)

Even in the current static implementation, nodes compose behavior at runtime:

1. **Prompts change based on input.** The moments prompt conditionally includes "Interaction Signals" sections based on `PipelineDirectives`. See `buildPass1Prompt()` in `src/llm/prompts/moments.ts`.

2. **Format adapts per session shape.** `getShapeGuidance()` in `src/llm/prompts/moments.ts` injects different guidance for janitorial vs exploratory vs debugging vs narrative sessions.

3. **Pre-computation shapes downstream behavior.** `analyzeInteractions()` builds exchange pairs and computes behavioral flags → becomes `PipelineDirectives` → toggles prompt sections in moments. Chr 3 output literally shapes what Chr 1 tells the LLM to look for.

4. **Topology is a variable.** Current = Topology L (linear). Specs define R (routed), T (top-down), C (critic), H (hybrid). Topology changes mean adding/removing nodes in `orchestrator.ts`.

### Pre-computed vs LLM-inferred

| Pre-computed (deterministic) | LLM infers |
|------------------------------|------------|
| Turn exchanges (user + AI response pairs) | Moment type and significance |
| Behavioral flags (devAskedQuestion, devUsedReasoning) | Agency attribution (current — moving to pre-computed) |
| Causal threading (respondingTo, turnId) | Arc assignment and narrative arcs |
| Session chunking (pause, file shift, topic shift) | Cross-chunk deduplication |
| Session shape classification (Haiku, cheap) | Narrative synthesis |
| Pipeline directives (passive acceptance, delegation) | Statement quality |

The more you pre-compute, the simpler the LLM's job.

### Key Design Principles

1. **Pre-computation reduces LLM complexity** — each step pre-computes what the next step would otherwise infer. The LLM is an editor, not an analyst.
2. **Evidence flows through the pipeline** — never truncate or strip evidence between stages.
3. **Behavioral signals > content** — HOW the developer interacts (passive/challenge/delegation) matters more than WHAT was discussed.
4. **Eval-Driven Development** — write eval fixtures and criteria BEFORE implementation. Use real CC session data.
5. **Dynamic composition** — nodes select their prompt, format, and data strategy at runtime. A passive exchange gets minimal context; a developer challenge gets full evidence. The router decides, not a hardcoded config.

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

## Eval Workflow (EDD)

Eval-Driven Development: write eval criteria FIRST, run baseline, inspect failures, THEN change code.

### Running an eval

```bash
npx tsx run-gen0.ts          # full Gen 0 fitness evaluation against design-scope fixture
```

### The golden rule: inspect before you implement

Before changing any prompt or pipeline step:
1. Run the eval and capture the baseline score
2. Look at the ACTUAL pipeline output — read the moments detected, the narrative generated
3. Identify what's wrong (missing moments? wrong agency? generic language?)
4. Only then modify code
5. Re-run eval and compare

### Adding a new eval fixture

1. Extract a slice of CC conversation log into `tests/eval/fixtures/scope-<name>.jsonl`
2. Add a `ScopeCriteria` entry in `tests/eval/session-criteria.ts` with:
   - `mustDetectMoments`: moments you know should be found (by topic + type + agency)
   - `mustNotDetect`: anti-patterns the pipeline should not hallucinate
   - `narrativeMusts`/`narrativeMustNots`: phrases the narrative must/must not contain
   - `expectedDirectives`: what the interaction analysis should flag
3. Add the scope to the `allScopes` array
4. Run the eval to establish baseline

### Current baseline (Gen 0)

Overall: 65%. Narrative quality: 100%. Moment detection: 0% (generic fingerprints). Directive accuracy: 75%.

### Fitness weights (actual, in `src/eval/fitness.ts`)

| Metric | Weight |
|--------|--------|
| Moment detection | 0.30 |
| Moment precision | 0.10 |
| Narrative quality | 0.30 |
| Narrative precision | 0.10 |
| Directive accuracy | 0.20 |

Token efficiency is not yet scored.

## How-To Guide

### Add a new pipeline node

1. Create `src/pipeline/<name>.ts` — export a function, not a class
2. Define input/output types in `src/adapters/types.ts`
3. If it makes LLM calls, create a prompt builder in `src/llm/prompts/<name>.ts`
4. Wire it into `src/pipeline/orchestrator.ts` at the correct position in the state flow
5. Write tests in `tests/pipeline/<name>.test.ts` (mock LLM calls with vitest)
6. Run eval to verify no regression

### Add a new chromosome allele

**Note:** The chromosome framework (`docs/superpowers/specs/2026-05-22-chromosome-framework.md`) is specced but NOT fully implemented. The `src/eval/chromosomes/` directory doesn't exist yet. Today, allele behavior lives in:

- **Chr 1 (Instructions):** `src/llm/prompts/*.ts` — the system prompts
- **Chr 2 (Format):** `src/llm/prompts/moments.ts` — `formatThreadedEvents()` and related functions
- **Chr 3 (Synthesis):** `src/pipeline/analyze.ts` — the `analyzeInteractions()` function
- **Chr 4 (Data Selection):** `src/pipeline/normalize.ts` + `src/adapters/claude-code.ts` — what data passes through

To experiment with a new allele today, modify the relevant file and test the alternative behind a flag or conditional. Use the eval harness to compare.

### When to brainstorm vs. implement

- **New topology or new node type** → brainstorm first (spec → plan → implement)
- **New chromosome allele** → implement directly, evaluate with fitness function
- **Prompt wording changes** → implement directly, evaluate
- **Pipeline state changes (new fields, new types)** → spec first if it affects multiple nodes

### Know which model to use

- **Haiku** (`claude-haiku-4-5`): Classification, cheap critics, routing decisions. "Pick from N options" or "yes/no."
- **Sonnet** (`claude-sonnet-4-6`): Reasoning, moment detection, narrative generation. Nuance, natural language, judgment.

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

Evolutionary optimization of the pipeline. See `docs/superpowers/specs/2026-05-22-chromosome-framework.md` for full spec.

**3 levels of configuration:**

1. **Per-node organisms** — each node selects alleles for its 4 chromosomes. A node might dynamically pick its prompt allele based on input (e.g., use "exchange scorer" prompt for pre-computed inputs, "moment hunter" for raw inputs).

2. **Topology** — how nodes connect. Linear, routed (skip steps for simple sessions), top-down (arc planner → per-arc detection), critic loop, or hybrid.

3. **Per-exchange adaptation** — within a single node, different exchanges can get different treatment. A passive "ok" gets minimal context; a developer challenge gets full evidence with behavioral headers. The pre-computation step (Chr 3) determines the treatment.

**Eval:** Fixtures from our real CC session in `tests/eval/fixtures/` (4 scopes: design, implementation, pivot, full). Criteria in `tests/eval/session-criteria.ts`. Fitness function in `src/eval/fitness.ts`.

## Debugging Pipeline Runs

No integrated tracing system yet. To debug:

1. **Dry run first:** `npx tsx src/cli/index.ts digest --dry-run` — runs only deterministic steps. Check events parsed, exchanges built, directives correct, chunks reasonable.

2. **Read orchestrator log:** Pipeline emits step-by-step progress to stderr (`[1/10] Parsing...`). Watch for warnings (large session, truncation, JSON parse failures).

3. **Inspect prompt inputs:** Add temporary logging in `src/llm/prompts/moments.ts` (or other prompt builders) to print the `system` and `user` strings sent to the LLM.

4. **Check Zod failures:** LLM client validates responses with Zod. Schema validation errors show the exact field mismatch. Check the Zod schema in the relevant prompt file against what the LLM returned.

5. **Run single fixture:** Use the eval harness to isolate issues. Inspect the moments array and narrative object in the fitness result details.

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
