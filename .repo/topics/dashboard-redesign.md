# dashboard redesign

The dashboard was redesigned from a single-view layout to a Brain/Sessions tab architecture using shadcn/ui with a minimalist aesthetic. The Brain tab shows a topic map with topic detail panel (insights, evidence, related sessions with navigation). The Sessions tab shows a private session list with topic badges linking back to the Brain tab. The two-tab structure encodes the privacy model: Brain is shared curated knowledge, Sessions is private execution memory.

## structure

- Dashboard has two tabs: Brain (shared curated knowledge — topic map, topic detail, insights, evidence) and Sessions (private execution memory — session list with topic badges). These are architecturally separate concerns with different privacy models.

## decision

- shadcn/ui was chosen as the design system with explicit emphasis on minimalist aesthetic and UX attention
- The old feature/tagging paradigm in the dashboard was dropped entirely — the redesign is a full rewrite of App.tsx and all components, not an incremental patch

## behavior

- Session list items show topic badges that link to the Brain tab, enabling bidirectional navigation: topic → sessions and session → topics
- Topics in the Brain tab show activity heatmap data — session count, moment count, update count — making the brain a living evidence-backed artifact weighted by development energy

## risk

- The AI-generated API endpoints used wrong column names (`topic_a_id`/`topic_b_id` instead of `topic_id`/`related_topic_id`, and `i.content`/`i.kind` instead of `i.statement`/`i.category`) — schema mismatches in server.ts required immediate fixes before the frontend could work

## Files

- `docs/superpowers/specs/2026-05-24-dashboard-redesign.md` — Dashboard redesign spec
- `src/web/server.ts` — API server — brain topics, insights, related topics endpoints
- `src/web/ui/src/api.ts` — Frontend API client — brain topics, session list with topic joins
- `src/web/ui/src/App.tsx` — Root component — Brain/Sessions tab architecture
- `src/web/ui/src/components/ChatPanel.tsx` — Chat panel — updated to accept topicId
- `src/web/ui/src/components/Header.tsx` — Dashboard header with tab navigation
- `src/web/ui/src/components/SessionList.tsx` — Sessions tab — private session list with topic badges
- `src/web/ui/src/components/SessionPanel.tsx` — Session detail panel
- `src/web/ui/src/components/TopicDetail.tsx` — Brain tab — topic detail panel with insights, evidence, related sessions
- `src/web/ui/src/components/TopicList.tsx` — Brain tab — topic map with activity heatmap
- `src/web/ui/src/index.css` — Global styles — minimalist aesthetic
- `src/web/ui/src/types.ts` — Frontend types — Session with topics field, Topic, Insight

## Evidence

- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)

## Related

- [data model and schema](data-model-and-schema.md)
- [Repo Brain pipeline](repo-brain-pipeline.md)
