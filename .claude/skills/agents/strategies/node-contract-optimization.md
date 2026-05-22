# Node Contract Optimization

## Purpose

Define strict node responsibilities.

Every node should behave like a bounded software component with a clear PURPOSE stated as a question it answers.

## Node Purpose Pattern

Each node's contract should start with the question it answers:

| Node | Purpose Question |
|------|-----------------|
| Moment Detector | "What is signal vs noise in this chunk?" |
| Transition Detector | "Where did the developer's intent change, and why?" |
| Narrative Generator | "What is the story of how understanding evolved?" |
| Exchange Classifier | "What is the engagement, intent, and agency of this exchange?" |

The purpose question constrains what the node should and should not do. A moment detector should NOT attribute narrative arcs — that is a different node's question.

## Key Learning: Pre-computation Does the Heavy Lifting

The node that matters most is often the pre-computation step (Chr 3), not the main LLM call. When exchanges arrive with accurate engagement/intent/agency labels, the moment detector's job simplifies to "separate signal from noise" rather than "analyze everything from scratch."

## Required Contract Fields

- purpose (stated as a question)
- input state (with pre-computed fields explicitly listed)
- output state
- allowed tools
- failure behavior
- retry policy
- evaluator expectations

## Design Principles

- nodes should have single responsibilities
- outputs should be structured (Zod-validated)
- state writes should be minimal — enrich, never replace
- failures should be explicit
- pre-computed labels should be treated as inputs, not re-derived

## Contract Violations

Examples:
- writing unexpected state
- calling unauthorized tools
- mutating unrelated artifacts
- generating ambiguous outputs
- re-deriving classifications that were already pre-computed
- hallucinating data not present in inputs (e.g., file paths not in `filesInScope`)

## Preferred Patterns

Prefer:
- typed schemas with Zod validation
- deterministic transforms where possible
- explicit contracts
- lenient Zod schemas for LLM output (`.optional().default()`, `.passthrough()`)

Avoid:
- implicit state assumptions
- free-form mutation
- global state mutation
- regex for semantic classification
