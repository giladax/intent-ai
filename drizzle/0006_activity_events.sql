CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"category" text NOT NULL,
	"tags" text[] DEFAULT '{}',
	"actor" text NOT NULL,
	"summary" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"source_type" text,
	"source_id" uuid,
	"session_id" uuid,
	"repo" text,
	"branch" text,
	"worktree" text,
	"topic_ids" uuid[] DEFAULT '{}',
	"files" text[] DEFAULT '{}',
	"embedding" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX idx_ae_category ON activity_events USING btree (category text_pattern_ops);
CREATE INDEX idx_ae_timestamp ON activity_events USING btree (timestamp);
CREATE INDEX idx_ae_session_id ON activity_events USING btree (session_id);
CREATE INDEX idx_ae_repo ON activity_events USING btree (repo);
CREATE INDEX idx_ae_branch ON activity_events USING btree (branch);
CREATE INDEX idx_ae_tags ON activity_events USING gin (tags);
CREATE INDEX idx_ae_topic_ids ON activity_events USING gin (topic_ids);
CREATE INDEX idx_ae_files ON activity_events USING gin (files);
CREATE INDEX idx_ae_category_ts ON activity_events USING btree (category, timestamp);
CREATE INDEX idx_ae_repo_branch ON activity_events USING btree (repo, branch);
