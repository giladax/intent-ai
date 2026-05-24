# Handoff — 2026-05-24 Session 2

## What was done

### Dashboard redesign (complete)
Branch `feat/repo-brain`. Split-view layout working:
- **Left sidebar**: collapsible, topic list with search, project dropdown
- **Center split**: ResizablePanelGroup — topic detail (60%) + chat (40%)
- **Overview page**: stats cards + branch timeline with 🧠 brain version tags
- **Chat panel**: session context chips (toggleable, 3 most recent ON, overflow popover), clear button, aria-label
- **Topic detail**: reordered sections (sessions → related → insights → files)
- **Branch timeline**: git-log commits with brain version badges, version numbering
- **Backend**: `GET /api/timeline` endpoint, `commit_sha` set on brain version creation
- **Deleted**: SessionPanel, SessionList, right sidebar, Sessions tab
- **Key fix**: `SidebarInset className="h-svh overflow-hidden"` — constrains center to viewport height so panels scroll independently

120 tests pass, build clean.

### Key commits
```
0c99b73 fix(web): constrain SidebarInset to viewport height
ee60fe1 feat(web): complete split-view dashboard with branch timeline
f1ee8f2 feat: branch timeline with brain version tags
69e8041 feat(web): split-view layout with overview, context chips, reordered detail
4c57ca9 docs: dashboard redesign spec — split view
932eb04 feat(web): rewrite dashboard with shadcn/ui (sidebar-15)
```

## What's next — Priority 1: Brain topic quality

**This is the most important work.** The current topic synthesis output is flat, narrow, and reads like compressed changelog entries. It should produce a **knowledge tree** — hierarchical specs with sub-specs that give developers a mental model of the project.

### The vision
- Topics should be **specs**, not changelog summaries
- Hierarchical: areas → concepts → insights (not 20 flat siblings)
- Bidirectional: specs inform code, coding sessions inform specs
- The brain is a living project spec that evolves through versions

### How to approach
1. Read the strategy skills: `.claude/skills/agents/strategies/` — these have optimization approaches for prompts, topology, context composition
2. Read the current synthesis prompt: `src/llm/prompts/brain-synthesis.ts`
3. Read the pipeline: `src/pipeline/brain-synthesis.ts`
4. Read actual output: `.repo/brain.md` and `.repo/topics/*.md`
5. **Use EDD**: run on real data, inspect output, identify what's wrong, iterate
6. This is NOT just prompt engineering — consider topology changes (decompose the synthesis node, add hierarchy extraction, etc.)

### Key files
- `src/llm/prompts/brain-synthesis.ts` — synthesis prompt
- `src/pipeline/brain-synthesis.ts` — pipeline code
- `src/pipeline/brain-relevance.ts` — Haiku classifier
- `.claude/skills/agents/strategies/` — optimization strategies
- `.claude/skills/agents/topologies/` — graph patterns
- `src/adapters/types.ts` — domain types

### Design decisions (don't undo)
- 6 insight categories: structure, decision, constraint, behavior, risk, interface
- Topics are CONCEPTS, not files
- Semantic matching via Haiku, not file overlap
- Brain evolves through versions, never regenerated from scratch
- Per-project scoping via source_path auto-detection
- DB for depth, markdown for agent access

## Dashboard spec
`docs/superpowers/specs/2026-05-24-dashboard-redesign.md` — the full spec for the split-view layout with branch timeline.

## UX vision (saved to memory)
Center screen is main stage. Breadcrumb navigation. Narrative-as-chat (future). Session context chips. Branch timeline on overview. Topics should eventually render as a tree, not a flat list — but fix quality first, hierarchy second.
