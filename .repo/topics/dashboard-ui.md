# Dashboard & UI

The Dashboard & UI layer is the primary visual interface through which users interact with the system. It is responsible for presenting data, controls, and feedback in a coherent, navigable layout. This spec is currently in an early state — no knowledge fragments have been assigned yet, meaning the architectural decisions, component structure, and runtime behaviors of the UI have not yet been captured in the living design document. As fragments are added through development sessions, this spec will evolve to describe the component hierarchy, state management approach, routing strategy, data-fetching patterns, and any design system or styling conventions in use.

## structure

- The dashboard has exactly two top-level tabs — Brain (shared curated knowledge: topic map, topic detail, insights with evidence) and Sessions (private execution memory: session list, session detail, chat). All UI components are organized under one of these two concerns.

## decision

- The Brain/Sessions tab architecture is a full replacement of the old FeatureList/feature-tagging paradigm — not an incremental patch. Any code referencing the old feature/tagging model is obsolete and should not be restored.
- shadcn/ui is the chosen component library with an explicit minimalist aesthetic mandate. UI decisions should favor restraint — avoid adding visual complexity or heavy component libraries that conflict with this baseline.

## risk

- No knowledge fragments have been assigned to this spec yet. Any insights written here would be speculative rather than evidence-based. Developers should treat this spec as a placeholder until real codebase fragments are attached.
- AI-generated API code in server.ts has historically used wrong column names — `topic_a_id`/`topic_b_id` instead of `topic_id`/`related_topic_id`, and `i.content`/`i.kind` instead of `i.statement`/`i.category`. Always verify any generated or modified endpoint code against the actual DB schema before shipping.

## Files

- `src/web/server.ts`
- `src/web/ui/src/App.tsx`
- `src/web/ui/src/api.ts`
- `src/web/ui/src/components/ChatPanel.tsx`
- `src/web/ui/src/components/Header.tsx`
- `src/web/ui/src/components/SessionList.tsx`
- `src/web/ui/src/components/SessionPanel.tsx`
- `src/web/ui/src/components/TopicDetail.tsx`
- `src/web/ui/src/components/TopicList.tsx`
- `src/web/ui/src/index.css`
- `src/web/ui/src/types.ts`

## Sessions

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 25: The developer set out to implement insight deduplication using Eval-Driven Development, requiring... (7 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)
