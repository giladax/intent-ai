# Eval Case Schema

Matches the actual `ScopeCriteria` format used in `tests/eval/session-criteria.ts`.

```yaml
id: string
name: string
fixture_path: string  # path to .jsonl fixture file
scope:
  enum:
    - design
    - implementation
    - pivot
    - full
must_detect_moments:
  - topic: string
    type:
      enum: [realization, decision, pivot, struggle, exploration, implementation, ...]
    agency:
      enum: [developer, ai, collaborative]
    description: string  # optional, what the moment should capture
must_not_detect:
  - pattern: string     # anti-patterns that should NOT appear
    reason: string
narrative_musts:
  - string              # phrases or concepts the narrative must contain
narrative_must_nots:
  - string              # phrases or concepts the narrative must NOT contain
expected_directives:
  detect_passive_acceptance: boolean
  detect_delegation: boolean
  detect_challenge: boolean
  # additional behavioral flags as needed
tags:
  - string
difficulty:
  enum:
    - easy
    - medium
    - hard
```

## Fixture Format

Fixtures are `.jsonl` files containing raw CC conversation log events. Each line is a JSON object representing one event from the Claude Code session.

## Scope Types

| Scope | What it covers |
|-------|---------------|
| design | Architectural decisions, spec discussions |
| implementation | Code writing, debugging, iteration |
| pivot | Direction changes, rejected approaches |
| full | End-to-end session (all scopes combined) |

## Fitness Weights

| Metric | Weight |
|--------|--------|
| Moment detection (must_detect) | 0.30 |
| Moment precision (must_not_detect) | 0.10 |
| Narrative quality (narrative_musts) | 0.30 |
| Narrative precision (narrative_must_nots) | 0.10 |
| Directive accuracy (expected_directives) | 0.20 |
