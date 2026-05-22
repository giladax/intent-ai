# Context Composition

## Purpose

Optimize information quality, not context size.

More context frequently reduces reliability — but MISSING context causes worse failures (wrong attribution, lost cross-chunk patterns).

## Proven Pattern: Session Digest

When processing chunks in parallel, each chunk loses visibility into neighboring chunks. The **session digest** pattern solves this:

1. **Pre-compute cross-chunk context** before fan-out:
   - Developer statements (what the developer said across the full session)
   - Topic flow (ordered list of topics across all chunks)
   - Boundary exchanges (last exchange of chunk N, first of chunk N+1)

2. **Inject digest into each chunk's prompt** — gives each parallel worker awareness of the full session without sending the full session.

3. **Result:** Fixed cross-chunk context loss and wrong agency attribution. Each chunk processor knows what came before and after without receiving raw events from other chunks.

## Context Layers

### Stable Context
Rarely changing:
- system rules
- schemas
- topology constraints

### Pre-computed Context (Session Digest)
Derived from the full input before fan-out:
- developer statements with behavioral flags
- topic flow and arc structure
- boundary exchanges between chunks
- exchange classifications (engagement, intent, agency)

### Chunk-Local Context
The specific data this node processes:
- raw events in scope
- files in scope
- pre-computed labels for this chunk's exchanges

### Ephemeral Context
Short-lived reasoning:
- repair attempts
- temporary plans
- intermediate outputs

## Anti-Patterns

Avoid:
- dumping full conversations into every parallel worker
- unbounded scratchpads
- repeated retrieval results
- mixed historical and current instructions
- using regex for semantic classification in pre-computation (use Haiku structured output)

## Optimization Goal

Maximize:
- signal density
- retrieval relevance
- state clarity
- cross-chunk awareness (via digest, not via sending everything)

Minimize:
- ambiguity
- token cost
- stale information
- redundant context between chunks
