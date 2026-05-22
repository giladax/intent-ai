CREATE TYPE "public"."moment_relation_type" AS ENUM('caused', 'evolved_into', 'contradicts');--> statement-breakpoint
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
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "transition_moments" ADD CONSTRAINT "transition_moments_transition_id_transitions_id_fk" FOREIGN KEY ("transition_id") REFERENCES "public"."transitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transition_moments" ADD CONSTRAINT "transition_moments_moment_id_moments_id_fk" FOREIGN KEY ("moment_id") REFERENCES "public"."moments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transitions" ADD CONSTRAINT "transitions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;