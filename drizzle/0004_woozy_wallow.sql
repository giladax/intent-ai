CREATE TYPE "public"."skill_status" AS ENUM('draft', 'approved', 'validated');--> statement-breakpoint
ALTER TYPE "public"."insight_category" ADD VALUE 'navigation';--> statement-breakpoint
ALTER TYPE "public"."insight_category" ADD VALUE 'pitfall';--> statement-breakpoint
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
CREATE TABLE "brain_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_name" text NOT NULL,
	"level" text NOT NULL,
	"path" text,
	"parent_node" text,
	"summary" text NOT NULL,
	"insights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"files" jsonb DEFAULT '[]'::jsonb,
	"exports" jsonb DEFAULT '[]'::jsonb,
	"related" jsonb DEFAULT '[]'::jsonb,
	"children" jsonb DEFAULT '[]'::jsonb,
	"sessions" jsonb DEFAULT '[]'::jsonb,
	"version_id" uuid,
	"repo_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"type" text NOT NULL,
	"statement" text NOT NULL,
	"frequency" integer DEFAULT 1 NOT NULL,
	"confidence" text DEFAULT 'medium' NOT NULL,
	"file_associations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "topic_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pitfalls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "skill_status" DEFAULT 'draft' NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "parent_topic_id" uuid;--> statement-breakpoint
ALTER TABLE "brain_cards" ADD CONSTRAINT "brain_cards_version_id_brain_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."brain_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_cards" ADD CONSTRAINT "brain_cards_repo_id_projects_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_patterns" ADD CONSTRAINT "topic_patterns_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_skills" ADD CONSTRAINT "topic_skills_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_parent_topic_id_topics_id_fk" FOREIGN KEY ("parent_topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX idx_ae_category ON activity_events USING btree (category text_pattern_ops);--> statement-breakpoint
CREATE INDEX idx_ae_timestamp ON activity_events USING btree (timestamp);--> statement-breakpoint
CREATE INDEX idx_ae_session_id ON activity_events USING btree (session_id);--> statement-breakpoint
CREATE INDEX idx_ae_repo ON activity_events USING btree (repo);--> statement-breakpoint
CREATE INDEX idx_ae_branch ON activity_events USING btree (branch);--> statement-breakpoint
CREATE INDEX idx_ae_tags ON activity_events USING gin (tags);--> statement-breakpoint
CREATE INDEX idx_ae_topic_ids ON activity_events USING gin (topic_ids);--> statement-breakpoint
CREATE INDEX idx_ae_files ON activity_events USING gin (files);--> statement-breakpoint
CREATE INDEX idx_ae_category_ts ON activity_events USING btree (category, timestamp);--> statement-breakpoint
CREATE INDEX idx_ae_repo_branch ON activity_events USING btree (repo, branch);