# Handoff — 2026-05-24 Session 4: Brain Cards & Search Model

## What was done

### Brain quality pipeline (complete from session 3)
Three-node pipeline: extract → organize → write. Gen2B level schema promoted — forces `level: "root" | "child"` on every assignment.

### Organize prompt experiments (this session)
Ran 5 variants to fix flat topic trees:

| Variant | Result | Learning |
|---------|--------|----------|
| Gen0 baseline | 6 roots, 1 child | Flat, no story |
| Gen1 conceptualMap | 8 roots, 0 children | WORSE — reasoning doesn't transfer to output |
| Gen2A two-pass | 0 nesting | Same failure as Gen1 |
| **Gen2B level schema** | **4 roots, 7 children** | **WINNER — schema constraints > instructions** |
| Gen2C few-shot | 0 nesting | Example didn't help |

Key finding: making hierarchy structural in the output schema (level field) works. Prompt-level reasoning doesn't translate.

### Brain cards (this session)
- `BrainCard` interface in `types.ts`
- `generateCard()` pure function in `src/brain/cards.ts` (10 tests)
- `brain_cards` table in Postgres
- Cards stored automatically during `synthesizeV2`
- Markdown export renders card blockquotes at top of topic files

### Dashboard hierarchy (this session)
- Left sidebar renders tree: collapsible areas with nested child specs
- API returns `parent_topic_id` for tree building
- Search falls back to flat list

### Key commits
```
957b537 feat(web): hierarchical topic tree in sidebar with collapsible areas
c259d3f feat: end-to-end brain cards — Gen2B hierarchy + card storage + export
[earlier] feat: brain_cards table and card storage in pipeline
[earlier] feat: BrainCard type and card generation function
[earlier] feat: promote Gen2B level schema to main organize prompt
```

### End-to-end result
9 specs in a tree:
```
Pipeline Orchestration
  └── Evaluation Framework
  └── Moment Detection
Brain Versioning
  └── Brain Insight Categories
Tech Stack
  └── Database Infrastructure
Dashboard Architecture
Design Principles
```

176 tests pass. Dashboard at localhost:3456 shows the tree.

## What's next

### Priority 1: Card quality refinement
- Card summaries are currently just truncated spec summaries — should be arc-style narratives condensed by Haiku
- Insight selection in cards needs tuning (currently top-5 by confidence, should favor diversity)
- File-level cards (leaf nodes) not yet implemented

### Priority 2: Search & MCP
- `brain.search(query)` — star search across cards (path + summary + insight matching)
- `brain.get(name)` — card + full spec + inherited insights
- `brain.traverse(name, direction)` — navigate graph
- MCP server wrapping these three tools

### Priority 3: Routing layer (for scale)
- Gen3 relate-then-decide architecture designed but not yet needed
- File match score heuristic + Haiku semantic routing
- Kicks in when spec count > 50

### Open experiments
- `docs/experiments/brain-organize/` — gen0 through gen3 documented
- Gen3 test script needs `.nullable()` fix to run
- Experiment variants in `src/llm/prompts/brain-organize-gen2*.ts` can be cleaned up

### Design decisions (don't undo)
- Gen2B level schema is the organize prompt (level: root|child, parentSpec required for children)
- Cards are derived from specs, never written directly
- Knowledge flows bidirectionally (bottom-up from sessions, top-down from decisions)
- Files are weak signals — semantic connections are primary, files are entry points
- The card is the atom: search index, MCP resource, export format, dashboard unit
