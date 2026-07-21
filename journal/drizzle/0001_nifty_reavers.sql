CREATE TABLE "sittings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"sitting_index" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"event_range_start" integer NOT NULL,
	"event_range_end" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "moments" ADD COLUMN "occurred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "moments" ADD COLUMN "verification" text;--> statement-breakpoint
ALTER TABLE "sittings" ADD CONSTRAINT "sittings_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;