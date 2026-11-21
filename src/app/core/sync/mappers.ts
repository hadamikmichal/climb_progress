/**
 * Mapowanie model aplikacji ↔ wiersze tabel Neon (czyste funkcje, bez Angulara).
 *
 * Kierunek „do bazy” nigdy nie wysyła `user_id` – nadaje go Postgres z `auth.user_id()` (JWT Neon Auth).
 * Kierunek „z bazy” normalizuje znaczniki czasu do `toISOString()` (Postgres zwraca `+00:00` i mikrosekundy),
 * bo logika aplikacji porównuje znaczniki jako napisy.
 */
import type {
  AdaptationEventRow, AssessmentResultRow, AssessmentSessionRow, HangboardLogRow, JsonValue, PlannedWorkoutRow, ProfileRow, ReadinessCheckRow,
  RecoveryMeasurementRow, RouteLogRow, TrainingCycleRow, WorkoutSessionRow, WriteRow,
} from '../../../../db/schema';
import {
  AdaptationEvent, CompletedWorkout, HangboardLog, PlannedWorkout, ReadinessCheck, RouteLog, TestResult, TrainingCycle, UserProfile,
} from '../models/models';
import { Assessment, PROTOCOL_VERSION } from '../models/assessment';
import { strengthResults } from '../logic/assessment/scoring';
import { addDays } from '../logic/dates';

export const LEGACY_TEST_PROTOCOL = 'legacy-3x6a';

/* ---------------- pomocnicze ---------------- */

const json = <T>(v: T): JsonValue => JSON.parse(JSON.stringify(v ?? null)) as JsonValue;
const back = <T>(v: unknown): T => v as T;
/** Znacznik czasu w formacie aplikacji */
export const iso = (v: string | null | undefined): string => (v ? new Date(v).toISOString() : '');
/** Usuwa klucze o wartości undefined (pola opcjonalne modelu) */
function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}
const opt = <T>(v: T | null | undefined): T | undefined => (v == null ? undefined : v);

/* ---------------- profiles ---------------- */

export type ProfileWrite = Omit<WriteRow<ProfileRow>, 'id'>;

export function profileToRow(p: UserProfile): ProfileWrite {
  return {
    display_name: p.name,
    climbing_level: p.grade,
    target_grade: p.targetGrade,
    height_cm: p.heightCm,
    body_mass_kg: p.weightKg,
    route_length_m: p.routeLengthM,
    preferred_training_days: { ...p.trainingDays },
    hangboard: json(p.hangboard),
    intake: p.intake ? json(p.intake) : null,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

export function rowToProfile(r: ProfileRow): UserProfile {
  return clean({
    id: 'me' as const,
    name: r.display_name,
    heightCm: r.height_cm ?? 0,
    weightKg: r.body_mass_kg ?? 0,
    grade: r.climbing_level ?? '',
    targetGrade: r.target_grade ?? '',
    routeLengthM: r.route_length_m ?? 0,
    trainingDays: back<UserProfile['trainingDays']>(r.preferred_training_days),
    hangboard: back<UserProfile['hangboard']>(r.hangboard),
    intake: opt(back<UserProfile['intake'] | null>(r.intake)),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  });
}

/* ---------------- training_cycles ---------------- */

export function cycleToRow(c: TrainingCycle): WriteRow<TrainingCycleRow> {
  return {
    id: c.id,
    name: c.name,
    start_date: c.baselineDate,
    end_date: c.planStart ? addDays(c.planStart, c.weeks * 7 - 1) : null,
    plan_start: c.planStart,
    weeks: c.weeks,
    status: c.status,
    protocol_version: PROTOCOL_VERSION,
    goal_grade: c.goalGrade ?? null,
    deload_weeks: [...c.deloadWeeks],
    control_test_after_weeks: [...c.controlTestAfterWeeks],
    params: json(c.params),
    initial_params: json(c.initialParams),
    calibration: c.calibration ? json(c.calibration) : null,
    benchmark: c.benchmark ? json(c.benchmark) : null,
    extra_benchmarks: c.extraBenchmarks ? json(c.extraBenchmarks) : null,
    abilities: c.abilities ? json(c.abilities) : null,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

export function rowToCycle(r: TrainingCycleRow): TrainingCycle {
  return clean({
    id: r.id,
    name: r.name,
    status: r.status as TrainingCycle['status'],
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    baselineDate: r.start_date,
    planStart: r.plan_start,
    weeks: r.weeks,
    deloadWeeks: r.deload_weeks,
    controlTestAfterWeeks: r.control_test_after_weeks,
    params: back<TrainingCycle['params']>(r.params),
    initialParams: back<TrainingCycle['initialParams']>(r.initial_params),
    calibration: opt(back<TrainingCycle['calibration'] | null>(r.calibration)),
    benchmark: opt(back<TrainingCycle['benchmark'] | null>(r.benchmark)),
    extraBenchmarks: opt(back<TrainingCycle['extraBenchmarks'] | null>(r.extra_benchmarks)),
    abilities: opt(back<TrainingCycle['abilities'] | null>(r.abilities)),
    goalGrade: opt(r.goal_grade),
  });
}

/* ---------------- planned_workouts ---------------- */

interface PlanData {
  moves: PlannedWorkout['moves'];
  skipReason?: PlannedWorkout['skipReason'] | null;
  skipNote?: string | null;
}

export function plannedToRow(p: PlannedWorkout): WriteRow<PlannedWorkoutRow> {
  const data: PlanData = { moves: p.moves, skipReason: p.skipReason ?? null, skipNote: p.skipNote ?? null };
  return {
    id: p.id,
    cycle_id: p.cycleId,
    scheduled_date: p.date,
    original_date: p.originalDate,
    week: p.week,
    sort_order: p.order,
    workout_type: p.type,
    part: p.part ?? null,
    status: p.status,
    plan_data: json(data),
    completed_ref: p.completedWorkoutId ?? null,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

export function rowToPlanned(r: PlannedWorkoutRow): PlannedWorkout {
  const d = back<PlanData>(r.plan_data);
  return clean({
    id: r.id,
    cycleId: r.cycle_id,
    type: r.workout_type as PlannedWorkout['type'],
    week: r.week,
    date: r.scheduled_date,
    originalDate: r.original_date,
    order: r.sort_order,
    part: opt(r.part as PlannedWorkout['part'] | null),
    status: r.status as PlannedWorkout['status'],
    skipReason: opt(d.skipReason),
    skipNote: opt(d.skipNote),
    moves: d.moves ?? [],
    completedWorkoutId: opt(r.completed_ref),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  });
}

/* ---------------- workout_sessions + route_logs + hangboard_logs ---------------- */

export interface WorkoutRows {
  session: WriteRow<WorkoutSessionRow>;
  routes: WriteRow<RouteLogRow>[];
  hangs: WriteRow<HangboardLogRow>[];
}

export function workoutToRows(w: CompletedWorkout): WorkoutRows {
  const attemptsSeen = new Map<string, number>();
  const routes = w.routes.map((r): WriteRow<RouteLogRow> => {
    // Kolejna próba na tej samej trudności w tej samej serii (np. kilka prób trudnej drogi w treningu A)
    const key = `${r.setIndex}|${r.grade}`;
    const n = (attemptsSeen.get(key) ?? 0) + 1;
    attemptsSeen.set(key, n);
    return {
      id: r.id,
      workout_session_id: w.id,
      route_order: r.order,
      set_index: r.setIndex,
      route_name: r.project?.trim() || null,
      grade: r.grade,
      height_meters: r.lengthM,
      wall_style: null,
      ascent_time_seconds: null,
      completed: r.completed,
      attempt_number: n,
      rpe: r.rpe,
      forearm_pump: r.pump,
      technique_degradation: r.techniqueDegraded ?? null,
      crux_sent: r.cruxSent ?? null,
      ascent_style: r.ascent ?? null,
      notes: r.notes,
      logged_at: r.timestamp,
    };
  });
  const protocol = w.prescription?.hangboard?.protocol ?? 'max_hangs';
  const hangs = w.hangs.map((h): WriteRow<HangboardLogRow> => ({
    id: h.id,
    workout_session_id: w.id,
    session_date: h.date,
    board: h.board,
    protocol,
    hold_type: h.holdType,
    edge_label: h.edge,
    edge_depth_mm: h.edgeSizeMm,
    grip_type: h.grip,
    hold_duration_seconds: h.hangSec,
    sets_planned: h.setsPlanned,
    sets_done: h.setsDone,
    added_weight_kg: h.addedKg,
    assistance_kg: h.assistKg,
    body_mass_kg: h.bodyMassKg ?? null,
    pain: h.pain,
    rpe: h.rpe,
    hold_times_seconds: h.holdTimes ?? null,
    technique_ok: h.techniqueOk ?? null,
    notes: h.notes,
    created_at: h.timestamp,
  }));
  return {
    session: {
      id: w.id,
      cycle_id: w.cycleId,
      planned_workout_id: w.plannedWorkoutId,
      workout_type: w.type,
      week: w.week,
      deload: w.deload,
      session_date: w.date,
      started_at: w.startedAt,
      completed_at: w.finishedAt,
      duration_seconds: Math.round(w.durationMin * 60),
      status: w.completion,
      rpe: w.rpe,
      forearm_pump: w.pump,
      technique: w.technique,
      feeling_after: w.feelingAfter,
      follow_up: w.followUp ? json(w.followUp) : null,
      notes: w.notes,
      prescription: json(w.prescription),
      exercises: json(w.exercises),
      sets: json(w.sets),
      created_at: w.createdAt,
      updated_at: w.updatedAt,
    },
    routes,
    hangs,
  };
}

export function rowToRoute(r: RouteLogRow): RouteLog {
  return clean({
    id: r.id,
    order: r.route_order,
    setIndex: r.set_index,
    grade: r.grade,
    lengthM: r.height_meters ?? 0,
    completed: r.completed,
    pump: r.forearm_pump,
    rpe: r.rpe,
    project: opt(r.route_name),
    cruxSent: r.crux_sent,
    techniqueDegraded: r.technique_degradation,
    ascent: r.ascent_style as RouteLog['ascent'],
    notes: r.notes,
    timestamp: iso(r.logged_at),
  });
}

export function rowToHang(r: HangboardLogRow): HangboardLog {
  return clean({
    id: r.id,
    date: r.session_date,
    board: r.board,
    holdType: r.hold_type as HangboardLog['holdType'],
    edge: r.edge_label,
    edgeSizeMm: r.edge_depth_mm,
    grip: r.grip_type as HangboardLog['grip'],
    hangSec: r.hold_duration_seconds,
    setsPlanned: r.sets_planned,
    setsDone: r.sets_done,
    addedKg: r.added_weight_kg,
    assistKg: r.assistance_kg,
    rpe: r.rpe,
    pain: r.pain,
    notes: r.notes,
    timestamp: iso(r.created_at),
    bodyMassKg: opt(r.body_mass_kg),
    holdTimes: opt(r.hold_times_seconds),
    techniqueOk: opt(r.technique_ok),
  });
}

export function rowsToWorkout(s: WorkoutSessionRow, routes: RouteLogRow[], hangs: HangboardLogRow[]): CompletedWorkout {
  return {
    id: s.id,
    plannedWorkoutId: s.planned_workout_id,
    cycleId: s.cycle_id,
    type: s.workout_type as CompletedWorkout['type'],
    week: s.week,
    deload: s.deload,
    date: s.session_date,
    startedAt: iso(s.started_at),
    finishedAt: iso(s.completed_at),
    durationMin: s.duration_seconds / 60,
    completion: s.status as CompletedWorkout['completion'],
    prescription: back<CompletedWorkout['prescription']>(s.prescription),
    exercises: back<CompletedWorkout['exercises']>(s.exercises),
    routes: routes.map(rowToRoute).sort((a, b) => a.order - b.order),
    hangs: hangs.map(rowToHang).sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1)),
    sets: back<CompletedWorkout['sets']>(s.sets),
    rpe: s.rpe,
    pump: s.forearm_pump,
    technique: s.technique,
    feelingAfter: s.feeling_after,
    ...(s.follow_up ? { followUp: back<CompletedWorkout['followUp']>(s.follow_up) } : {}),
    notes: s.notes,
    createdAt: iso(s.created_at),
    updatedAt: iso(s.updated_at),
  };
}

/* ---------------- assessment_sessions + assessment_results + recovery_measurements ---------------- */

export interface AssessmentRows {
  session: WriteRow<AssessmentSessionRow>;
  results: Omit<WriteRow<AssessmentResultRow>, 'id' | 'created_at'>[];
  recovery: Omit<WriteRow<RecoveryMeasurementRow>, 'id' | 'created_at'>[];
}

type ResultInput = Omit<WriteRow<AssessmentResultRow>, 'id' | 'created_at' | 'assessment_session_id'>;

/** Wyniki Baseline Test rozpisane na pomiary – do historii i zapytań analitycznych w SQL */
export function assessmentResultRows(a: Assessment): ResultInput[] {
  const out: ResultInput[] = [];
  const add = (category: string, metric_key: string, value: number | null | undefined, unit: string, attempt_number: number | null, metadata: object = {}) =>
    out.push({ category, metric_key, value_numeric: value ?? null, unit, attempt_number, metadata: json(metadata) });

  const s = a.strength;
  if (s) {
    s.weightedPullUp.attempts.forEach((t, i) =>
      add('strength', 'pullup.added_weight_kg', t.addedWeightKg, 'kg', i + 1, { reps: t.reps, successful: t.successful, techniqueValid: t.techniqueValid, rpe: t.rpe }));
    const f = s.maxFingerStrength;
    f.attempts.forEach((t, i) =>
      add('strength', 'finger.added_weight_kg', t.addedWeightKg, 'kg', i + 1, {
        assistanceKg: t.assistanceKg, holdSeconds: t.holdSeconds, successful: t.successful, technicallyValid: t.technicallyValid, rpe: t.rpe,
        edgeDepthMm: f.edgeDepthMm, edgeLabel: f.edgeLabel, gripType: f.gripType,
      }));
    s.coreStrength.attempts.forEach((t, i) => add('strength', 'core.hold_seconds', t.holdSeconds, 's', i + 1, { exercise: t.exercise, technicallyValid: t.technicallyValid }));
    if (s.deadHang.holdSeconds != null) {
      add('strength', 'dead_hang.hold_seconds', s.deadHang.holdSeconds, 's', null, { endReason: s.deadHang.endReason, barDiameterMm: s.deadHang.barDiameterMm, status: s.deadHang.status });
    }
    const r = strengthResults(s);
    add('score', 'body_mass_kg', r.bodyMassKg, 'kg', null);
    add('score', 'finger.total_load_kg', r.finger.totalLoadKg, 'kg', null, { status: r.finger.status });
    add('score', 'finger.body_mass_ratio_pct', r.finger.bodyMassRatioPercent, '%', null);
    add('score', 'pullup.total_load_kg', r.pullUp.totalLoadKg, 'kg', null, { reps: r.pullUp.reps, status: r.pullUp.status });
    add('score', 'pullup.body_mass_ratio_pct', r.pullUp.bodyMassRatioPercent, '%', null);
    add('score', 'nine_c.finger', r.nineC.fingerStrength, 'pkt', null);
    add('score', 'nine_c.pulling', r.nineC.pullingStrength, 'pkt', null);
    add('score', 'nine_c.core', r.nineC.coreStrength, 'pkt', null, { exercise: r.core.exercise, holdSeconds: r.core.holdSeconds });
    add('score', 'nine_c.endurance', r.nineC.endurance, 'pkt', null);
    add('score', 'nine_c.total', r.nineC.totalPoints, 'pkt', null, { isComplete: r.nineC.isComplete, estimatedGrade: r.nineC.estimatedGrade, maxPoints: r.nineC.maxPoints });
  }

  const c = a.climbing;
  if (c) {
    const route = { grade: c.route.frenchGrade, routeName: c.route.name, wallStyle: c.route.wallStyle, heightMeters: c.route.heightMeters, climbingStyle: c.route.climbingStyle };
    for (const t of c.attempts) {
      const meta = {
        ...route, status: t.status, completed: t.completed, failReason: t.failReason, techniqueDegraded: t.techniqueDegraded, problemMove: t.problemMove,
        failurePoint: t.failurePoint, restBeforeSeconds: t.restBeforeSeconds, saved: t.saved,
      };
      add('climbing', 'route.ascent_time_seconds', t.ascentTimeSeconds, 's', t.index, meta);
      add('climbing', 'route.rpe', t.rpe, '', t.index);
      add('climbing', 'route.forearm_pump', t.forearmPump, '', t.index);
    }
  }
  return out;
}

export function assessmentToRows(a: Assessment): AssessmentRows {
  const results = assessmentResultRows(a).map((r) => ({ ...r, assessment_session_id: a.id }));
  const recovery = (a.climbing?.recoveryCurve ?? []).map((m) => ({ assessment_session_id: a.id, elapsed_seconds: m.elapsedSeconds, forearm_pump: m.forearmPump }));
  return {
    session: {
      id: a.id,
      cycle_id: a.cycleId,
      assessment_type: a.kind,
      protocol_version: a.protocolVersion,
      status: a.status,
      started_at: a.strength?.startedAt ?? a.climbing?.startedAt ?? a.createdAt,
      completed_at: a.completedAt,
      body_mass_kg: a.strength?.readiness.bodyMassKg ?? a.climbing?.readiness.bodyMassKg ?? null,
      notes: a.notes,
      payload: json(a),
      created_at: a.createdAt,
      updated_at: a.updatedAt,
    },
    results,
    recovery,
  };
}

/** Test w starym formacie 3 × 6a – ta sama tabela, inny protokół; bez wyników pochodnych */
export function legacyTestToRow(t: TestResult): WriteRow<AssessmentSessionRow> {
  return {
    id: t.id,
    cycle_id: t.cycleId,
    assessment_type: t.kind,
    protocol_version: LEGACY_TEST_PROTOCOL,
    status: 'completed',
    started_at: t.createdAt,
    completed_at: t.createdAt,
    body_mass_kg: null,
    notes: t.notes,
    payload: json(t),
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

export function rowToAssessment(r: AssessmentSessionRow): Assessment {
  return back<Assessment>(r.payload);
}

export function rowToLegacyTest(r: AssessmentSessionRow): TestResult {
  return back<TestResult>(r.payload);
}

/* ---------------- readiness_checks ---------------- */

export function readinessToRow(r: ReadinessCheck): WriteRow<ReadinessCheckRow> {
  return {
    id: r.id,
    check_date: r.date,
    checked_at: r.timestamp,
    sleep_quality: r.sleep,
    wellbeing: r.wellbeing,
    fatigue: r.fatigue,
    finger_pain: r.fingerPain,
    elbow_shoulder_pain: r.elbowShoulderPain,
    unusual_fatigue: r.unusualFatigue,
    notes: r.notes,
  };
}

export function rowToReadiness(r: ReadinessCheckRow): ReadinessCheck {
  return {
    id: r.id,
    date: r.check_date,
    timestamp: iso(r.checked_at),
    wellbeing: r.wellbeing,
    fatigue: r.fatigue,
    sleep: r.sleep_quality,
    fingerPain: r.finger_pain,
    elbowShoulderPain: r.elbow_shoulder_pain,
    unusualFatigue: r.unusual_fatigue,
    notes: r.notes,
  };
}

/* ---------------- adaptation_events ---------------- */

export function eventToRow(e: AdaptationEvent): WriteRow<AdaptationEventRow> {
  return {
    id: e.id,
    cycle_id: e.cycleId,
    occurred_at: e.timestamp,
    kind: e.kind,
    workout_type: e.workoutType ?? null,
    track: e.track ?? null,
    parameter: e.parameter ?? null,
    from_value: e.from ?? null,
    to_value: e.to ?? null,
    reason: e.reason,
    source_ids: [...e.sourceIds],
  };
}

export function rowToEvent(r: AdaptationEventRow): AdaptationEvent {
  return clean({
    id: r.id,
    cycleId: r.cycle_id,
    timestamp: iso(r.occurred_at),
    kind: r.kind as AdaptationEvent['kind'],
    workoutType: opt(r.workout_type as AdaptationEvent['workoutType'] | null),
    track: opt(r.track as AdaptationEvent['track'] | null),
    parameter: opt(r.parameter),
    from: opt(r.from_value),
    to: opt(r.to_value),
    reason: r.reason,
    sourceIds: r.source_ids ?? [],
  });
}

