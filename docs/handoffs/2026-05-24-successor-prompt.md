# Successor Prompt

Read these docs in order, then execute:

1. `CLAUDE.md` — project standards, commands, conventions
2. `docs/handoffs/2026-05-24-repo-brain-session-3.md` — what's built, what's not, quality issues, UX direction
3. `docs/superpowers/specs/2026-05-23-repo-brain-design.md` — brain spec (data model, categories, pipeline, dashboard)
4. `docs/superpowers/specs/2026-05-24-dashboard-redesign.md` — dashboard spec (Brain/Sessions tabs, layout)

## Current state

Branch `feat/repo-brain`. Working system:
- `intent digest` — session digestion (working, handles large sessions via streaming)
- `intent brain <sessionId...>` — synthesize topics per-project, store to DB, version chain
- `intent brain-classify <sessionId>` — Haiku relevance matching
- `intent brain-export` — generates `.repo/brain.md` + `.repo/topics/*.md`
- `intent web --port 3456` — dashboard with Brain/Sessions tabs

4 projects in DB (intent-ai, brain, telegram, telegram-tmp). Brain rebuild running — topics are being re-scoped per project.

120 tests passing, 15 test files.

## Priority 1: Quality review of brain synthesis + narrative

**This is the most important work.** The current topic synthesis output is too narrow, too cryptic, and reads like compressed changelog entries. Narratives are robotic.

What "good" looks like: a topic should give a developer joining the project a MENTAL MODEL, not a fact list. "Brain tracks which conversation logs it has already processed. The cursor mechanism was originally a simple timestamp but broke in production..." — not — "The cursor was redesigned from a bare timestamp to a JSON object."

### How to approach
1. Run `intent brain --dry-run <sessionId>` on one session, read the output
2. Compare against the session narrative (`intent web` → Sessions tab → click session)
3. Identify what's wrong: too compressed? missing context? wrong abstraction level?
4. Edit the synthesis prompt at `src/llm/prompts/brain-synthesis.ts`
5. Re-run on same session, compare
6. Iterate until topics feel like something you'd want to read
7. Same for narrative prompt at `src/llm/prompts/narrative.ts`

### Key prompt files
- `src/llm/prompts/brain-synthesis.ts` — brain topic extraction prompt
- `src/llm/prompts/narrative.ts` — session narrative prompt
- `src/llm/prompts/moments.ts` — moment detection prompt

## Priority 2: Dashboard polish with shadcn blocks

The current dashboard works but uses hand-rolled CSS. Redesign using shadcn blocks (https://ui.shadcn.com/blocks):
- Use the sidebar layout block as the foundation
- Match Claude Console aesthetic: off-white warm background, minimal borders, clean typography, generous spacing
- Install shadcn: `cd src/web/ui && npx shadcn@latest init`
- Keep Brain/Sessions tab structure, topic detail panel, chat panel

## Priority 3: Wire the full brain pipeline

Connect classifier + synthesizer into `intent brain-sync`:
```
classify (Haiku) → scoped context per topic → synthesize (Sonnet, parallel) → merge → verify → store + version
```

Read `src/pipeline/brain-relevance.ts` and `src/pipeline/brain-synthesis.ts` — these are the two halves.

## Important design decisions (don't undo)

- 6 insight categories: structure, decision, constraint, behavior, risk, interface
- Topics are CONCEPTS, not files
- Semantic matching via Haiku, not file overlap
- Brain evolves through versions, never regenerated from scratch
- Per-project scoping via source_path auto-detection
- Sessions are private (user's execution memory), brain is shared knowledge
- DB for depth, markdown for agent access
- EDD: iterate on real data, human review first, then LLM-as-judge
- CLAUDE.md stays clean — no planning, no next steps, only project standards

## How to verify your environment

```bash
npm install
docker compose up -d                        # or: npx tsx src/cli/index.ts up
npx vitest run                              # 120 tests should pass
npx tsx src/cli/index.ts brain-export       # should generate .repo/ files
npx tsx src/cli/index.ts web --port 3456    # dashboard at localhost:3456
```
