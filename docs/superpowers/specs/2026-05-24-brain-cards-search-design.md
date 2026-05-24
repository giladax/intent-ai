# Brain Cards & Search Model

## Problem

The brain is a knowledge graph but has no search interface. Agents can't query it — they read flat markdown. No traversal, no semantic search, no MCP. Cards don't exist as a concept.

## Solution: Cards as the Atom of the Brain

Every node in the graph (area, spec, file) has a **card** — a compressed, searchable summary derived from session knowledge. Cards are the search index, the MCP resource, and the export format. One artifact, every surface.

### Card Schema

```typescript
interface BrainCard {
  name: string;
  level: "area" | "spec" | "file";
  path?: string;                    // file level only
  parent?: string;
  children?: string[];
  summary: string;                  // ~100-150 words, the arc — how understanding evolved
  insights: {                       // top 3-5, from 6 categories
    category: InsightCategory;
    statement: string;
  }[];
  files?: string[];                 // key files (spec/area level)
  exports?: string[];               // key exports (file level)
  related?: string[];               // cross-branch connections
  sessions: string[];               // contributing session IDs
  versionId: string;                // brain version when last updated
}
```

### Card Levels

| Level | What it represents | Summary example |
|-------|-------------------|-----------------|
| area | Major project subsystem (2-4 total) | "The pipeline transforms CC logs into structured moments through 8 stages" |
| spec | A concept within an area | "Coarse-then-fine moment detection. Originally timed out until switched to streaming." |
| file | A source file with accumulated session knowledge | "Pass-1 Haiku classifier. Processes chunks in parallel with digest." |

### Insight Inheritance

Insights live at their natural level. Cards show the full context stack:

```
File card for moments-p1.ts:
  Own: [interface] Exports classifyMoments(chunks) → MomentCandidate[]
  From Moment Detection: [constraint] Agency field required on every moment
  From Pipeline: [constraint] All LLM calls must use streaming
```

An agent reading a file card gets everything relevant without traversing.

### Knowledge Flow

**Bottom-up:** Session discovers "streaming required" at file level → propagates to spec → maybe to area if systemic.

**Top-down:** Decision "switch to two-pass" at spec level → flows down to file cards.

Node 2 (Organize) tags each insight with its natural level.

## Search: Star Pattern

Query radiates through multiple paths, converges on top candidates:

```
         query: "retry logic for LLM"
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
  path      summary   insight
  match     match     match
    │         │         │
    └─────────┼─────────┘
              ▼
     score by hit count
         + relevance
              │
              ▼
        top-N cards
```

Nodes matching on multiple paths (summary + insight + file) rank higher than single-path matches.

## MCP Interface (3 tools)

**`brain.search(query, limit?)`** — Star search across all cards. Returns top-N with match reasons.

**`brain.get(name)`** — Card + full spec + inherited insights from ancestors.

**`brain.traverse(name, direction: "up"|"down"|"related")`** — Navigate the graph.

Agent workflow: `search → get top hit → traverse for context`.

## Card Creation

Cards are **derived from full specs**, never written directly.

Node 3 (Write) produces full spec → card generated as deterministic compression or light Haiku call:
- Summary: condensed arc from the spec narrative
- Insights: top 3-5 by confidence, one per category max
- Files/exports: from fileRefs
- Parent/children/related: from graph structure

Cards regenerate when their spec updates. The spec is the source of truth.

**File-level cards** are created when a file appears in 2+ sessions or is explicitly requested via `--file-depth` flag.

## Version Coupling

Each brain version records `commit_sha`. Cards track `versionId`. This enables:

- **Drift detection:** HEAD ahead of latest brain version → brain may be stale
- **Version diff:** what changed between v2 and v3
- **Arc continuity:** summary extends across versions, never replaces

## Storage

```sql
-- New table (or column on topics)
brain_cards: id, node_name, level, path, parent_node,
  summary, insights (jsonb), files (jsonb), exports (jsonb),
  related (jsonb), sessions (jsonb), version_id
```

## Export

```
.repo/brain.md             — tree of area cards (overview)
.repo/topics/<spec>.md     — full spec with card at top
.repo/files/<path>.md      — file card (when file nodes exist)
```

## Gen2B Integration

The Organize step (Node 2) uses Gen2B's level schema (`level: "root"|"child"`) for tree structure. Cards add a third level (file) below the existing two. The organize prompt gains the ability to assign insights to their natural level (area/spec/file).

## Scope for First Implementation

1. Add `brain_cards` table + card generation from existing specs
2. Update `brain-export` to render cards in markdown
3. Promote Gen2B level schema to main organize prompt
4. Defer: MCP server, file-level nodes, star search implementation
