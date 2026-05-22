# Context Composition

## Purpose

Optimize information quality, not context size.

More context frequently reduces reliability.

## Principles

- Include only task-relevant state
- Prefer structured artifacts over transcripts
- Remove stale reasoning
- Minimize duplicated information

## Context Layers

### Stable Context
Rarely changing:
- system rules
- schemas
- topology constraints

### Session Context
Current interaction state:
- active objectives
- retrieved artifacts
- routing metadata

### Ephemeral Context
Short-lived reasoning:
- repair attempts
- temporary plans
- intermediate outputs

## Anti-Patterns

Avoid:
- dumping full conversations
- unbounded scratchpads
- repeated retrieval results
- mixed historical and current instructions

## Optimization Goal

Maximize:
- signal density
- retrieval relevance
- state clarity

Minimize:
- ambiguity
- token cost
- stale information