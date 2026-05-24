# Database Infrastructure

> Parent: [Pipeline Orchestration](pipeline-orchestration.md)

The database infrastructure layer provides persistent storage for the pipeline orchestrator using PostgreSQL with Drizzle ORM. PostgreSQL is a hard requirement — not SQLite or any embedded alternative — because the system relies on pgvector for semantic similarity search and is designed from v1 for cross-project, multi-user operation. Drizzle ORM provides type-safe query building and a migration toolchain. The infrastructure is managed via two key files: `drizzle.config.ts` configures the Drizzle Kit migration toolchain, and `src/cli/infra.ts` exposes CLI commands (e.g., `intent infra migrate`) for running schema migrations. A critical operational constraint governs migrations: `drizzle-kit migrate` spawns a child Node process that does NOT inherit environment variables loaded via `dotenv/config` in the parent process — `DATABASE_URL` must be explicitly present in the shell environment before invoking drizzle-kit. Developers cannot rely on `.env` file loading in the CLI entry point to satisfy drizzle-kit's env requirements; they must `export DATABASE_URL=...` in their shell or use a wrapper script. The pipeline's `closeDb()` call (invoked after `runPipeline()` in `src/cli/digest.ts`) is also part of this layer, ensuring the Postgres connection pool is explicitly torn down to prevent process hang on exit.

## structure

- The infrastructure layer is split across two files: `drizzle.config.ts` (Drizzle Kit configuration, requires DATABASE_URL in shell env) and `src/cli/infra.ts` (CLI command surface that spawns the drizzle-kit migrate subprocess). Schema migrations flow through this pair exclusively.

## constraint

- `drizzle-kit migrate` spawns a new Node subprocess that does NOT inherit environment variables loaded via `dotenv/config` in the parent process. `DATABASE_URL` must be explicitly exported in the shell environment before running any drizzle-kit command — loading it programmatically in the CLI entry point is insufficient.
- `drizzle-kit migrate` spawns a subprocess that does NOT inherit dotenv-loaded env vars — DATABASE_URL must be exported to the shell environment before running any drizzle-kit command, not just imported via dotenv in the parent CLI process.

## decision

- PostgreSQL is chosen over SQLite as a hard architectural constraint — not a default — because pgvector enables first-class semantic similarity search and the system is designed for cross-project, multi-user operation from v1.
- PostgreSQL is the required database — this is a hard constraint driven by the pipeline's use of Drizzle ORM and Postgres-specific capabilities. SQLite or other embedded databases are not viable substitutes.

## behavior

- After `runPipeline()` completes in `src/cli/digest.ts`, `closeDb()` must be called explicitly to tear down the Postgres connection pool. Without this, the Node process will hang on exit because the pool keeps the event loop alive.
- The `src/cli/infra.ts` file is responsible for spawning drizzle-kit as a subprocess for migrations — any wrapper logic that needs to bridge dotenv-loaded vars into that subprocess must live here, e.g., by reading `process.env` after dotenv load and passing vars explicitly to the child process spawn options.

## risk

- Developers who add new CLI commands that invoke drizzle-kit (or any subprocess that needs DATABASE_URL) will silently fail if they assume dotenv loading in the parent process is sufficient. This is a recurring footgun — the fix must be documented at the shell/environment level, not in code.
- Migration failures caused by missing DATABASE_URL in the subprocess environment are silent or cryptically reported — developers may incorrectly diagnose this as a config file problem rather than an env inheritance issue.

## interface

- The `DATABASE_URL` environment variable is the single external contract between the database infrastructure and the rest of the system — it must be a valid Postgres connection string present in the shell environment for both runtime (Drizzle ORM queries) and migration time (drizzle-kit subprocess).

## Files

- `drizzle.config.ts`
- `src/cli/digest.ts`
- `src/cli/infra.ts`

## Sessions

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)
