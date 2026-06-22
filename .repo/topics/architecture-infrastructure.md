# Architecture & Infrastructure

This spec covers the high-level architectural decisions and infrastructure choices that define how the system is structured, deployed, and operated. It exists to give new developers a clear mental model of how the major components fit together, what constraints govern technology choices, and why the system is organized the way it is. No knowledge fragments were provided for this spec, so this document represents a baseline scaffold — it should be evolved as fragments are added. The Database Infrastructure child spec covers persistence layer details specifically; this spec focuses on everything above and around that layer: service topology, runtime environment, deployment model, and cross-cutting infrastructure concerns.

## structure

- Database Infrastructure is a distinct child concern — architectural decisions about persistence (schema, migrations, connection pooling, vector extensions) are documented in the Database Infrastructure spec, not here. This spec covers the layers above: application structure, service boundaries, and deployment topology.

## constraint

- No knowledge fragments were assigned to this spec. All insights are structural placeholders derived from the tree context. This spec must be evolved with real fragment evidence before it can be treated as authoritative.
- `drizzle-kit migrate` spawns a subprocess that does NOT inherit dotenv-loaded env vars — DATABASE_URL must be exported to the shell environment before running any drizzle-kit command, not just imported via dotenv in the parent CLI process.

## decision

- Drizzle ORM was chosen over raw SQL or other ORMs to provide compile-time type safety on queries and a first-class migration toolchain (`drizzle-kit`) that generates and applies SQL migrations from TypeScript schema definitions.
- PostgreSQL is chosen over SQLite as a hard architectural constraint — not a default — because pgvector enables first-class semantic similarity search and the system is designed for cross-project, multi-user operation from v1.

## behavior

- After `runPipeline()` completes in `src/cli/digest.ts`, `closeDb()` must be called explicitly to tear down the Postgres connection pool. Without this, the Node process will hang on exit because the pool keeps the event loop alive.

## Files

- `drizzle.config.ts`
- `drizzle/0004_brain_hierarchy.sql`
- `drizzle/0004_woozy_wallow.sql`
- `drizzle/meta/_journal.json`
- `src/cli/digest.ts`
- `src/cli/infra.ts`

## Sessions

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 25: The developer set out to implement insight deduplication using Eval-Driven Development, requiring... (7 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)
