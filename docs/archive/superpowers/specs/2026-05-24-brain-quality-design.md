# Brain Quality Redesign — LLM-Native Spec Graph

## Problem

Single Sonnet call produces flat, changelog-like topics. No hierarchy, no maintenance, duplicates accumulate. Agent reads 25 flat entries to find one relevant spec.

## Solution: Three-Node Pipeline

### Node 1: Extract (Sonnet, per-session, parallel)

**Question:** "What reusable codebase knowledge did this session produce?"

**Input:** Session digest (narrative, arcs, moments, outcomes, files).
**Output:** `SpecFragment[]` — raw knowledge fragments, not finished specs.

```typescript
interface SpecFragment {
  nameHint: string;           // suggested spec name
  insights: {
    category: InsightCategory;
    statement: string;
    evidence: { momentId: string; reasoning: string }[];
    confidence: number;
  }[];
  fileRefs: { path: string; role: string }[];
}
```

Prompt change: stop asking for "topics with related topics." Ask for knowledge fragments. No hierarchy, no relations — just raw material.

### Node 2: Organize (Haiku, one call, full graph)

**Question:** "Given all specs and these new fragments, what's the best tree for agent retrieval?"

**Input:**
- All existing specs (name, summary, insight IDs + statements, file list, session count, staleness)
- New fragments from Node 1
- Deterministic signals: shared file ratios between specs, time since last update

**Prompt constraints:** Max tree depth 3. Prefer fewer root specs (3-7). Merge when specs share >70% of files AND similar insight statements. Cold start (no existing specs): build initial tree from fragments alone.

**Output:** `GraphPlan` — validated with lenient Zod schema (`.optional().default()`, `.passthrough()` per project convention).

**Note:** Existing `brain-classify` command is unaffected. It continues to classify session relevance to topics. Could later be used as a pre-filter for Node 2 input, but not required initially.

```typescript
interface GraphPlan {
  assignments: {
    fragmentIndex: number;
    targetSpec: string;        // existing spec name or new name
    action: 'update' | 'create';
    parentSpec?: string;       // for new specs
  }[];
  merges: {
    specs: string[];           // specs to merge
    intoName: string;          // resulting spec name
    parentSpec?: string;
  }[];
  splits: {
    spec: string;
    into: { name: string; insightIds: string[] }[];   // explicit insight IDs per target
    parentSpec?: string;
  }[];
}
```

### Node 3: Write (Sonnet, per-changed-spec, parallel)

**Question:** "Write this spec as a living design document."

**Input per spec:**
- Assigned fragments (new knowledge)
- Existing spec content (if updating)
- Tree context: parent spec summary, child spec names
- Instruction: write as a design doc, not a changelog

**Output:** Final spec — name, summary (design-doc style), categorized insights, file refs.

## Schema Changes

### topics table
```sql
ALTER TABLE topics ADD COLUMN parent_topic_id UUID REFERENCES topics(id) ON DELETE SET NULL;
```

### topic_relations — typed relationship
```sql
CREATE TYPE topic_relationship_type AS ENUM ('depends_on', 'constrains', 'related');
-- Existing column is text; migrate to enum:
ALTER TABLE topic_relations
  ALTER COLUMN relationship TYPE topic_relationship_type
  USING relationship::topic_relationship_type;
```
Note: `contains` is omitted — parent-child is represented by `parent_topic_id`, not relations.

## Pipeline Flow

```
brain <sessionIds...>
  ├─ extractFragments(sessionId)        Sonnet × N sessions (parallel)
  ├─ organizeGraph(fragments, specs)    Haiku × 1
  ├─ writeSpecs(graphPlan)              Sonnet × changed specs (parallel)
  ├─ applyGraphPlan(plan, specs)        deterministic DB writes
  ├─ createBrainVersion(repoId)
  └─ exportMarkdown(repoId)            hierarchical tree
```

**applyGraphPlan** is deterministic. Execution order matters:
1. `merge` — combine topics, move insights/evidence/files to target, delete absorbed. Deduplicate insights with identical statements (keep highest confidence, merge evidence).
2. `split` — create new topics, reassign insights by explicit ID lists, delete original.
3. `create` — insert new topics with parent_topic_id.
4. `update` — upsert insights, update summary from Node 3 output.

Validate: reject circular parent references before applying. Normalize topic names (lowercase, trim) for matching.

## Markdown Export

**brain.md** — tree, not flat list:
```markdown
## Pipeline Architecture
- [Pipeline Architecture](topics/pipeline-architecture.md) (3 sessions, 12 insights)
  - [Moment Detection](topics/moment-detection.md) (2 sessions, 7 insights)
  - [Narrative Generation](topics/narrative-generation.md) (1 session, 4 insights)

## Data Layer
- [Data Layer](topics/data-layer.md) (2 sessions, 8 insights)
  - [Schema Design](topics/schema-design.md) (1 session, 5 insights)
```

**Per-topic** — breadcrumbs:
```markdown
# Moment Detection
> Parent: [Pipeline Architecture](pipeline-architecture.md)
```

## EDD Strategy

Haiku judge scores 5 dimensions with qualitative verdicts + reasoning:

| Dimension | Question | Verdicts |
|-----------|----------|----------|
| Spec quality | Does it read like a design doc or a changelog? | `design_doc` · `mixed` · `changelog` |
| Hierarchy coherence | Does the tree help an agent find the right spec fast? | `navigable` · `shallow` · `flat` |
| Deduplication | Are there specs that say the same thing? | `clean` · `some_overlap` · `redundant` |
| Scope precision | Does each spec cover exactly one concept? | `focused` · `broad` · `tangled` |
| Actionability | Can an agent use this to write correct code? | `actionable` · `vague` · `useless` |

Each dimension returns `{ verdict: VerdictEnum, reasoning: string, examples: string[] }`. Verdicts are Zod enums — not free-text strings. The reasoning explains *why*, citing specific specs. Examples point to the best and worst specs for that dimension.

**Cycle:** Baseline current output → change Node 1 prompt → add Node 2 → change Node 3 prompt → compare scores at each step.

**Fixtures:** Real sessions already in DB. No synthetic data.

## Cost

Per brain run (25 existing topics, 3 new sessions):
- Node 1: 3 Sonnet calls (parallel) — ~$0.03
- Node 2: 1 Haiku call — ~$0.001
- Node 3: ~5 Sonnet calls (parallel) — ~$0.05
- Total: ~$0.08

## Design Decisions

- **LLM-native, not algorithmic.** No embeddings, no cosine similarity, no clustering. The LLM reads the graph and organizes it. For 25-100 topics, Haiku handles this in one call.
- **Deterministic signals as context, not algorithm.** File overlap, session counts, staleness — fed to the LLM as input, not used as thresholds.
- **Tree in the topics table.** `parent_topic_id` — simple, queryable, no separate hierarchy table.
- **Parallel where possible.** Node 1 and Node 3 are embarrassingly parallel. Node 2 is the serialization point.
- **Incremental, not rebuild.** Only changed specs get rewritten. Graph restructuring (merges, splits, reparents) happens when the LLM decides it's needed, not on a schedule.
- **Evidence preserved through merges.** When specs merge, insights and their moment evidence are re-linked, not lost. Duplicate insights (same statement) are deduplicated — keep highest confidence, combine evidence refs.
- **All new types in `src/adapters/types.ts`.** `SpecFragment`, `GraphPlan`, updated `Topic` with `parentTopicId`. Zod schemas in prompt files per existing convention.
