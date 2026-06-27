# Repo Brain — Implementation Plan

Spec: `docs/superpowers/specs/2026-05-23-repo-brain-design.md`

## Approach

Vertical slice: one topic, one session, end-to-end. EDD — human review first, LLM-as-judge after convergence.

## Tasks

### Phase 1: Schema + Types

1. Add types to `src/adapters/types.ts`: `Topic`, `Insight`, `FileRef`, `BrainVersion`
2. Add Drizzle tables to `src/storage/schema.ts`: `topics`, `insights`, `insight_evidence`, `topic_files`, `topic_relations`, `brain_versions`
3. Generate migration, run it
4. Add storage queries: `storeTopic`, `getTopicsForRepo`, `getTopicWithInsights`

### Phase 2: Topic Synthesis (EDD)

5. Create `src/pipeline/brain-synthesis.ts` — function that takes session digest → topics
6. Create `src/llm/prompts/brain-synthesis.ts` — prompt + Zod schema
7. Extract files touched from normalized events (filter tool_input/tool_output for file paths)
8. **EDD loop**: run on session 1, human review, iterate prompt until quality converges
9. Add multi-session merge: synthesis receives existing topics, outputs created/updated/deprecated
10. **EDD loop**: run session 2 against session 1's topics, review merge behavior

### Phase 3: Markdown Generation

11. Create `src/brain/generate-markdown.ts` — generates `.repo/brain.md` + `.repo/topics/*.md` from DB
12. Add CLI command: `intent brain [--repo path]` — runs synthesis + generates markdown
13. Add `.repo/brain.md` reference to CLAUDE.md

### Phase 4: Dashboard

14. Add repo selector to UI (use existing `projects` table)
15. Add Brain/Sessions tab toggle
16. Brain tab: topic list panel with session/moment counts
17. Brain tab: topic detail panel (insights by category, files, evidence sessions)
18. Brain tab: click evidence → navigate to sessions tab
19. Brain tab: filter by category, filter by file (bidirectional)
20. Brain tab: chat scoped to selected topic
21. Sessions tab: group by repo, add topic badges

### Phase 5: Polish + Versioning

22. Wire brain versioning (BrainVersion created on each `intent brain` run)
23. Mutation diffing (compare version N to N-1, generate report)
24. LLM-as-judge eval criteria (from human review patterns in phase 2)

## Start

Phase 1, task 1. Types first, then schema, then the EDD loop on synthesis.
