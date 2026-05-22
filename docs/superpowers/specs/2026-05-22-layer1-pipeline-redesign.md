# Layer 1: Pipeline Redesign — Pre-computation, Routing, Critic

## Goal

Reduce the cognitive load on each LLM call by pre-computing what's currently inferred, routing simple sessions to cheap paths, and adding a critic loop on the final output. Each step hands the next a simpler problem.

## Why

The complexity review found every LLM step re-derives structure that previous steps already produced. Moments Pass 1 does 10 cognitive tasks simultaneously. Transitions re-derives structure from moments. Narrative re-groups arcs. Plus a bug: `collectFiles` is empty — the LLM hallucinating file paths.

## Architecture

```
normalize (+ threading) → ┬─ classify (Haiku)  ─┐
                           ├─ chunk (local)      ├─ route ─┐
                           └─ analyze (local)   ─┘         │
                                                            │
                    ┌───────────── simple ◀─────────────────┤
                    │                                       │
                    ▼                                       ▼
              simple narrative                     ┌─ pre-compute ─┐
              (Haiku, 1 call)                      │  (deterministic) │
                                                   └───────┬───────┘
                                                           │
                                                    moments pass 1
                                                    (Sonnet, fan-out)
                                                           │
                                                    moments pass 2
                                                    (Sonnet, 1 call)
                                                           │
                                                    transitions
                                                    (Sonnet or deterministic)
                                                           │
                                                    narrative
                                                    (Sonnet, 1 call)
                                                           │
                                                    critic
                                                    (Haiku, loop max 2)
```

## Changes

### 1. DAG: Parallelize classify + chunk + analyze

Currently sequential. All three depend only on `normalizedEvents`. Run with `Promise.all`.

```typescript
const [shape, chunks, directives] = await Promise.all([
  classifySession(normalizedEvents),
  chunkSession(normalizedEvents, sessionId),
  analyzeInteractions(normalizedEvents),
]);
```

**Files:** `src/pipeline/orchestrator.ts`

### 2. Conditional Routing

After classify + analyze, route based on session complexity:

```typescript
type PipelineRoute = "simple" | "standard";

function routeSession(shape: SessionShape, directives: PipelineDirectives, eventCount: number): PipelineRoute {
  if (shape === "janitorial" && eventCount < 50) return "simple";
  if (directives.exchangeSummary.totalExchanges < 3) return "simple";
  return "standard";
}
```

**Simple path:** Skip moments/transitions. Generate a lightweight narrative directly from the exchange summary and event stats using Haiku. One cheap LLM call.

**Standard path:** Full pipeline with pre-computation improvements below.

**Files:** `src/pipeline/orchestrator.ts`, `src/pipeline/simple-narrative.ts` (new)

### 3. Deterministic Pre-computation (the big one)

New step between chunk and moments. Computes what the LLM currently infers:

```typescript
interface PrecomputedChunkContext {
  chunkId: string;
  exchanges: EnrichedExchange[];
  topicFingerprint: string;        // from file paths, not LLM
}

interface EnrichedExchange {
  devEvent: NormalizedDevEvent;
  aiTurnEvents: NormalizedDevEvent[];

  // Pre-computed — LLM doesn't need to figure these out
  agency: "developer" | "ai" | "collaborative";
  candidateType: MomentType | null;  // null = not a moment candidate
  topicFingerprint: string;
  notableQuotes: {
    speaker: "dev" | "ai";
    text: string;
    eventId: string;
  }[];
}
```

**Agency rules (deterministic):**
- Dev message > 30 chars with reasoning words → `developer`
- Dev message < 15 chars after AI proposal → `ai`
- Dev asked question, AI answered, dev refined → `collaborative`

**Candidate type rules (deterministic):**
- Dev used "actually", "instead", "but" + introduced new direction → `pivot` or `rejection`
- Dev < 15 chars, affirmative → `confirmation` (possibly passive)
- Same file edited after tool_result error → `struggle`
- Dev introduced new topic with reasoning → `proposal` or `commitment`
- No strong signal → `null` (not a candidate, LLM decides)

**Topic fingerprint (deterministic):**
- Extract common directory from `filesAffected`: `src/pipeline/*.ts` → `pipeline`
- If no files, use first significant noun from dev message
- Two exchanges on same files share a fingerprint automatically

**Notable quotes (deterministic):**
- Dev's exact words from intent events (full text, not truncated)
- First sentence of AI proposals
- Error messages from tool results

**Files:** `src/pipeline/precompute.ts` (new)

### 4. Simplified Moment Detection Prompt

With pre-computation, the moment LLM's input changes from raw events to pre-labeled exchanges:

```
Exchange 1:
  agency: developer
  candidate_type: proposal
  topic: pipeline-orchestrator
  DEV: "Let's add a chunking step between normalize and moments"
  AI: [Read orchestrator.ts, Edit orchestrator.ts]
  quotes: ["Let's add a chunking step..."]

Exchange 2:
  agency: ai
  candidate_type: confirmation (passive)
  topic: pipeline-orchestrator
  DEV: "ok"
  AI: [Edit orchestrator.ts, Write chunk.ts]
```

**The LLM's ONE job:** "Which of these pre-labeled exchanges are actual inflection points? Confirm or override the candidate type. Write the moment statement."

Removes from the LLM: agency classification, topic fingerprint generation, evidence extraction, type classification from scratch.

**Files:** `src/llm/prompts/moments.ts`

### 5. Deterministic Transitions

Transitions are derivable from arc structure — a `pivot`/`rejection` at a `turning_point` IS a transition:

```typescript
function deriveTransitions(moments: SessionMoment[]): IntentTransition[] {
  const transitions: IntentTransition[] = [];
  const arcGroups = groupBy(moments, m => m.arcId);

  for (const [arcId, arcMoments] of arcGroups) {
    const sorted = arcMoments.sort((a, b) => /* causal order */);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].arcRole === "turning_point") {
        transitions.push({
          fromStatement: sorted[i-1].statement,
          toStatement: sorted[i].statement,
          reason: sorted[i].significance,
          originMomentIds: [sorted[i].id],
          arcId,
          confidence: sorted[i].confidence,
        });
      }
    }
  }
  return transitions;
}
```

The Sonnet transitions call becomes optional — only used if the deterministic derivation misses cross-arc transitions. For most sessions, transitions are fully deterministic.

**Also fix the `collectFiles` bug:** Thread `chunks[].filesInScope` through to outcomes.

**Files:** `src/pipeline/transitions.ts`, `src/llm/prompts/transitions.ts`

### 6. Narrative Critic Loop

After narrative generation, a Haiku critic validates:

```typescript
interface CriticResult {
  issues: {
    type: "unsupported_claim" | "missing_arc" | "generic_statement" | "wrong_agency";
    description: string;
    location: string;  // which part of the narrative
  }[];
  approved: boolean;
}
```

**Critic checks:**
- Does every claim trace back to a moment?
- Are all arcs represented in the narrative?
- Are any statements too generic (could describe any session)?
- Does agency attribution match the moments' agency fields?

If issues found → revise narrative with the critic's feedback (max 2 iterations). Critic is Haiku (cheap), revision is Sonnet.

**Files:** `src/llm/prompts/critic.ts` (new), `src/pipeline/narrative.ts`

### 7. State Enrichment Refactor

Refactor orchestrator to use a shared `PipelineState` object instead of explicit parameter threading:

```typescript
interface PipelineState {
  sessionId: string;
  logPath: string;
  rawEvents: RawDevEvent[];
  normalizedEvents: NormalizedDevEvent[];
  shape: SessionShape;
  chunks: SessionChunk[];
  directives: PipelineDirectives;
  precomputed: PrecomputedChunkContext[];
  moments: SessionMoment[];
  transitions: IntentTransition[];
  outcomes: AcceptedOutcome[];
  narrative: SessionNarrative;
}
```

Each pipeline step reads from state, writes to state. Any step can access any prior field (e.g., narrative can read directives without explicit threading).

**Files:** `src/pipeline/orchestrator.ts`

## Files Summary

| File | Change |
|------|--------|
| `src/pipeline/orchestrator.ts` | DAG parallelism, routing, state enrichment refactor |
| `src/pipeline/precompute.ts` | New — deterministic agency, candidate types, topics, quotes |
| `src/pipeline/simple-narrative.ts` | New — Haiku-based lightweight narrative for simple sessions |
| `src/pipeline/transitions.ts` | Deterministic transition derivation, fix collectFiles bug |
| `src/llm/prompts/moments.ts` | Simplified prompt consuming pre-computed exchanges |
| `src/llm/prompts/critic.ts` | New — narrative critic prompt |
| `src/pipeline/narrative.ts` | Critic loop integration |
| `src/adapters/types.ts` | Add PrecomputedChunkContext, EnrichedExchange, PipelineState, CriticResult |

## What Does NOT Change

Adapter, normalization, chunking, Layer 0 threading/analysis. Storage schema (pre-computed fields are pipeline-internal).

## Cost Impact

| Scenario | Before | After |
|----------|--------|-------|
| Simple session (janitorial, <50 events) | ~11 Sonnet calls | 1 Haiku call |
| Standard session (~100 events, 8 chunks) | ~11 Sonnet calls | ~10 Sonnet + 1-2 Haiku (critic) |
| Large session (~300 events, 20 chunks) | ~23 Sonnet calls | ~22 Sonnet + 1-2 Haiku |

Net: similar cost for standard sessions, massive savings for simple ones, better quality across all.

## Testing

- Pre-computation: given threaded exchanges → verify agency, candidate types, topics, quotes
- Routing: janitorial + <50 events → simple path; narrative + 200 events → standard path
- Deterministic transitions: given moments with arcs → verify correct from/to/reason
- Critic: given narrative with unsupported claim → verify critic catches it
- End-to-end: run against real CC log, compare digest quality before/after
