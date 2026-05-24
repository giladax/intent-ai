# Handoff — 2026-05-24 Session 4: Brain Cards, Search Model, Sidebar Hierarchy

## What was done

### Brain quality pipeline (from session 3)
Three-node pipeline: extract → organize → write. 176 tests pass.

### Organize prompt experiments
Ran 5 variants to fix flat topic trees:
- Gen0 baseline: 6 roots, 1 child — flat
- Gen1 conceptualMap: 8 roots, 0 children — worse
- **Gen2B level schema: 4 roots, 7 children — WINNER**
- Gen2C few-shot: 0 nesting
- Gen3 relate-then-decide: designed but not yet needed (scaling layer)

**Key finding:** `level: "root" | "child"` on the output schema forces hierarchy. Prompt reasoning doesn't translate to output.

### Brain cards
- `BrainCard` interface + `generateCard()` pure function (10 tests)
- `brain_cards` table in Postgres
- Cards stored automatically during `synthesizeV2`
- Gen2B promoted to main organize prompt

### LLM-friendly export with file accumulation
- `brain.md`: entry point with tree, file counts, File Index table (file → spec hierarchy path)
- Per-topic files: accumulated files from children grouped by child spec
- `buildTopicTree()` computes accumulated files bottom-up via DFS
- File Index shows most-specific spec per file (e.g., `Pipeline > Database Infra`)

### Dashboard updates
- Left sidebar: **Recent** (5 latest specs) + **Knowledge Tree** (collapsible hierarchy)
- **Sync Brain** button with full flow:
  - Discover: finds undigested CC logs + unprocessed sessions
  - Digest: SSE-streaming digest of CC logs with progress
  - Select: sessions with branch relevance scoring (file overlap + timestamp correlation)
  - Propose: dry-run synthesis with SSE progress
  - Review: compact scrollable change list
  - Apply: commits changes with SSE progress
- Server-side sync job tracking (survives page refresh)
- Project-scoped sync (key={projectId} remounts component)

### Key commits
```
fe31ec2 feat: LLM-friendly brain export with file accumulation and file index
6ee2221 feat(web): digest button + compact scrollable review list
278d0df feat(web): SSE streaming in BrainSync — live progress messages
4641fa7 fix(web): skip slow auto-digest in discover, show undigested count
bd98c91 feat(web): full brain sync — auto-digest, branch relevance scoring, session picker
```

## Known issues

### Session matching for intent-ai project
Only 1 CC log matches intent-ai by source_path (`-Users-giladkoch-dev-intent-ai`). The other sessions used for brain testing have source paths from other projects (`-dev-brain`) and were linked via CLI fallback logic. New sessions need to be digested from the 19 undigested CC logs — some are for intent-ai, some for other projects.

### Digest flow
The "Digest Sessions" button exists but the user may not see it if discover finds no unprocessed sessions (because they haven't been digested yet). The flow should be: discover → show digest button if undigested logs exist → digest → re-discover → show sessions for brain sync.

### Duplicate insights
Multiple brain runs accumulate duplicate insights (same statement appears 2-3 times). Need deduplication during synthesis or in the write step.

## What's next

### Priority 1: MCP server for the brain
Three tools: `brain.search(query)`, `brain.get(name)`, `brain.traverse(name, direction)`. The `.repo/` files are already LLM-friendly — MCP wraps the same data as queryable tools. This is the foundation for Claude Code integration.

### Priority 2: Card quality
- Summaries are truncated spec text — should be arc-style narratives
- Insight deduplication needed (same insight appears multiple times from different sessions)
- File-level cards (leaf nodes) not yet implemented

### Priority 3: Digest integration
- Dashboard should run digest as part of sync flow
- Show digestion progress per-session with SSE
- After digest completes, auto-discover new sessions for brain sync

### Design decisions (don't undo)
- Gen2B level schema is the organize prompt (level: root|child)
- Cards are derived from specs, never written directly
- Knowledge flows bidirectionally (bottom-up + top-down)
- Files accumulate upward (spec includes all children's files)
- File Index maps every file to its most-specific spec hierarchy path
- The card is the atom: search index, MCP resource, export format
- Brain mutations are human-gated — sync proposes, user approves
- Star search pattern for queries (path + summary + insight matching)
- Branch relevance scoring: file overlap + timestamp correlation
