# dashboard redesign

The dashboard was redesigned from a single-view layout into a two-tab Brain/Sessions architecture built with shadcn/ui and a minimalist aesthetic. The Brain tab is the shared, curated knowledge surface — it displays a topic map with an activity heatmap, and a topic detail panel showing insights, evidence, and related sessions with navigation. The Sessions tab is the private execution memory surface — it shows a personal session list with topic badges that link back to the Brain tab, plus session detail and chat. This two-tab split is not cosmetic: it encodes the system's privacy model, where Brain is what the agent has learned and curated (shareable), and Sessions is the raw interaction history (private). The old feature/tagging paradigm (FeatureList.tsx) was dropped entirely in favor of this architecture. A known fragility is that the API endpoints in server.ts must use the exact schema column names — `statement`/`category` for insights and `topic_id`/`related_topic_id` for topic relations — because AI-generated code historically used wrong names and broke the frontend.

## structure

- The dashboard is split into two architecturally separate tabs: Brain (topic map, topic detail with insights/evidence/related sessions, activity heatmap) and Sessions (session list with topic badges, session detail, chat). These are not just UI tabs — they represent distinct data concerns and privacy boundaries.
- Dashboard has two tabs: Brain (shared curated knowledge — topic map, topic detail, insights, evidence) and Sessions (private execution memory — session list with topic badges). These are architecturally separate concerns with different privacy models.

## constraint

- API endpoints in server.ts must use the exact schema column names: `statement` and `category` for insights (NOT `content`/`kind`), and `topic_id`/`related_topic_id` for topic relations (NOT `topic_a_id`/`topic_b_id`). Using wrong names silently breaks the frontend.

## decision

- shadcn/ui was chosen as the design system with explicit emphasis on minimalist aesthetic and UX attention
- shadcn/ui was chosen as the component library with explicit emphasis on minimalist UX. The old feature/tagging paradigm (FeatureList.tsx) was fully replaced — do not attempt to restore or reconcile it with the new architecture.
- The old feature/tagging paradigm in the dashboard was dropped entirely — the redesign is a full rewrite of App.tsx and all components, not an incremental patch

## behavior

- Session list items show topic badges that link to the Brain tab, enabling bidirectional navigation: topic → sessions and session → topics
- Topics in the Brain tab show activity heatmap data — session count, moment count, update count — making the brain a living evidence-backed artifact weighted by development energy
- Topic badges in the Sessions tab are interactive navigation elements — clicking them navigates the user to the Brain tab and selects the corresponding topic in the topic detail panel. This cross-tab linking is the primary way users move from execution memory to curated knowledge.

## risk

- The AI-generated API endpoints used wrong column names (`topic_a_id`/`topic_b_id` instead of `topic_id`/`related_topic_id`, and `i.content`/`i.kind` instead of `i.statement`/`i.category`) — schema mismatches in server.ts required immediate fixes before the frontend could work
- AI-generated server.ts code is historically unreliable for schema column names. Any regeneration or modification of API endpoints must be manually verified against the actual database schema before testing the frontend.

## interface

- ChatPanel accepts a `topicId` prop — it is no longer a standalone component but is contextualized by the currently selected topic. Any refactor of topic selection state must ensure topicId is threaded through to ChatPanel.

## Files

- `docs/superpowers/specs/2026-05-24-dashboard-redesign.md` — Dashboard redesign spec
- `src/web/server.ts` — API endpoints — must use correct schema column names (statement/category for insights, topic_id/related_topic_id for relations); historically fragile under AI generation
- `src/web/server.ts` — API server — brain topics, insights, related topics endpoints
- `src/web/ui/src/api.ts` — Frontend API client — abstracts fetch calls to server.ts endpoints for all dashboard data
- `src/web/ui/src/api.ts` — Frontend API client — brain topics, session list with topic joins
- `src/web/ui/src/App.tsx` — Root component — Brain/Sessions tab architecture
- `src/web/ui/src/App.tsx` — Root component implementing the Brain/Sessions tab architecture and top-level state for selected topic and active tab
- `src/web/ui/src/components/ChatPanel.tsx` — Chat panel — updated to accept topicId
- `src/web/ui/src/components/ChatPanel.tsx` — Chat panel — updated to accept topicId prop, contextualizing chat within the selected topic
- `src/web/ui/src/components/Header.tsx` — Dashboard header containing the Brain/Sessions tab navigation controls
- `src/web/ui/src/components/Header.tsx` — Dashboard header with tab navigation
- `src/web/ui/src/components/SessionList.tsx` — Sessions tab — private session list with topic badges
- `src/web/ui/src/components/SessionList.tsx` — Sessions tab — private session list with topic badges that link back to the Brain tab
- `src/web/ui/src/components/SessionPanel.tsx` — Session detail panel
- `src/web/ui/src/components/SessionPanel.tsx` — Session detail panel — shows individual session content within the Sessions tab
- `src/web/ui/src/components/TopicDetail.tsx` — Brain tab — topic detail panel showing insights, evidence, and related sessions with cross-tab navigation
- `src/web/ui/src/components/TopicDetail.tsx` — Brain tab — topic detail panel with insights, evidence, related sessions
- `src/web/ui/src/components/TopicList.tsx` — Brain tab — renders the topic map with activity heatmap; primary navigation surface for curated knowledge
- `src/web/ui/src/components/TopicList.tsx` — Brain tab — topic map with activity heatmap
- `src/web/ui/src/index.css` — Global styles — minimalist aesthetic
- `src/web/ui/src/types.ts` — Frontend TypeScript types including Session with topics field and other dashboard data shapes
- `src/web/ui/src/types.ts` — Frontend types — Session with topics field, Topic, Insight

## Evidence

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)

## Related

- [data model and schema](data-model-and-schema.md)
- [Repo Brain pipeline](repo-brain-pipeline.md)
