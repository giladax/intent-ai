CREATE TABLE "feature_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feature_id" uuid NOT NULL,
	"glob" text,
	"file_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "topics" DROP CONSTRAINT "topics_parent_topic_id_topics_id_fk";
--> statement-breakpoint
ALTER TABLE "activity_events" ALTER COLUMN "source_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN "feature_id" text;--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN "review_status" text DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "features" ADD COLUMN "current_understanding" text;--> statement-breakpoint
ALTER TABLE "features" ADD COLUMN "constraints" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "features" ADD COLUMN "known_unknowns" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "feature_files" ADD CONSTRAINT "feature_files_feature_id_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" DROP COLUMN "parent_topic_id";