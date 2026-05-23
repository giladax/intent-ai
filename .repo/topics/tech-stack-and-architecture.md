# tech stack and architecture

intent-ai is a greenfield TypeScript monolith CLI — a single package with adapters, pipeline, LLM, storage, and CLI all in one process. PostgreSQL (with pgvector) is the storage layer, chosen over SQLite to support cross-project queries, semantic search, and eventual multi-user/web UI scenarios. Python/LangChain was explicitly rejected.

## constraint

- Do not introduce Python, SQLite, microservices, or library-pattern architectures — all three were explicitly rejected during design.

## decision

- TypeScript is the required language for intent-ai — Python/LangChain was inferred from sibling projects but explicitly overridden by the developer.
- Monolith CLI architecture was chosen over microservices and library patterns — no service boundaries, no inter-process communication, just a clean pipeline within one process.
- PostgreSQL was chosen over SQLite to enable pgvector semantic search, cross-project queries, and eventual web UI — signaling the project is not a local single-project tool.

## Files

- `/Users/giladkoch/.claude/projects/-Users-giladkoch/memory/MEMORY.md` — Master memory file updated to reflect TypeScript preference.
- `/Users/giladkoch/.claude/projects/-Users-giladkoch/memory/user_prefers_typescript.md` — Persisted memory artifact encoding the TypeScript language preference.
- `/Users/giladkoch/dev/intent-ai/docs/superpowers/specs/2026-05-21-execution-memory-design.md` — Full design spec capturing the chosen architecture, storage schema, CLI commands, and pipeline.

## Evidence

- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
