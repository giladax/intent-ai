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
- All existing specs (name, summary, insight count, file list, session count, staleness)
- New fragments from Node 1
- Deterministic signals: shared file ratios between specs, time since last update

**Output:** `GraphPlan`

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
    into: { name: string; insightFilter: string }[];  // LLM describes which insights go where
    parentSpec?: string;
  }[];
  reparents: {
    spec: string;
    newParent: string | null;  // null = promote to root
  }[];
  deprecations: string[];     // spec names to mark stale
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
CREATE TYPE topic_relationship_type AS ENUM ('contains', 'depends_on', 'constrains', 'related');
ALTER TABLE topic_relations ADD COLUMN relationship_type topic_relationship_type DEFAULT 'related';
```

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

**applyGraphPlan** is deterministic:
- `create`: insert topic with parent_topic_id
- `update`: upsert insights, update summary
- `merge`: move all insights/evidence/files from absorbed topics → target, delete absorbed
- `split`: create new topics, reassign insights by filter, delete original
- `reparent`: update parent_topic_id
- `deprecate`: set all insights to status='stale'

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

Score with Haiku judge on 5 dimensions (1-5 each):

| Dimension | Measures |
|-----------|----------|
| Spec quality | Reads like a design doc, not a changelog |
| Hierarchy coherence | Tree makes sense for retrieval, 2-3 levels |
| Deduplication | No redundant specs |
| Scope precision | Each spec is ONE concept |
| Actionability | Agent can use this to write code |

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
- **Evidence preserved through merges.** When specs merge, insights and their moment evidence are re-linked, not lost.
