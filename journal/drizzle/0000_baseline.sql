CREATE TYPE "public"."insight_category" AS ENUM('structure', 'decision', 'constraint', 'behavior', 'risk', 'interface', 'navigation', 'pitfall');--> statement-breakpoint
CREATE TYPE "public"."insight_status" AS ENUM('active', 'stale', 'deprecated');--> statement-breakpoint
CREATE TYPE "public"."moment_relation_type" AS ENUM('caused', 'evolved_into', 'contradicts');--> statement-breakpoint
CREATE TYPE "public"."skill_status" AS ENUM('draft', 'approved', 'validated');--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"category" text NOT NULL,
	"tags" text[] DEFAULT '{}',
	"actor" text NOT NULL,
	"summary" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"source_type" text,
	"source_id" text,
	"session_id" uuid,
	"repo" text,
	"branch" text,
	"worktree" text,
	"feature_id" text,
	"review_status" text DEFAULT 'pending',
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
CREATE TABLE "brain_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"commit_sha" text,
	"parent_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"topic_hint" text,
	"files_in_scope" text[],
	"event_range_start" integer NOT NULL,
	"event_range_end" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feature_id" uuid NOT NULL,
	"glob" text,
	"file_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_sessions" (
	"feature_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "feature_sessions_feature_id_session_id_pk" PRIMARY KEY("feature_id","session_id")
);
--> statement-breakpoint
CREATE TABLE "features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '',
	"current_understanding" text,
	"constraints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"known_unknowns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insight_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"insight_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"moment_id" uuid,
	"reasoning" text
);
--> statement-breakpoint
CREATE TABLE "insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"category" "insight_category" NOT NULL,
	"statement" text NOT NULL,
	"confidence" integer DEFAULT 80 NOT NULL,
	"status" "insight_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moment_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"moment_id" uuid NOT NULL,
	"quote" text NOT NULL,
	"source_event_id" uuid,
	"source_type" text,
	"quote_type" text
);
--> statement-breakpoint
CREATE TABLE "moment_relations" (
	"moment_id" uuid NOT NULL,
	"related_moment_id" uuid NOT NULL,
	"relation_type" "moment_relation_type" NOT NULL,
	CONSTRAINT "moment_relations_moment_id_related_moment_id_pk" PRIMARY KEY("moment_id","related_moment_id")
);
--> statement-breakpoint
CREATE TABLE "moments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"chunk_id" uuid,
	"type" text NOT NULL,
	"statement" text NOT NULL,
	"significance" text,
	"agency" text,
	"confidence" text,
	"topic_fingerprint" text,
	"arc_id" text,
	"arc_role" text
);
--> statement-breakpoint
CREATE TABLE "narrative_arcs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"narrative_id" uuid NOT NULL,
	"arc_id" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"resolution" text,
	"moment_ids" text[]
);
--> statement-breakpoint
CREATE TABLE "narratives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"session_shape" text,
	"summary" text NOT NULL,
	"progression" text[],
	"discoveries" text[],
	"stabilized_directions" text[],
	"abandoned_directions" text[]
);
--> statement-breakpoint
CREATE TABLE "normalized_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"raw_event_id" uuid,
	"causal_order" integer NOT NULL,
	"category" text NOT NULL,
	"actor" text NOT NULL,
	"summary" text NOT NULL,
	"detail" text,
	"files_affected" text[]
);
--> statement-breakpoint
CREATE TABLE "outcome_files" (
	"outcome_id" uuid NOT NULL,
	"file_path" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outcome_moments" (
	"outcome_id" uuid NOT NULL,
	"moment_id" uuid NOT NULL,
	CONSTRAINT "outcome_moments_outcome_id_moment_id_pk" PRIMARY KEY("outcome_id","moment_id")
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"statement" text NOT NULL,
	"confidence" text
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"source" text NOT NULL,
	"timestamp" timestamp with time zone,
	"type" text NOT NULL,
	"raw" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" text NOT NULL,
	"source_path" text NOT NULL,
	"session_shape" text,
	"source_hash" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"file_path" text NOT NULL,
	"role" text NOT NULL,
	"session_id" uuid
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
CREATE TABLE "topic_relations" (
	"topic_id" uuid NOT NULL,
	"related_topic_id" uuid NOT NULL,
	"relationship" text NOT NULL,
	CONSTRAINT "topic_relations_topic_id_related_topic_id_pk" PRIMARY KEY("topic_id","related_topic_id")
);
--> statement-breakpoint
CREATE TABLE "topic_sessions" (
	"topic_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	CONSTRAINT "topic_sessions_topic_id_session_id_pk" PRIMARY KEY("topic_id","session_id")
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
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"name" text NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transition_moments" (
	"transition_id" uuid NOT NULL,
	"moment_id" uuid NOT NULL,
	CONSTRAINT "transition_moments_transition_id_moment_id_pk" PRIMARY KEY("transition_id","moment_id")
);
--> statement-breakpoint
CREATE TABLE "transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"from_statement" text NOT NULL,
	"to_statement" text NOT NULL,
	"reason" text,
	"arc_id" text,
	"confidence" text
);
--> statement-breakpoint
ALTER TABLE "brain_cards" ADD CONSTRAINT "brain_cards_version_id_brain_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."brain_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_cards" ADD CONSTRAINT "brain_cards_repo_id_projects_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_versions" ADD CONSTRAINT "brain_versions_repo_id_projects_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_versions" ADD CONSTRAINT "brain_versions_parent_version_id_brain_versions_id_fk" FOREIGN KEY ("parent_version_id") REFERENCES "public"."brain_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_files" ADD CONSTRAINT "feature_files_feature_id_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_sessions" ADD CONSTRAINT "feature_sessions_feature_id_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."features"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_sessions" ADD CONSTRAINT "feature_sessions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "features" ADD CONSTRAINT "features_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_evidence" ADD CONSTRAINT "insight_evidence_insight_id_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_evidence" ADD CONSTRAINT "insight_evidence_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_evidence" ADD CONSTRAINT "insight_evidence_moment_id_moments_id_fk" FOREIGN KEY ("moment_id") REFERENCES "public"."moments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moment_evidence" ADD CONSTRAINT "moment_evidence_moment_id_moments_id_fk" FOREIGN KEY ("moment_id") REFERENCES "public"."moments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moment_evidence" ADD CONSTRAINT "moment_evidence_source_event_id_normalized_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."normalized_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moment_relations" ADD CONSTRAINT "moment_relations_moment_id_moments_id_fk" FOREIGN KEY ("moment_id") REFERENCES "public"."moments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moment_relations" ADD CONSTRAINT "moment_relations_related_moment_id_moments_id_fk" FOREIGN KEY ("related_moment_id") REFERENCES "public"."moments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moments" ADD CONSTRAINT "moments_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moments" ADD CONSTRAINT "moments_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrative_arcs" ADD CONSTRAINT "narrative_arcs_narrative_id_narratives_id_fk" FOREIGN KEY ("narrative_id") REFERENCES "public"."narratives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narratives" ADD CONSTRAINT "narratives_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalized_events" ADD CONSTRAINT "normalized_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalized_events" ADD CONSTRAINT "normalized_events_raw_event_id_raw_events_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_files" ADD CONSTRAINT "outcome_files_outcome_id_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."outcomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_moments" ADD CONSTRAINT "outcome_moments_outcome_id_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."outcomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_moments" ADD CONSTRAINT "outcome_moments_moment_id_moments_id_fk" FOREIGN KEY ("moment_id") REFERENCES "public"."moments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_events" ADD CONSTRAINT "raw_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_files" ADD CONSTRAINT "topic_files_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_files" ADD CONSTRAINT "topic_files_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_patterns" ADD CONSTRAINT "topic_patterns_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_relations" ADD CONSTRAINT "topic_relations_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_relations" ADD CONSTRAINT "topic_relations_related_topic_id_topics_id_fk" FOREIGN KEY ("related_topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_sessions" ADD CONSTRAINT "topic_sessions_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_sessions" ADD CONSTRAINT "topic_sessions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_skills" ADD CONSTRAINT "topic_skills_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_repo_id_projects_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transition_moments" ADD CONSTRAINT "transition_moments_transition_id_transitions_id_fk" FOREIGN KEY ("transition_id") REFERENCES "public"."transitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transition_moments" ADD CONSTRAINT "transition_moments_moment_id_moments_id_fk" FOREIGN KEY ("moment_id") REFERENCES "public"."moments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transitions" ADD CONSTRAINT "transitions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ae_category" ON "activity_events" USING btree ("category" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "idx_ae_timestamp" ON "activity_events" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_ae_session_id" ON "activity_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_ae_repo" ON "activity_events" USING btree ("repo");--> statement-breakpoint
CREATE INDEX "idx_ae_branch" ON "activity_events" USING btree ("branch");--> statement-breakpoint
CREATE INDEX "idx_ae_tags" ON "activity_events" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "idx_ae_topic_ids" ON "activity_events" USING gin ("topic_ids");--> statement-breakpoint
CREATE INDEX "idx_ae_files" ON "activity_events" USING gin ("files");--> statement-breakpoint
CREATE INDEX "idx_ae_category_ts" ON "activity_events" USING btree ("category","timestamp");--> statement-breakpoint
CREATE INDEX "idx_ae_repo_branch" ON "activity_events" USING btree ("repo","branch");--> statement-breakpoint
CREATE INDEX "idx_ae_feature_review" ON "activity_events" USING btree ("feature_id","review_status");--> statement-breakpoint
CREATE INDEX "idx_ff_feature_id" ON "feature_files" USING btree ("feature_id");