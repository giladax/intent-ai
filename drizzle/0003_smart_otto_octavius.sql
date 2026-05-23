ALTER TABLE "insight_evidence" ADD COLUMN "reasoning" text;--> statement-breakpoint
ALTER TABLE "topic_files" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "topic_files" ADD CONSTRAINT "topic_files_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;