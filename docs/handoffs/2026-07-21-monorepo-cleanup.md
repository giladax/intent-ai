# Handoff — Monorepo cleanup (intent-ai)

**To:** the next Fable model. **You design the structure.** This gives you the mission, the constraints, and the map — deliberately *not* a blueprint. The prior session over-prescribed a target tree; the founder pulled it back. The scaffold is yours to propose.

**From:** prior session, 2026-07-21. Branch `feat/repo-brain`. HEAD `a007ac4`. Founder is non-technical, values short visible reversible slices, and trusts a capable model to make the calls.

---

## The mission

One git repo holds two ~equal codebases with **zero shared code**: ~19.5k lines of TypeScript in `src/` and ~18k lines of Python in `alignment/`, plus ~236 markdown docs, five competing dot-dirs, and stray root files. It "feels like chaos" because nothing declares the shape.

Turn it into **one self-respecting software project** — legible to a non-technical owner and to agents, only-what's-needed. This is a **folder/label reorg — no code rewrite, no DB migration this pass.**

## What's locked (principles — honor, don't relitigate)

- **Single repo.**
- **Concrete, legible names.** A folder should explain itself to someone unfamiliar with the project. Avoid insider jargon. (The prior session's `ingestion/`/`analysis/` split was rejected on exactly this: it says nothing to an outsider — and may be the wrong *axis* for the top level. Don't reach for it.)
- **No product mythology** (no "Brain"/"Align"/"feeder") in the structure. One project name; the story/vision lives in the **PRD**, not in folder names.
- **Docs: radically selective.** Keep a small durable trunk (a readable architecture doc, the PRD, CLAUDE.md, a glossary, dated decisions). Everything else archived or deleted. **Any doc naming a specific file/function/line gets verified against current code — if the code is gone, the doc goes** (git history is the safety net).
- **Reversible, green, one commit per slice**, small enough for the founder to react between them.

## Your first real task: propose the scaffold

Design it from the actual system, show the founder, get a nod, then execute. **Do not inherit a shape from me.** Things to weigh (not answers):

- The two codebases share **zero code** — different languages, different datastores, different entry points. They're nearly two apps that happen to cohabit.
- Each side is itself **heavily decoupled**: the TS pipeline is independent step-functions; the Python analysis is a deterministic core with LLM only at the edges; events/alarms/comms are separable. The founder explicitly wants the structure to **respect that decoupling** rather than flatten it into a generic front/back template.
- There's a **flow** — roughly capture → understand → serve/alarm. Whether the top level is best organized by app, by component, by flow-stage, or otherwise is your call. Optimize for: a newcomer's legibility, and honoring the decoupling.

Understand the repo yourself before proposing (fan out read-only agents if useful). The prior session's full grep-verified keep/move/archive/delete inventory (40 items) exists from workflow run `wf_acc48060-af9` — use it as evidence, not as a plan.

## The map (what exists today)

- **TS `src/`:** ingests Claude Code session logs → parses/normalizes → LLM extracts "moments" → stores in **Postgres** (Drizzle, port 5433) → serves feature context to agents over an **MCP server**, plus a React/Vite dashboard under `src/web/ui`. Entry: `src/cli/index.ts`. Loose root `run-*.ts` scripts drive evals.
- **Python `alignment/`:** reads a PR/diff + declared product promises → decides keep/break → maintains an entity graph → fires quote-backed **alarms**; FastAPI server + CLI; self-contained (own `pytest.ini`, `requirements.txt`, **SQLite**). 229 tests + two evals green.
- **Beware false "dead code."** Prior surveys wrongly flagged live code: `classify-exchanges.ts`, `src/agents/`, the Python modules `hierarchy/graph_heuristics/entity_propose/onboard/timeline/atoms`, and the `topics/insights/brainVersions/brainCards` schema are all **live**. Grep-verify zero importers before removing anything.

## Where I stopped

- **Phase 1a committed (`300237e`):** removed grep-verified dead `src/pipeline/dedup.ts`, stray `.agents/`, and gitignored disk clutter. Tree clean; only the pre-existing dirty `feature.ts` remains uncommitted (leave it).
- **Nothing has moved. The structure is intentionally NOT decided — that's yours.**

## Invariants / landmines (guardrails — must hold whatever shape you choose)

- **Green at every phase; each phase its own commit; archive-over-delete.**
  - Python: `LANGCHAIN_TRACING_V2=false LANGSMITH_TRACING=false python3 -m pytest` → **229 passing**; `python3 -m evals.event_stream` + `python3 -m evals.alarms` → both "all clear".
  - TS: `npm test`, `npm run typecheck:ui` (TS tests may need Postgres up — `docker compose up`, port **5433**).
- **Never commit `src/mcp/feature.ts`** (uncommitted local change; standing rule). It moves with its folder but stays dirty.
- **Never edit/regenerate `alignment/workspaces/quire-brain`** — a rehearsed live demo.
- **Hardcoded paths break on any move — fix them in the same commit:** `.mcp.json` (`npx tsx src/cli/index.ts`), `tsconfig.json`, `drizzle.config.ts`, root `package.json` scripts; `alignment/quire_align/onboard.py`'s repo-scan **skip-list** (names `.repo`, `.superpowers`, `mockups`, `eval-runs`, `handoffs`, `.claude`, `skills`, `archive`, `fixtures`, `tests`); and `src/eval/mvp-task-criteria.ts` + `mvp-decontamination.test.ts`, which reference **`.repo/brain.md`** (the measurement-v2 baseline — keep it retrievable; don't just delete `.repo/`).
- **Do NOT unify the datastores** (Postgres/TS vs SQLite/Python) — intentional debt for a later pass.
- Commit trailers on every commit:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01353uysft2sGVgMeaJwgDcS
  ```

## Open questions for the founder (surface, don't guess)

- **`mockups/`** (32MB, 58 files) is referenced by `docs/plans/2026-07-05-feed-implementation.md`. Live design reference for the dashboard, or fluff to archive? Left untouched.
- How clean a UI/server separation is worth it: the React SPA is separable (own `package.json`) but the Express side of `src/web` is coupled to the TS backend — no rewrite this pass.

## Pointers

- **Read the founder's principles first:** `MEMORY.md` — especially `feedback_concrete_structure_no_fluff`, `feedback_docs_weight_by_durability`, `feedback_short_iterations`, `feedback_agent_briefs_leave_room`, `feedback_trust_the_lm`.
- Full inventory: workflow run `wf_acc48060-af9` (`…/tasks/wqlnt21tg.output` if present).
- **Quality loop:** `alignment/docs/quality-loop.md`, last-reviewed `0aab0cf`. Task tracker: cleanup is **#41**.
