# Handoff — 2026-05-24 Session 3: Brain Quality Pipeline

## What was done

### Three-node brain pipeline (complete)
Branch `feat/repo-brain`. Replaced single-call synthesis with extract → organize → write pipeline:

- **Node 1 (Extract)**: Sonnet extracts spec fragments per-session, parallel. No hierarchy — just raw knowledge.
- **Node 2 (Organize)**: Haiku sees full graph + fragments in one call, outputs GraphPlan (assignments, merges, splits). LLM-as-organizer, not algorithmic clustering.
- **Node 3 (Write)**: Sonnet writes each changed spec as a living design document, aware of tree position (parent/child context).
- **applyGraphPlan**: Deterministic DB operations — merge/split/create/update with cycle detection, name normalization, insight deduplication.
- **Schema**: Added `parent_topic_id` to topics table for tree hierarchy.
- **Export**: Hierarchical markdown — brain.md shows tree structure, topic files have breadcrumbs.
- **EDD Judge**: 5-dimension quality judge with Zod enum verdicts (spec_quality, hierarchy_coherence, deduplication, scope_precision, actionability).

### Key commits
```
959b7eb feat: EDD brain quality judge with 5 enum verdict dimensions
c25e131 feat: hierarchical markdown export with tree structure and breadcrumbs
d7121e7 feat: wire three-node brain pipeline with synthesizeV2
382fa32 feat: applyGraphPlan deterministic DB operations
f82dffb feat: Node 3 write prompt for spec-quality output
4fbc178 feat: Node 2 organize prompt and GraphPlan schema
85d6c90 feat: Node 1 extract prompt and schema for spec fragments
5fecf33 feat(db): add parent_topic_id for hierarchical topics
```

### End-to-end validation
Ran on 3 real sessions: 10 fragments extracted, 1 merge applied, 6 specs written. Output reads like design docs, not changelogs. "v2 roadmap and strategy" correctly nested under "tech stack and architecture decisions". 165 tests pass.

### New files
```
src/llm/prompts/brain-extract.ts     — Node 1 prompt + schema
src/llm/prompts/brain-organize.ts    — Node 2 prompt + GraphPlan schema
src/llm/prompts/brain-write.ts       — Node 3 prompt + schema
src/pipeline/brain-apply.ts          — deterministic graph plan executor
src/eval/brain-judge.ts              — 5-dimension quality judge
drizzle/0004_brain_hierarchy.sql     — parent_topic_id migration
tests/pipeline/brain-extract.test.ts — 7 tests
tests/pipeline/brain-organize.test.ts — 9 tests
tests/pipeline/brain-write.test.ts   — 14 tests
tests/pipeline/brain-apply.test.ts   — 15 tests
```

## What's next — Priority 1: Brain as MCP + Code Breadcrumbs

### The vision
The brain knowledge graph should be accessible as an MCP server — both coding agents and humans connect to it. From there:

1. **MCP server for brain** — expose topics, hierarchy, insights, file map as MCP tools. Agents query the brain for context before making changes. Humans browse via dashboard or MCP client.

2. **Code breadcrumbs** — the brain graph becomes a map overlaid on the codebase. Source files get lightweight annotations (comments or companion `.brain.md` files) that link to their relevant specs. Like `// @brain: Pipeline Architecture > Moment Detection` or a summary + MCP hint at the file/directory level.

3. **Bidirectional** — editing code updates the brain (via digestion), reading code surfaces brain context (via breadcrumbs/MCP).

### How to approach
1. Design the MCP server interface (what tools/resources to expose)
2. Implement MCP server wrapping the brain DB queries
3. Design breadcrumb format (inline comments vs companion files vs directory-level)
4. Generate breadcrumbs from the brain graph
5. Test with a real coding agent — does the brain context improve code quality?

### Design decisions (don't undo)
- Three-node pipeline: extract → organize → write
- LLM-native graph organization (Haiku sees full graph, no embeddings)
- parent_topic_id for tree hierarchy
- Specs are living design docs, not changelogs
- GraphPlan actions: assign, merge, split, create, update
- Evidence preserved through merges
- 6 insight categories: structure, decision, constraint, behavior, risk, interface
