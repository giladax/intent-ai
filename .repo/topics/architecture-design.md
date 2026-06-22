# Architecture & Design

This document describes the high-level architecture and design principles of the codebase. It serves as the entry point for new developers to understand how the system is structured, what major components exist, why key design decisions were made, and how those components interact. The system's database infrastructure is covered in depth by the child spec 'Database Infrastructure' — this document focuses on the broader architectural picture and cross-cutting concerns. As a living document, it will be updated as architectural evidence is gathered from the codebase. Currently, no knowledge fragments have been provided beyond the child spec boundary, so this spec remains a structured placeholder awaiting population from future analysis sessions.

## constraint

- v1 code must not be reused, migrated from, or built upon in any form. v2 is a clean-slate implementation and v1 serves only as a conceptual reference. Any attempt to port, extend, or adapt v1 logic violates this constraint.
- intent-ai is TypeScript only — not Python. This overrides any inference from sibling projects using Python/LangChain/LangGraph. The preference is persisted in memory files specifically to prevent future sessions from re-assuming Python.
- Do not revert to Python, SQLite, or microservices/library patterns under any circumstances. All three were explicitly evaluated and rejected. Suggesting or implementing any of them would undo deliberate architectural decisions.

## decision

- The atomic unit of knowledge in v2 is the 'moment', not the 'fact'. Moments represent cognitive events — proposals, discoveries, transitions, confirmations, rejections, and commitments — and this is the core data structure around which the entire pipeline is designed.
- PostgreSQL with pgvector is the storage layer. SQLite was considered and rejected. The choice signals that semantic vector search, cross-project queries, and multi-user support are first-class design goals built into the foundation.

## Files

- `/Users/giladkoch/.claude/projects/-Users-giladkoch/memory/MEMORY.md`
- `/Users/giladkoch/.claude/projects/-Users-giladkoch/memory/user_prefers_typescript.md`
- `docs/superpowers/specs/2026-05-21-execution-memory-design.md`
- `docs/superpowers/specs/2026-05-21-execution-memory-design.md`

## Sessions

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 25: The developer set out to implement insight deduplication using Eval-Driven Development, requiring... (7 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)
