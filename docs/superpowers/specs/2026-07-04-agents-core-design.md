# Agents Core — Design

**Date:** 2026-07-04 · **Status:** approved (user 2026-07-04: LangGraph substrate; loop + custom nodes; digest agent first; plain taxonomy; EDD iteration with subagents mandatory)
**Context:** The understanding-stage rewrite (see `2026-07-04-understanding-stage-rewrite-design.md`) fixed provenance but kept a fixed single-shot pipeline. The audit that motivated it was itself performed by tool-using agents reading transcripts — and out-performed the pipeline it audited. This design gives intent-ai an in-process agent capability: a shared core (tool registry + agent loop + budgets + output validation) consumed by purpose-specific agents. First consumer: a **digest agent** that competes with the pipeline on the fidelity eval. Later consumers on the same core: a **search agent** (user Q&A over the event river/digests) and a **consolidation agent** (cross-session synthesis).

## Principles

1. **Agentic process, contract-checked output.** The agent explores however it wants (read, search, cross-check); what it *stores* must pass the same validators and storage contracts as the pipeline (`validateAnchors`, `storeSessionDigest`, occurred-time, nullable judgments). The audit's lesson stands: fluent unanchored output is the failure mode — the contracts, not the pipeline shape, are what prevent it.
2. **Competing arm, not replacement.** The digest agent writes digests only via an explicit flag/entry point until it beats the pipeline on `run-fidelity`. Promotion is an evidence decision, recorded.
3. **EDD, subagent-iterated (binding).** Graph topology, context composition, tool structure, and prompts are tuned by experiments — one dimension per experiment, executed by subagents, scored by `run-fidelity`, results recorded. No "felt better" changes. See §6.
4. Plain taxonomy: `digest agent`, `search agent`, `consolidation agent`, `runAgent`, `defineTool`. No metaphors.

## Module layout

```
src/agents/
  core/
    tool.ts        defineTool({ name, description, schema, execute }) → LangChain StructuredTool (Zod-typed)
    graph.ts       buildAgentGraph(config): compiled LangGraph StateGraph — standard loop + insertion
                   points for custom nodes; node primitives exported for reuse
    run.ts         runAgent(config, input): Promise<AgentResult> — invoke graph, return validated
                   output + run stats { turns, tokensUsed, toolCalls, repaired, partial }
    types.ts       AgentConfig, AgentResult, AgentState (all also re-exported from adapters/types.ts
                   if pipeline code needs them)
  tools/           shared domain tools — one purpose each, grouped by data source
    transcript.ts  read_transcript_range (by causalOrder span), search_transcript (substring/regex
                   over normalized events), list_tool_events (action/result events in a span)
    digests.ts     search_events (activity_events filters), get_session_digest, list_sessions
    git.ts         git_log_window (commits in a repo/time window)
  digest/
    agent.ts       digest-agent AgentConfig + custom node validate_anchors_and_repair
    run.ts         digestWithAgent(logPath): deterministic groundwork (parse/normalize/sittings,
                   reused from the pipeline) → agent → contracts → storeSessionDigest + emit
```

Dependencies added: `@langchain/langgraph`, `@langchain/core`, `@langchain/anthropic`. House style: exported functions, no classes, Zod schemas, `.js` imports. LangSmith tracing via existing env configuration.

## The loop (core/graph.ts)

State: `{ messages, turns, tokensUsed, output, validationErrors, repairs }`.

Nodes and edges:

- `call_model` — model with bound tools (model id from AgentConfig; default `claude-sonnet-4-6`).
- conditional edge: tool calls present → `execute_tools` → `budget_guard` → `call_model`; no tool calls → `finalize`.
- `budget_guard` — conditional edge, not an LLM: `turns >= maxTurns` or `tokensUsed >= maxTokens` → forced `finalize` with a system note ("budget exhausted — produce your best final output now").
- `finalize` — demands the structured final output and validates against `AgentConfig.outputSchema` (Zod). Invalid → bounce to `call_model` with the validation errors appended; max 2 repairs; still invalid → return `{ partial: true }` with the raw attempt attached. **A partial result is flagged, never silently cleaned.**
- Custom nodes: `AgentConfig.customNodes` lets an agent insert nodes between `finalize`'s validation and acceptance (the digest agent inserts `validate_anchors_and_repair` here).

No judgment field is ever schema-defaulted (same rule as the pipeline).

## Digest agent (first consumer)

- Groundwork reused verbatim from the pipeline: `parseClaudeCodeLog` → `normalize` → `detectSittings` (+ `classifySession` for shape guidance in the system prompt).
- The agent gets: the session's sitting structure, shape, and the transcript/digest/git tools. Its job: produce the same digest domain objects (moments with anchored evidence, transitions, outcomes, narrative) by reading and cross-checking as it sees fit. The system prompt carries the existing taxonomy + confidence/agency rubrics (shared constants with the pipeline prompts — single source).
- Custom node `validate_anchors_and_repair`: runs the existing `validateAnchors` per moment; unanchored evidence and out-of-range indices go back to the model with specifics; max 2 repairs; residual unanchored evidence stays visibly `anchored: false`.
- Output path: same `storeSessionDigest` + `buildSessionEvents` as the pipeline. Entry in v1: `npx tsx run-digest-agent.ts <path>` (dedicated script; a `digest --agent` CLI flag comes with promotion, never before). Never the default path until promoted.
- Budgets (initial, tunable by experiment): maxTurns 40, maxTokens 400k per session; cost and turns are recorded per run and are secondary fitness metrics.

## Search & consolidation agents (later, same core)

- Search agent: tools = `digests.ts` group (+ `transcript.ts` read for drill-down); output schema = answer with cited event/session ids. Serves the web Correspondence dock and/or MCP.
- Consolidation agent: tools = `digests.ts` + `git.ts`; output = proposed observations/feature-understanding deltas, which enter the existing approval flow (never auto-commit understanding).
- Both are config + tools on the standard loop; neither is designed in detail here (YAGNI) — their specs come after the digest agent proves the core.

## Long sessions: rolling window with carried notes

The digest agent's default topology for v1 is a **sequential rolling pass**, not parallel chunk extraction: the graph loops over sittings (or budget-sized segments within a sitting), and the agent carries a working-notes scratchpad in graph state — open threads, unresolved claims, candidate moments — pulling transcript ranges via tools rather than receiving a fixed render. This preserves causality across the whole session (the reader of segment 4 knows what happened in segment 1), which parallel per-chunk extraction structurally cannot. Cost: wall-clock (sequential) — mitigated by the notes preventing re-reads. `parallel-extract` vs `rolling-notes` is pre-registered experiment E1 (topology): expected effect — rolling-notes improves catalog recall and chronology at higher latency, similar tokens.

## Agent trace persistence

Every digest-agent run persists its own reasoning trace as activity events (`sourceType: "agent-trace"`, `sessionId` = the digested session): which transcript ranges it read, which claims it checked, verdicts found, budget consumed. This makes the digester auditable the same way the digest is — and feeds the planned session "zoom" view (timeline: sittings → moments at occurred-time → anchored evidence → raw events → the agent's checks). The zoom view itself is a separate web-UI spec once the core ships; the trace data lands now so it's available.

## Inherited domain-model critique (drives experiments and follow-ups)

The rewrite fixed mechanics, not the domain model. Weaknesses acknowledged and scheduled rather than ignored:

- **Causal edges are the weakest part of the model.** `relatedMomentIds`/`transition_moments` are written but never read; arcs are post-hoc labels. The rolling-notes topology (E1) is expected to produce real edges; if it does, the moment schema gains a first-class `causedBy` reference and the dead join tables get excised.
- **Confidence should be derived, not emitted** (post-rewrite A5: still ~95% "high" despite the rubric). Experiment E2 (prompt/contract): drop model-emitted confidence; derive in code — anchored + verification=supported → high; anchored → medium; unanchored → low. Structurally cannot saturate.
- **Transitions/outcomes are re-projections of moments** (two LLM calls + three tables restating pivot/confirmation/execution moments + verification). Follow-up: derive them deterministically as views over agent-produced moments; readers keep working. Gated on E1/E2 results.
- **Narrative is a derived cache, not a fact.** Keep storing it (the journal needs a stable summary event) but mark it regenerable and re-render it when its moments change. Fixed template (progression/discoveries/…) revisited per-shape later.
- **Session shape becomes per-sitting** (a 12-hour session is not one genre). Cheap; scheduled with the digest agent since sittings already exist.
- Cleanup: `significance` free-text is currently stuffed into activity-event `tags` (noise in the tag vocabulary) — move to metadata.

## EDD iteration protocol (binding)

Fitness: `npx tsx run-fidelity.ts` on the audited sessions — recall / precision / agency / calibration / provenance — plus secondary metrics per run: token cost, turns, wall-clock. Baselines: the pipeline's post-rewrite numbers (`docs/audits/fidelity-after-rewrite-2026-07-04.md`) and each preceding experiment.

Protocol per experiment:
1. **One dimension only**: graph topology (node/edge structure) · context composition (what the agent is given up front vs must fetch) · tool structure (granularity, names, descriptions, result shapes) · prompt (system prompt content/rubrics). A change touching two dimensions is two experiments. Pre-registered queue: E1 `parallel-extract` vs `rolling-notes` (topology); E1b control arm — pipeline shape with sitting-sized chunks, zero overlap, carried header of previous chunks' moments (isolates window-size from agenthood: if E1b closes most of E1's gap, the win was chunk size, not agency); E2 derived vs model-emitted confidence (contract); E3 context composition (sittings+shape upfront vs fetch-everything). Standing note: the 3-event chunk overlap is judged negative-value (creates the duplicates dedup exists to clean; carries no narrative) — do not tune it; it disappears with whichever E1 arm wins.
2. **Pre-register** the expected effect (which fidelity metric should move and why) before running.
3. **Subagent executes**: implements the variant, runs `digest --agent` on the experiment set, runs fidelity, reports the comparison table. The controlling session decides keep/revert; the decision and numbers are recorded in `.claude/skills/agents/experiments/` (existing convention — one file per experiment).
4. **Experiment set**: default `d73d5190` (short) + `5b31a1bb` (medium) to keep iteration cheap; full set including `20f5efec` (large) before any promotion claim.
5. The repo's agent-skill guides govern method: changing node connections → read `.claude/skills/agents/topologies/`; changing a node's behavior → `strategies/`; running experiments → `playbooks/`.

Promotion bar (pre-registered): digest agent ≥ pipeline on every provenance check, strictly better on catalog recall with no precision/agency regression, on the full experiment set, at ≤3× pipeline token cost. Then `--agent` becomes default and the pipeline extract/weave/verify path is retired in a follow-up excision.

## Testing

- Core loop: fake chat model with scripted tool-call sequences (no live LLM) — round-trip, budget enforcement (turn cap, token cap), output-gate bounce, repair cap, partial flagging, custom-node insertion.
- Tools: unit tests against fixture transcripts (`tests/eval/fixtures/`, `.intent/raw-sessions/`) and the test DB patterns used by storage tests.
- Digest agent: no mocked-LLM "quality" tests — quality is the fidelity eval's job (EDD). Contract tests only: output passes `validateAnchors`/storage without modification.
- Baselines to hold: current suite green (381), tsc ≤9.

## Non-goals (v1)

- Deep-Agents-style planning/filesystem/skills middleware — not needed; our memory is Postgres.
- Multi-agent orchestration inside the core (subagent delegation) — revisit when consolidation agent is designed.
- Streaming/interactive UI hookup for the search agent — after digest agent promotion.
- Checkpointing/persistence of agent state across process restarts — a digest run is minutes; rerun on failure (idempotent storage makes that safe).
