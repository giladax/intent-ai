# Database Infrastructure

> Parent: [Architecture & Design](architecture-design.md)

The database infrastructure layer provides persistent storage for the pipeline orchestrator using PostgreSQL with Drizzle ORM. PostgreSQL is a hard requirement — not SQLite or any embedded alternative — because the system relies on pgvector for semantic similarity search and is designed from v1 for cross-project, multi-user operation. Drizzle ORM provides type-safe query building and a migration toolchain. The infrastructure is managed via two key files: `drizzle.config.ts` configures the Drizzle Kit migration toolchain, and `src/cli/infra.ts` exposes CLI commands (e.g., `intent infra migrate`) for running schema migrations. A critical operational constraint governs migrations: `drizzle-kit migrate` spawns a child Node process that does NOT inherit environment variables loaded via `dotenv/config` in the parent process — `DATABASE_URL` must be explicitly present in the shell environment before invoking drizzle-kit. Developers cannot rely on `.env` file loading in the CLI entry point to satisfy drizzle-kit's env requirements; they must `export DATABASE_URL=...` in their shell or use a wrapper script. The pipeline's `closeDb()` call (invoked after `runPipeline()` in `src/cli/digest.ts`) is also part of this layer, ensuring the Postgres connection pool is explicitly torn down to prevent process hang on exit. Migration history is tracked via a journal file (`drizzle/meta/_journal.json`) that must stay in sync with what has actually been applied to the database — manual SQL application outside of drizzle-kit will cause journal/DB state mismatches that require careful manual resolution.

## constraint

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
- Jun 19: The developer set out to design and implement an activity event backbone for the Intent-AI execut... (26 moments)
