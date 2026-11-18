/**
 * ClimbProgress – schemat PostgreSQL (Neon) w Drizzle ORM.
 *
 * Zasady:
 *  - identyfikatory rekordów to UUID generowane po stronie klienta (uid()) – zapis jest idempotentny
 *    (upsert po id), więc ponowienie przerwanej synchronizacji nie tworzy duplikatów;
 *  - `user_id` NIE pochodzi z frontendu: domyślna wartość to `app.current_user_id()` (claim `sub` zweryfikowanego
 *    JWT Neon Auth, czytany przez `auth.user_id()` z pg_session_jwt), a polityki RLS odrzucają każdy wiersz,
 *    którego `user_id` ≠ `app.current_user_id()`. Pośrednik jest potrzebny, bo schemat `auth` należy do Neon
 *    (cloud_admin) i rola `authenticated` nie ma do niego USAGE – patrz drizzle/0003_current_user_id.sql;
 *  - tabele podrzędne mają złożone klucze obce (rodzic.id, user_id) – nie da się podpiąć rekordu
 *    pod cudzy trening / test nawet znając jego UUID;
 *  - konta i hasła przechowuje Neon Auth we własnym schemacie `neon_auth` – tu nie ma tabeli użytkowników.
 *
 * Klucze obiektów w TS = nazwy kolumn (snake_case), dzięki czemu `$inferSelect` opisuje dokładnie
 * JSON zwracany przez Neon Data API (PostgREST).
 */
import { sql } from 'drizzle-orm';
import {
  AnyPgColumn, boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgPolicy, pgTable, smallint, text, timestamp, unique, uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/neon';

/* ---------------- pomocnicze ---------------- */

/** Identyfikator zalogowanego użytkownika (sub z JWT Neon Auth) – funkcja z migracji 0003 */
const currentUserId = sql`app.current_user_id()`;
const userId = () => text('user_id').notNull().default(sql`(${currentUserId})`);
const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
const num = (name: string) => numeric(name, { mode: 'number' });
const day = (name: string) => date(name, { mode: 'string' });

/** Polityki SELECT / INSERT / UPDATE / DELETE: wyłącznie własne rekordy zalogowanego użytkownika */
function ownerPolicies(table: string, col: AnyPgColumn) {
  const own = sql`(select ${currentUserId} = ${col})`;
  return [
    pgPolicy(`${table}_select_own`, { for: 'select', to: authenticatedRole, using: own }),
    pgPolicy(`${table}_insert_own`, { for: 'insert', to: authenticatedRole, withCheck: own }),
    pgPolicy(`${table}_update_own`, { for: 'update', to: authenticatedRole, using: own, withCheck: own }),
    pgPolicy(`${table}_delete_own`, { for: 'delete', to: authenticatedRole, using: own }),
  ];
}

const scale = (name: string, col: AnyPgColumn, min: number, max: number) => check(name, sql`${col} is null or ${col} between ${sql.raw(String(min))} and ${sql.raw(String(max))}`);

/* ---------------- typy JSONB (kształty z modelu aplikacji) ---------------- */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

/* ---------------- profiles ---------------- */

export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: userId().unique('profiles_user_id_uq'),
    display_name: text('display_name').notNull().default(''),
    /** Deklarowany poziom (najtrudniejsza droga RP/OS), np. "6b+" */
    climbing_level: text('climbing_level'),
    target_grade: text('target_grade'),
    height_cm: num('height_cm'),
    body_mass_kg: num('body_mass_kg'),
    route_length_m: num('route_length_m'),
    /** Przypisanie typów treningów A/B/C do dni tygodnia (1 = pon … 7 = nd) */
    preferred_training_days: jsonb('preferred_training_days').$type<Record<string, number>>().notNull(),
    hangboard: jsonb('hangboard').$type<JsonValue>().notNull(),
    intake: jsonb('intake').$type<JsonValue>(),
    created_at: tstz('created_at').notNull().defaultNow(),
    updated_at: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('profiles_height_chk', sql`${t.height_cm} is null or ${t.height_cm} between 0 and 260`),
    check('profiles_mass_chk', sql`${t.body_mass_kg} is null or ${t.body_mass_kg} between 0 and 250`),
    ...ownerPolicies('profiles', t.user_id),
  ],
);

/* ---------------- training_cycles ---------------- */

export const trainingCycles = pgTable(
  'training_cycles',
  {
    id: uuid('id').primaryKey(),
    user_id: userId(),
    name: text('name').notNull(),
    /** Data testu początkowego (Baseline) */
    start_date: day('start_date').notNull(),
    /** Ostatni dzień planu (planStart + weeks × 7 − 1); null przed wygenerowaniem planu */
    end_date: day('end_date'),
    /** Poniedziałek 1. tygodnia treningowego */
    plan_start: day('plan_start'),
    weeks: smallint('weeks').notNull(),
    status: text('status').notNull(),
    protocol_version: text('protocol_version').notNull(),
    goal_grade: text('goal_grade'),
    deload_weeks: jsonb('deload_weeks').$type<number[]>().notNull(),
    control_test_after_weeks: jsonb('control_test_after_weeks').$type<number[]>().notNull(),
    /** Aktualny poziom obciążenia (Max Hangs / Repeaters, drogi, obwody) */
    params: jsonb('params').$type<JsonValue>().notNull(),
    initial_params: jsonb('initial_params').$type<JsonValue>().notNull(),
    calibration: jsonb('calibration').$type<JsonValue>(),
    benchmark: jsonb('benchmark').$type<JsonValue>(),
    extra_benchmarks: jsonb('extra_benchmarks').$type<JsonValue>(),
    abilities: jsonb('abilities').$type<JsonValue>(),
    created_at: tstz('created_at').notNull(),
    updated_at: tstz('updated_at').notNull(),
  },
  (t) => [
    unique('training_cycles_id_user_uq').on(t.id, t.user_id),
    index('training_cycles_user_start_idx').on(t.user_id, t.start_date),
    check('training_cycles_status_chk', sql`${t.status} in ('baseline','active','completed','archived')`),
    check('training_cycles_weeks_chk', sql`${t.weeks} between 1 and 52`),
    check('training_cycles_dates_chk', sql`${t.end_date} is null or ${t.plan_start} is null or ${t.end_date} >= ${t.plan_start}`),
    ...ownerPolicies('training_cycles', t.user_id),
  ],
);

/* ---------------- planned_workouts ---------------- */

export const plannedWorkouts = pgTable(
  'planned_workouts',
  {
    id: uuid('id').primaryKey(),
    user_id: userId(),
    cycle_id: uuid('cycle_id').notNull(),
    scheduled_date: day('scheduled_date').notNull(),
    original_date: day('original_date').notNull(),
    /** 0 = test początkowy, 1..N = tydzień cyklu, N+1 = test końcowy */
    week: smallint('week').notNull(),
    sort_order: smallint('sort_order').notNull().default(0),
    workout_type: text('workout_type').notNull(),
    /** Sesja Baseline Test: dzień siłowy lub dzień dróg */
    part: text('part'),
    status: text('status').notNull(),
    /** Przesunięcia (z uzasadnieniem), powód i notatka pominięcia */
    plan_data: jsonb('plan_data').$type<JsonValue>().notNull(),
    /** Trening / test, który zrealizował tę jednostkę (workout_sessions lub assessment_sessions) */
    completed_ref: uuid('completed_ref'),
    created_at: tstz('created_at').notNull(),
    updated_at: tstz('updated_at').notNull(),
  },
  (t) => [
    foreignKey({ name: 'planned_workouts_cycle_fk', columns: [t.cycle_id, t.user_id], foreignColumns: [trainingCycles.id, trainingCycles.user_id] }).onDelete('cascade'),
    index('planned_workouts_user_date_idx').on(t.user_id, t.scheduled_date),
    index('planned_workouts_cycle_idx').on(t.cycle_id),
    check('planned_workouts_type_chk', sql`${t.workout_type} in ('A','B','C','BASELINE','CONTROL','FINAL')`),
    check('planned_workouts_part_chk', sql`${t.part} is null or ${t.part} in ('strength','climbing')`),
    check('planned_workouts_status_chk', sql`${t.status} in ('planned','done','partial','skipped','moved')`),
    ...ownerPolicies('planned_workouts', t.user_id),
  ],
);

/* ---------------- workout_sessions ---------------- */

export const workoutSessions = pgTable(
  'workout_sessions',
  {
    id: uuid('id').primaryKey(),
    user_id: userId(),
    cycle_id: uuid('cycle_id').notNull(),
    planned_workout_id: uuid('planned_workout_id').references(() => plannedWorkouts.id, { onDelete: 'set null' }),
    workout_type: text('workout_type').notNull(),
    week: smallint('week').notNull(),
    /** Deload lub lżejsza wersja – nie wpływa na progresję */
    deload: boolean('deload').notNull().default(false),
    session_date: day('session_date').notNull(),
    started_at: tstz('started_at').notNull(),
    completed_at: tstz('completed_at').notNull(),
    duration_seconds: integer('duration_seconds').notNull(),
    /** full = wszystkie części wykonane, partial = częściowo */
    status: text('status').notNull(),
    rpe: smallint('rpe'),
    forearm_pump: smallint('forearm_pump'),
    technique: smallint('technique'),
    feeling_after: smallint('feeling_after'),
    notes: text('notes').notNull().default(''),
    /** Snapshot parametrów, z jakimi trening był zaplanowany (w tym przerwy) */
    prescription: jsonb('prescription').$type<JsonValue>().notNull(),
    /** Wykonane ćwiczenia (rozgrzewka, części treningu, checklisty) */
    exercises: jsonb('exercises').$type<JsonValue>().notNull(),
    /** Serie obwodów z RPE i pompowaniem */
    sets: jsonb('sets').$type<JsonValue>().notNull(),
    created_at: tstz('created_at').notNull(),
    updated_at: tstz('updated_at').notNull(),
  },
  (t) => [
    unique('workout_sessions_id_user_uq').on(t.id, t.user_id),
    foreignKey({ name: 'workout_sessions_cycle_fk', columns: [t.cycle_id, t.user_id], foreignColumns: [trainingCycles.id, trainingCycles.user_id] }).onDelete('cascade'),
    index('workout_sessions_user_date_idx').on(t.user_id, t.session_date),
    index('workout_sessions_cycle_idx').on(t.cycle_id),
    index('workout_sessions_planned_idx').on(t.planned_workout_id),
    check('workout_sessions_type_chk', sql`${t.workout_type} in ('A','B','C')`),
    check('workout_sessions_status_chk', sql`${t.status} in ('full','partial')`),
    check('workout_sessions_duration_chk', sql`${t.duration_seconds} >= 0`),
    check('workout_sessions_time_chk', sql`${t.completed_at} >= ${t.started_at}`),
    scale('workout_sessions_rpe_chk', t.rpe, 0, 10),
    scale('workout_sessions_pump_chk', t.forearm_pump, 0, 10),
    scale('workout_sessions_technique_chk', t.technique, 1, 5),
    scale('workout_sessions_feeling_chk', t.feeling_after, 1, 5),
    ...ownerPolicies('workout_sessions', t.user_id),
  ],
);

/* ---------------- route_logs ---------------- */

export const routeLogs = pgTable(
  'route_logs',
  {
    id: uuid('id').primaryKey(),
    user_id: userId(),
    workout_session_id: uuid('workout_session_id').notNull(),
    route_order: smallint('route_order').notNull(),
    /** Numer serii w obwodzie (0 dla treningów bez serii) */
    set_index: smallint('set_index').notNull().default(0),
    route_name: text('route_name'),
    grade: text('grade').notNull(),
    height_meters: num('height_meters'),
    wall_style: text('wall_style'),
    ascent_time_seconds: integer('ascent_time_seconds'),
    completed: boolean('completed').notNull(),
    attempt_number: smallint('attempt_number'),
    rpe: smallint('rpe'),
    forearm_pump: smallint('forearm_pump'),
    technique_degradation: boolean('technique_degradation'),
    crux_sent: boolean('crux_sent'),
    ascent_style: text('ascent_style'),
    notes: text('notes').notNull().default(''),
    logged_at: tstz('logged_at').notNull(),
  },
  (t) => [
    foreignKey({ name: 'route_logs_session_fk', columns: [t.workout_session_id, t.user_id], foreignColumns: [workoutSessions.id, workoutSessions.user_id] }).onDelete('cascade'),
    index('route_logs_session_idx').on(t.workout_session_id),
    index('route_logs_user_grade_idx').on(t.user_id, t.grade),
    check('route_logs_wall_chk', sql`${t.wall_style} is null or ${t.wall_style} in ('vertical','overhang','roof','mixed')`),
    check('route_logs_ascent_chk', sql`${t.ascent_style} is null or ${t.ascent_style} in ('onsight','flash','redpoint')`),
    check('route_logs_time_chk', sql`${t.ascent_time_seconds} is null or ${t.ascent_time_seconds} >= 0`),
    scale('route_logs_rpe_chk', t.rpe, 0, 10),
    scale('route_logs_pump_chk', t.forearm_pump, 0, 10),
    ...ownerPolicies('route_logs', t.user_id),
  ],
);

/* ---------------- hangboard_logs ---------------- */

export const hangboardLogs = pgTable(
  'hangboard_logs',
  {
    id: uuid('id').primaryKey(),
    user_id: userId(),
    workout_session_id: uuid('workout_session_id').notNull(),
    session_date: day('session_date').notNull(),
    board: text('board').notNull(),
    /** max_hangs lub repeaters (z parametrów treningu) */
    protocol: text('protocol'),
    hold_type: text('hold_type').notNull(),
    edge_label: text('edge_label').notNull(),
    edge_depth_mm: num('edge_depth_mm'),
    grip_type: text('grip_type').notNull(),
    hold_duration_seconds: num('hold_duration_seconds').notNull(),
    sets_planned: smallint('sets_planned').notNull(),
    sets_done: smallint('sets_done').notNull(),
    added_weight_kg: num('added_weight_kg').notNull().default(0),
    assistance_kg: num('assistance_kg').notNull().default(0),
    /** Masa ciała w dniu treningu (null = nieznana) */
    body_mass_kg: num('body_mass_kg'),
    total_load_kg: num('total_load_kg').generatedAlwaysAs(sql`body_mass_kg + added_weight_kg - assistance_kg`),
    pain: boolean('pain').notNull().default(false),
    successful: boolean('successful').generatedAlwaysAs(sql`sets_done >= sets_planned and not pain`),
    rpe: smallint('rpe'),
    notes: text('notes').notNull().default(''),
    created_at: tstz('created_at').notNull(),
  },
  (t) => [
    foreignKey({ name: 'hangboard_logs_session_fk', columns: [t.workout_session_id, t.user_id], foreignColumns: [workoutSessions.id, workoutSessions.user_id] }).onDelete('cascade'),
    index('hangboard_logs_session_idx').on(t.workout_session_id),
    index('hangboard_logs_user_date_idx').on(t.user_id, t.session_date),
    check('hangboard_logs_protocol_chk', sql`${t.protocol} is null or ${t.protocol} in ('max_hangs','repeaters')`),
    check('hangboard_logs_sets_chk', sql`${t.sets_done} >= 0 and ${t.sets_planned} >= 0`),
    check('hangboard_logs_load_chk', sql`${t.added_weight_kg} >= 0 and ${t.assistance_kg} >= 0`),
    check('hangboard_logs_hold_chk', sql`${t.hold_duration_seconds} > 0`),
    scale('hangboard_logs_rpe_chk', t.rpe, 0, 10),
    ...ownerPolicies('hangboard_logs', t.user_id),
  ],
);

/* ---------------- assessment_sessions ---------------- */

export const assessmentSessions = pgTable(
  'assessment_sessions',
  {
    id: uuid('id').primaryKey(),
    user_id: userId(),
    cycle_id: uuid('cycle_id').notNull(),
    assessment_type: text('assessment_type').notNull(),
    /** '1.0' = Baseline Test v1.0, 'legacy-3x6a' = test w starym formacie 3 × 6a */
    protocol_version: text('protocol_version').notNull(),
    status: text('status').notNull(),
    started_at: tstz('started_at').notNull(),
    completed_at: tstz('completed_at'),
    body_mass_kg: num('body_mass_kg'),
    notes: text('notes').notNull().default(''),
    /**
     * Pełny dokument testu (obie sesje, warunki początkowe, próby, kalibracja) – źródło prawdy dla aplikacji.
     * Wyniki do analiz są dodatkowo rozpisane w assessment_results i recovery_measurements.
     */
    payload: jsonb('payload').$type<JsonValue>().notNull(),
    created_at: tstz('created_at').notNull(),
    updated_at: tstz('updated_at').notNull(),
  },
  (t) => [
    unique('assessment_sessions_id_user_uq').on(t.id, t.user_id),
    foreignKey({ name: 'assessment_sessions_cycle_fk', columns: [t.cycle_id, t.user_id], foreignColumns: [trainingCycles.id, trainingCycles.user_id] }).onDelete('cascade'),
    index('assessment_sessions_user_type_idx').on(t.user_id, t.assessment_type, t.completed_at),
    index('assessment_sessions_cycle_idx').on(t.cycle_id),
    check('assessment_sessions_type_chk', sql`${t.assessment_type} in ('BASELINE','CONTROL','FINAL')`),
    check('assessment_sessions_status_chk', sql`${t.status} in ('scheduled','in_progress','completed','invalid','postponed')`),
    ...ownerPolicies('assessment_sessions', t.user_id),
  ],
);

/* ---------------- assessment_results ---------------- */

export const assessmentResults = pgTable(
  'assessment_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: userId(),
    assessment_session_id: uuid('assessment_session_id').notNull(),
    /** strength (dzień 1), climbing (dzień 2), score (punktacja 9c i wartości pochodne) */
    category: text('category').notNull(),
    metric_key: text('metric_key').notNull(),
    value_numeric: num('value_numeric'),
    unit: text('unit').notNull().default(''),
    /** 1..N dla pomiarów z kolejnych prób; null dla wyniku zbiorczego */
    attempt_number: smallint('attempt_number'),
    metadata: jsonb('metadata').$type<JsonValue>().notNull().default({}),
    created_at: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'assessment_results_session_fk', columns: [t.assessment_session_id, t.user_id], foreignColumns: [assessmentSessions.id, assessmentSessions.user_id] }).onDelete('cascade'),
    unique('assessment_results_metric_uq').on(t.assessment_session_id, t.category, t.metric_key, t.attempt_number).nullsNotDistinct(),
    index('assessment_results_user_metric_idx').on(t.user_id, t.metric_key),
    check('assessment_results_category_chk', sql`${t.category} in ('strength','climbing','score')`),
    ...ownerPolicies('assessment_results', t.user_id),
  ],
);

/* ---------------- recovery_measurements ---------------- */

export const recoveryMeasurements = pgTable(
  'recovery_measurements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: userId(),
    assessment_session_id: uuid('assessment_session_id').notNull(),
    elapsed_seconds: smallint('elapsed_seconds').notNull(),
    forearm_pump: smallint('forearm_pump'),
    created_at: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'recovery_measurements_session_fk', columns: [t.assessment_session_id, t.user_id], foreignColumns: [assessmentSessions.id, assessmentSessions.user_id] }).onDelete('cascade'),
    unique('recovery_measurements_point_uq').on(t.assessment_session_id, t.elapsed_seconds),
    check('recovery_measurements_point_chk', sql`${t.elapsed_seconds} in (0, 60, 120, 180)`),
    scale('recovery_measurements_pump_chk', t.forearm_pump, 0, 10),
    ...ownerPolicies('recovery_measurements', t.user_id),
  ],
);

/* ---------------- readiness_checks ---------------- */

export const readinessChecks = pgTable(
  'readiness_checks',
  {
    id: uuid('id').primaryKey(),
    user_id: userId(),
    check_date: day('check_date').notNull(),
    checked_at: tstz('checked_at').notNull(),
    /** Jakość snu 1–5 (aplikacja nie zbiera liczby godzin w codziennej ocenie gotowości) */
    sleep_quality: smallint('sleep_quality').notNull(),
    wellbeing: smallint('wellbeing').notNull(),
    fatigue: smallint('fatigue').notNull(),
    finger_pain: boolean('finger_pain').notNull().default(false),
    elbow_shoulder_pain: boolean('elbow_shoulder_pain').notNull().default(false),
    unusual_fatigue: boolean('unusual_fatigue').notNull().default(false),
    pain_present: boolean('pain_present').generatedAlwaysAs(sql`finger_pain or elbow_shoulder_pain`),
    notes: text('notes').notNull().default(''),
  },
  (t) => [
    index('readiness_checks_user_date_idx').on(t.user_id, t.check_date),
    scale('readiness_checks_sleep_chk', t.sleep_quality, 1, 5),
    scale('readiness_checks_wellbeing_chk', t.wellbeing, 1, 5),
    scale('readiness_checks_fatigue_chk', t.fatigue, 1, 5),
    ...ownerPolicies('readiness_checks', t.user_id),
  ],
);

/* ---------------- adaptation_events (historia zmian planu) ---------------- */

export const adaptationEvents = pgTable(
  'adaptation_events',
  {
    id: uuid('id').primaryKey(),
    user_id: userId(),
    cycle_id: uuid('cycle_id').notNull(),
    occurred_at: tstz('occurred_at').notNull(),
    kind: text('kind').notNull(),
    workout_type: text('workout_type'),
    parameter: text('parameter'),
    from_value: text('from_value'),
    to_value: text('to_value'),
    /** Wyjaśnienie decyzji – zawsze widoczne dla użytkownika */
    reason: text('reason').notNull(),
    source_ids: jsonb('source_ids').$type<string[]>().notNull().default([]),
  },
  (t) => [
    foreignKey({ name: 'adaptation_events_cycle_fk', columns: [t.cycle_id, t.user_id], foreignColumns: [trainingCycles.id, trainingCycles.user_id] }).onDelete('cascade'),
    index('adaptation_events_user_time_idx').on(t.user_id, t.occurred_at),
    check('adaptation_events_kind_chk', sql`${t.kind} in ('progress','hold','reduce','reschedule','skip','deload','readiness','manual','plan')`),
    ...ownerPolicies('adaptation_events', t.user_id),
  ],
);

/* ---------------- typy wierszy (kształt JSON z Data API) ---------------- */

export type ProfileRow = typeof profiles.$inferSelect;
export type TrainingCycleRow = typeof trainingCycles.$inferSelect;
export type PlannedWorkoutRow = typeof plannedWorkouts.$inferSelect;
export type WorkoutSessionRow = typeof workoutSessions.$inferSelect;
export type RouteLogRow = typeof routeLogs.$inferSelect;
export type HangboardLogRow = typeof hangboardLogs.$inferSelect;
export type AssessmentSessionRow = typeof assessmentSessions.$inferSelect;
export type AssessmentResultRow = typeof assessmentResults.$inferSelect;
export type RecoveryMeasurementRow = typeof recoveryMeasurements.$inferSelect;
export type ReadinessCheckRow = typeof readinessChecks.$inferSelect;
export type AdaptationEventRow = typeof adaptationEvents.$inferSelect;

/** Wiersz wysyłany przez klienta: bez user_id (nadaje go baza z JWT) i bez kolumn generowanych */
export type WriteRow<T> = Omit<T, 'user_id' | 'total_load_kg' | 'successful' | 'pain_present'>;
