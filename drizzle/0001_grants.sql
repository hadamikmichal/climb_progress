-- Uprawnienia dla ról Neon Data API. Role `authenticated` i `anonymous` tworzy Neon po włączeniu Data API.
-- RLS (polityki *_own) ogranicza `authenticated` do własnych wierszy; `anonymous` nie ma dostępu do żadnej tabeli.
GRANT USAGE ON SCHEMA public TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON
  profiles, training_cycles, planned_workouts, workout_sessions, route_logs, hangboard_logs,
  assessment_sessions, assessment_results, recovery_measurements, readiness_checks, adaptation_events
TO authenticated;--> statement-breakpoint
REVOKE ALL ON
  profiles, training_cycles, planned_workouts, workout_sessions, route_logs, hangboard_logs,
  assessment_sessions, assessment_results, recovery_measurements, readiness_checks, adaptation_events
FROM anonymous;