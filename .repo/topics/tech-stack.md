# Tech Stack
> **area**
> intent-ai is a TypeScript monolith CLI that runs as a single process containing all subsystems: adapters, pipeline, LLM integration, storage, and CLI interface. The stack was chosen deliberately after explicit evaluation of alternatives — TypeScript over Python (despite LLM tooling conventions favoring Python/LangChain/LangGraph), PostgreSQL with pgvector over SQLite (for semantic search, cross-project queries, and eventual multi-user access), and a monolith CLI over microservices or library patterns (for simplicity and direct developer invocation). These are not defaults or starting points — they are locked architectural decisions. PostgreSQL's pgvector extension makes semantic similarity search a first-class capability rather than a bolt-on, and the choice of Postgres over SQLite signals that intent-ai is designed from v1 to operate across projects and users, not as a local single-project tool. The storage layer uses Drizzle ORM to interface with PostgreSQL, with a schema defined around the SessionNarrative interface. The monolith structure means all components share...
> [constraint] intent-ai is TypeScript only — never Python. This was an ... · [decision] PostgreSQL with pgvector was chosen over SQLite to suppor... · [decision] The architecture is a monolith CLI — a single TypeScript ... · [risk] AI coding assistants working on this codebase will repeat... · [structure] The storage layer uses Drizzle ORM over PostgreSQL. The s...

intent-ai is a TypeScript monolith CLI that runs as a single process containing all subsystems: adapters, pipeline, LLM integration, storage, and CLI interface. The stack was chosen deliberately after explicit evaluation of alternatives — TypeScript over Python (despite LLM tooling conventions favoring Python/LangChain/LangGraph), PostgreSQL with pgvector over SQLite (for semantic search, cross-project queries, and eventual multi-user access), and a monolith CLI over microservices or library patterns (for simplicity and direct developer invocation). These are not defaults or starting points — they are locked architectural decisions. PostgreSQL's pgvector extension makes semantic similarity search a first-class capability rather than a bolt-on, and the choice of Postgres over SQLite signals that intent-ai is designed from v1 to operate across projects and users, not as a local single-project tool. The storage layer uses Drizzle ORM to interface with PostgreSQL, with a schema defined around the SessionNarrative interface. The monolith structure means all components share a single process, single deployment, and single dependency graph — database infrastructure details are covered in the child spec.

## structure

- All subsystems — adapters, pipeline, LLM integration, storage, and CLI — share a single process, single deployment unit, and single dependency graph. There are no inter-service boundaries or network calls between internal components.
- Because it is a monolith CLI, all subsystems — adapters, pipeline, LLM client, storage (PostgreSQL), and CLI entrypoint — share a single process, single Node.js runtime, and single package dependency graph. There is no inter-service communication layer.
- The storage layer uses Drizzle ORM over PostgreSQL. The schema is defined around the SessionNarrative interface and is specified in the system design doc. Database infrastructure details (schema, migrations, connection management) are covered in the child 'Database Infrastructure' spec.

## constraint

- Do not revert to Python, SQLite, or microservices/library patterns under any circumstances. All three were explicitly evaluated and rejected. Suggesting or implementing any of them would undo deliberate architectural decisions.
- intent-ai is TypeScript only — not Python. This overrides any inference from sibling projects using Python/LangChain/LangGraph. The preference is persisted in memory files specifically to prevent future sessions from re-assuming Python.
- intent-ai is TypeScript only — never Python. This was an explicit developer override of the AI's initial inference from sibling projects using Python/LangChain/LangGraph, and has been persisted to memory files to prevent future sessions from re-introducing the Python assumption.
- pgvector (PostgreSQL extension) is a hard dependency for semantic search. SQLite cannot be substituted — the semantic similarity search architecture is built around pgvector's vector indexing capabilities.

## decision

- TypeScript is the implementation language — not Python. This was an explicit override of the natural LLM/AI tooling assumption (LangChain, Python ecosystem). The developer locked this in as a persisted preference.
- PostgreSQL with pgvector was chosen over SQLite from v1. This is not a scalability hedge — it reflects a design intent for cross-project queries, multi-user access, and semantic similarity search as core capabilities, not future additions.
- PostgreSQL with pgvector is the storage layer. SQLite was considered and rejected. The choice signals that semantic vector search, cross-project queries, and multi-user support are first-class design goals built into the foundation.
- The architecture is a monolith CLI (Approach A) — all subsystems (adapters, pipeline, LLM, storage, CLI) run in one process. Microservices and library patterns were evaluated and rejected.
- PostgreSQL with pgvector was chosen over SQLite to support semantic similarity search, cross-project queries, and eventual multi-user/web UI access from v1. This is not a scaling decision deferred to later — it reflects the project's ambition to operate across projects and users from the start.
- The architecture is a monolith CLI — a single TypeScript package with adapters, pipeline, LLM, storage, and CLI all in one process. Microservices and library patterns were explicitly evaluated and rejected in favor of simplicity and direct developer invocation.
- The architecture is a monolith CLI — a single TypeScript package where adapters, pipeline, LLM integration, storage, and CLI all run in one process. Microservices and library patterns were explicitly evaluated and rejected in favor of simplicity and direct developer invocation.

## behavior

- PostgreSQL must be running and accessible for the CLI to function — it is not an embedded database. This means the developer environment requires a Postgres server with the pgvector extension installed.

## risk

- AI assistants working on this codebase will incorrectly infer Python as the language based on the LLM tooling ecosystem (LangChain, LangGraph). This has already happened and required explicit correction. Always verify language assumptions against the persisted memory files before generating code.
- AI coding assistants working on this codebase will repeatedly infer Python as the language based on the LLM/AI tooling ecosystem (LangChain, LangGraph, etc.). The TypeScript constraint must be re-asserted at the start of any new session or when adding new dependencies — do not assume the AI has retained this context.

## Files

- `docs/superpowers/specs/2026-05-21-execution-memory-design.md` — Full system design spec covering architecture, schema, CLI, and pipeline — the authoritative reference for all stack and structural decisions.
- `/Users/giladkoch/.claude/projects/-Users-giladkoch/memory/MEMORY.md` — Top-level memory index updated to reflect TypeScript preference — serves as the authoritative reference for cross-session architectural constraints.
- `/Users/giladkoch/.claude/projects/-Users-giladkoch/memory/user_prefers_typescript.md` — Persisted memory artifact encoding the TypeScript language preference — exists specifically to prevent AI sessions from re-inferring Python based on ecosystem context.
- `/Users/giladkoch/.claude/projects/-Users-giladkoch/memory/user_prefers_typescript.md` — Persisted TypeScript language preference to prevent AI sessions from re-introducing Python assumptions.
- `/Users/giladkoch/.claude/projects/-Users-giladkoch/memory/user_prefers_typescript.md` — Persisted TypeScript preference file — exists to prevent future AI sessions from defaulting back to Python assumptions
- `docs/superpowers/specs/2026-05-21-execution-memory-design.md` — Full system design spec capturing all architectural decisions including tech stack choices and their rationale

## Evidence

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)
