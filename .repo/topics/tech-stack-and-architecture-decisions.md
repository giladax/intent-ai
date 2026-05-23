# tech stack and architecture decisions

intent-ai is a greenfield TypeScript monolith CLI project using PostgreSQL with pgvector and Drizzle ORM. The stack was explicitly chosen over Python/LangChain (inferred from sibling projects), SQLite, microservices, and library patterns. These decisions reflect ambitions beyond a local single-project tool toward cross-project, multi-user, and semantic-search capabilities.

## constraint

- Drizzle ORM is the database layer — referenced alongside PostgreSQL in the full system design

## decision

- TypeScript is the required language for intent-ai — not Python, despite sibling projects using Python/LangChain/LangGraph
- Monolith CLI architecture was chosen over microservices and library patterns — single TypeScript package with adapters, pipeline, LLM, storage, and CLI all in one process
- PostgreSQL with pgvector was chosen over SQLite to enable semantic search, cross-project queries, and eventual web UI — signaling multi-user ambitions from day one

## Files

- `/Users/giladkoch/.claude/projects/-Users-giladkoch/memory/MEMORY.md` — Global memory file updated with TypeScript preference
- `/Users/giladkoch/.claude/projects/-Users-giladkoch/memory/user_prefers_typescript.md` — Persisted TypeScript preference to prevent future sessions defaulting to Python
- `docs/superpowers/specs/2026-05-21-execution-memory-design.md` — Full design spec capturing stack, schema, CLI, and pipeline decisions

## Evidence

- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
