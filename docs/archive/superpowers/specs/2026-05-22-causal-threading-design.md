# Layer 0: Causal Threading & Interaction Analysis

## Goal

Add causal threading and interaction analysis to the normalization pipeline so downstream LLM steps receive structured exchanges (not flat event lists) and actionable directives (not raw data).

## Why

The current pipeline asks "what happened?" at every stage. It can't detect passive acceptance, ignored proposals, delegation patterns, or developer-driven vs AI-driven decisions — because events are flat and unthreaded. This layer makes the downstream LLM's job easier by structuring the input and configuring what to look for.

## Changes

### 1. Causal Threading (in `normalize.ts`)

Add two fields to `NormalizedDevEvent`:

```typescript
respondingTo?: string;  // ID of event this responds to
turnId: string;         // groups events from same assistant/user message
```

**Turn grouping:** `turnId` is derived from the `RawDevEvent.id` by stripping the block suffix. Current ID format is `<uuid>-<type>-<index>` — the `turnId` is the `<uuid>` prefix. Events from the same CC log entry (same assistant message with multiple content blocks) share a `turnId`.

**Threading rules (single pass, deterministic):**

| Current Event | `respondingTo` target | `turnId` |
|--------------|----------------------|----------|
| First event in AI turn | Most recent user event's ID | Shared with all events in this AI turn |
| Non-first event in same AI turn | First event of this AI turn | Same `turnId` as above |
| Tool result | The tool_call event it answers | Own `turnId` (from its raw log entry) |
| User turn (conversation_turn) | Most recent AI turn's last event | Own `turnId` |

**Edge cases:**
- First event in session: `respondingTo = undefined`
- Zero exchanges (all AI, no user turns): all events get `respondingTo` pointing to previous event sequentially, directives return defaults (all flags false)

### 2. Interaction Analysis (new `analyze.ts`)

Takes threaded `NormalizedDevEvent[]`, produces `PipelineDirectives`.

**Step 1 — Pair exchanges:** Match each user `intent` event to the AI turn it `respondingTo` → `TurnExchange[]`

```typescript
interface TurnExchange {
  devEvent: NormalizedDevEvent;          // single conversation_turn event
  aiTurnEvents: NormalizedDevEvent[];    // all events sharing the AI turnId being responded to
  devResponseChars: number;
  devAskedQuestion: boolean;
  devUsedReasoning: boolean;             // "because", "actually", "instead", "but"
  devIntroducedNewTopic: boolean;        // mentions files not in AI turn
  aiProposedMultipleOptions: boolean;    // AI text contains "A)", "B)", "option" patterns
  devRespondedToAllOptions: boolean;     // dev response references multiple options
}
```

One `TurnExchange` per `conversation_turn` event. If an exchange spans a chunk boundary, the exchange is assigned to the chunk containing the dev event.

**Step 2 — Compute directives:**

```typescript
interface PipelineDirectives {
  promptSections: {
    detectPassiveAcceptance: boolean;   // 70%+ exchanges have devResponseChars < 15
    trackDelegation: boolean;           // 50%+ exchanges have !devUsedReasoning && !devIntroducedNewTopic
    detectIgnoredProposals: boolean;    // any exchange has aiProposedMultipleOptions && !devRespondedToAllOptions
    isLearningExchange: boolean;        // 40%+ exchanges have devAskedQuestion
  };
  exchangeSummary: {
    totalExchanges: number;
    shortResponseCount: number;
    questionCount: number;
    reasoningCount: number;
    newTopicCount: number;
    ignoredProposals: string[];         // summaries of AI proposals with no dev response
  };
}
```

**Removed from earlier draft:** `enabledLenses` and `likelySchema` are deferred to Layer 1 spec. This layer only produces `promptSections` (used now) and `exchangeSummary` (facts for downstream).

### 3. Threaded Prompt Format (in `moments.ts`)

Replace flat event rendering with exchange-grouped format. The format is illustrative — exact formatting is implementation detail:

```
── Exchange 1 ──
DEV: "fix the auth bug"
  AI [turn-002]:
    - "I'll check the middleware..."
    - Read auth.ts → [contents]
    - "I see the issue — missing expiry check"
```

**Conditional guidance injection:** When `promptSections.detectPassiveAcceptance` is true, append to the system prompt:

> "This session contains many short developer responses. When you see responses like 'yes', 'ok', 'sure' — distinguish active agreement from passive acceptance. This matters for agency classification."

Similarly for `trackDelegation`, `detectIgnoredProposals`, `isLearningExchange`.

### 4. Pipeline Integration (in `orchestrator.ts`)

```
parse → normalize (+ threading) → analyzeInteractions → classify → chunk → moments(directives) → ...
```

- `analyzeInteractions(normalizedEvents)` returns `PipelineDirectives`
- `detectMoments(chunks, sessionShape, directives)` — updated signature, passes directives to prompt builder
- Step count updates from 9 to 10 in progress logging

## Files

| File | Change |
|------|--------|
| `src/adapters/types.ts` | Add `respondingTo`, `turnId` to `NormalizedDevEvent`. Add `TurnExchange`, `PipelineDirectives` types. |
| `src/pipeline/normalize.ts` | Add threading pass after category assignment |
| `src/pipeline/analyze.ts` | New — exchange pairing + directive computation |
| `src/pipeline/orchestrator.ts` | Insert analyze step, pass directives to moments |
| `src/pipeline/moments.ts` | Accept directives param, pass to prompt builder |
| `src/llm/prompts/moments.ts` | Accept directives, threaded format + conditional guidance |

## What Does NOT Change

Adapter, chunking, storage schema, transitions, outcomes, narrative. Those are Layer 1.

## Testing

- Threading: given event sequence → verify `respondingTo` and `turnId` for each event
- Exchange pairing: given threaded events → verify correct `TurnExchange[]` output
- Directives: given exchanges with 70%+ short responses → verify `detectPassiveAcceptance = true`
- Directives: zero exchanges → all flags false, empty summary
- Smoke test: run against real CC log, print threaded exchanges, verify structure
