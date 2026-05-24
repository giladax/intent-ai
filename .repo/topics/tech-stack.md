# Tech Stack

intent-ai is a TypeScript monolith CLI that runs as a single process containing all subsystems: adapters, pipeline, LLM integration, storage, and CLI interface. The stack was chosen deliberately — TypeScript over Python (despite LLM tooling conventions), PostgreSQL with pgvector over SQLite (for semantic search and cross-project queries), and a monolith CLI over microservices or library patterns (for simplicity and direct developer invocation). These are not defaults or starting points — they are locked architectural decisions made after explicit evaluation of alternatives. PostgreSQL's pgvector extension is what makes semantic similarity search a first-class capability rather than a bolt-on, and the monolith structure means all components share a single process, single deployment, and single dependency graph. New developers should treat these choices as hard constraints: the system is designed around them, not despite them.

## structure

- Because it is a monolith CLI, all subsystems — adapters, pipeline, LLM client, storage (PostgreSQL), and CLI entrypoint — share a single process, single Node.js runtime, and single package dependency graph. There is no inter-service communication layer.

## constraint

- Do not revert to Python, SQLite, or microservices/library patterns under any circumstances. All three were explicitly evaluated and rejected. Suggesting or implementing any of them would undo deliberate architectural decisions.

## decision

- TypeScript is the implementation language — not Python. This was an explicit override of the natural LLM/AI tooling assumption (LangChain, Python ecosystem). The developer locked this in as a persisted preference.
- The architecture is a monolith CLI (Approach A) — all subsystems (adapters, pipeline, LLM, storage, CLI) run in one process. Microservices and library patterns were evaluated and rejected.
- PostgreSQL with pgvector is the storage layer. SQLite was considered and rejected. The choice signals that semantic vector search, cross-project queries, and multi-user support are first-class design goals built into the foundation.

## behavior

- PostgreSQL must be running and accessible for the CLI to function — it is not an embedded database. This means the developer environment requires a Postgres server with the pgvector extension installed.

## Files

- `/Users/giladkoch/.claude/projects/-Users-giladkoch/memory/user_prefers_typescript.md` — Persisted TypeScript preference file — exists to prevent future AI sessions from defaulting back to Python assumptions
- `docs/superpowers/specs/2026-05-21-execution-memory-design.md` — Full system design spec capturing all architectural decisions including tech stack choices and their rationale

## Evidence

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)
