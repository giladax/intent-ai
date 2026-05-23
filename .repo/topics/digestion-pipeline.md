# digestion pipeline

The intent-ai digestion pipeline is a multi-stage, single-process orchestration that transforms raw Claude Code conversation logs into structured SessionNarrative artifacts. Model assignments are explicit: Haiku handles shape classification (cheap, fast), Sonnet handles moment detection and arc/transition writing (quality-critical). Storage uses Drizzle ORM over PostgreSQL. The CLI entry point is `intent digest`.

## structure

- The pipeline assigns Claude Haiku to shape classification and Claude Sonnet to moment detection and transition/arc writing — cost and quality tiers are intentional.
- The pipeline produces a SessionNarrative interface stored via Drizzle ORM in PostgreSQL, exposed through the `intent digest` CLI command.

## behavior

- The data source for digestion is Claude Code conversation logs — which already contain every Edit, Write, and Bash tool call with full context and reasoning, making them richer than raw git diffs.

## interface

- The primary CLI command is `intent digest` — this is the user-facing entry point for the pipeline.

## Files

- `/Users/giladkoch/dev/intent-ai/docs/superpowers/specs/2026-05-21-execution-memory-design.md` — Spec containing the full pipeline orchestration design, model assignments, and CLI commands.

## Evidence

- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)

## Related

- [tech stack and architecture](tech-stack-and-architecture.md)
