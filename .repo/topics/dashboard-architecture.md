# Dashboard Architecture

The dashboard is a single-page React application built with shadcn/ui that exposes two top-level tabs: Brain and Sessions. Brain is the shared, curated knowledge layer — it shows a topic map with activity heatmap badges, a topic detail panel with insights and evidence, and navigation back to related sessions. Sessions is the private execution memory layer — it shows a date-ordered session list with topic badges, a session detail panel, and a chat interface. These two layers are intentionally kept separate: sessions are never auto-published to the brain, and the bridge between them (promoting session content into brain topics) is surfaced only through the topic detail panel. The architecture is a complete replacement of a prior feature/tagging paradigm — not an incremental patch — and all frontend types, API endpoints, and UI components were rewritten to reflect the Brain/Sessions model. The API server joins topic data onto session records and exposes dedicated endpoints for brain topics, insights, related sessions, and streaming chat with an optional topicId context parameter.

## structure

- The dashboard has exactly two top-level tabs — Brain (shared curated knowledge: topic map, topic detail, insights with evidence) and Sessions (private execution memory: session list, session detail, chat). All UI components are organized under one of these two concerns.

## constraint

- The dashboard UI must use shadcn/ui components with a minimalist aesthetic. Do not introduce alternative component libraries or heavy visual styling that conflicts with this baseline.

## decision

- The Brain/Sessions tab architecture is a full replacement of the old FeatureList/feature-tagging paradigm — not an incremental patch. Any code referencing the old feature/tagging model is obsolete and should not be restored.
- Sessions are intentionally never auto-published to the brain. The only bridge between private session memory and shared brain knowledge is an explicit action surfaced in the topic detail panel.

## behavior

- At runtime, the Brain tab renders a topic map (TopicList) with activity heatmap badges; selecting a topic opens TopicDetail showing insights, evidence, and related sessions. The Sessions tab renders a date-ordered SessionList with topic badges; selecting a session opens SessionPanel alongside ChatPanel, which can receive a topicId to scope the conversation.

## risk

- AI-generated API endpoint code in server.ts has a known history of using wrong column names. Specifically: `topic_a_id`/`topic_b_id` instead of `topic_id`/`related_topic_id`, and `i.content`/`i.kind` instead of `i.statement`/`i.category`. Always verify generated API code against the actual DB schema before running.

## interface

- The sessions API endpoint joins topic data and returns a `topics` field on each Session object. The streamChat API accepts an optional `topicId` parameter to scope chat context. The topic detail panel exposes an activity heatmap (session count, moment count, update count) and enables navigation from a topic back to its related sessions.

## Files

- `src/web/server.ts` — API server — exposes brain topics, insights, related sessions endpoints, and sessions endpoint with topic join; known risk of AI-generated column name errors
- `src/web/ui/src/api.ts` — Frontend API client — wraps all server endpoint calls for Brain and Sessions data
- `src/web/ui/src/App.tsx` — Root component — owns the Brain/Sessions tab switcher; full rewrite replacing the old feature paradigm
- `src/web/ui/src/components/ChatPanel.tsx` — Chat interface — accepts optional topicId parameter to scope conversation context
- `src/web/ui/src/components/Header.tsx` — Dashboard header component
- `src/web/ui/src/components/SessionList.tsx` — Sessions tab — date-ordered session list with topic badges
- `src/web/ui/src/components/SessionPanel.tsx` — Sessions tab — session detail panel shown when a session is selected
- `src/web/ui/src/components/TopicDetail.tsx` — Brain tab — topic detail panel showing insights, evidence, and related sessions navigation; hosts the session→brain bridge action
- `src/web/ui/src/components/TopicList.tsx` — Brain tab — topic map with activity heatmap badges for each topic
- `src/web/ui/src/index.css` — Dashboard styles — minimalist shadcn/ui aesthetic baseline
- `src/web/ui/src/types.ts` — Frontend types — Session type includes topics field; Brain topic and insight types defined here

## Evidence

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)
