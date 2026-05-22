# Execution Memory System — Design Spec

## What This Is

A TypeScript CLI that ingests Claude Code conversation logs and produces evidence-backed session digests reconstructing how understanding evolved during AI-assisted development.

Not a code reviewer. Not a productivity tracker. An execution memory layer.

## Core Experience

A developer runs `intent digest` after a coding session and sees: what they were trying to do, how direction changed, which ideas stabilized into code, and what was abandoned — all backed by evidence from their actual conversation.

They can then run `intent explore` to ask questions conversationally: "why did auth move out of middleware?" and get an evidence-backed answer.

## Tech Stack

- TypeScript (Node.js)
- PostgreSQL (Docker Compose for local, connection string for external)
- Drizzle ORM + drizzle-kit migrations
- Anthropic SDK (Claude Sonnet for reasoning, Haiku for classification)
- Commander.js (CLI)
- Zod (runtime validation)

## Project Structure

```
intent-ai/
├── src/
│   ├── adapters/
│   │   ├── types.ts              RawDevEvent interface
│   │   └── claude-code.ts        CC log parser → RawDevEvent[]
│   ├── pipeline/
│   │   ├── normalize.ts          RawDevEvent → NormalizedDevEvent
│   │   ├── classify.ts           session shape classification
│   │   ├── chunk.ts              session → bounded reasoning windows
│   │   ├── moments.ts            chunk → SessionMoment[] (two-pass)
│   │   ├── transitions.ts        moments → IntentTransition[]
│   │   ├── outcomes.ts           moments → AcceptedOutcome[]
│   │   ├── narrative.ts          everything → SessionNarrative
│   │   └── orchestrator.ts       end-to-end pipeline runner
│   ├── llm/
│   │   ├── client.ts             Anthropic SDK wrapper
│   │   └── prompts/              prompt templates per pipeline step
│   ├── storage/
│   │   ├── schema.ts             Drizzle ORM schema
│   │   ├── connection.ts         Postgres connection
│   │   └── queries.ts            read/write digests
│   ├── cli/
│   │   ├── index.ts              entry point, commander.js
│   │   ├── digest.ts             digest command
│   │   ├── explore.ts            conversational REPL
│   │   ├── eval.ts               eval runner command
│   │   └── infra.ts              up/down commands
│   ├── eval/
│   │   ├── fixtures/             curated CC session logs
│   │   ├── criteria.ts           expected outputs per fixture
│   │   ├── runner.ts             runs pipeline against fixtures
│   │   └── judge.ts              LLM-as-judge scoring
│   └── utils/
│       └── log-discovery.ts      find CC logs on disk
├── docker-compose.yml
├── drizzle.config.ts
├── package.json
├── tsconfig.json
└── .env.example
```

## Event Model

### RawDevEvent — adapter output

```typescript
interface RawDevEvent {
  id: string;
  source: "claude-code";
  timestamp: string;
  type: "conversation_turn" | "tool_call" | "tool_result" | "ai_response";
  raw: Record<string, unknown>;
}
```

### NormalizedDevEvent — pipeline input

```typescript
interface NormalizedDevEvent {
  id: string;
  sessionId: string;
  timestamp: string;
  causalOrder: number;
  category: "intent" | "proposal" | "action" | "result" | "reflection";
  actor: "user" | "ai";
  content: {
    summary: string;
    detail: string;
    filesAffected?: string[];
  };
  rawEventId: string;
}
```

Causal ordering over timestamps. `sessionId` is a client-generated UUID, created when the adapter begins parsing a log file. Raw always preserved.

### Normalization Category Rules

Category assignment is deterministic, based on event type and position:

| Event Type | Actor | Category |
|------------|-------|----------|
| `conversation_turn` | user | `intent` |
| `ai_response` before tool calls | ai | `proposal` |
| `ai_response` after tool results | ai | `reflection` |
| `tool_call` (Edit, Write, Bash) | ai | `action` |
| `tool_result` | ai | `result` |
| `tool_call` (Read, Glob, Grep) | ai | `reflection` |

The key distinction: tool calls that modify state (Edit, Write, Bash) are `action`. Tool calls that read state (Read, Glob, Grep) are `reflection`. AI text preceding tool calls is `proposal` (suggesting what to do); AI text following tool results is `reflection` (reasoning about what happened).

## Claude Code Log Format

Claude Code stores conversation logs as JSONL files in `~/.claude/projects/<project-hash>/`. Each line is a JSON object representing a conversation turn.

**Log discovery strategy (`log-discovery.ts`):**
1. Default: scan `~/.claude/projects/` for JSONL files, sorted by modification time (newest first)
2. Explicit: user passes a file path directly
3. `--last N`: take the N most recent files from the default location

Each JSONL file represents one conversation session. Lines contain objects with fields including: `type` (human/assistant/tool_use/tool_result), `content`, `timestamp`, tool name and parameters for tool calls, and tool output for results. The adapter maps these to `RawDevEvent[]`, preserving the full original object in the `raw` field.

## Session Chunking

```typescript
interface SessionChunk {
  id: string;
  sessionId: string;
  chunkIndex: number;
  events: NormalizedDevEvent[];
  topicHint: string;
  filesInScope: string[];
  eventRange: [number, number];
}
```

Split heuristics (priority order):
1. Large pauses (>5min)
2. File cluster shifts (>70% new files)
3. Explicit topic shifts in user messages
4. Size cap (~80 events, split at nearest boundary)

Deterministic, no LLM. Chunks overlap by 3 events for continuity.

### Edge cases

- **Short sessions (<10 events):** No chunking — the entire session is one chunk.
- **Single-topic sessions (no split points):** One chunk with the size cap as the only potential splitter. If under 80 events, stays as one chunk.
- **Multi-day sessions:** The 5-minute pause heuristic will naturally split at overnight gaps. Each day becomes at least one chunk.

## Session Shape Classification

```typescript
type SessionShape = "narrative" | "exploratory" | "janitorial" | "debugging" | "review";
```

Single Haiku call on event stream summary. Determines which moment detection prompts to use.

## Moment Detection (Core Differentiator)

```typescript
type MomentType =
  | "proposal"
  | "discovery"
  | "pivot"
  | "confirmation"
  | "rejection"
  | "commitment"
  | "struggle"
  | "breakthrough"
  | "execution";

interface SessionMoment {
  id: string;
  chunkId: string;
  type: MomentType;
  statement: string;
  significance: string;
  agency: "developer" | "ai" | "collaborative" | "ambiguous";
  confidence: "high" | "medium" | "low";
  topicFingerprint: string;
  relatedMomentIds: string[];
  arcId?: string;
  arcRole?: "origin" | "escalation" | "turning_point" | "resolution";
  evidence: Evidence[];
}

interface Evidence {
  quote: string;
  sourceEventId: string;
  sourceType: "human_message" | "ai_message" | "tool_output" | "tool_input";
  quoteType: "verbatim" | "summarized";
}
```

### What makes this gold

1. **Evidence quotes** — verbatim phrases from the conversation, not just event IDs. "User said: 'actually let's not mock the database'" beats "a decision was made."
2. **Significance field** — forces the LLM to articulate why this moment matters in the session arc.
3. **Agency tracking** — structured field distinguishing developer-driven vs AI-proposed vs collaborative decisions.
4. **Struggle + breakthrough** — highlights failure/resolution arcs that developers remember most.
5. **Execution type** — captures sustained implementation work so the "boring middle" isn't invisible.
6. **Arc threading** — moments link to narrative arcs via `arcId` and `arcRole`, enabling story reconstruction.
7. **Topic fingerprints** — LLM-generated slugs (e.g., `"auth-scoping-bug"`) for cross-chunk dedup.

### Two-pass detection

**Pass 1:** Per-chunk, parallelized. Extracts candidate moments with topic fingerprints. Uses session-shape-specific prompts.

**Pass 2:** Cross-chunk. Receives all candidates. Applies merge rules:
- Same type + same fingerprint + adjacent chunks → merge, combine evidence
- Same fingerprint + different types (proposal → commitment) → keep both, link via arc
- Same type + same fingerprint + non-adjacent → keep both (topic resurfaced)

Emits final moments with arc assignments.

### Prompt principles

- Be specific, not generic
- Use the developer's own language
- Only detect moments with clear evidence — skip rather than hallucinate
- Emit uncertain moments with low confidence rather than dropping them
- For janitorial sessions, focus on scope; for exploratory, focus on insights

## Intent Transitions

```typescript
interface IntentTransition {
  id: string;
  sessionId: string;
  fromStatement: string;
  toStatement: string;
  reason: string;
  originMomentIds: string[];
  arcId?: string;
  confidence: "high" | "medium" | "low";
}
```

Derived from moment pairs with matching topic fingerprints and complementary types (proposal→pivot, struggle→breakthrough).

## Accepted Outcomes

```typescript
interface AcceptedOutcome {
  id: string;
  sessionId: string;
  statement: string;
  supportingMomentIds: string[];
  supportingFiles: string[];
  confidence: "high" | "medium" | "low";
}
```

Only directions with both a commitment/confirmation moment AND corresponding file changes qualify. Doubly evidenced.

## Session Narrative

```typescript
interface SessionNarrative {
  sessionId: string;
  sessionShape: SessionShape;
  summary: string;
  progression: string[];
  discoveries: string[];
  stabilizedDirections: string[];
  abandonedDirections: string[];
  arcs: NarrativeArc[];
}

interface NarrativeArc {
  arcId: string;
  title: string;
  summary: string;
  momentIds: string[];
  resolution: "resolved" | "abandoned" | "open";
}
```

Tone: observational, evidence-backed, uses developer's language, acknowledges uncertainty, never recommends.

## Storage Schema (Postgres + Drizzle)

```
sessions           id, sourceType, sourcePath, sessionShape, startedAt, endedAt, createdAt
raw_events         id, sessionId, source, timestamp, type, raw (jsonb)
normalized_events  id, sessionId, rawEventId, causalOrder, category, actor, summary, detail, filesAffected (text[])
chunks             id, sessionId, chunkIndex, topicHint, filesInScope (text[]), eventRange (int4range)
moments            id, sessionId, chunkId, type, statement, significance, agency, confidence, topicFingerprint, arcId, arcRole
moment_evidence    id, momentId, quote, sourceEventId, sourceType, quoteType
moment_relations   momentId, relatedMomentId, relationType
transitions        id, sessionId, fromStatement, toStatement, reason, arcId, confidence
transition_moments transitionId, momentId
outcomes           id, sessionId, statement, confidence
outcome_moments    outcomeId, momentId
outcome_files      outcomeId, filePath
narratives         id, sessionId, sessionShape, summary, progression (text[]), discoveries (text[]), stabilizedDirections (text[]), abandonedDirections (text[])
narrative_arcs     id, narrativeId, arcId, title, summary, resolution, momentIds (text[])
```

Evidence is its own table. Join tables for many-to-many. Raw events stored as JSONB. pgvector columns deferred.

`moment_relations.relationType` values: `"caused"` (this moment caused the related moment), `"evolved_into"` (same topic, later stage), `"contradicts"` (opposing direction).

## Pipeline Orchestration

```
intent digest
  │
  ├─ 1. Discover/read CC log file
  ├─ 2. Adapter: parse → RawDevEvent[]
  ├─ 3. Normalize → NormalizedDevEvent[]           (deterministic)
  ├─ 4. Classify session shape                      (Haiku)
  ├─ 5. Chunk session                               (deterministic)
  ├─ 6. Detect moments pass 1                       (Sonnet, parallel per chunk)
  ├─ 7. Detect moments pass 2                       (Sonnet, cross-chunk)
  ├─ 8. Detect transitions + outcomes               (Sonnet)
  ├─ 9. Generate narrative                          (Sonnet)
  └─ 10. Store to Postgres                          (transactional)
```

Steps 1-3, 5 are deterministic — no LLM cost. Step 6 parallelizes across chunks. ~11 Sonnet calls per typical session (~100 events, ~8 chunks).

## CLI Commands

- `intent digest [path]` — process session, print narrative. `--last N` for batch.
- `intent explore [--session <id>]` — conversational REPL over stored digests (see Explore Command below).
- `intent eval [--fixture name] [--step name]` — run eval suite, report scores.
- `intent up` / `intent down` — Docker Compose for Postgres.

## Explore Command

Interactive REPL for querying session digests conversationally.

**Architecture:**
1. User enters a question in the terminal
2. System retrieves relevant digest data: load the session's narrative, moments, transitions, and outcomes from Postgres
3. Build a system prompt containing the structured digest data as context
4. Send user question + digest context + conversation history to Claude Sonnet
5. Stream the response back to the terminal
6. Maintain conversation history for follow-up questions (in-memory, not persisted)

**Context assembly:** The LLM receives the full session narrative, all moments with evidence, transitions, and outcomes as structured context. For typical sessions this fits comfortably in context. For very large sessions (50+ moments), include the narrative and arc summaries, then load moment details on-demand when the user asks about a specific topic.

**REPL interface:** Simple readline-based loop. `Ctrl+C` or `quit` to exit. No special commands — just natural language questions.

## Eval Harness

First-class, not bolted on.

- **Fixtures:** Curated CC session logs per session shape (narrative, janitorial, exploratory, debugging, short)
- **Criteria:** Structured expectations per fixture per pipeline step
- **LLM-as-judge:** Separate Claude call scoring output against criteria (1-5 scale with explanation)
- **CLI:** `intent eval` runs full suite, reports per-fixture per-step scores

Every prompt change runs through evals before shipping.

## Adapter Architecture

Claude Code adapter first. Adding Codex/Copilot later = writing a new adapter (~200-400 lines) that maps their log format to `RawDevEvent[]`. Pipeline never knows which tool produced the events.

```
Claude Code logs  →  adapter  →  RawDevEvent[]  →  pipeline
Codex logs        →  adapter  →  RawDevEvent[]  ↗
Copilot logs      →  adapter  →  RawDevEvent[]  ↗
```

## Deployment

- Local dev: `intent up` → Docker Compose Postgres
- External: `DATABASE_URL` connection string
- LLM: `ANTHROPIC_API_KEY` env var

## Error Handling

**Strategy: fail-fast with clear messages, partial results where safe.**

| Failure | Behavior |
|---------|----------|
| Malformed CC log line | Skip the line, warn to stderr, continue parsing. Adapter reports count of skipped lines. |
| CC log file not found | Exit with error message + hint about expected location. |
| LLM call fails (network/rate limit) | Retry up to 3 times with exponential backoff. If still failing, abort pipeline and report which step failed. |
| LLM output fails Zod validation | Retry once with a stricter prompt asking for corrected output. If still invalid, skip that chunk's moments (for pass 1) or abort (for later steps). Log the invalid response for debugging. |
| Database unreachable | Exit with error + hint to run `intent up`. |
| Pipeline fails mid-way | No partial writes — the transaction rolls back. User can re-run safely. |

**Large session cost warning:** For sessions with >300 normalized events (~20+ chunks), print an estimated cost and prompt for confirmation before running LLM steps.

## Non-Goals (v1)

- pgvector / semantic search
- Cross-session queries
- Web UI
- Additional adapters (Codex, Copilot)
- UserIntentEstimate / provenance tracking
- Real-time event capture
