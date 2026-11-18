CREATE TABLE "adaptation_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text DEFAULT (auth.user_id()) NOT NULL,
	"cycle_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"workout_type" text,
	"parameter" text,
	"from_value" text,
	"to_value" text,
	"reason" text NOT NULL,
	"source_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "adaptation_events_kind_chk" CHECK ("adaptation_events"."kind" in ('progress','hold','reduce','reschedule','skip','deload','readiness','manual','plan'))
);
--> statement-breakpoint
ALTER TABLE "adaptation_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "assessment_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text DEFAULT (auth.user_id()) NOT NULL,
	"assessment_session_id" uuid NOT NULL,
	"category" text NOT NULL,
	"metric_key" text NOT NULL,
	"value_numeric" numeric,
	"unit" text DEFAULT '' NOT NULL,
	"attempt_number" smallint,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_results_metric_uq" UNIQUE NULLS NOT DISTINCT("assessment_session_id","category","metric_key","attempt_number"),
	CONSTRAINT "assessment_results_category_chk" CHECK ("assessment_results"."category" in ('strength','climbing','score'))
);
--> statement-breakpoint
ALTER TABLE "assessment_results" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "assessment_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text DEFAULT (auth.user_id()) NOT NULL,
	"cycle_id" uuid NOT NULL,
	"assessment_type" text NOT NULL,
	"protocol_version" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"body_mass_kg" numeric,
	"notes" text DEFAULT '' NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assessment_sessions_id_user_uq" UNIQUE("id","user_id"),
	CONSTRAINT "assessment_sessions_type_chk" CHECK ("assessment_sessions"."assessment_type" in ('BASELINE','CONTROL','FINAL')),
	CONSTRAINT "assessment_sessions_status_chk" CHECK ("assessment_sessions"."status" in ('scheduled','in_progress','completed','invalid','postponed'))
);
--> statement-breakpoint
ALTER TABLE "assessment_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hangboard_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text DEFAULT (auth.user_id()) NOT NULL,
	"workout_session_id" uuid NOT NULL,
	"session_date" date NOT NULL,
	"board" text NOT NULL,
	"protocol" text,
	"hold_type" text NOT NULL,
	"edge_label" text NOT NULL,
	"edge_depth_mm" numeric,
	"grip_type" text NOT NULL,
	"hold_duration_seconds" numeric NOT NULL,
	"sets_planned" smallint NOT NULL,
	"sets_done" smallint NOT NULL,
	"added_weight_kg" numeric DEFAULT 0 NOT NULL,
	"assistance_kg" numeric DEFAULT 0 NOT NULL,
	"body_mass_kg" numeric,
	"total_load_kg" numeric GENERATED ALWAYS AS (body_mass_kg + added_weight_kg - assistance_kg) STORED,
	"pain" boolean DEFAULT false NOT NULL,
	"successful" boolean GENERATED ALWAYS AS (sets_done >= sets_planned and not pain) STORED,
	"rpe" smallint,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "hangboard_logs_protocol_chk" CHECK ("hangboard_logs"."protocol" is null or "hangboard_logs"."protocol" in ('max_hangs','repeaters')),
	CONSTRAINT "hangboard_logs_sets_chk" CHECK ("hangboard_logs"."sets_done" >= 0 and "hangboard_logs"."sets_planned" >= 0),
	CONSTRAINT "hangboard_logs_load_chk" CHECK ("hangboard_logs"."added_weight_kg" >= 0 and "hangboard_logs"."assistance_kg" >= 0),
	CONSTRAINT "hangboard_logs_hold_chk" CHECK ("hangboard_logs"."hold_duration_seconds" > 0),
	CONSTRAINT "hangboard_logs_rpe_chk" CHECK ("hangboard_logs"."rpe" is null or "hangboard_logs"."rpe" between 0 and 10)
);
--> statement-breakpoint
ALTER TABLE "hangboard_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "planned_workouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text DEFAULT (auth.user_id()) NOT NULL,
	"cycle_id" uuid NOT NULL,
	"scheduled_date" date NOT NULL,
	"original_date" date NOT NULL,
	"week" smallint NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"workout_type" text NOT NULL,
	"part" text,
	"status" text NOT NULL,
	"plan_data" jsonb NOT NULL,
	"completed_ref" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "planned_workouts_type_chk" CHECK ("planned_workouts"."workout_type" in ('A','B','C','BASELINE','CONTROL','FINAL')),
	CONSTRAINT "planned_workouts_part_chk" CHECK ("planned_workouts"."part" is null or "planned_workouts"."part" in ('strength','climbing')),
	CONSTRAINT "planned_workouts_status_chk" CHECK ("planned_workouts"."status" in ('planned','done','partial','skipped','moved'))
);
--> statement-breakpoint
ALTER TABLE "planned_workouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text DEFAULT (auth.user_id()) NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"climbing_level" text,
	"target_grade" text,
	"height_cm" numeric,
	"body_mass_kg" numeric,
	"route_length_m" numeric,
	"preferred_training_days" jsonb NOT NULL,
	"hangboard" jsonb NOT NULL,
	"intake" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_user_id_uq" UNIQUE("user_id"),
	CONSTRAINT "profiles_height_chk" CHECK ("profiles"."height_cm" is null or "profiles"."height_cm" between 0 and 260),
	CONSTRAINT "profiles_mass_chk" CHECK ("profiles"."body_mass_kg" is null or "profiles"."body_mass_kg" between 0 and 250)
);
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "readiness_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text DEFAULT (auth.user_id()) NOT NULL,
	"check_date" date NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"sleep_quality" smallint NOT NULL,
	"wellbeing" smallint NOT NULL,
	"fatigue" smallint NOT NULL,
	"finger_pain" boolean DEFAULT false NOT NULL,
	"elbow_shoulder_pain" boolean DEFAULT false NOT NULL,
	"unusual_fatigue" boolean DEFAULT false NOT NULL,
	"pain_present" boolean GENERATED ALWAYS AS (finger_pain or elbow_shoulder_pain) STORED,
	"notes" text DEFAULT '' NOT NULL,
	CONSTRAINT "readiness_checks_sleep_chk" CHECK ("readiness_checks"."sleep_quality" is null or "readiness_checks"."sleep_quality" between 1 and 5),
	CONSTRAINT "readiness_checks_wellbeing_chk" CHECK ("readiness_checks"."wellbeing" is null or "readiness_checks"."wellbeing" between 1 and 5),
	CONSTRAINT "readiness_checks_fatigue_chk" CHECK ("readiness_checks"."fatigue" is null or "readiness_checks"."fatigue" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "readiness_checks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recovery_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text DEFAULT (auth.user_id()) NOT NULL,
	"assessment_session_id" uuid NOT NULL,
	"elapsed_seconds" smallint NOT NULL,
	"forearm_pump" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_measurements_point_uq" UNIQUE("assessment_session_id","elapsed_seconds"),
	CONSTRAINT "recovery_measurements_point_chk" CHECK ("recovery_measurements"."elapsed_seconds" in (0, 60, 120, 180)),
	CONSTRAINT "recovery_measurements_pump_chk" CHECK ("recovery_measurements"."forearm_pump" is null or "recovery_measurements"."forearm_pump" between 0 and 10)
);
--> statement-breakpoint
ALTER TABLE "recovery_measurements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "route_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text DEFAULT (auth.user_id()) NOT NULL,
	"workout_session_id" uuid NOT NULL,
	"route_order" smallint NOT NULL,
	"set_index" smallint DEFAULT 0 NOT NULL,
	"route_name" text,
	"grade" text NOT NULL,
	"height_meters" numeric,
	"wall_style" text,
	"ascent_time_seconds" integer,
	"completed" boolean NOT NULL,
	"attempt_number" smallint,
	"rpe" smallint,
	"forearm_pump" smallint,
	"technique_degradation" boolean,
	"crux_sent" boolean,
	"ascent_style" text,
	"notes" text DEFAULT '' NOT NULL,
	"logged_at" timestamp with time zone NOT NULL,
	CONSTRAINT "route_logs_wall_chk" CHECK ("route_logs"."wall_style" is null or "route_logs"."wall_style" in ('vertical','overhang','roof','mixed')),
	CONSTRAINT "route_logs_ascent_chk" CHECK ("route_logs"."ascent_style" is null or "route_logs"."ascent_style" in ('onsight','flash','redpoint')),
	CONSTRAINT "route_logs_time_chk" CHECK ("route_logs"."ascent_time_seconds" is null or "route_logs"."ascent_time_seconds" >= 0),
	CONSTRAINT "route_logs_rpe_chk" CHECK ("route_logs"."rpe" is null or "route_logs"."rpe" between 0 and 10),
	CONSTRAINT "route_logs_pump_chk" CHECK ("route_logs"."forearm_pump" is null or "route_logs"."forearm_pump" between 0 and 10)
);
--> statement-breakpoint
ALTER TABLE "route_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "training_cycles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text DEFAULT (auth.user_id()) NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"plan_start" date,
	"weeks" smallint NOT NULL,
	"status" text NOT NULL,
	"protocol_version" text NOT NULL,
	"goal_grade" text,
	"deload_weeks" jsonb NOT NULL,
	"control_test_after_weeks" jsonb NOT NULL,
	"params" jsonb NOT NULL,
	"initial_params" jsonb NOT NULL,
	"calibration" jsonb,
	"benchmark" jsonb,
	"extra_benchmarks" jsonb,
	"abilities" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "training_cycles_id_user_uq" UNIQUE("id","user_id"),
	CONSTRAINT "training_cycles_status_chk" CHECK ("training_cycles"."status" in ('baseline','active','completed','archived')),
	CONSTRAINT "training_cycles_weeks_chk" CHECK ("training_cycles"."weeks" between 1 and 52),
	CONSTRAINT "training_cycles_dates_chk" CHECK ("training_cycles"."end_date" is null or "training_cycles"."plan_start" is null or "training_cycles"."end_date" >= "training_cycles"."plan_start")
);
--> statement-breakpoint
ALTER TABLE "training_cycles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workout_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text DEFAULT (auth.user_id()) NOT NULL,
	"cycle_id" uuid NOT NULL,
	"planned_workout_id" uuid,
	"workout_type" text NOT NULL,
	"week" smallint NOT NULL,
	"deload" boolean DEFAULT false NOT NULL,
	"session_date" date NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"duration_seconds" integer NOT NULL,
	"status" text NOT NULL,
	"rpe" smallint,
	"forearm_pump" smallint,
	"technique" smallint,
	"feeling_after" smallint,
	"notes" text DEFAULT '' NOT NULL,
	"prescription" jsonb NOT NULL,
	"exercises" jsonb NOT NULL,
	"sets" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workout_sessions_id_user_uq" UNIQUE("id","user_id"),
	CONSTRAINT "workout_sessions_type_chk" CHECK ("workout_sessions"."workout_type" in ('A','B','C')),
	CONSTRAINT "workout_sessions_status_chk" CHECK ("workout_sessions"."status" in ('full','partial')),
	CONSTRAINT "workout_sessions_duration_chk" CHECK ("workout_sessions"."duration_seconds" >= 0),
	CONSTRAINT "workout_sessions_time_chk" CHECK ("workout_sessions"."completed_at" >= "workout_sessions"."started_at"),
	CONSTRAINT "workout_sessions_rpe_chk" CHECK ("workout_sessions"."rpe" is null or "workout_sessions"."rpe" between 0 and 10),
	CONSTRAINT "workout_sessions_pump_chk" CHECK ("workout_sessions"."forearm_pump" is null or "workout_sessions"."forearm_pump" between 0 and 10),
	CONSTRAINT "workout_sessions_technique_chk" CHECK ("workout_sessions"."technique" is null or "workout_sessions"."technique" between 1 and 5),
	CONSTRAINT "workout_sessions_feeling_chk" CHECK ("workout_sessions"."feeling_after" is null or "workout_sessions"."feeling_after" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "workout_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "adaptation_events" ADD CONSTRAINT "adaptation_events_cycle_fk" FOREIGN KEY ("cycle_id","user_id") REFERENCES "public"."training_cycles"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_session_fk" FOREIGN KEY ("assessment_session_id","user_id") REFERENCES "public"."assessment_sessions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_sessions" ADD CONSTRAINT "assessment_sessions_cycle_fk" FOREIGN KEY ("cycle_id","user_id") REFERENCES "public"."training_cycles"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hangboard_logs" ADD CONSTRAINT "hangboard_logs_session_fk" FOREIGN KEY ("workout_session_id","user_id") REFERENCES "public"."workout_sessions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_workouts" ADD CONSTRAINT "planned_workouts_cycle_fk" FOREIGN KEY ("cycle_id","user_id") REFERENCES "public"."training_cycles"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_measurements" ADD CONSTRAINT "recovery_measurements_session_fk" FOREIGN KEY ("assessment_session_id","user_id") REFERENCES "public"."assessment_sessions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_logs" ADD CONSTRAINT "route_logs_session_fk" FOREIGN KEY ("workout_session_id","user_id") REFERENCES "public"."workout_sessions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_planned_workout_id_planned_workouts_id_fk" FOREIGN KEY ("planned_workout_id") REFERENCES "public"."planned_workouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_cycle_fk" FOREIGN KEY ("cycle_id","user_id") REFERENCES "public"."training_cycles"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adaptation_events_user_time_idx" ON "adaptation_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "assessment_results_user_metric_idx" ON "assessment_results" USING btree ("user_id","metric_key");--> statement-breakpoint
CREATE INDEX "assessment_sessions_user_type_idx" ON "assessment_sessions" USING btree ("user_id","assessment_type","completed_at");--> statement-breakpoint
CREATE INDEX "assessment_sessions_cycle_idx" ON "assessment_sessions" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "hangboard_logs_session_idx" ON "hangboard_logs" USING btree ("workout_session_id");--> statement-breakpoint
CREATE INDEX "hangboard_logs_user_date_idx" ON "hangboard_logs" USING btree ("user_id","session_date");--> statement-breakpoint
CREATE INDEX "planned_workouts_user_date_idx" ON "planned_workouts" USING btree ("user_id","scheduled_date");--> statement-breakpoint
CREATE INDEX "planned_workouts_cycle_idx" ON "planned_workouts" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "readiness_checks_user_date_idx" ON "readiness_checks" USING btree ("user_id","check_date");--> statement-breakpoint
CREATE INDEX "route_logs_session_idx" ON "route_logs" USING btree ("workout_session_id");--> statement-breakpoint
CREATE INDEX "route_logs_user_grade_idx" ON "route_logs" USING btree ("user_id","grade");--> statement-breakpoint
CREATE INDEX "training_cycles_user_start_idx" ON "training_cycles" USING btree ("user_id","start_date");--> statement-breakpoint
CREATE INDEX "workout_sessions_user_date_idx" ON "workout_sessions" USING btree ("user_id","session_date");--> statement-breakpoint
CREATE INDEX "workout_sessions_cycle_idx" ON "workout_sessions" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "workout_sessions_planned_idx" ON "workout_sessions" USING btree ("planned_workout_id");--> statement-breakpoint
CREATE POLICY "adaptation_events_select_own" ON "adaptation_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.user_id() = "adaptation_events"."user_id"));--> statement-breakpoint
CREATE POLICY "adaptation_events_insert_own" ON "adaptation_events" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.user_id() = "adaptation_events"."user_id"));--> statement-breakpoint
CREATE POLICY "adaptation_events_update_own" ON "adaptation_events" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.user_id() = "adaptation_events"."user_id")) WITH CHECK ((select auth.user_id() = "adaptation_events"."user_id"));--> statement-breakpoint
CREATE POLICY "adaptation_events_delete_own" ON "adaptation_events" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.user_id() = "adaptation_events"."user_id"));--> statement-breakpoint
CREATE POLICY "assessment_results_select_own" ON "assessment_results" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.user_id() = "assessment_results"."user_id"));--> statement-breakpoint
CREATE POLICY "assessment_results_insert_own" ON "assessment_results" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.user_id() = "assessment_results"."user_id"));--> statement-breakpoint
CREATE POLICY "assessment_results_update_own" ON "assessment_results" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.user_id() = "assessment_results"."user_id")) WITH CHECK ((select auth.user_id() = "assessment_results"."user_id"));--> statement-breakpoint
CREATE POLICY "assessment_results_delete_own" ON "assessment_results" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.user_id() = "assessment_results"."user_id"));--> statement-breakpoint
CREATE POLICY "assessment_sessions_select_own" ON "assessment_sessions" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.user_id() = "assessment_sessions"."user_id"));--> statement-breakpoint
CREATE POLICY "assessment_sessions_insert_own" ON "assessment_sessions" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.user_id() = "assessment_sessions"."user_id"));--> statement-breakpoint
CREATE POLICY "assessment_sessions_update_own" ON "assessment_sessions" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.user_id() = "assessment_sessions"."user_id")) WITH CHECK ((select auth.user_id() = "assessment_sessions"."user_id"));--> statement-breakpoint
CREATE POLICY "assessment_sessions_delete_own" ON "assessment_sessions" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.user_id() = "assessment_sessions"."user_id"));--> statement-breakpoint
CREATE POLICY "hangboard_logs_select_own" ON "hangboard_logs" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.user_id() = "hangboard_logs"."user_id"));--> statement-breakpoint
CREATE POLICY "hangboard_logs_insert_own" ON "hangboard_logs" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.user_id() = "hangboard_logs"."user_id"));--> statement-breakpoint
CREATE POLICY "hangboard_logs_update_own" ON "hangboard_logs" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.user_id() = "hangboard_logs"."user_id")) WITH CHECK ((select auth.user_id() = "hangboard_logs"."user_id"));--> statement-breakpoint
CREATE POLICY "hangboard_logs_delete_own" ON "hangboard_logs" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.user_id() = "hangboard_logs"."user_id"));--> statement-breakpoint
CREATE POLICY "planned_workouts_select_own" ON "planned_workouts" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.user_id() = "planned_workouts"."user_id"));--> statement-breakpoint
CREATE POLICY "planned_workouts_insert_own" ON "planned_workouts" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.user_id() = "planned_workouts"."user_id"));--> statement-breakpoint
CREATE POLICY "planned_workouts_update_own" ON "planned_workouts" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.user_id() = "planned_workouts"."user_id")) WITH CHECK ((select auth.user_id() = "planned_workouts"."user_id"));--> statement-breakpoint
CREATE POLICY "planned_workouts_delete_own" ON "planned_workouts" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.user_id() = "planned_workouts"."user_id"));--> statement-breakpoint
CREATE POLICY "profiles_select_own" ON "profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.user_id() = "profiles"."user_id"));--> statement-breakpoint
CREATE POLICY "profiles_insert_own" ON "profiles" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.user_id() = "profiles"."user_id"));--> statement-breakpoint
CREATE POLICY "profiles_update_own" ON "profiles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.user_id() = "profiles"."user_id")) WITH CHECK ((select auth.user_id() = "profiles"."user_id"));--> statement-breakpoint
CREATE POLICY "profiles_delete_own" ON "profiles" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.user_id() = "profiles"."user_id"));--> statement-breakpoint
CREATE POLICY "readiness_checks_select_own" ON "readiness_checks" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.user_id() = "readiness_checks"."user_id"));--> statement-breakpoint
CREATE POLICY "readiness_checks_insert_own" ON "readiness_checks" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.user_id() = "readiness_checks"."user_id"));--> statement-breakpoint
CREATE POLICY "readiness_checks_update_own" ON "readiness_checks" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.user_id() = "readiness_checks"."user_id")) WITH CHECK ((select auth.user_id() = "readiness_checks"."user_id"));--> statement-breakpoint
CREATE POLICY "readiness_checks_delete_own" ON "readiness_checks" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.user_id() = "readiness_checks"."user_id"));--> statement-breakpoint
CREATE POLICY "recovery_measurements_select_own" ON "recovery_measurements" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.user_id() = "recovery_measurements"."user_id"));--> statement-breakpoint
CREATE POLICY "recovery_measurements_insert_own" ON "recovery_measurements" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.user_id() = "recovery_measurements"."user_id"));--> statement-breakpoint
CREATE POLICY "recovery_measurements_update_own" ON "recovery_measurements" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.user_id() = "recovery_measurements"."user_id")) WITH CHECK ((select auth.user_id() = "recovery_measurements"."user_id"));--> statement-breakpoint
CREATE POLICY "recovery_measurements_delete_own" ON "recovery_measurements" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.user_id() = "recovery_measurements"."user_id"));--> statement-breakpoint
CREATE POLICY "route_logs_select_own" ON "route_logs" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.user_id() = "route_logs"."user_id"));--> statement-breakpoint
CREATE POLICY "route_logs_insert_own" ON "route_logs" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.user_id() = "route_logs"."user_id"));--> statement-breakpoint
CREATE POLICY "route_logs_update_own" ON "route_logs" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.user_id() = "route_logs"."user_id")) WITH CHECK ((select auth.user_id() = "route_logs"."user_id"));--> statement-breakpoint
CREATE POLICY "route_logs_delete_own" ON "route_logs" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.user_id() = "route_logs"."user_id"));--> statement-breakpoint
CREATE POLICY "training_cycles_select_own" ON "training_cycles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.user_id() = "training_cycles"."user_id"));--> statement-breakpoint
CREATE POLICY "training_cycles_insert_own" ON "training_cycles" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.user_id() = "training_cycles"."user_id"));--> statement-breakpoint
CREATE POLICY "training_cycles_update_own" ON "training_cycles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.user_id() = "training_cycles"."user_id")) WITH CHECK ((select auth.user_id() = "training_cycles"."user_id"));--> statement-breakpoint
CREATE POLICY "training_cycles_delete_own" ON "training_cycles" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.user_id() = "training_cycles"."user_id"));--> statement-breakpoint
CREATE POLICY "workout_sessions_select_own" ON "workout_sessions" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.user_id() = "workout_sessions"."user_id"));--> statement-breakpoint
CREATE POLICY "workout_sessions_insert_own" ON "workout_sessions" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.user_id() = "workout_sessions"."user_id"));--> statement-breakpoint
CREATE POLICY "workout_sessions_update_own" ON "workout_sessions" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.user_id() = "workout_sessions"."user_id")) WITH CHECK ((select auth.user_id() = "workout_sessions"."user_id"));--> statement-breakpoint
CREATE POLICY "workout_sessions_delete_own" ON "workout_sessions" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.user_id() = "workout_sessions"."user_id"));