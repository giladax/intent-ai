# API Endpoints

The API layer lives in src/web/server.ts and serves the Brain/Sessions dashboard with a set of REST endpoints. It exposes brain-side endpoints (topics, insights, related sessions) and session-side endpoints (session list with topic join, stream chat). The endpoints are consumed by the frontend API client in src/web/ui/src/api.ts and must precisely match the actual PostgreSQL schema column names — a constraint that has already caused bugs when AI-generated code used wrong column names. The sessions endpoint performs a JOIN to attach topic data to each session object, and the streamChat endpoint accepts an optional topicId parameter to scope chat context. These endpoints are the sole data bridge between the persistent knowledge store and the dashboard UI.

## structure

- The API is split into two logical groups mirroring the dashboard tabs: Brain endpoints (topics, insights, related sessions — shared curated knowledge) and Sessions endpoints (session list, session detail, stream chat — private execution memory). This separation is intentional and reflects the product architecture.

## constraint

- Column names in SQL queries within server.ts must exactly match the PostgreSQL schema: use `topic_id`/`related_topic_id` for topic relations, and `statement`/`category` for insight fields. These are hard constraints — mismatches cause silent query failures or runtime errors.

## decision

- The old feature/tagging API paradigm was completely replaced — not incrementally patched — when the Brain/Sessions architecture was adopted. Any endpoint patterns referencing features or tags are obsolete and should not be restored.

## behavior

- The topic detail panel drives several API calls at runtime: it fetches insights with evidence for a given topic, fetches related sessions (via a related-topics join), and provides the activity heatmap data (session count, moment count, update count). These are read-only GET endpoints triggered by topic selection in the Brain tab.

## risk

- AI-generated API code in server.ts has historically used wrong column names — `topic_a_id`/`topic_b_id` instead of `topic_id`/`related_topic_id`, and `i.content`/`i.kind` instead of `i.statement`/`i.category`. Always verify any generated or modified endpoint code against the actual DB schema before shipping.

## interface

- The sessions endpoint JOINs topic data and returns a `topics` field on each Session object. The streamChat endpoint accepts an optional `topicId` parameter. These are stable contracts consumed by the frontend — changing them requires updating both server.ts and the frontend types in types.ts.

## Files

- `src/web/server.ts` — Primary API server — implements all REST endpoints for Brain (topics, insights, related sessions) and Sessions (session list with topic join, stream chat with optional topicId)
- `src/web/ui/src/api.ts` — Frontend API client — consumes all server.ts endpoints; must stay in sync with endpoint signatures and response shapes
- `src/web/ui/src/types.ts` — Frontend type definitions — Session type includes topics field; Brain topic and insight types must match API response shapes

## Evidence

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)
