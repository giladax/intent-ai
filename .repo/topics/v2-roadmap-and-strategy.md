# v2 roadmap and strategy
> Parent: [tech stack and architecture decisions](tech-stack-and-architecture-decisions.md)

v2 is a ground-up reimplementation of intent-ai that replaces v1's fact-extraction model with a fundamentally different cognitive architecture centered on 'moments' — discrete units of developer cognition such as proposals, discoveries, transitions, confirmations, rejections, and commitments. Where v1 treated conversations as sources of extractable facts, v2 treats them as sequences of cognitive events that can be compressed and reasoned over. This is not an incremental upgrade: v1 exists solely as a reference artifact, and no v1 code, schemas, or migration paths are carried forward. The strategic bet is that modeling the shape of developer thinking (not just its outputs) enables richer cross-session, cross-project intelligence that aligns with the PostgreSQL/pgvector/Drizzle stack chosen at the architecture level.

## structure

- v2's architecture is designed to support the cross-project, multi-user, and semantic-search ambitions described in the parent tech stack spec. The shift to moments (rather than facts) is what makes semantic similarity across sessions meaningful — moments carry cognitive context that bare facts do not, making pgvector embeddings over moments more semantically rich.

## constraint

- v2 is a clean-slate implementation. v1 code must not be reused, imported, migrated from, or built upon in any form. v1 exists as a conceptual reference only — consult it for intent, never for implementation.

## decision

- The atomic unit of storage and processing in v2 is the 'moment' (proposals, discoveries, transitions, confirmations, rejections, commitments), not the 'fact'. This is the single most important architectural difference from v1 and must not be regressed.
- The v2 pipeline is oriented around cognitive compression — distilling the shape and progression of developer thinking — rather than fact extraction. Pipeline stages, prompts, and data models should be designed with this goal as the primary objective.

## risk

- The moment taxonomy (proposals, discoveries, transitions, confirmations, rejections, commitments) is the load-bearing abstraction for all of v2. If this taxonomy is poorly defined or inconsistently applied in the pipeline, the entire cognitive compression model breaks down. Treat the moment type definitions as a critical interface contract.

## Evidence

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)
