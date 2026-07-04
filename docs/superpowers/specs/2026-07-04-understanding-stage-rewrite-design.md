# Understanding-Stage Rewrite — Design

**Date:** 2026-07-04 · **Status:** implemented
**Inputs:** [fidelity audit](../../audits/2026-07-04-digest-fidelity-report.md) · rewrite-contracts.md + rewrite-salvage.md (`.intent/audit/`) · fidelity baseline (`docs/audits/fidelity-baseline-2026-07-04.md`)

## Why a rewrite, not patches

The audit's verdict was *content-faithful, structure-unfaithful*. Every provenance channel is broken deterministically — evidence replaced by a Zod default at pass 2, chunk ids hardcoded to `chunks[0]`, confidence never asked of the LLM, timestamps stamped at digest time, tails unrecoverable by design. Patching each hole leaves the architecture that produced them: **LLM steps re-emit data they were handed, and every re-emission is a place data dies.** The rewrite removes that class of failure instead of guarding each instance.

## The one design rule

> **LLMs judge; code carries.** No LLM step ever re-emits data an earlier step produced. Later steps output *decisions that reference IDs*; deterministic code joins the decisions back to the canonical data. A schema default may fill in bookkeeping, never a judgment (confidence, agency, verification are emitted or null — never defaulted).

## Keep boundary (unchanged)

`parseClaudeCodeLog` → `normalize` (threading, causalOrder) → `classifySession` / `analyzeInteractions` — kept as-is. Postgres schema kept with **additive-only** changes. All readers (web, MCP, CLI events, observe-events) keep working: `PipelineResult`, table shapes, and `ActivityEvent` payloads are unchanged apart from new nullable fields.

Also salvaged into the new stage (per rewrite-salvage.md): `chunk.ts` heuristics as-is; the 9-type moment taxonomy + shape guidance; the hybrid render (behavioral headers + uncompressed detail); exchange precompute (with padding made loud); `dedup-moments` scaffolding; `session-digest` context header.

## New pipeline (src/pipeline/understand/)

```
normalizedEvents
  → sittings.ts     deterministic: gap ≥ 30min ⇒ sitting boundary        [0 LLM]
  → chunk.ts        (salvaged; sitting boundaries are hard chunk breaks) [≤1 Haiku]
  → extract.ts      per chunk, Sonnet ×N: moments with REQUIRED evidence
                    {quote, eventIndex} — eventIndex is the causalOrder
                    printed in the render; code validates index ∈ chunk
                    range and quote ⊆ event text, else evidence is
                    marked unanchored (visible, not defaulted)
  → weave.ts        session-level, Sonnet ×1: outputs ONLY decisions —
                    keep/merge/drop by moment id, arc assignments,
                    related links. Statements/evidence/agency are joined
                    back from extract output in code.
  → verify.ts       Sonnet ×1 (batched): every claim typed confirmation/
                    breakthrough/execution + every outcome is checked
                    against the tool events in its anchor window.
                    verdict ∈ supported | contradicted | unverified.
  → transitions.ts  Sonnet ×1: moments-only input (unchanged design),
                    confidence with rubric, null when not emitted
  → narrative.ts    Sonnet ×1: receives sittings + occurredAt-stamped
                    moments; progression is sitting-aware (no flattening)
  → emit-events.ts  occurred-time stamped from anchors; digest-time only
                    as explicit fallback
```

Cost: today ~10–11 calls/large session; new: +1 (verify). Extract stays 1×Sonnet/chunk.

### What each audit failure maps to

| Audit | Mechanism in rewrite |
|---|---|
| F1 tail loss | Orchestrator: on already-digested path, compare parsed max-timestamp vs stored `ended_at` (60s epsilon); grown ⇒ transactional delete + re-digest. `digest --force` for manual replace. |
| F2.1 evidence destroyed | Weave never touches evidence; extract's evidence is schema-required (`.min(1)`, no default) and carried by code. |
| F2.2 no event anchors | Evidence carries `eventIndex` (causalOrder); validated in code; stored as real `source_event_id` (map causalOrder→row uuid at insert). |
| F2.3 chunk fabricated | Moments are born with their chunkIndex in extract; weave references ids, never reassigns chunks. |
| F2.4 digest-time stamps | `occurredAt` = timestamp of the moment's first anchored event (fallback: chunk start). New `moments.occurred_at` column; emit uses it. |
| F3 confidence noise | Rubric in prompts: high = anchored evidence + verified/dev-confirmed; medium = inferred from multiple events; low = speculative. Nullable everywhere; contradicted claims are capped at low by code. |
| F4 self-report laundering | Data selection = conversation + tool actions (names, files, error results — not full outputs), so extract sees what actually ran; verify.ts cross-checks claims against tool events. |
| F5 agency inversion | Extract (Sonnet, full chunk detail) judges agency with an explicit rubric ("who initiated the direction; executing tools is not agency"); precompute agency becomes a hint, never "keep unless clearly wrong". Padding in exchange classification becomes an error, not a silent default. |
| F6 under-extraction | Extract prompt gains two mandates: the session's *opening intent* (first substantive user message) must yield a moment; discoveries that changed scope/direction rank above implementation detail. Measured by fidelity recall. |
| F7 time flattened | Sittings are first-class (new `sittings` table, additive); narrative receives them; progression entries carry sitting index. |

### Schema (additive migration)

- `moments.occurred_at timestamptz`, `moments.verification text` (supported/contradicted/unverified/null)
- new table `sittings(id, session_id fk cascade, sitting_index, started_at, ended_at, event_range_start, event_range_end)`
- no changes to existing columns; readers unaffected (new fields nullable).

### Explicitly deferred

- Sidechain/`/clear`/compaction tagging in the parser (keep-zone; audit found sidechains handled sanely). Revisit if fidelity eval shows pollution.
- Embedding/RAG on activity events; moment_relations/narrative_arcs reader story (written-but-never-read tables — flagged in contracts doc; separate cleanup).
- Prompt-level confidence calibration tuning beyond the rubric (EDD iterations after the rewrite baseline).

## Acceptance (pre-registered, judged by `npx tsx run-fidelity.ts`)

On re-digested audited sessions: evidenceReal ≥80% and anchored >0% (target ≥60%); chunk spread non-degenerate; occurred-time span non-null; moment-confidence distribution informative; transitions/outcomes confidence never a uniform default (null allowed); `20f5efec` tail covered with its 4 tail recall items matched; **no regression** on catalog recall/precision/agency vs the captured baseline; no new precision violations. Plus: 321+ tests green, tsc ≤16, Gen-0 machinery deleted (`run-gen0/crossover/learn/phase1`, chromosomes, organism) with `CLAUDE.md` updated.
