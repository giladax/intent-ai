# storage schema

The persistence layer uses PostgreSQL with Drizzle ORM. The schema is designed from day one for cross-project queries, pgvector semantic search, and eventual multi-user access — not scoped to a single local project.

## constraint

- The schema must support pgvector from the start — semantic search over sessions and moments is a first-class requirement, not a future add-on.

## decision

- Drizzle ORM was selected as the TypeScript-native ORM for PostgreSQL — this is the database access layer for the project.

## Files

- `docs/superpowers/specs/2026-05-21-execution-memory-design.md` — Contains the Postgres/Drizzle schema design for sessions, moments, and related entities.

## Evidence

- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)

## Related

- [tech stack and architecture decisions](tech-stack-and-architecture-decisions.md)
- [digestion pipeline](digestion-pipeline.md)
