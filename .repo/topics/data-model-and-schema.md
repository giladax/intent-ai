# data model and schema

The intent-ai data model centers on the `SessionNarrative` interface stored in PostgreSQL via Drizzle ORM. Key schema decisions include a structured `agency` field on moments (developer vs AI), causal links between moments, an `execution` moment type for low-inflection-point sessions, and pgvector columns for semantic search. These schema choices were hardened through adversarial review before the spec was written.

## structure

- Moments in the schema have: type (including `execution`), agency (developer|AI), causal links to other moments, and evidence references — all required fields, not optional

## constraint

- pgvector support is a hard requirement driving the PostgreSQL choice — semantic search over session narratives is a planned capability, not a future nice-to-have

## decision

- Schema was adversarially reviewed before being committed to the spec — 7 concrete design gaps were identified and resolved, making the schema more robust than a first-pass design

## Files

- `docs/superpowers/specs/2026-05-21-execution-memory-design.md` — Contains the full Postgres/Drizzle schema design including SessionNarrative interface and moment structure

## Evidence

- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)

## Related

- [tech stack and architecture decisions](tech-stack-and-architecture-decisions.md)
- [moment detection system](moment-detection-system.md)
- [digestion pipeline](digestion-pipeline.md)
