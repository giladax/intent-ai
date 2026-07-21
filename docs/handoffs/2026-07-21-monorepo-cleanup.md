# Handoff — Monorepo cleanup (intent-ai)

**To:** the next Fable model. You're highly capable; this is intent + invariants, not a script. Sequence it your way, recognize better moves as you find them, and fill the gaps with judgment. The founder is non-technical and values short, visible, reversible slices.

**From:** prior session, 2026-07-21. Branch `feat/repo-brain`. HEAD `300237e`.

---

## The mission

The repo is one git repo holding two ~equal codebases with **zero shared code**: ~19.5k lines of TypeScript in `src/` (session ingestion → Postgres → MCP server + a React dashboard) and ~18k lines of Python in `alignment/` (promises-vs-code analysis + proactive alarms; the flagship the founder pitches). Plus ~236 markdown docs, five competing dot-dirs, and stray root files. It "feels like chaos" because nothing declares the shape.

Turn it into **one self-respecting software project**: obvious top-level layout, only-what's-needed, legible to a non-technical owner and to agents. This is a **folder/label reorg — no code rewrite, no DB migration this pass.**

## Decisions already locked with the founder (do not relitigate)

- **Single repo.** Not a split.
- **Drop the product mythology.** No "Brain" / "Align" / "feeder" in the structure. One project name; folders named by *function*, concrete engineering terms. All narrative/story lives in the **PRD**, not in folder names. Build so new can supersede old.
- **feature.ts:** `src/mcp/feature.ts` has an uncommitted local change under a standing *never-commit* rule. It rides along with its folder in the move but is **never staged or committed** — stays dirty at the new path.
- **Docs:** radically selective. Keep a small **durable trunk** (README, ARCHITECTURE, the PRD, CLAUDE.md, a glossary, dated decisions). Everything else archived or deleted. **Any doc that names a specific file/function/line gets verified against current code — if the code is gone, the doc goes** (git history is the safety net).

## Target structure

```
intent-ai/
├─ README.md          what it is + how to run — concrete, 30-second orientation
├─ ARCHITECTURE.md    plain-English system map (infra, data models, LLM arch)
├─ infra/             docker-compose, .env.example, .mcp.json, db
├─ frontend/          the dashboard UI
├─ backend/
│   ├─ ingestion/     session capture + MCP serving + storage (TS, was src/)
│   └─ analysis/      promises-vs-code + alarms (Python, was alignment/)
├─ docs/              prd (the story) + specs + glossary + decisions/ + archive/
├─ tools/             the loose eval/run scripts
└─ .claude/           agent scaffold (the one live one — keep)
```

Backend is split by **function, not language/brand** (`ingestion` = TS today, `analysis` = Python, the direction). Founder wants to eyeball this naming when it lands — easy to steer.

## Where I stopped

**Phase 1a done + committed (`300237e`):** removed dead `src/pipeline/dedup.ts`, stray `.agents/`, and gitignored disk clutter. Tree is clean; nothing staged except the pre-existing dirty `feature.ts` (leave it).

**Nothing has moved yet.** The structure above is approved; execution is yours.

## The plan (phases — order and granularity are yours)

1. **Finish the cruft cut.** Archive the bulky superseded dirs *with their live references updated in the same commit* (see landmines): `.repo/` → `docs/archive/legacy-export/`, `.superpowers/` → `docs/archive/superpowers-campaign/`, `alignment/design/round1` (superseded by round2). Resolve `mockups/` with the founder (open question below).
2. **Scaffold** the empty target dirs + README/ARCHITECTURE placeholders.
3. **Move Python** `alignment/` → `backend/analysis/` first — it's self-contained (own `pytest.ini`, `requirements.txt`, SQLite), lowest blast radius, proves the pattern. Update `pytest.ini` pythonpath, `onboard.py` skip-list, CLAUDE.md paths. Green before moving on.
4. **Move TS** `src/` → `backend/ingestion/`, the React SPA → `frontend/`, `drizzle/`, root `run-*.ts` → `tools/`, `scripts/` along with it. Update **every hardcoded path** (see landmines) in the *same* commit. Green before moving on.
5. **Consolidate infra** into `infra/`; **cull docs** to the durable trunk and write the real `ARCHITECTURE.md` (plain English — this is the artifact the founder most wants to read), `glossary`, `docs/INDEX.md`; update `CLAUDE.md` paths.
6. **Land** a README that's the 30-second map; run a quality-loop tick; show the founder.

## Invariants / landmines (breaking these is the only way to fail)

- **Green at every phase, each its own commit, archive-over-delete (reversible).**
  - Python: `cd backend/analysis && LANGCHAIN_TRACING_V2=false LANGSMITH_TRACING=false python3 -m pytest` → **229 passing**; plus `python3 -m evals.event_stream` and `python3 -m evals.alarms` → both "all clear".
  - TS: `npm test`, `npm run typecheck:ui` (TS tests may need Postgres up — `docker compose up` / `cli up`, port **5433**).
- **Never commit `src/mcp/feature.ts`.** Moves with its folder; stays dirty.
- **Never edit/regenerate anything under `alignment/workspaces/quire-brain`** — a rehearsed live demo.
- **Grep-verify, don't survey-trust.** The understanding surveys produced several *false* "dead code" calls (`classify-exchanges.ts`, `src/agents/`, six Python modules `hierarchy/graph_heuristics/entity_propose/onboard/timeline/atoms`, the `topics/insights/brainVersions/brainCards` schema) — all actually **live**. Confirm zero importers before deleting anything.
- **Hardcoded paths that break on the move — update in the same commit:**
  - `.mcp.json` runs `npx tsx src/cli/index.ts` → update or the MCP server dies.
  - `tsconfig.json` rootDir, `drizzle.config.ts` schema path, root `package.json` scripts.
  - `alignment/quire_align/onboard.py` has a repo-scan **skip-list** naming `.repo`, `.superpowers`, `mockups`, `eval-runs`, `handoffs`, `.claude`, `skills`, `archive`, `fixtures`, `tests` → update when those dirs move/rename.
  - `src/eval/mvp-task-criteria.ts` + `mvp-decontamination.test.ts` assume the decontamination arm receives `CLAUDE.md` + **`.repo/brain.md`** by path → if `.repo/` is archived, update these refs (or keep `.repo/` in place). `brain.md` is the **measurement-v2 baseline** the treatment arm must beat — keep retrievable.
- **Do NOT unify the datastores** (Postgres for TS, SQLite for Python). Intentional debt for a later, explicit pass.
- **Keep** `.claude/` (the only live agent scaffold), `alignment/workspaces/{intent-ai,intent-ai-live,pydantic,telegram}` (dogfood targets), `docs/superpowers/specs/{execution-memory,activity-event-backbone}` (only prose that explains those subsystems), `docs/prd.md`.
- Commit trailers on every commit:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01353uysft2sGVgMeaJwgDcS
  ```

## Open questions for the founder (genuine — surface, don't guess)

- **`mockups/`** (32MB, 58 files) is referenced by `docs/plans/2026-07-05-feed-implementation.md`. Is that **live design reference for the frontend**, or fluff to archive? Left untouched pending their call.
- The TS **dashboard/server coupling**: the React SPA is separable (own `package.json`) but the Express side of `src/web` is coupled to the ingestion backend. Decide how clean the `frontend/` vs `backend/ingestion/` cut should be without a rewrite.

## Pointers

- **Read the founder's principles first:** `MEMORY.md` — especially `feedback_concrete_structure_no_fluff`, `feedback_docs_weight_by_durability`, `feedback_short_iterations`, `feedback_agent_briefs_leave_room`, `feedback_trust_the_lm`.
- **Full keep/move/archive/delete inventory** (40 items, grep-verified) from the understanding workflow: run was `wf_acc48060-af9`; result cached at `…/tasks/wqlnt21tg.output` if still present. The verdicts are summarized above; the file has per-path rationale if you want it.
- **Quality loop:** `alignment/docs/quality-loop.md`, last-reviewed `0aab0cf`. Run a tick after substantive commits.
- Task tracker: cleanup is task **#41**.

You have the resources to fan out (understanding workflows, verification agents). Use them for breadth; keep the file-moves sequential and green. Ship in slices the founder can see.
