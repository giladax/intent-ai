# tech stack and architecture decisions
> Children: [v2 roadmap and strategy](v2-roadmap-and-strategy.md)

intent-ai is a greenfield TypeScript monolith CLI project built on PostgreSQL with pgvector and Drizzle ORM. The stack reflects deliberate, locked-in choices: TypeScript over Python/LangChain (despite sibling projects using Python), PostgreSQL over SQLite (to enable semantic search via pgvector, cross-project queries, and eventual multi-user/web UI support), and a single-process monolith over microservices or library patterns. All major subsystems — adapters, pipeline, LLM integration, storage, and CLI — live in one TypeScript package with no service boundaries or inter-process communication. These decisions signal that intent-ai is designed to grow beyond a local single-project tool, and the architecture was chosen to support that trajectory from day one. A critical operational constraint exists around database migrations: drizzle-kit spawns a subprocess that does not inherit dotenv-loaded environment variables, so DATABASE_URL must be explicitly exported to the shell before running migrations.

## structure

- Drizzle ORM is the data access layer sitting between the application and PostgreSQL — drizzle.config.ts configures the kit (including migration tooling) and requires DATABASE_URL to be present in the shell environment at migration time.

## constraint

- intent-ai is TypeScript only — Python, LangChain, and LangGraph are explicitly rejected and must not be introduced, even though sibling projects use them. This preference is persisted in memory files to prevent future sessions from re-assuming Python.
- drizzle-kit migrate spawns a new Node subprocess and does NOT inherit env vars loaded by dotenv in the parent process — DATABASE_URL must be explicitly exported to the shell environment before running drizzle-kit, not just set via dotenv in application code.
- Drizzle ORM is the database layer — referenced alongside PostgreSQL in the full system design

## decision

- TypeScript is the required language for intent-ai — not Python, despite sibling projects using Python/LangChain/LangGraph
- Monolith CLI architecture was chosen over microservices and library patterns — single TypeScript package with adapters, pipeline, LLM, storage, and CLI all in one process
- Monolith CLI architecture (Approach A) was chosen over microservices or library patterns — all subsystems (adapters, pipeline, LLM, storage, CLI) run in a single TypeScript process with no service boundaries or inter-process communication.
- PostgreSQL with pgvector was chosen over SQLite to enable semantic search, cross-project queries, and eventual web UI — signaling multi-user ambitions from day one
- PostgreSQL was chosen over SQLite specifically to enable pgvector semantic search, cross-project queries, and eventual multi-user/web UI — this is not a local single-project tool and the database choice reflects that ambition.

## risk

- The drizzle-kit subprocess env var gap is a recurring operational footgun — any CI/CD pipeline, onboarding script, or npm migration command that relies solely on dotenv will silently fail to connect to the database during migrations.

## Files

- `drizzle.config.ts` — Drizzle kit configuration — requires DATABASE_URL to be present in the shell environment (not just dotenv) for migrations to succeed
- `src/cli/infra.ts` — CLI infra commands including migrate — must ensure DATABASE_URL is exported to the shell before spawning drizzle-kit subprocess
- `/Users/giladkoch/.claude/projects/-Users-giladkoch/memory/MEMORY.md` — Global memory file updated with TypeScript preference
- `/Users/giladkoch/.claude/projects/-Users-giladkoch/memory/user_prefers_typescript.md` — Persisted TypeScript preference to prevent future sessions defaulting to Python
- `docs/superpowers/specs/2026-05-21-execution-memory-design.md` — Full design spec capturing stack, schema, CLI, and pipeline decisions
- `docs/superpowers/specs/2026-05-21-execution-memory-design.md` — Full system design spec covering architecture, schema, CLI, and pipeline — canonical reference for the overall design

## Evidence

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)
