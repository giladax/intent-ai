# Agents Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **LangGraph tasks (3–5): BEFORE writing any LangGraph/LangChain code, invoke the `langgraph-fundamentals` skill (and `langchain-dependencies` for package versions). The code sketches below show intent; verify exact APIs against the skill docs, not memory.**

**Goal:** Ship `src/agents/` per `docs/superpowers/specs/2026-07-04-agents-core-design.md` — shared LangGraph loop + tool registry, digest agent as an EDD-iterated competing arm — plus the digest concurrency-race fix.

**Architecture:** See the spec. One sentence: `runAgent(config)` executes a standard tool loop (budget-guarded, structured-output-gated, custom-node-extensible); domain tools live in `src/agents/tools/`; the digest agent runs a rolling-notes pass over sittings and lands output through the existing pipeline contracts (`validateAnchors`, `storeSessionDigest`).

**Tech Stack:** TypeScript ESM, Vitest, Zod; new deps `@langchain/langgraph`, `@langchain/core`, `@langchain/anthropic` (pin per `langchain-dependencies` skill).

## Global Constraints

- Baselines: **381 tests pass**, **exactly 9 `npx tsc --noEmit` errors**. Break nothing, add none.
- No classes in our code (LangChain's own classes are fine to *use*); exported functions; `.js` imports; domain types in `src/adapters/types.ts`.
- **No Zod default fills a judgment field.** Partial/failed agent output is flagged, never silently cleaned.
- The digest agent NEVER runs as the default digest path in this plan (dedicated `run-digest-agent.ts` only).
- Rubric/taxonomy text shared with the pipeline via constants — single source, no copy drift (extract them in Task 5).
- Live-LLM runs happen ONLY in Tasks 6–8 (explicitly budgeted); all other tests use fakes/fixtures.
- Commit per task, trailers:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01CT7KvNTVAGKSLmyGKVvVpM`

---

### Task 1: Digest concurrency-race fix

**Files:**
- Modify: `src/storage/schema.ts` (unique index on `sessions.source_hash`), new drizzle migration via `npx drizzle-kit generate` + apply via `npx tsx src/cli/index.ts up`
- Modify: `src/storage/queries.ts` (`storeSessionDigest`: session INSERT gains `ON CONFLICT (source_hash) DO NOTHING` + row-count check → if conflicted, log `⚠ concurrent digest detected — another digest of this session landed first; discarding this run's write` and return without inserting children)
- Modify: `run-fidelity.ts` (session lookup: `ORDER BY created_at DESC LIMIT 1`)
- Test: `tests/storage/store-digest.test.ts` (extend)

**Interfaces:** `storeSessionDigest` signature unchanged; behavior on conflict: no partial child rows, no throw.

Pre-check: `SELECT source_hash, count(*) FROM sessions GROUP BY 1 HAVING count(*) > 1` must be empty before the unique index applies (the known duplicate was already cleaned; verify, and if any remain, STOP and report).

- [ ] **Step 1: Failing test** — mock-level: when the session INSERT reports 0 inserted rows (conflict), no normalized_events/chunks/moments inserts run and the function resolves without throwing. Follow the existing mock style in that test file.
- [ ] **Step 2: Verify fail. Step 3: Implement** (index: `uniqueIndex("sessions_source_hash_unique").on(t.sourceHash)` where `source_hash IS NOT NULL` — drizzle partial unique index; verify generated SQL). **Step 4: Full suite + tsc; verify index via psql `\d sessions`.**
- [ ] **Step 5: Commit** — `fix(storage): unique source_hash + conflict-safe storeSessionDigest; deterministic fidelity lookup`

---

### Task 2: Dependencies + tool registry

**Files:**
- Modify: `package.json` (add the three deps — consult `langchain-dependencies` skill for versions; commit lockfile)
- Create: `src/agents/core/tool.ts`, `src/agents/core/types.ts`
- Test: `tests/agents/tool.test.ts`

**Interfaces (later tasks import these exact names):**

```typescript
// src/agents/core/types.ts
export interface AgentToolDef<I = unknown, O = unknown> {
  name: string;                 // snake_case, e.g. "read_transcript_range"
  description: string;          // written for the model — when to use it, what it returns
  schema: z.ZodType<I>;
  execute: (input: I) => Promise<O>;
}
export interface AgentConfig {
  name: string;
  model?: string;               // default "claude-sonnet-4-6"
  systemPrompt: string;
  tools: AgentToolDef[];
  maxTurns: number;
  maxTokens: number;
  outputSchema: z.ZodType;
  customNodes?: CustomNode[];   // defined in Task 3
}
export interface AgentResult<T = unknown> {
  output: T | null;
  partial: boolean;             // budget exhausted or validation never passed
  stats: { turns: number; tokensUsed: number; toolCalls: { name: string; ms: number }[]; repairs: number };
  rawFinal?: string;            // present when partial
}
```

```typescript
// src/agents/core/tool.ts
export function defineTool<I, O>(def: AgentToolDef<I, O>): AgentToolDef<I, O>; // identity + validation (name snake_case, description non-empty)
export function toLangChainTools(defs: AgentToolDef[]): StructuredToolInterface[]; // wraps execute with Zod parse; tool errors return as tool-result text "TOOL_ERROR: ..." (agent sees it, loop continues)
```

- [ ] **Step 1: Failing tests** — defineTool rejects bad names/empty descriptions; toLangChainTools: valid input executes, invalid input returns a Zod error message as tool output (not a throw), execute() throwing returns `TOOL_ERROR: <message>` (not a throw). ~5 `it()` blocks with exact assertions.
- [ ] **Step 2–4: fail → implement → full suite + tsc.**
- [ ] **Step 5: Commit** — `feat(agents): tool registry — Zod-typed defineTool + LangChain adapter with contained tool errors`

---

### Task 3: Core graph + runAgent

**Files:**
- Create: `src/agents/core/graph.ts`, `src/agents/core/run.ts`
- Test: `tests/agents/graph.test.ts`

**Interfaces:**

```typescript
// graph.ts
export interface CustomNode {
  name: string;
  // Runs after outputSchema validation passes. Returns null to accept,
  // or repair instructions (string) to bounce back to the model.
  check: (output: unknown, state: AgentState) => Promise<string | null>;
}
export interface AgentState { messages: BaseMessage[]; turns: number; tokensUsed: number; output: unknown | null; repairs: number; }
export function buildAgentGraph(config: AgentConfig, modelOverride?: BaseChatModel): CompiledGraph; // modelOverride for tests (fake model)
// run.ts
export async function runAgent<T>(config: AgentConfig & { outputSchema: z.ZodType<T> }, input: string, modelOverride?: BaseChatModel): Promise<AgentResult<T>>;
```

Graph wiring (verify APIs via `langgraph-fundamentals` before coding): `call_model` (ChatAnthropic `.bindTools(...)`; accumulate `usage_metadata` into `tokensUsed`) → conditional: has tool_calls → `execute_tools` (prebuilt `ToolNode` or manual loop) → budget check → `call_model` | budget exhausted → append system nudge "budget exhausted — produce your final structured output now" → `call_model` (tools unbound on final pass) ; no tool_calls → `finalize`: parse final message against `outputSchema` (the finalize pass uses a forced tool-choice "final_output" tool built from outputSchema — the standard LangChain structured-output approach); invalid → append validation errors, `repairs+1`, bounce (max 2) → else `partial: true` with rawFinal. Custom nodes run after schema validation; a non-null check result bounces exactly like a validation failure and shares the same repair budget.

- [ ] **Step 1: Failing tests** with a scripted fake chat model (LangChain's `FakeListChatModel` or a hand-rolled `BaseChatModel` stub emitting a fixed sequence): (a) happy path — 2 tool calls then valid final output → `partial:false`, stats.turns/toolCalls correct; (b) turn cap → forced finalize, `partial` only if final output invalid; (c) token cap same; (d) invalid final output → bounce with errors visible in the next model input → valid on repair 1 → `repairs:1`; (e) 3× invalid → `partial:true`, `rawFinal` set; (f) custom node returning repair text bounces, returning null accepts. ~7 `it()` blocks.
- [ ] **Step 2–4: fail → implement → full suite + tsc.**
- [ ] **Step 5: Commit** — `feat(agents): core LangGraph loop — budget-guarded, output-gated, custom-node extensible`

---

### Task 4: Shared domain tools

**Files:**
- Create: `src/agents/tools/transcript.ts`, `src/agents/tools/digests.ts`, `src/agents/tools/git.ts`
- Test: `tests/agents/tools-transcript.test.ts` (fixtures); digests/git get schema-level tests only (their queries reuse `storage/queries.ts` functions already tested)

**Interfaces (tool names are the model-facing API — exact):**

- `transcript.ts` — a factory `makeTranscriptTools(normalizedEvents: NormalizedDevEvent[]): AgentToolDef[]` (closure over the already-parsed session, no re-reads):
  - `read_transcript_range` `{ from: number, to: number }` (causalOrder span, cap 200 events/call) → rendered events, `[N]` prefixes, same per-category rendering as `renderChunkEvents` (REUSE it — export from understand/extract if needed)
  - `search_transcript` `{ query: string, regex?: boolean }` → matching events (causalOrder + 200-char snippet, cap 50 hits)
  - `list_tool_events` `{ from: number, to: number }` → action/result events only, successes included (reuse verify's window rendering)
- `digests.ts` — `makeDigestTools(): AgentToolDef[]`: `search_events` (thin wrapper over `queryEvents`), `get_session_digest` (narrative + moments via existing getters), `list_sessions`
- `git.ts` — `git_log_window` `{ repo: string, sinceIso: string, untilIso: string }` → `git log --since --until --oneline` via execSync, errors contained

- [ ] **Step 1: Failing tests** for transcript tools against a fixture event array: range respects caps and renders `[N]`; search finds by substring and respects hit cap; list_tool_events includes success results. ~6 `it()` blocks.
- [ ] **Step 2–4: fail → implement → full suite + tsc.** **Step 5: Commit** — `feat(agents): shared domain tools — transcript, digest, git`

---

### Task 5: Digest agent + run-digest-agent.ts

**Files:**
- Create: `src/agents/digest/agent.ts`, `src/agents/digest/output-schema.ts`, `run-digest-agent.ts`
- Create: `src/llm/prompts/shared-rubrics.ts` — move the canonical confidence + agency rubric strings and the 9-type taxonomy block out of `understand/extract.ts` into exported constants; extract.ts imports them (no text change — pure move, existing prompt tests must not change)
- Test: `tests/agents/digest-agent.test.ts` (contract tests, no live LLM)

**Interfaces:**

- `output-schema.ts`: `DigestAgentOutputSchema` — `{ moments: [...], transitions: [...], outcomes: [...], narrative: {...} }` where the moment shape mirrors `ExtractMomentSchema` (evidence `.min(1)` with `eventIndex`, confidence nullable — no judgment defaults) plus `sittingIndex: number`.
- `agent.ts`:
  - `buildDigestAgentConfig(session: { normalizedEvents; sittings; sessionShape }): AgentConfig` — tools = `makeTranscriptTools(events)` + `git.ts`; systemPrompt = taxonomy + rubrics (from shared-rubrics) + rolling-notes instructions: work sitting-by-sitting in order; keep working notes; for every claim-type moment, check tool events before asserting; opening intent of the session must yield a moment; cite eventIndex on all evidence. maxTurns 40, maxTokens 400_000.
  - Custom node `validate_anchors_and_repair`: adapts output moments per sitting into `validateAnchors` inputs (build a pseudo-chunk per sitting from its eventRange); >30% unanchored evidence → repair message listing the failures; ≤30% → accept (residual unanchored stays visible).
  - `digestWithAgent(logPath: string): Promise<PipelineResult>` — groundwork reused from orchestrator (parse → normalize → sittings → classify), `runAgent`, map output → SessionMoment[] (ids `moment-${i}`, chunkId: per-sitting pseudo-chunks stored via the normal chunks path, occurredAt from first anchored evidence), then the SAME `storeSessionDigest` + `buildSessionEvents` path, plus agent-trace activity events (`sourceType: "agent-trace"`: one event per tool call with name/args-summary/ms, one for the run summary with stats). Respects idempotency + `--force` exactly like the pipeline (reuse the orchestrator's growth-check helpers — export them if private).
- `run-digest-agent.ts`: `npx tsx run-digest-agent.ts <path> [--force]` — prints stats + where it stored.

- [ ] **Step 1: Failing contract tests** — with a fake model emitting a fixed valid output: (a) digest output maps to SessionMoments that pass `validateAnchors` untouched; (b) unanchored-heavy fake output triggers the repair bounce; (c) agent-trace events built with correct sourceType/sessionId; (d) storeSessionDigest receives sittings and anchor-shaped evidence. ~6 `it()` blocks.
- [ ] **Step 2–4: fail → implement → full suite + tsc.** **Step 5: Commit** — `feat(agents): digest agent — rolling-notes arm behind pipeline contracts, agent-trace persistence`

---

### Task 6: E0 live smoke + fidelity wiring

Live LLM (budgeted: one short session ≈ a few dollars). Requires .env keys + Postgres.

- [ ] **Step 1:** `npx tsx run-digest-agent.ts <d73d5190 path> --force` — must complete within budget, store a digest, emit trace events.
- [ ] **Step 2:** `npx tsx run-fidelity.ts` — d73d5190 row now reflects the agent digest; capture numbers side-by-side with the pipeline's post-rewrite numbers for that session.
- [ ] **Step 3:** Record `E0-smoke` in `.claude/skills/agents/experiments/` (template per that directory's convention): setup, numbers, cost/turns, verdict ("arm functional" — NOT a quality claim).
- [ ] **Step 4:** Restore the pipeline digest for d73d5190 (`npx tsx src/cli/index.ts digest --force <path>`) so the journal reflects the promoted arm, and commit the experiment record — `docs(experiments): E0 digest-agent smoke`

---

### Task 7: E1 — parallel-extract vs rolling-notes (topology)

Per the spec's EDD protocol (one dimension; pre-registered; subagent-executed; recorded). Variant: a second digest-agent config whose system prompt drops the sequential mandate and whose graph fans out per sitting (LangGraph `Send`) merging notes at the end. Experiment set: d73d5190 + 5b31a1bb, `--force`, fidelity after each, restore pipeline digests after. Record E1 with the comparison table and keep/revert decision. Commit.

### Task 8: E2 — derived vs model-emitted confidence (contract)

Variant: strip `confidence` from `DigestAgentOutputSchema`; derive in code — anchored + verification `supported` → high; anchored → medium; unanchored → low. (Verification for the agent arm = its own recorded claim-checks from the trace, or the pipeline's verify node run over agent moments — pick in the experiment design and pre-register.) Same set, same protocol, record E2. Commit.

---

## Self-Review Notes

- Spec coverage: core (T2–3), tools (T4), digest agent + trace + rolling-notes (T5), race fix (T1), EDD E0–E2 (T6–8). Search/consolidation agents and the zoom view are explicitly out (spec: later specs).
- Type flow: `AgentToolDef` → `toLangChainTools` at the boundary; digest output → `ExtractMomentSchema`-mirroring shape → `validateAnchors` → `SessionMoment` — same contracts as the pipeline.
- Promotion is NOT in this plan — it's an evidence decision after E1/E2, per the spec's promotion bar.
