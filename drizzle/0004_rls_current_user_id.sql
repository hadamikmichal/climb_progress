ALTER TABLE "adaptation_events" ALTER COLUMN "user_id" SET DEFAULT (app.current_user_id());--> statement-breakpoint
ALTER TABLE "assessment_results" ALTER COLUMN "user_id" SET DEFAULT (app.current_user_id());--> statement-breakpoint
ALTER TABLE "assessment_sessions" ALTER COLUMN "user_id" SET DEFAULT (app.current_user_id());--> statement-breakpoint
ALTER TABLE "hangboard_logs" ALTER COLUMN "user_id" SET DEFAULT (app.current_user_id());--> statement-breakpoint
ALTER TABLE "planned_workouts" ALTER COLUMN "user_id" SET DEFAULT (app.current_user_id());--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "user_id" SET DEFAULT (app.current_user_id());--> statement-breakpoint
ALTER TABLE "readiness_checks" ALTER COLUMN "user_id" SET DEFAULT (app.current_user_id());--> statement-breakpoint
ALTER TABLE "recovery_measurements" ALTER COLUMN "user_id" SET DEFAULT (app.current_user_id());--> statement-breakpoint
ALTER TABLE "route_logs" ALTER COLUMN "user_id" SET DEFAULT (app.current_user_id());--> statement-breakpoint
ALTER TABLE "training_cycles" ALTER COLUMN "user_id" SET DEFAULT (app.current_user_id());--> statement-breakpoint
ALTER TABLE "workout_sessions" ALTER COLUMN "user_id" SET DEFAULT (app.current_user_id());--> statement-breakpoint
ALTER POLICY "adaptation_events_select_own" ON "adaptation_events" TO authenticated USING ((select app.current_user_id() = "adaptation_events"."user_id"));--> statement-breakpoint
ALTER POLICY "adaptation_events_insert_own" ON "adaptation_events" TO authenticated WITH CHECK ((select app.current_user_id() = "adaptation_events"."user_id"));--> statement-breakpoint
ALTER POLICY "adaptation_events_update_own" ON "adaptation_events" TO authenticated USING ((select app.current_user_id() = "adaptation_events"."user_id")) WITH CHECK ((select app.current_user_id() = "adaptation_events"."user_id"));--> statement-breakpoint
ALTER POLICY "adaptation_events_delete_own" ON "adaptation_events" TO authenticated USING ((select app.current_user_id() = "adaptation_events"."user_id"));--> statement-breakpoint
ALTER POLICY "assessment_results_select_own" ON "assessment_results" TO authenticated USING ((select app.current_user_id() = "assessment_results"."user_id"));--> statement-breakpoint
ALTER POLICY "assessment_results_insert_own" ON "assessment_results" TO authenticated WITH CHECK ((select app.current_user_id() = "assessment_results"."user_id"));--> statement-breakpoint
ALTER POLICY "assessment_results_update_own" ON "assessment_results" TO authenticated USING ((select app.current_user_id() = "assessment_results"."user_id")) WITH CHECK ((select app.current_user_id() = "assessment_results"."user_id"));--> statement-breakpoint
ALTER POLICY "assessment_results_delete_own" ON "assessment_results" TO authenticated USING ((select app.current_user_id() = "assessment_results"."user_id"));--> statement-breakpoint
ALTER POLICY "assessment_sessions_select_own" ON "assessment_sessions" TO authenticated USING ((select app.current_user_id() = "assessment_sessions"."user_id"));--> statement-breakpoint
ALTER POLICY "assessment_sessions_insert_own" ON "assessment_sessions" TO authenticated WITH CHECK ((select app.current_user_id() = "assessment_sessions"."user_id"));--> statement-breakpoint
ALTER POLICY "assessment_sessions_update_own" ON "assessment_sessions" TO authenticated USING ((select app.current_user_id() = "assessment_sessions"."user_id")) WITH CHECK ((select app.current_user_id() = "assessment_sessions"."user_id"));--> statement-breakpoint
ALTER POLICY "assessment_sessions_delete_own" ON "assessment_sessions" TO authenticated USING ((select app.current_user_id() = "assessment_sessions"."user_id"));--> statement-breakpoint
ALTER POLICY "hangboard_logs_select_own" ON "hangboard_logs" TO authenticated USING ((select app.current_user_id() = "hangboard_logs"."user_id"));--> statement-breakpoint
ALTER POLICY "hangboard_logs_insert_own" ON "hangboard_logs" TO authenticated WITH CHECK ((select app.current_user_id() = "hangboard_logs"."user_id"));--> statement-breakpoint
ALTER POLICY "hangboard_logs_update_own" ON "hangboard_logs" TO authenticated USING ((select app.current_user_id() = "hangboard_logs"."user_id")) WITH CHECK ((select app.current_user_id() = "hangboard_logs"."user_id"));--> statement-breakpoint
ALTER POLICY "hangboard_logs_delete_own" ON "hangboard_logs" TO authenticated USING ((select app.current_user_id() = "hangboard_logs"."user_id"));--> statement-breakpoint
ALTER POLICY "planned_workouts_select_own" ON "planned_workouts" TO authenticated USING ((select app.current_user_id() = "planned_workouts"."user_id"));--> statement-breakpoint
ALTER POLICY "planned_workouts_insert_own" ON "planned_workouts" TO authenticated WITH CHECK ((select app.current_user_id() = "planned_workouts"."user_id"));--> statement-breakpoint
ALTER POLICY "planned_workouts_update_own" ON "planned_workouts" TO authenticated USING ((select app.current_user_id() = "planned_workouts"."user_id")) WITH CHECK ((select app.current_user_id() = "planned_workouts"."user_id"));--> statement-breakpoint
ALTER POLICY "planned_workouts_delete_own" ON "planned_workouts" TO authenticated USING ((select app.current_user_id() = "planned_workouts"."user_id"));--> statement-breakpoint
ALTER POLICY "profiles_select_own" ON "profiles" TO authenticated USING ((select app.current_user_id() = "profiles"."user_id"));--> statement-breakpoint
ALTER POLICY "profiles_insert_own" ON "profiles" TO authenticated WITH CHECK ((select app.current_user_id() = "profiles"."user_id"));--> statement-breakpoint
ALTER POLICY "profiles_update_own" ON "profiles" TO authenticated USING ((select app.current_user_id() = "profiles"."user_id")) WITH CHECK ((select app.current_user_id() = "profiles"."user_id"));--> statement-breakpoint
ALTER POLICY "profiles_delete_own" ON "profiles" TO authenticated USING ((select app.current_user_id() = "profiles"."user_id"));--> statement-breakpoint
ALTER POLICY "readiness_checks_select_own" ON "readiness_checks" TO authenticated USING ((select app.current_user_id() = "readiness_checks"."user_id"));--> statement-breakpoint
ALTER POLICY "readiness_checks_insert_own" ON "readiness_checks" TO authenticated WITH CHECK ((select app.current_user_id() = "readiness_checks"."user_id"));--> statement-breakpoint
ALTER POLICY "readiness_checks_update_own" ON "readiness_checks" TO authenticated USING ((select app.current_user_id() = "readiness_checks"."user_id")) WITH CHECK ((select app.current_user_id() = "readiness_checks"."user_id"));--> statement-breakpoint
ALTER POLICY "readiness_checks_delete_own" ON "readiness_checks" TO authenticated USING ((select app.current_user_id() = "readiness_checks"."user_id"));--> statement-breakpoint
ALTER POLICY "recovery_measurements_select_own" ON "recovery_measurements" TO authenticated USING ((select app.current_user_id() = "recovery_measurements"."user_id"));--> statement-breakpoint
ALTER POLICY "recovery_measurements_insert_own" ON "recovery_measurements" TO authenticated WITH CHECK ((select app.current_user_id() = "recovery_measurements"."user_id"));--> statement-breakpoint
ALTER POLICY "recovery_measurements_update_own" ON "recovery_measurements" TO authenticated USING ((select app.current_user_id() = "recovery_measurements"."user_id")) WITH CHECK ((select app.current_user_id() = "recovery_measurements"."user_id"));--> statement-breakpoint
ALTER POLICY "recovery_measurements_delete_own" ON "recovery_measurements" TO authenticated USING ((select app.current_user_id() = "recovery_measurements"."user_id"));--> statement-breakpoint
ALTER POLICY "route_logs_select_own" ON "route_logs" TO authenticated USING ((select app.current_user_id() = "route_logs"."user_id"));--> statement-breakpoint
ALTER POLICY "route_logs_insert_own" ON "route_logs" TO authenticated WITH CHECK ((select app.current_user_id() = "route_logs"."user_id"));--> statement-breakpoint
ALTER POLICY "route_logs_update_own" ON "route_logs" TO authenticated USING ((select app.current_user_id() = "route_logs"."user_id")) WITH CHECK ((select app.current_user_id() = "route_logs"."user_id"));--> statement-breakpoint
ALTER POLICY "route_logs_delete_own" ON "route_logs" TO authenticated USING ((select app.current_user_id() = "route_logs"."user_id"));--> statement-breakpoint
ALTER POLICY "training_cycles_select_own" ON "training_cycles" TO authenticated USING ((select app.current_user_id() = "training_cycles"."user_id"));--> statement-breakpoint
ALTER POLICY "training_cycles_insert_own" ON "training_cycles" TO authenticated WITH CHECK ((select app.current_user_id() = "training_cycles"."user_id"));--> statement-breakpoint
ALTER POLICY "training_cycles_update_own" ON "training_cycles" TO authenticated USING ((select app.current_user_id() = "training_cycles"."user_id")) WITH CHECK ((select app.current_user_id() = "training_cycles"."user_id"));--> statement-breakpoint
ALTER POLICY "training_cycles_delete_own" ON "training_cycles" TO authenticated USING ((select app.current_user_id() = "training_cycles"."user_id"));--> statement-breakpoint
ALTER POLICY "workout_sessions_select_own" ON "workout_sessions" TO authenticated USING ((select app.current_user_id() = "workout_sessions"."user_id"));--> statement-breakpoint
ALTER POLICY "workout_sessions_insert_own" ON "workout_sessions" TO authenticated WITH CHECK ((select app.current_user_id() = "workout_sessions"."user_id"));--> statement-breakpoint
ALTER POLICY "workout_sessions_update_own" ON "workout_sessions" TO authenticated USING ((select app.current_user_id() = "workout_sessions"."user_id")) WITH CHECK ((select app.current_user_id() = "workout_sessions"."user_id"));--> statement-breakpoint
ALTER POLICY "workout_sessions_delete_own" ON "workout_sessions" TO authenticated USING ((select app.current_user_id() = "workout_sessions"."user_id"));