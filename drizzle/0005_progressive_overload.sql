ALTER TABLE "adaptation_events" ADD COLUMN "track" text;--> statement-breakpoint
ALTER TABLE "hangboard_logs" ADD COLUMN "hold_times_seconds" jsonb;--> statement-breakpoint
ALTER TABLE "hangboard_logs" ADD COLUMN "technique_ok" boolean;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "follow_up" jsonb;--> statement-breakpoint
ALTER TABLE "adaptation_events" ADD CONSTRAINT "adaptation_events_track_chk" CHECK ("adaptation_events"."track" is null or "adaptation_events"."track" in ('hang','aerobic','pe','hard'));