# Handoff: Repo Brain — Session 3

**Date:** 2026-05-24
**From:** Session that built dashboard redesign, digested new sessions, rebuilt brain per-project
**For:** Successor — quality review of brain synthesis + narrative, then full pipeline wiring

## What's Built

### Full working system

```
intent digest <path>                # digest CC session → moments/narrative/transitions
intent brain <sessionId...>         # synthesize topics per-project, store to DB, version chain
intent brain-classify <sessionId>   # Haiku relevance matching (session ↔ topics)
intent brain-export                 # generate .repo/brain.md + .repo/topics/*.md
intent web --port 3456              # dashboard with Brain/Sessions tabs
```

### Dashboard (redesigned this session)
- Brain tab: topic list with insight/session counts, topic detail (insights by category, files, sessions, related topics), topic-scoped chat
- Sessions tab: session list grouped by date (newest first), session detail (narrative, arcs, moments, outcomes), session-scoped chat
- Cross-tab navigation: topic badges on sessions → Brain tab, session links in topics → Sessions tab
- Minimalist aesthetic: warm neutrals, no borders between panels, subtle shade differences

### Brain state
- 4 projects: intent-ai, brain, telegram, telegram-tmp
- Auto-detection: `intent brain` matches sessions to projects via source_path
- Sessions are deduped by CC session UUID (source_hash)
- Brain topics deduped by topic_sessions check

### Bug fixes this session
1. `client.ts` — cap max_tokens at model limit (Haiku 64K)
2. `classify-exchanges.ts` — lenient candidateType coercion (unknown → null)
3. `brain-synthesis.ts` — skip invalid moment UUIDs in evidence storage
4. `index.ts` — auto-detect project from session source_path
5. `index.ts` — dedup brain synthesis via topic_sessions check
6. `SessionList.tsx` — sort sessions before grouping by date

## QUALITY REVIEW NEEDED

### Topic synthesis quality is poor

The current brain topics are **too narrow, too cryptic, and lack context**. Examples of problems:

- Topic names are overly specific: "claude_collector cursor mechanism" — this is an implementation detail, not a concept a developer needs to navigate
- Summaries are dense but not illuminating — they read like compressed technical notes, not explanations that help someone understand the codebase
- Insights are correct but feel like bullet-pointed facts, not connected knowledge
- No sense of WHY a topic matters or HOW it fits into the larger picture

### What "good" looks like

A good topic should answer: **"If I'm a developer joining this project, what do I need to understand about this concept?"**

Bad: "The cursor was redesigned from a bare timestamp to a JSON object tracking per-file byte offsets"
Good: "Brain tracks which parts of conversation logs it has already processed. The cursor mechanism was originally a simple timestamp but broke in production (47 duplicate timestamps). It's now a per-file byte offset that reliably resumes from where it left off."

The insight should give you a MENTAL MODEL, not a CHANGELOG ENTRY.

### Narrative quality is also weak

Session narratives suffer from similar issues:
- Too much "The developer set out to..." framing — sounds robotic
- Summaries compress too aggressively, losing the story
- Arcs are listed but don't convey WHY they mattered

### Recommended approach

1. **Review the synthesis prompt** at `src/llm/prompts/brain-synthesis.ts` — the system prompt needs to be rewritten to produce topics that explain concepts, not enumerate facts
2. **Review the narrative prompt** at `src/llm/prompts/narrative.ts` — needs similar quality pass
3. **EDD approach**: pick one session, run synthesis, human review output, iterate prompt until topics feel like something you'd actually want to read
4. **Consider adding a "so what?" instruction** — every insight should answer why it matters to someone working in this codebase
5. **Consider topic granularity** — some topics should probably be merged (e.g., "cursor mechanism" could be a section within a broader "ingestion pipeline" topic, not its own topic)

## What's NOT Built

### 1. Full two-stage pipeline (`intent brain-sync`)
Classifier and synthesizer exist independently. Not wired into: classify → scoped context → parallel synthesis → merge → verify → store.

### 2. Mutation tracking
Brain versions exist but don't record what changed. No diff between versions.

### 3. Brain breadcrumbs
Thin `.repo/` markdown files that point agents to the brain + `intent brain-query` CLI for agent interaction.

## Pipeline Design (agreed, not implemented)

```
Stage 0: Pre-compute (deterministic) — collect session signals
Stage 1: Relevance Matching (Haiku) ← BUILT
Stage 2: Context Assembly (deterministic) ← NOT BUILT
Stage 3: Synthesis (Sonnet, per topic, parallel) ← BUILT (not scoped)
Stage 4: Merge (deterministic) ← NOT BUILT
Stage 5: Verify (Haiku) ← NOT BUILT
Stage 6: Commit ← BUILT
```

## Key Files

```
src/pipeline/brain-synthesis.ts     — synthesis + storage + versioning
src/pipeline/brain-relevance.ts     — Haiku relevance classifier
src/llm/prompts/brain-synthesis.ts  — synthesis prompt (NEEDS QUALITY REVIEW)
src/llm/prompts/brain-relevance.ts  — classifier prompt
src/llm/prompts/narrative.ts        — narrative prompt (NEEDS QUALITY REVIEW)
src/brain/generate-markdown.ts      — markdown generation
src/web/server.ts                   — API endpoints including topic-scoped chat
src/web/ui/src/                     — React dashboard
```

## Dashboard UX Direction

The dashboard should match the **Claude Console** aesthetic — the Anthropic developer dashboard. Key traits:
- Off-white warm background, not stark white
- Minimal borders — use background shade differences between panels
- Clean typography hierarchy — large headings, muted secondary text
- Generous whitespace, nothing feels cramped
- Subtle rounded cards with thin borders, not heavy shadows
- Use shadcn/ui components matching Console's component language
- The sidebar navigation pattern (collapsible sections, clean hover states)

Reference: screenshot of Claude Console in this session's context. The intent dashboard should feel like it belongs in the same product family.

**Implementation: use shadcn blocks** — https://ui.shadcn.com/blocks
- The sidebar layout block is the right starting point for our three-panel dashboard
- Install shadcn properly with `npx shadcn@latest init` + add needed components
- Use the sidebar block pattern: collapsible sidebar nav, main content area, right panel
- This replaces our hand-rolled CSS grid with a proper component-based layout

## Design Decisions (don't undo)

- 6 categories: structure, decision, constraint, behavior, risk, interface
- Topics are concepts, not files
- Semantic matching via Haiku, not file overlap
- Brain evolves through versions, never regenerated
- Per-project scoping via source_path auto-detection
- Sessions are private, brain is shared
- DB for depth, markdown for agent access

## Tests

120 tests across 15 files, all passing.
