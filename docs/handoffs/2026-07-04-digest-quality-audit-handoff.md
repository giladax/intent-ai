# Handoff — Digest Fidelity Audit (read transcripts against their digests)

> You are auditing, then fixing what the audit justifies. Do not assume the pipeline's design is wrong — or right. It was designed and tuned by an earlier model generation and has never been read critically by a stronger one. Reach your own conclusions from primary evidence; this brief gives you symptoms, not a diagnosis.

## Why this gates everything

Digestion is the foundation the whole product now stands on. The Journal narrates digests. Feature understanding assembles from digest-derived observations. The planned search/Correspondence eval suites derive their ground truth *from digests* (successor handoff, workstream 3) — if digests are unfaithful, the eval suite bakes the unfaithfulness in as the answer key. Measurement-v2's provenance rule ("treatment context traces to digested sessions") makes the MVP claim itself only as strong as digest fidelity. Source evidence used to evaporate on a ~30-day log-retention clock; as of 2026-07-04 every digested log is archived to `.intent/raw-sessions/` (re-copied as it grows), so your audits and any re-digestion have permanent raw material — but anything digestion *missed before* the archive existed is already gone, and the archive only captures what digestion touches.

## The actual audit (do this before reading any pipeline code)

Take at least 3 digested sessions — one large (500+ events), one resumed/multi-day, one short — and read the **raw transcript side-by-side with its stored digest** (`sessions`, `moments`, `transitions`, `narratives`, `outcomes` tables; transcripts under `~/.claude/projects/`). Catalog, with quoted evidence: decisions the digest missed · moments it invented or over-claimed · wrong agency attribution (developer vs ai vs collaborative) · lost session tails · chronology errors · summary claims no transcript span supports. That catalog — not this brief — determines what gets redesigned.

## Symptoms already observed (evidence, not conclusions)

1. **Confidence carries no information.** A real session digested 2026-07-03 produced 17/17 moments high-confidence, 0 medium, 0 low. If everything is high, the field is decorative — and downstream consumers (fitness scoring, served context) treat it as signal.
2. **Resumed sessions lose their tail, permanently.** Idempotency (`src/pipeline/orchestrator.ts:61-68`, keyed on CC session UUID) returns the stored digest and never re-reads a grown log. With scheduled digestion now live (10-min quiet debounce), this is systematic: any session that pauses >10min gets digested mid-life; everything after is never captured and evaporates with the log. The fix design is open — re-digest and replace? version digests? append-only tail digestion keyed on event offset? — but the hole is not. Mitigation already landed: the raw archive re-copies grown logs even on the already-digested path (`orchestrator.ts`, `archiveRawSession`), so stale digests are re-derivable from complete raws.
3. **Intra-session chronology is destroyed at emit.** `emit-events.ts` stamps all beats digest-time (`new Date()`); the observability design (`docs/plans/2026-07-03-observability-design.md`, "timestamp finding" + §7.1) specifies the contract fix (stamp occurred-time from chunk timing). Known, unfixed.
4. **The eval harness predates the current product.** `src/eval/` speaks the excised experiment era: organisms, chromosomes, Gen-0 (`run-gen0.ts`, `src/eval/chromosomes/`). `tests/eval/session-criteria.ts` criteria and `tests/eval/fixtures/` may or may not measure what the current pipeline emits — freshness unaudited. The judge (`src/eval/judge.ts`) and fitness math (`src/eval/fitness.ts`) may be sound; whether they measure *fidelity to the transcript* (vs. plausibility of the output) is the question that matters.
5. **Plausibility masks infidelity.** Digest narratives read well (see any Journal entry) — which is exactly why nobody has caught problems: a fluent summary of the wrong emphasis is invisible without the side-by-side read.

## Sources (read in this order)

1. 3+ transcripts vs digests (the audit — primary evidence)
2. `src/pipeline/orchestrator.ts` — the 10 steps; `src/adapters/types.ts` — the domain model
3. `src/pipeline/chunk.ts` (486 lines of chunking heuristics) · `src/llm/prompts/moments.ts` (a 500-line prompt) · `prompts/{classify,transitions,narrative}.ts` · `src/pipeline/{analyze,moments,narrative}.ts`
4. `src/eval/{fitness,judge,runner}.ts` + `tests/eval/session-criteria.ts` + `run-gen0.ts` — what "quality" currently means
5. `CLAUDE.md` §Eval Workflow (EDD) — the discipline: criteria first, baseline, then change code

## The ask, in order

1. **Fidelity report** — the catalog above, with a severity call per failure class. Surfacing "the pipeline is basically faithful and the real problems are X and Y" is a fully acceptable outcome; a false-clean report is not.
2. **Make fidelity measurable** — update/replace `session-criteria` so the eval scores transcript-fidelity (recall of real decisions, precision of claimed moments, agency accuracy, calibration), not just output plausibility. Baseline the current pipeline. Pre-register what "better" means.
3. **Fix what the audit justifies** — candidates the symptoms suggest (confidence calibration, resumed-session tail capture, occurred-time stamping, prompt/chunking revisions), but let the report drive. One change at a time, re-run the eval, compare (EDD).
4. **Leave the harness honest** — retire eval machinery that measures the excised world; keep the eval runnable in one command.

## Grain and constraints

Pure functions, no classes; all types in `src/adapters/types.ts`; lenient Zod on LLM output; Sonnet for moments/narrative, Haiku for classification (cost: moments are Sonnet ×N per chunk — fidelity fixes that multiply LLM calls need justification). Baselines to hold or consciously move: 311 tests, tsc ≤16. Digests are idempotent by session UUID — whatever you do to fix the tail-loss must keep `digest` safe to re-run.

## Context you'd otherwise lack

- The product reframed 2026-07-03/04: the event river is the substrate, Features are lenses, the Journal is the surface (PRD v0.3.1, `docs/handoffs/2026-07-03-brain-v03-successor-handoff.md`). Digest output feeds the river via `src/pipeline/emit-events.ts`.
- Scheduled digestion runs in the web server (`/api/digest/schedule`, `.intent/digest-schedule.json`) — your resumed-session fix interacts with its debounce.
- The Topic subsystem was excised 2026-07-04 (`28bbf0e`); if you find pipeline code that only served it, that's more fat to cut.
