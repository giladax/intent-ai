-- Feed presentation cache. This table stores LLM-generated editorial copy
-- keyed by lens ('org'). It is a PRESENTATION CACHE — not a fact table.
-- Clear it freely; it recomposes automatically on next /api/feed request.
CREATE TABLE IF NOT EXISTS "feed_cache" (
  "id" text PRIMARY KEY,
  "payload" jsonb NOT NULL,
  "composed_at" timestamptz NOT NULL,
  "event_count_at_compose" integer NOT NULL DEFAULT 0
);
