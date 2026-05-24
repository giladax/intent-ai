# Design Principles

The v2 system is built on two foundational design principles that distinguish it from its predecessor. First, the atomic unit of knowledge is the 'moment' — a cognitive event such as a proposal, discovery, transition, confirmation, rejection, or commitment — rather than the discrete 'fact' used in v1. This shift reorients the entire pipeline from fact extraction toward cognitive compression: the system captures meaningful transitions in understanding rather than cataloguing isolated data points. Second, v2 is a complete greenfield rewrite; v1 exists solely as a conceptual reference and must not be reused, migrated, or extended in any form. These two principles together define what v2 is trying to be and set hard boundaries on how it must be built.

## constraint

- v2 is a complete greenfield build. v1 code must not be reused, migrated, or extended in any way. v1 exists only as a conceptual reference — any temptation to port or adapt v1 components must be rejected.

## decision

- The fundamental data structure in v2 is the 'moment' (proposals, discoveries, transitions, confirmations, rejections, commitments), not the 'fact' used in v1. This is the core architectural difference between the two versions.
- The v2 pipeline is oriented around cognitive compression, not fact extraction. The goal is to capture meaningful cognitive events — shifts in understanding, commitments, rejections — rather than enumerating discrete facts from a conversation.

## Evidence

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)
