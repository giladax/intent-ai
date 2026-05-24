# Dashboard Architecture
> **area**
> The dashboard is a single-page React application built with shadcn/ui that exposes two top-level tabs: Brain and Sessions. Brain is the shared, curated knowledge layer — it shows a topic map with activity heatmap badges (session count, moment count, update count), a topic detail panel with insights and evidence, and navigation back to related sessions. Sessions is the private execution memory layer — it shows a date-ordered session list with topic badges, a session detail panel, and a chat interface. These two layers are intentionally kept separate: sessions are never auto-published to the brain, and the bridge between them (promoting session content into brain topics) is surfaced only through the topic detail panel. The architecture is a complete replacement of a prior feature/tagging paradigm — not an incremental patch — and all frontend types, API endpoints, and UI components were rewritten to reflect the Brain/Sessions model. The API server joins...
> [structure] The dashboard has exactly two top-level tabs — Brain (sha... · [decision] The Brain/Sessions tab architecture is a full replacement... · [risk] API endpoints in server.ts are prone to schema column nam... · [behavior] The Brain tab surfaces activity heatmap data per topic (s... · [interface] The chat panel accepts an optional topicId context parame...

The dashboard is a single-page React application built with shadcn/ui that exposes two top-level tabs: Brain and Sessions. Brain is the shared, curated knowledge layer — it shows a topic map with activity heatmap badges (session count, moment count, update count), a topic detail panel with insights and evidence, and navigation back to related sessions. Sessions is the private execution memory layer — it shows a date-ordered session list with topic badges, a session detail panel, and a chat interface. These two layers are intentionally kept separate: sessions are never auto-published to the brain, and the bridge between them (promoting session content into brain topics) is surfaced only through the topic detail panel. The architecture is a complete replacement of a prior feature/tagging paradigm — not an incremental patch — and all frontend types, API endpoints, and UI components were rewritten to reflect the Brain/Sessions model. The API server joins topic data onto session records and exposes dedicated endpoints for brain topics, insights, related sessions, and streaming chat with an optional topicId context parameter. Topics are weighted by development energy rather than static documentation, making the Brain tab a living map of where work has actually concentrated.

## structure

- The dashboard has exactly two top-level tabs — Brain (shared curated knowledge: topics, insights, evidence) and Sessions (private execution memory: user's own digested sessions). These are intentionally separate layers with no automatic promotion between them.
- The dashboard has exactly two top-level tabs — Brain (shared curated knowledge) and Sessions (private execution memory) — and these are architecturally separate concerns with no automatic data flow between them. The only bridge is manual promotion of session content into brain topics, surfaced through the topic detail panel.
- The dashboard has exactly two top-level tabs — Brain (shared curated knowledge: topic map, topic detail, insights with evidence) and Sessions (private execution memory: session list, session detail, chat). All UI components are organized under one of these two concerns.
- The API is split into two logical groups mirroring the dashboard tabs: Brain endpoints (topics, insights, related sessions — shared curated knowledge) and Sessions endpoints (session list, session detail, stream chat — private execution memory). This separation is intentional and reflects the product architecture.

## constraint

- API endpoints in server.ts must use exact schema column names: `topic_id`/`related_topic_id` for topic relations, and `i.statement`/`i.category` for insights. Using `topic_a_id`/`topic_b_id` or `i.content`/`i.kind` will silently break the frontend.
- Column names in SQL queries within server.ts must exactly match the PostgreSQL schema: use `topic_id`/`related_topic_id` for topic relations, and `statement`/`category` for insight fields. These are hard constraints — mismatches cause silent query failures or runtime errors.
- The dashboard UI must use shadcn/ui components with a minimalist aesthetic. Do not introduce alternative component libraries or heavy visual styling that conflicts with this baseline.

## decision

- The old feature/tagging paradigm (FeatureList.tsx) was replaced wholesale — App.tsx was fully rewritten, not patched. This was a deliberate architectural reset, not an incremental migration. Do not attempt to restore or reconcile the old paradigm.
- The Brain/Sessions tab architecture is a full replacement of the old FeatureList/feature-tagging paradigm — not an incremental patch. Any code referencing the old feature/tagging model is obsolete and should not be restored.
- The Brain/Sessions tab architecture is a full replacement of the old feature/tagging paradigm (FeatureList component), not an incremental patch. All frontend types, API endpoints, and UI components were rewritten from scratch. Do not attempt to restore or reconcile the old feature/tagging model.
- Sessions are intentionally never auto-published to the brain. The only bridge between private session memory and shared brain knowledge is an explicit action surfaced in the topic detail panel.
- shadcn/ui is the component library with a minimalist aesthetic as a hard design constraint. UX quality and visual minimalism are first-class concerns, not afterthoughts — this was an explicit developer priority when the architecture was established.
- The old feature/tagging API paradigm was completely replaced — not incrementally patched — when the Brain/Sessions architecture was adopted. Any endpoint patterns referencing features or tags are obsolete and should not be restored.

## behavior

- The Brain tab surfaces activity heatmap data per topic (session count, moment count, update count), making topics weighted by actual development energy rather than static documentation. Clicking a topic navigates to related sessions, creating a bidirectional link between the knowledge layer and execution memory.
- The topic detail panel in the Brain tab displays an activity heatmap (session count, moment count, update count) and provides navigation back to related sessions. The bridge from Sessions to Brain — promoting session content into brain topics — is surfaced exclusively here, not in the Sessions tab.
- At runtime, the Brain tab renders a topic map (TopicList) with activity heatmap badges; selecting a topic opens TopicDetail showing insights, evidence, and related sessions. The Sessions tab renders a date-ordered SessionList with topic badges; selecting a session opens SessionPanel alongside ChatPanel, which can receive a topicId to scope the conversation.
- The topic detail panel drives several API calls at runtime: it fetches insights with evidence for a given topic, fetches related sessions (via a related-topics join), and provides the activity heatmap data (session count, moment count, update count). These are read-only GET endpoints triggered by topic selection in the Brain tab.

## risk

- AI-generated API code in server.ts has historically used wrong column names — `topic_a_id`/`topic_b_id` instead of `topic_id`/`related_topic_id`, and `i.content`/`i.kind` instead of `i.statement`/`i.category`. Always verify any generated or modified endpoint code against the actual DB schema before shipping.
- AI-generated API endpoint code in server.ts has a known history of using wrong column names. Specifically: `topic_a_id`/`topic_b_id` instead of `topic_id`/`related_topic_id`, and `i.content`/`i.kind` instead of `i.statement`/`i.category`. Always verify generated API code against the actual DB schema before running.
- API endpoints in server.ts are prone to schema column name mismatches. Known historical errors: `topic_a_id`/`topic_b_id` instead of `topic_id`/`related_topic_id` for topic relations, and `i.content`/`i.kind` instead of `i.statement`/`i.category` for insights. Any regeneration or modification of server.ts queries must be validated against the actual schema column names before the frontend will work.
- Code generation for server.ts API endpoints is error-prone: column names have been wrong at least once and required manual correction. Any time server.ts is regenerated or modified, column names must be verified against the actual database schema before testing the frontend.

## interface

- The Sessions API joins topic data and returns a `topics` field on each Session object (defined in types.ts). The streamChat API accepts an optional `topicId` parameter to scope chat context to a specific brain topic.
- The sessions endpoint JOINs topic data and returns a `topics` field on each Session object. The streamChat endpoint accepts an optional `topicId` parameter. These are stable contracts consumed by the frontend — changing them requires updating both server.ts and the frontend types in types.ts.
- The sessions API endpoint joins topic data and returns a `topics` field on each Session object. The streamChat API accepts an optional `topicId` parameter to scope chat context. The topic detail panel exposes an activity heatmap (session count, moment count, update count) and enables navigation from a topic back to its related sessions.
- The chat panel accepts an optional topicId context parameter, allowing Brain tab topic context to be injected into chat queries. The API server exposes dedicated endpoints for brain topics, insights, related sessions, and streaming chat — all must be kept in sync with the frontend types defined in types.ts.

## Files

- `src/web/server.ts` — API endpoints for brain topics, insights, related sessions, and streaming chat — column names must exactly match schema (topic_id/related_topic_id, statement/category)
- `src/web/server.ts` — API server — exposes brain topics, insights, related sessions endpoints, and sessions endpoint with topic join; known risk of AI-generated column name errors
- `src/web/server.ts` — API server — exposes brain topics, insights, related sessions, session list with topic joins, and streaming chat endpoints; column names must match schema exactly
- `src/web/server.ts` — Primary API server — implements all REST endpoints for Brain (topics, insights, related sessions) and Sessions (session list with topic join, stream chat with optional topicId)
- `src/web/ui/src/api.ts` — Frontend API client — all server endpoint calls go through here
- `src/web/ui/src/api.ts` — Frontend API client — consumes all server.ts endpoints; must stay in sync with endpoint signatures and response shapes
- `src/web/ui/src/api.ts` — Frontend API client — wraps all calls to server.ts endpoints including streamChat with topicId
- `src/web/ui/src/api.ts` — Frontend API client — wraps all server endpoint calls for Brain and Sessions data
- `src/web/ui/src/App.tsx` — Full rewrite implementing Brain/Sessions two-tab layout — replaces the old feature/tagging paradigm entirely
- `src/web/ui/src/App.tsx` — Root component — Brain/Sessions tab routing, full rewrite from prior feature/tagging paradigm
- `src/web/ui/src/App.tsx` — Root component — owns the Brain/Sessions tab switcher; full rewrite replacing the old feature paradigm
- `src/web/ui/src/components/ChatPanel.tsx` — Chat interface — accepts optional topicId parameter to scope conversation context
- `src/web/ui/src/components/ChatPanel.tsx` — Chat panel — accepts optional topicId for Brain tab context injection
- `src/web/ui/src/components/ChatPanel.tsx` — Chat panel — accepts optional topicId parameter to scope chat context to a brain topic
- `src/web/ui/src/components/Header.tsx` — Dashboard header component
- `src/web/ui/src/components/Header.tsx` — Dashboard header with Brain/Sessions tab navigation
- `src/web/ui/src/components/SessionList.tsx` — Sessions tab — date-ordered session list with topic badges
- `src/web/ui/src/components/SessionList.tsx` — Sessions tab: date-ordered session list with topic badges
- `src/web/ui/src/components/SessionPanel.tsx` — Session detail panel for the Sessions tab
- `src/web/ui/src/components/SessionPanel.tsx` — Sessions tab — session detail panel shown when a session is selected
- `src/web/ui/src/components/TopicDetail.tsx` — Brain tab — topic detail panel showing insights, evidence, and related sessions navigation; hosts the session→brain bridge action
- `src/web/ui/src/components/TopicDetail.tsx` — Brain tab: topic detail panel with insights, evidence, and related sessions navigation
- `src/web/ui/src/components/TopicDetail.tsx` — Topic detail panel — shows insights, evidence, activity heatmap, related session navigation, and the brain promotion bridge
- `src/web/ui/src/components/TopicList.tsx` — Brain tab topic map component — renders the list of brain topics with activity heatmap badges
- `src/web/ui/src/components/TopicList.tsx` — Brain tab — topic map with activity heatmap badges for each topic
- `src/web/ui/src/components/TopicList.tsx` — Brain tab: topic map with activity heatmap badges (session count, moment count, update count)
- `src/web/ui/src/index.css` — Dashboard styles — minimalist shadcn/ui aesthetic baseline
- `src/web/ui/src/index.css` — Dashboard styles — shadcn/ui minimalist aesthetic baseline
- `src/web/ui/src/index.css` — Minimalist shadcn/ui styles for the dashboard
- `src/web/ui/src/types.ts` — Frontend type definitions — includes Session type with topics field, Topic, Insight, and related types
- `src/web/ui/src/types.ts` — Frontend type definitions — Session type includes topics field; Brain topic and insight types must match API response shapes
- `src/web/ui/src/types.ts` — Frontend types including Session with topics field and BrainTopic — source of truth for API contract on the client side
- `src/web/ui/src/types.ts` — Frontend types — Session type includes topics field; Brain topic and insight types defined here

## Evidence

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)
