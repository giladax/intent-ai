# Brain Insight Categories

> Parent: [Brain Versioning](brain-versioning.md)

Brain Insight Categories are the typed classification system applied to every insight stored in the brain graph. Each insight is tagged with one of a small, deliberate set of categories — currently: structure, decision, constraint, behavior, risk, and interface — and the defining criterion for any category's existence is whether knowing it changes what an agent *does* with the insight. This is not a cosmetic taxonomy; categories drive downstream agent behavior during code generation and navigation. The schema was hardened through adversarial review that eliminated `flow` (redundant with `architecture`/`structure`), merged `risk` and `gap` (inseparable in practice), and narrowed `architecture` to prevent it becoming a catch-all. The categories are enforced structurally in Zod output validation inside the synthesis pipeline, meaning the LLM cannot emit an uncategorized or miscategorized insight without failing schema validation. Relevance classification — deciding which topics an insight belongs to — uses semantic moment-meaning ↔ topic-meaning matching rather than file-overlap or import-graph signals, because file diffs are weak proxies for semantic meaning and miss transitive import impact.

## constraint

- Categories are enforced at the schema level via Zod validation in the synthesis pipeline — an insight with an invalid or missing category will fail output parsing. This is a hard structural constraint, not a soft convention.

## decision

- The category set was deliberately minimized through adversarial review: `flow` was dropped as redundant with `structure`/`architecture`, and `risk`/`gap` were merged because they are inseparable in practice. Any future category proposal must pass the litmus test: 'Does knowing this category change what the agent *does* with the insight?'
- Relevance classification — assigning insights to topics — uses semantic moment-meaning ↔ topic-meaning matching, not file-overlap or import-graph matching. File diffs are explicitly rejected as signals because they miss transitive import impact and are poor proxies for semantic understanding.

## behavior

- At runtime, the synthesis pipeline pre-computes a moment index and requires UUID citations in the output schema. This means category assignment happens alongside evidence citation — an insight is not just categorized but also anchored to specific moment UUIDs, preventing positional index drift and ensuring categories are grounded in traceable evidence.

## risk

- `architecture`/`structure` categories carry a known risk of becoming catch-alls if the litmus test is not applied rigorously. The adversarial review explicitly narrowed `architecture` for this reason — future contributors adding insights should verify the category drives distinct agent behavior, not just that it 'feels right' semantically.

## Files

- `src/pipeline/brain-synthesis.ts`

## Sessions

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)
