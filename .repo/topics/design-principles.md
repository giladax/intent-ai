# Design Principles

The v2 system is built on two foundational design principles that define its identity and set hard boundaries on implementation. First, the atomic unit of knowledge is the 'moment' — a cognitive event such as a proposal, discovery, transition, confirmation, rejection, or commitment — rather than the discrete 'fact' used in v1. This shift reorients the entire pipeline from fact extraction toward cognitive compression: the system captures meaningful transitions in understanding rather than cataloguing isolated data points. A moment encodes not just what was learned, but the cognitive significance of when and how understanding changed. Second, v2 is a complete greenfield rewrite; v1 exists solely as a conceptual reference and must not be reused, migrated from, or extended in any form. These two principles together define what v2 is trying to be and set hard constraints on how it must be built — any design decision that treats facts as the primary data structure, or that imports v1 logic, violates the foundational architecture.

## constraint

- v2 is a clean-slate implementation. v1 code must not be reused, migrated from, or built upon in any form. v1 exists as a conceptual reference only. Any PR or design that imports, adapts, or extends v1 logic violates this constraint.
- v2 is a complete greenfield build. v1 code must not be reused, migrated, or extended in any way. v1 exists only as a conceptual reference — any temptation to port or adapt v1 components must be rejected.
- v1 code must not be reused, migrated from, or built upon in any form. v2 is a clean-slate implementation and v1 serves only as a conceptual reference. Any attempt to port, extend, or adapt v1 logic violates this constraint.

## decision

- The atomic unit of knowledge in v2 is the 'moment' — a typed cognitive event (proposal, discovery, transition, confirmation, rejection, commitment) — replacing v1's 'fact' as the core data structure. Every downstream component must be designed around moments, not facts.
- The atomic unit of knowledge in v2 is the 'moment', not the 'fact'. Moments represent cognitive events — proposals, discoveries, transitions, confirmations, rejections, and commitments — and this is the core data structure around which the entire pipeline is designed.
- The fundamental data structure in v2 is the 'moment' (proposals, discoveries, transitions, confirmations, rejections, commitments), not the 'fact' used in v1. This is the core architectural difference between the two versions.
- The v2 pipeline is oriented around cognitive compression, not fact extraction. The goal is to identify and preserve meaningful transitions in understanding — the 'when and how' of knowledge change — rather than enumerating discrete data points.
- The v2 pipeline is oriented around cognitive compression rather than fact extraction. The goal is to identify and preserve meaningful transitions in understanding, not to enumerate every discrete piece of information encountered.
- The v2 pipeline is oriented around cognitive compression, not fact extraction. The goal is to capture meaningful cognitive events — shifts in understanding, commitments, rejections — rather than enumerating discrete facts from a conversation.

## risk

- The most likely architectural drift risk is reverting to fact-centric thinking — e.g., designing storage schemas, retrieval queries, or summarization logic around discrete facts rather than typed cognitive events. Any abstraction that flattens moment type or strips cognitive context is a regression toward v1 semantics.
- The most likely architectural drift risk is reverting to fact-based thinking when designing new pipeline components. Any data structure, schema, or processing step that treats isolated facts as the primary output should be treated as a design violation and reconsidered against the moment model.

## Sessions

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)
