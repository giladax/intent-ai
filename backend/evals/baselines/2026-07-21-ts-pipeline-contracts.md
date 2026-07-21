# TS Pipeline Interface Contracts — 2026-07-21

Interface specification for the Python port. Derived from
`journal/src/adapters/types.ts` (branch feat/repo-brain, Slice 0 commit).
This is a **port spec**, not a code dump — describes semantics the Python
implementation must reproduce, not syntax.

---

## 1. Ingestion boundary: RawDevEvent

The adapter (Claude Code log parser) emits one `RawDevEvent` per log entry.

| Field       | Type                                                              | Semantics                                                                                      |
|-------------|-------------------------------------------------------------------|------------------------------------------------------------------------------------------------|
| `id`        | string (UUID)                                                     | Copied verbatim from the original log entry's UUID. Stable across re-parses.                  |
| `source`    | literal `"claude-code"`                                           | Identifies the producing tool. Only one source type exists today.                              |
| `timestamp` | ISO 8601 string                                                   | Wall-clock time of the log entry, UTC.                                                         |
| `type`      | enum: `conversation_turn` \| `tool_call` \| `tool_result` \| `ai_response` | Semantic classification of the log entry. `conversation_turn` = user message; `tool_result` = user message containing tool_result content blocks. |
| `raw`       | opaque object                                                     | The original log entry, preserved verbatim. Downstream steps may inspect `raw` for content.   |

**Invariants:**
- Every log line produces exactly one `RawDevEvent`.
- `id` is unique within a session.
- `raw` is never mutated after creation.

---

## 2. First normalisation step: NormalizedDevEvent

`RawDevEvent`s are projected into `NormalizedDevEvent` by the normalisation
step. This is the unit the rest of the pipeline reasons over.

| Field           | Type                                                                  | Semantics                                                                                                      |
|-----------------|-----------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------|
| `id`            | string                                                                | Same UUID as the source `RawDevEvent`.                                                                         |
| `sessionId`     | string                                                                | Groups events into a session (matches the `sessions` table PK).                                                |
| `timestamp`     | ISO 8601 string                                                       | Forwarded from `RawDevEvent.timestamp`.                                                                        |
| `causalOrder`   | integer (0-based)                                                     | Monotone index within the session. Used for chunk boundary arithmetic and evidence anchoring.                  |
| `category`      | enum: `intent` \| `proposal` \| `action` \| `result` \| `reflection` | Semantic bucket. Determined by the normalizer, not the log type.                                               |
| `actor`         | enum: `user` \| `ai`                                                  | Who produced this event.                                                                                       |
| `content`       | object                                                                | Structured content (see below).                                                                                |
| `rawEventId`    | string                                                                | Back-reference to `RawDevEvent.id`.                                                                            |
| `respondingTo`  | string or undefined                                                   | `causalOrder` (as string) of the event this is a reply to; undefined for user turns.                          |
| `turnId`        | string                                                                | Groups events that belong to the same conversational turn (user message + all AI events that follow it).       |

**content sub-fields:**

| Sub-field      | Type            | Semantics                                                         |
|----------------|-----------------|-------------------------------------------------------------------|
| `summary`      | string          | Short human-readable summary of what happened (≤ 1 sentence).    |
| `detail`       | string          | Full content / body of the event, suitable for LLM context.       |
| `filesAffected`| string[] or undefined | File paths mentioned or modified, if any.                  |

**Category assignment rules (deterministic, not LLM):**
- `tool_call` events with file-modifying tool names → `action`
- `tool_result` events → `result`
- `ai_response` events with substantial text → `reflection` or `proposal` depending on content
- `conversation_turn` events (user messages) → `intent`
- The classifier is structural, not semantic — these are rough buckets; fidelity criteria do not
  depend on category assignment being precise.

---

## 3. Turn grouping: TurnExchange

After normalisation, events are grouped into `TurnExchange` objects. One
exchange = one user message + all AI events (responses + tool calls) that
follow it before the next user message.

| Field                    | Type                  | Semantics                                                                   |
|--------------------------|-----------------------|-----------------------------------------------------------------------------|
| `devEvent`               | NormalizedDevEvent    | The user message that opened this exchange.                                 |
| `aiTurnEvents`           | NormalizedDevEvent[]  | All AI events in this exchange (responses, tool calls, tool results).       |
| `devResponseChars`       | integer               | Character count of `devEvent.content.detail`.                               |
| `devAskedQuestion`       | boolean               | True if the user message contains a `?`.                                    |
| `devUsedReasoning`       | boolean               | True if the user message contains extended reasoning markers.               |
| `devIntroducedNewTopic`  | boolean               | True if this turn shifts topic (structural heuristic, not LLM).            |
| `aiProposedMultipleOptions` | boolean            | True if the AI offered >1 option in this exchange.                          |
| `devRespondedToAllOptions` | boolean             | True if the user explicitly addressed all proposed options.                 |

---

## 4. Interaction signals: PipelineDirectives

Aggregated from all `TurnExchange`s in a session. Used to steer
downstream prompt assembly (which optional prompt sections to include).

| Field                    | Type    | Semantics                                                                              |
|--------------------------|---------|----------------------------------------------------------------------------------------|
| `promptSections.detectPassiveAcceptance` | boolean | ≥ 70% of exchanges have short/passive user responses.  |
| `promptSections.trackDelegation`         | boolean | > 30% of exchanges are delegation, or passive-minus-challenge > 50%. |
| `promptSections.detectIgnoredProposals`  | boolean | Any exchange where dev gave short reply to a multi-part AI proposal.  |
| `promptSections.isLearningExchange`      | boolean | Any exchange had a user question.                                      |
| `exchangeSummary.totalExchanges`         | integer | Total turn-exchange count.                                             |
| `exchangeSummary.shortResponseCount`     | integer | Exchanges with short/passive user response.                            |
| `exchangeSummary.questionCount`          | integer | Exchanges with a user question.                                        |
| `exchangeSummary.reasoningCount`         | integer | Exchanges with challenge/refinement intent.                            |
| `exchangeSummary.newTopicCount`          | integer | Exchanges flagged as pivot/new-topic.                                  |
| `exchangeSummary.ignoredProposals`       | string[] | Descriptions of ignored multi-part proposals.                         |

**Note:** In the current TS codebase `analyzeInteractions` is `async` but the
dry-run CLI path calls it without `await`, causing a crash in the stats printer.
The full pipeline correctly awaits it. The Python port should make this
synchronous (no I/O involved).

---

## 5. Chunking: SessionChunk

Events are partitioned into bounded windows for LLM reasoning. Chunk size is
calibrated to fit within a single LLM context window.

| Field         | Type                  | Semantics                                                               |
|---------------|-----------------------|-------------------------------------------------------------------------|
| `id`          | string                | `${sessionId}-chunk-${chunkIndex}`                                     |
| `sessionId`   | string                | Parent session.                                                         |
| `chunkIndex`  | integer (0-based)     | Position in the ordered sequence of chunks.                             |
| `events`      | NormalizedDevEvent[]  | The events in this chunk, ordered by `causalOrder`.                     |
| `topicHint`   | string                | Short description of what this chunk is about (heuristic, not LLM).    |
| `filesInScope` | string[]             | Union of `filesAffected` across all events in the chunk.                |
| `eventRange`  | [number, number]      | `[startCausalOrder, endCausalOrder]`, inclusive.                        |

**Invariants:**
- Every event belongs to exactly one chunk.
- `eventRange` boundaries are contiguous: chunk N+1 starts where chunk N ends.
- Chunks are ordered by `chunkIndex`; `eventRange` values are monotonically increasing.

---

## 6. Moments: ExtractedMoment (LLM output)

The extraction step asks an LLM to find significant moments in each chunk.
`ExtractedMoment` is the structured LLM output, validated by Zod.

| Field             | Type                                                                           | Semantics                                                                                          |
|-------------------|--------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|
| `id`              | string (`c${chunkIndex}-m${i}`)                                                | Deterministic ID assigned in code after LLM extraction, not by the LLM.                           |
| `chunkIndex`      | integer                                                                        | Which chunk this moment came from.                                                                 |
| `type`            | enum: `proposal` \| `discovery` \| `pivot` \| `confirmation` \| `rejection` \| `commitment` \| `struggle` \| `breakthrough` \| `execution` | Moment taxonomy. |
| `statement`       | string                                                                         | The moment expressed as a declarative sentence. The key human-readable output.                     |
| `significance`    | string                                                                         | Why this moment matters in the arc of the session.                                                 |
| `agency`          | enum: `developer` \| `ai` \| `collaborative`                                   | Who drove this moment. Note: `ambiguous` is in the full `SessionMoment` type but LLMs are instructed to avoid it; fidelity checks it against `developer`/`ai`. |
| `confidence`      | enum: `high` \| `medium` \| `low` or null                                      | LLM self-assessed confidence.                                                                       |
| `topicFingerprint`| string                                                                         | Short slug identifying the topic (e.g., `"docker-disk-full"`). Used for dedup.                     |
| `evidence`        | EvidenceAnchor[] (≥1, schema-enforced)                                         | Quotes from events supporting this moment.                                                          |
| `occurredAt`      | ISO 8601 string or null                                                        | Timestamp of first anchored evidence event, or chunk start if none anchored.                        |

**EvidenceAnchor sub-fields:**

| Sub-field     | Type                                      | Semantics                                                                                                |
|---------------|-------------------------------------------|----------------------------------------------------------------------------------------------------------|
| `quote`       | string                                    | The quoted text from the log.                                                                             |
| `eventIndex`  | integer or null                           | `causalOrder` cited by the LLM. Null if unparseable.                                                     |
| `anchored`    | boolean                                   | Code-verified: index in chunk range AND quote found in that event's text.                                 |
| `sourceType`  | enum: `user` \| `ai` \| `tool_output`     | Who produced the quoted event. **Note:** This is the LLM-output `EvidenceAnchor.sourceType` (line 330). The stored `Evidence` type (line 120) has a different enum: `"human_message" | "ai_message" | "tool_output" | "tool_input"`. These are separate types; do not merge them in the Python port. |

**Evidence anchoring (deterministic, post-LLM):**
- The LLM emits `eventIndex` as the `causalOrder` it sourced the quote from.
- Post-extraction code verifies: is `eventIndex` within the chunk's `eventRange`? Is the `quote`
  substring-present in that event's text?
- `anchored = true` only if both conditions hold.
- `anchoredPct = anchored / total evidence` — the key provenance metric in fidelity scoring.

---

## 7. Sitting detection: Sitting

Long sessions are split into "sittings" (separate working sessions) based on
idle-time gaps.

| Field         | Type              | Semantics                                                |
|---------------|-------------------|----------------------------------------------------------|
| `sittingIndex`| integer (0-based) | Position in the ordered sequence of sittings.            |
| `startedAt`   | ISO 8601 string   | Timestamp of the first event in this sitting.            |
| `endedAt`     | ISO 8601 string   | Timestamp of the last event in this sitting.             |
| `eventRange`  | [number, number]  | `causalOrder` span, inclusive.                           |

---

## 8. Downstream types (storage / narrative layer)

These types are primarily stored in Postgres and used for fidelity scoring.
The Python port's extract step must produce compatible outputs.

### SessionMoment (stored)

Extends `ExtractedMoment` with:
- `id` — database UUID (not the deterministic chunk-moment id)
- `chunkId` — FK to the chunk record
- `relatedMomentIds` — cross-moment arcs (populated by the weave step)
- `arcId`, `arcRole` — narrative arc membership. **Important:** `SessionMoment.arcRole` (types.ts line 135) is `"origin" | "escalation" | "turning_point" | "resolution"`, while `Pass2Moment.arcRole` (types.ts line 372, used by the weave step) is `"origin" | "development" | "turning_point" | "resolution"` — note the enum distinction: `escalation` vs `development`. A Python port must keep them distinct.
- `evidence` — `Evidence[]` with fields: `quote` (string), `sourceEventId` (string, FK to stored events), `sourceType` (enum: `"human_message" | "ai_message" | "tool_output" | "tool_input"`), `quoteType` (enum: `"verbatim" | "summarized"`)
- `verification` — `"supported" | "contradicted" | "unverified" | null` (populated by the verify step)

### IntentTransition (stored)

Captures when the session's intent shifted.

| Field               | Type                                | Semantics                                          |
|---------------------|-------------------------------------|----------------------------------------------------|
| `fromStatement`     | string                              | Prior intent.                                      |
| `toStatement`       | string                              | New intent.                                        |
| `reason`            | string                              | What caused the shift.                             |
| `originMomentIds`   | string[]                            | Moments that evidence this transition.             |
| `confidence`        | `high` \| `medium` \| `low` or null | LLM self-assessed confidence.                      |

### AcceptedOutcome (stored)

What the session actually produced.

| Field               | Type                                | Semantics                                          |
|---------------------|-------------------------------------|----------------------------------------------------|
| `statement`         | string                              | Declarative description of the outcome.            |
| `supportingMomentIds`| string[]                           | Moments backing this outcome.                      |
| `supportingFiles`   | string[]                            | Files produced or modified.                        |
| `confidence`        | `high` \| `medium` \| `low` or null | LLM self-assessed confidence.                      |

### SessionNarrative (stored)

Top-level session digest.

| Field                   | Type         | Semantics                                                            |
|-------------------------|--------------|----------------------------------------------------------------------|
| `sessionShape`          | enum         | `narrative` \| `exploratory` \| `janitorial` \| `debugging` \| `review` |
| `summary`               | string       | ≤ 150-word arc of the session.                                       |
| `progression`           | string[]     | Ordered list of what happened (narrative spine).                     |
| `discoveries`           | string[]     | Things learned or uncovered.                                         |
| `stabilizedDirections`  | string[]     | Decisions that stuck.                                                |
| `abandonedDirections`   | string[]     | Paths not taken.                                                     |
| `arcs`                  | NarrativeArc[] | Narrative arcs grouping moments by theme.                          |

### ActivityEvent (emitted by pipeline, stored in activity_events table)

The unified output of the pipeline's `emit-events` step. Freeform; no strict
schema enforced by the pipeline (categories and tags are strings).

| Field        | Type                    | Semantics                                              |
|--------------|-------------------------|--------------------------------------------------------|
| `timestamp`  | Date                    | When this event occurred (from session events).        |
| `category`   | string                  | Freeform dot-separated hierarchy (e.g. `session.moment.discovery`). |
| `tags`       | string[]                | Facet tags for filtering (e.g. `["struggling", "docker"]`). |
| `actor`      | string                  | Who did it (`"developer"`, `"ai"`, etc.).              |
| `summary`    | string                  | Human-readable one-liner.                              |
| `metadata`   | object                  | Structured payload; shape varies by category.          |
| `sourceType` | string or undefined     | Source system (e.g. `"session"`).                      |
| `sourceId`   | string or undefined     | FK to the source record.                               |
| `sessionId`  | string or undefined     | Which session produced this.                           |
| `repo`       | string or undefined     | Repo name (e.g. `"intent-ai"`).                        |
| `branch`     | string or undefined     | Git branch.                                            |
| `worktree`   | string or undefined     | Worktree path (for session isolation).                 |
| `topicIds`   | string[] or undefined   | Related topic IDs.                                     |
| `files`      | string[] or undefined   | Files involved.                                        |
| `embedding`  | number[] or undefined   | Vector embedding for RAG (excluded from port scope).   |

---

## 9. Fidelity scoring dimensions

The fidelity harness (`journal/src/eval/fidelity.ts`) scores these dimensions:

| Dimension     | What it measures                                                                              |
|---------------|-----------------------------------------------------------------------------------------------|
| **Provenance**| `evidenceRealPct` (evidence ≥ 1 quote); `evidenceAnchoredPct` (verified quote+index match);  |
|               | `distinctChunks` covered; `chunkSpreadOk` (not all moments from 1 chunk); `occurredTimeSpanMs` |
| **Calibration**| Distribution of `confidence` values; `informative` = not all same value                     |
| **Tail**      | Whether the digest covers events in the last portion of the session (covered vs. lost N min)  |
| **Recall**    | Expected moments matched by keyword search over `statement` + narrative text                  |
| **Precision** | Forbidden claims absent from `statement` + narrative text                                     |
| **Agency**    | `agency` field matches expected value for moments with an `agency` expectation                |

The Python port must produce outputs that, when scored by an equivalent harness,
meet or exceed these baselines (see `2026-07-21-ts-fidelity.md`).
