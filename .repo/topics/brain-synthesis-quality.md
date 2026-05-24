# Brain Synthesis Quality

> Parent: [Brain Versioning](brain-versioning.md)

Brain Synthesis Quality encompasses the mechanisms, gates, and evaluation strategies that ensure the Repo Brain accumulates accurate, semantically meaningful knowledge rather than silently corrupted or shallow data. Within the Brain Versioning system, each synthesis run must correctly persist insights to Postgres, merge topics without duplication, and cite evidence by stable UUIDs rather than positional indices. Quality is enforced at multiple layers: a pre-scaling subagent review gate catches structural correctness blockers before they propagate, relevance matching between sessions and brain topics uses semantic similarity of moment statements against topic narratives (not file-overlap heuristics), and evaluation follows an EDD pattern of human review first to understand quality shape before introducing LLM-as-judge automation. A known hard scalability ceiling exists: very large sessions (1215+ events) exceed Haiku's 64K token output limit and cannot be classified in a single call — batched classification for these sessions is explicitly deferred. The synthesis pipeline lives in src/pipeline/brain-synthesis.ts (topic storage, UUID evidence, merge logic) and src/pipeline/classify-exchanges.ts (semantic relevance classification).

## constraint

- Evidence must be cited by UUID in synthesis output, not by positional index. Positional index drift was identified as a structural correctness blocker — the synthesis prompt pre-computes a moment index and the output schema requires UUID citations to prevent this class of corruption.

## decision

- Relevance matching between sessions and brain topics uses semantic matching of moment statements against topic insights and narrative arcs — not structural signals like file overlap or import graphs. File-based signals were explicitly evaluated and rejected as too shallow because they miss transitive import impact.
- Brain synthesis quality is evaluated using an EDD pattern: human review first to understand the quality shape, then LLM-as-judge once good quality is understood. This mirrors the proven session digestion evaluation approach and prevents automating evaluation before the quality baseline is established.

## behavior

- A subagent review gate runs before Phase 3 scaling to check DB storage correctness, merge logic stability, and evidence index stability. This gate is not optional — it caught three structural blockers (no DB persistence, fragile name-string merge, positional instead of UUID evidence indices) that would have silently corrupted the brain graph.

## risk

- Very large sessions (1215+ events, ~4926 lines) hit Haiku's 64K token output limit and cannot be classified in a single LLM call. Batched classification for large sessions is a known deferred problem — the current classifier in classify-exchanges.ts will silently fail or truncate on these inputs.

## Files

- `src/pipeline/brain-synthesis.ts`
- `src/pipeline/classify-exchanges.ts`

## Sessions

- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)
