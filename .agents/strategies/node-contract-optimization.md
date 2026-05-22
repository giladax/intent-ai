# Node Contract Optimization

## Purpose

Define strict node responsibilities.

Every node should behave like a bounded software component.

## Required Contract Fields

- input state
- output state
- allowed tools
- failure behavior
- retry policy
- evaluator expectations

## Design Principles

- nodes should have single responsibilities
- outputs should be structured
- state writes should be minimal
- failures should be explicit

## Contract Violations

Examples:
- writing unexpected state
- calling unauthorized tools
- mutating unrelated artifacts
- generating ambiguous outputs

## Preferred Patterns

Prefer:
- typed schemas
- deterministic transforms
- explicit contracts

Avoid:
- implicit state assumptions
- free-form mutation
- global state mutation