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

**Threading rules (single pass, deterministic):**

- AI response after user turn → responds to that turn
- Tool call in same AI turn → responds to first event in turn (shares `turnId`)
- Tool result → responds to its tool call
- User turn → responds to most recent AI turn's last event

**Turn grouping:** All events from the same CC log entry share a `turnId` (the message's uuid from the raw log).

### 2. Interaction Analysis (new `analyze.ts`)

Takes threaded `NormalizedDevEvent[]`, produces `PipelineDirectives`.

**Step 1 — Pair exchanges:** Match each user turn to the AI turn it responds to → `TurnExchange[]`

```typescript
interface TurnExchange {
  devEvent: NormalizedDevEvent;
  aiTurnEvents: NormalizedDevEvent[];
  devResponseChars: number;
  devAskedQuestion: boolean;
  devUsedReasoning: boolean;       // "because", "actually", "instead"
  devIntroducedNewTopic: boolean;  // new files or direction
  aiProposedMultipleOptions: boolean;
  devRespondedToAllOptions: boolean;
}
```

**Step 2 — Compute directives:** Apply routing rules to exchanges → `PipelineDirectives`

```typescript
interface PipelineDirectives {
  promptSections: {
    detectPassiveAcceptance: boolean;   // 70%+ short responses
    trackDelegation: boolean;           // dev defers decisions
    detectIgnoredProposals: boolean;    // AI proposals with no response
    isLearningExchange: boolean;        // dev asking questions
  };
  enabledLenses: {
    behavioral: boolean;
    causal: boolean;
    understanding: boolean;
    projectManagement: boolean;
  };
  exchangeSummary: {
    totalExchanges: number;
    shortResponseCount: number;
    questionCount: number;
    reasoningCount: number;
    newTopicCount: number;
    ignoredProposals: string[];
  };
  likelySchema: "quest" | "siege" | "construction" | "exploration" | "rescue" | "pivot_chain";
}
```

### 3. Threaded Prompt Format (in `moments.ts`)

Replace flat event rendering with threaded exchange format:

```
── Exchange 1 ──────────────────────────
DEV: "fix the auth bug"
  └─ AI [turn-002]:
     ├── "I'll check the middleware..."
     ├── Read auth.ts → [contents]
     └── "I see the issue — missing expiry check"
```

Conditionally inject guidance sections based on `promptSections`.

### 4. Pipeline Integration (in `orchestrator.ts`)

Insert `analyzeInteractions()` between normalize and classify. Pass directives through to moment detection.

## Files

| File | Change |
|------|--------|
| `src/adapters/types.ts` | Add `respondingTo`, `turnId`, `TurnExchange`, `PipelineDirectives` |
| `src/pipeline/normalize.ts` | Add threading pass after category assignment |
| `src/pipeline/analyze.ts` | New — exchange pairing + directive computation |
| `src/pipeline/orchestrator.ts` | Insert analyze step, pass directives downstream |
| `src/llm/prompts/moments.ts` | Threaded format + conditional guidance injection |

## What Does NOT Change

Adapter, chunking, storage schema, transitions, outcomes, narrative. Those are Layer 1.

## Testing

- Threading rules: given event sequence → verify `respondingTo` and `turnId`
- Exchange pairing: given threaded events → verify `TurnExchange[]`
- Directives: given exchanges with short responses → verify `detectPassiveAcceptance = true`
- Smoke test: run against real CC log, verify threaded output matches expected exchange format
