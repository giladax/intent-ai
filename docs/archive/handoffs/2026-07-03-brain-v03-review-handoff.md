# Handoff — Independent Review of Brain v0.3

> **Read the primary sources and reach your own conclusions.** Don't trust this summary over the artifacts, and don't assume our choices are right — we want you to find where they're wrong, including at the level of the whole framing. Terse, specific, contrarian-where-warranted is more useful than confirmation.

## Context
`intent-ai` (branch `feat/repo-brain`, not pushed) is being reframed as **Brain**: a system connecting organizational intent — "what we want" (PRDs, later other signals) — to code — "what we have." We are dogfooding: Brain is being built by a loop of agents that read Brain over MCP and write observations back, working in parallel git worktrees.

## What we want
- **Product bet:** an *organizational understanding engine*. Feature is the node; intent and implementation are two kinds of evidence under it; **alignment — "is what we built still what we wanted?" — is meant to be the differentiator.**
- **Immediate goal:** a Week-1 MVP that *proves* feature-aware context measurably improves coding-agent performance. Intent ingestion and alignment/drift are deferred to Phase 2.
- This is our current framing. It may be wrong.

## What we have
- `docs/prd.md` — PRD v0.3 (vision, model, objects, MVP, measurement).
- `docs/future-knowledge.md` — consciously deferred bets.
- `docs/consolidation-iteration-0.md` — triage of 38 prior-plan docs → backlog + observations.
- Merged to `feat/repo-brain` (1447 tests pass, 0 net type errors; DB migration `drizzle/0007` **not** applied; measurement harness **never run live**):
  - `f177f58` schema + Feature MCP read/write path
  - `c7fab1e` ETC/CVR measurement harness (treatment arm stubbed)
  - `0b878ae` observation approval UI
  - `6919d59` pipeline hygiene

## Where we want your emphasized review
Open questions — reach your own answers; don't optimize within our assumptions.
1. **Is the MVP proving the right thing?** It measures "feature context helps an agent" and defers the intent/alignment differentiator. Right first proof, or the wrong target?
2. **Is the measurement valid?** Would ETC (exploratory tool-calls) + CVR (constraint-violation rate) convince a skeptic that context *caused* the gain? Where does it break? What would you measure?
3. **Is "Feature" the right primary unit?** It's load-bearing and currently manual/fuzzy. Does the model survive if Feature doesn't?
4. **Is the positioning honest** — "understanding engine" vs. enterprise search — real distinction or vocabulary?
5. **Is the dogfooding agent-loop sound**, or does it manufacture motion/complexity? Judge the method, not only the output.
6. What are we not asking that we should be?

## How to review
Read the three docs and skim the four commits. Form an independent view. If the frame itself is wrong, say so plainly. Cite specifics; keep it short.
