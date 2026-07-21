CREATE INDEX "idx_moment_evidence_moment_id" ON "moment_evidence" USING btree ("moment_id");--> statement-breakpoint
CREATE INDEX "idx_moments_session_id" ON "moments" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_outcomes_session_id" ON "outcomes" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_transitions_session_id" ON "transitions" USING btree ("session_id");