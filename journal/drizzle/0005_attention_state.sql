-- Shared attention v1: single-row table for the current user attention state.
-- Written by the web server on PUT /api/attention, read by the MCP
-- brain_attention tool. Cross-process bridge: web server and MCP server are
-- separate processes and cannot share memory — this table is the slot.
-- NOT a fact table; one row ('current'), single-user v1.
CREATE TABLE IF NOT EXISTS "attention_state" (
	"id" text PRIMARY KEY DEFAULT 'current' NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Sentinel row so the upsert always finds its slot ({} = no attention reported).
INSERT INTO "attention_state" ("id", "state") VALUES ('current', '{}') ON CONFLICT DO NOTHING;
