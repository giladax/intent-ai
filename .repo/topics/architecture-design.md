# Architecture & Design

This document describes the high-level architecture and design principles of the codebase. It serves as the entry point for new developers to understand how the system is structured, what major components exist, why key design decisions were made, and how those components interact. As a living document, it will be updated as the system evolves. Currently, no knowledge fragments have been provided, so this spec is initialized as a placeholder to be populated as architectural evidence is gathered from the codebase.

## structure

- All subsystems — adapters, pipeline, LLM integration, storage, and CLI — share a single process, single deployment unit, and single dependency graph. There are no inter-service boundaries or network calls between internal components.
- Because it is a monolith CLI, all subsystems — adapters, pipeline, LLM client, storage (PostgreSQL), and CLI entrypoint — share a single process, single Node.js runtime, and single package dependency graph. There is no inter-service communication layer.
- The storage layer uses Drizzle ORM over PostgreSQL. The schema is defined around the SessionNarrative interface and is specified in the system design doc. Database infrastructure details (schema, migrations, connection management) are covered in the child 'Database Infrastructure' spec.

## constraint

- v2 is a clean-slate implementation. v1 code must not be reused, migrated from, or built upon in any form. v1 exists as a conceptual reference only. Any PR or design that imports, adapts, or extends v1 logic violates this constraint.
- v1 code must not be reused, migrated from, or built upon in any form. v2 is a clean-slate implementation and v1 serves only as a conceptual reference. Any attempt to port, extend, or adapt v1 logic violates this constraint.
- intent-ai is TypeScript only — not Python. This overrides any inference from sibling projects using Python/LangChain/LangGraph. The preference is persisted in memory files specifically to prevent future sessions from re-assuming Python.
- intent-ai is TypeScript only — never Python. This was an explicit developer override of the AI's initial inference from sibling projects using Python/LangChain/LangGraph, and has been persisted to memory files to prevent future sessions from re-introducing the Python assumption.
- Do not revert to Python, SQLite, or microservices/library patterns under any circumstances. All three were explicitly evaluated and rejected. Suggesting or implementing any of them would undo deliberate architectural decisions.
- v2 is a complete greenfield build. v1 code must not be reused, migrated, or extended in any way. v1 exists only as a conceptual reference — any temptation to port or adapt v1 components must be rejected.
- pgvector (PostgreSQL extension) is a hard dependency for semantic search. SQLite cannot be substituted — the semantic similarity search architecture is built around pgvector's vector indexing capabilities.

## decision

- The atomic unit of knowledge in v2 is the 'moment', not the 'fact'. Moments represent cognitive events — proposals, discoveries, transitions, confirmations, rejections, and commitments — and this is the core data structure around which the entire pipeline is designed.
- TypeScript is the implementation language — not Python. This was an explicit override of the natural LLM/AI tooling assumption (LangChain, Python ecosystem). The developer locked this in as a persisted preference.
- The atomic unit of knowledge in v2 is the 'moment' — a typed cognitive event (proposal, discovery, transition, confirmation, rejection, commitment) — replacing v1's 'fact' as the core data structure. Every downstream component must be designed around moments, not facts.
- The architecture is a monolith CLI (Approach A) — all subsystems (adapters, pipeline, LLM, storage, CLI) run in one process. Microservices and library patterns were evaluated and rejected.
- PostgreSQL with pgvector was chosen over SQLite to support semantic similarity search, cross-project queries, and eventual multi-user/web UI access from v1. This is not a scaling decision deferred to later — it reflects the project's ambition to operate across projects and users from the start.
- PostgreSQL with pgvector is the storage layer. SQLite was considered and rejected. The choice signals that semantic vector search, cross-project queries, and multi-user support are first-class design goals built into the foundation.
- The fundamental data structure in v2 is the 'moment' (proposals, discoveries, transitions, confirmations, rejections, commitments), not the 'fact' used in v1. This is the core architectural difference between the two versions.
- The architecture is a monolith CLI — a single TypeScript package with adapters, pipeline, LLM, storage, and CLI all in one process. Microservices and library patterns were explicitly evaluated and rejected in favor of simplicity and direct developer invocation.
- PostgreSQL with pgvector was chosen over SQLite from v1. This is not a scalability hedge — it reflects a design intent for cross-project queries, multi-user access, and semantic similarity search as core capabilities, not future additions.
- The v2 pipeline is oriented around cognitive compression, not fact extraction. The goal is to identify and preserve meaningful transitions in understanding — the 'when and how' of knowledge change — rather than enumerating discrete data points.
- The v2 pipeline is oriented around cognitive compression rather than fact extraction. The goal is to identify and preserve meaningful transitions in understanding, not to enumerate every discrete piece of information encountered.
- The architecture is a monolith CLI — a single TypeScript package where adapters, pipeline, LLM integration, storage, and CLI all run in one process. Microservices and library patterns were explicitly evaluated and rejected in favor of simplicity and direct developer invocation.
- The v2 pipeline is oriented around cognitive compression, not fact extraction. The goal is to capture meaningful cognitive events — shifts in understanding, commitments, rejections — rather than enumerating discrete facts from a conversation.

## behavior

- PostgreSQL must be running and accessible for the CLI to function — it is not an embedded database. This means the developer environment requires a Postgres server with the pgvector extension installed.

## risk

- AI coding assistants working on this codebase will repeatedly infer Python as the language based on the LLM/AI tooling ecosystem (LangChain, LangGraph, etc.). The TypeScript constraint must be re-asserted at the start of any new session or when adding new dependencies — do not assume the AI has retained this context.
- AI assistants working on this codebase will incorrectly infer Python as the language based on the LLM tooling ecosystem (LangChain, LangGraph). This has already happened and required explicit correction. Always verify language assumptions against the persisted memory files before generating code.
- The most likely architectural drift risk is reverting to fact-centric thinking — e.g., designing storage schemas, retrieval queries, or summarization logic around discrete facts rather than typed cognitive events. Any abstraction that flattens moment type or strips cognitive context is a regression toward v1 semantics.
- The most likely architectural drift risk is reverting to fact-based thinking when designing new pipeline components. Any data structure, schema, or processing step that treats isolated facts as the primary output should be treated as a design violation and reconsidered against the moment model.

## Files

- `/Users/giladkoch/.claude/projects/-Users-giladkoch/memory/MEMORY.md`
- `/Users/giladkoch/.claude/projects/-Users-giladkoch/memory/user_prefers_typescript.md`
- `docs/superpowers/specs/2026-05-21-execution-memory-design.md`
- `docs/superpowers/specs/2026-05-21-execution-memory-design.md`

## Sessions

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)
