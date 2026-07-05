-- Shared attention v1: single-row table for the current user attention state.
-- Written by web server on PUT /api/attention, read by MCP brain_attention tool.
-- Cross-process bridge: web server and MCP server can both access it.
CREATE TABLE IF NOT EXISTS "attention_state" (
  "id" text PRIMARY KEY DEFAULT 'current',
  "state" jsonb NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
-- Insert sentinel so upsert always finds a row
INSERT INTO "attention_state" ("id", "state") VALUES ('current', '{}') ON CONFLICT DO NOTHING;
