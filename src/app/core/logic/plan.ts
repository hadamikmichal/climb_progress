import { AssessmentPart } from '../models/assessment';
import { ISODate, PlannedWorkout, TrainingCycle, TrainingParams, TrainingType, UserProfile, Weekday, WorkoutType } from '../models/models';
import { addDays, diffDays, startOfWeek } from './dates';
import { uid } from './ids';
import { shiftGrade } from './grades';
import { isHeavy } from './templates';

export const CYCLE_WEEKS = 6;
export const DELOAD_WEEKS = [4];
export const CONTROL_AFTER_WEEKS = [3];

const TRAINING_TYPES: TrainingType[] = ['A', 'B', 'C'];

/**
 * Tworzy nowy cykl w fazie testu początkowego. Plan 6-tygodniowy generowany jest
 * dopiero po zapisaniu testu (generateCyclePlan).
 */
export function createCycle(name: string, baselineDate: ISODate, params: TrainingParams, ts: string): TrainingCycle {
  return {
    id: uid(),
    name,
    status: 'baseline',
    createdAt: ts,
    updatedAt: ts,
    baselineDate,
    planStart: null,
    weeks: CYCLE_WEEKS,
    deloadWeeks: [...DELOAD_WEEKS],
    controlTestAfterWeeks: [...CONTROL_AFTER_WEEKS],
    params: structuredClone(params),
    initialParams: structuredClone(params),
  };
}

/** Odstęp między dniem 1 (siła) a dniem 2 (drogi) Baseline Testu – min. 48 h */
export const BASELINE_DAY_GAP = 2;

/** Baseline Test v1.0 = dwie sesje: Strength Assessment i Climbing Performance (≥ 48 h później) */
export function baselinePlanned(cycle: TrainingCycle, ts: string): PlannedWorkout[] {
  return [
    planned(cycle.id, 'BASELINE', 0, cycle.baselineDate, 0, ts, 'strength'),
    planned(cycle.id, 'BASELINE', 0, addDays(cycle.baselineDate, BASELINE_DAY_GAP), 0, ts, 'climbing'),
  ];
}

function planned(cycleId: string, type: WorkoutType, week: number, date: ISODate, order: number, ts: string, part?: AssessmentPart): PlannedWorkout {
  const p: PlannedWorkout = { id: uid(), cycleId, type, week, date, originalDate: date, order, status: 'planned', moves: [], createdAt: ts, updatedAt: ts };
  if (part) p.part = part;
  return p;
}

/**
 * Migracja planów sprzed Baseline Test v1.0: niezrealizowane testy w starym formacie (3 × 6a)
 * zamieniamy na nowy protokół. Test początkowy/końcowy → dwie sesje, test kontrolny → 3 × 6a z pomiarem czasu.
 * Zrealizowane testy zostają bez zmian (historia).
 */
export function migrateLegacyPlanned(items: PlannedWorkout[], ts: string): PlannedWorkout[] {
  const out: PlannedWorkout[] = [];
  for (const p of items) {
    if (p.part || (p.status !== 'planned' && p.status !== 'moved')) continue;
    if (p.type === 'CONTROL') out.push({ ...p, part: 'climbing', updatedAt: ts });
    if (p.type === 'BASELINE' || p.type === 'FINAL') {
      out.push({ ...p, part: 'strength', updatedAt: ts });
      out.push(planned(p.cycleId, p.type, p.week, addDays(p.date, BASELINE_DAY_GAP), p.order, ts, 'climbing'));
    }
  }
  return out;
}

export function dateForWeekday(planStart: ISODate, week: number, day: Weekday): ISODate {
  return addDays(planStart, (week - 1) * 7 + (day - 1));
}

/**
 * Generuje plan: tygodnie 1..N z treningami A/B/C w skonfigurowane dni,
 * test kontrolny na początku treningu B w tygodniu po tygodniu kontrolnym
 * (test przed sesją, nie zamiast niej) oraz test końcowy w tygodniu N+1.
 */
export function generateCyclePlan(cycle: TrainingCycle, profile: UserProfile, planStart: ISODate, ts: string): PlannedWorkout[] {
  const out: PlannedWorkout[] = [];
  const days = profile.trainingDays;
  for (let week = 1; week <= cycle.weeks; week++) {
    for (const t of TRAINING_TYPES) {
      out.push(planned(cycle.id, t, week, dateForWeekday(planStart, week, days[t]), 1, ts));
    }
  }
  for (const after of cycle.controlTestAfterWeeks) {
    const week = after + 1;
    if (week > cycle.weeks) continue;
    out.push(planned(cycle.id, 'CONTROL', week, dateForWeekday(planStart, week, days.B), 0, ts, 'climbing'));
  }
  const firstDay = Math.min(days.A, days.B, days.C) as Weekday;
  const finalDate = dateForWeekday(planStart, cycle.weeks + 1, firstDay);
  out.push(planned(cycle.id, 'FINAL', cycle.weeks + 1, finalDate, 0, ts, 'strength'));
  out.push(planned(cycle.id, 'FINAL', cycle.weeks + 1, addDays(finalDate, BASELINE_DAY_GAP), 0, ts, 'climbing'));
  return out.sort(comparePlanned);
}

export function comparePlanned(a: PlannedWorkout, b: PlannedWorkout): number {
  return a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1;
}

/** Pierwszy poniedziałek po teście początkowym, z co najmniej jednym dniem odpoczynku. */
export function suggestPlanStart(baselineDoneDate: ISODate, firstTrainingDay: Weekday = 1): ISODate {
  let monday = addDays(startOfWeek(baselineDoneDate), 7);
  while (diffDays(baselineDoneDate, addDays(monday, firstTrainingDay - 1)) < 2) monday = addDays(monday, 7);
  return monday;
}

/** 0 = faza testu początkowego, 1..weeks = tydzień cyklu, weeks+1 = test końcowy / po cyklu */
export function cycleWeek(cycle: TrainingCycle, date: ISODate): number {
  if (!cycle.planStart) return 0;
  const d = diffDays(cycle.planStart, date);
  if (d < 0) return 0;
  return Math.min(cycle.weeks + 1, Math.floor(d / 7) + 1);
}

export function weekStart(cycle: TrainingCycle, week: number): ISODate | null {
  return cycle.planStart ? addDays(cycle.planStart, (week - 1) * 7) : null;
}

export function isDeloadWeek(cycle: TrainingCycle, week: number): boolean {
  return cycle.deloadWeeks.includes(week);
}

export function stageLabel(cycle: TrainingCycle, week: number): string {
  if (cycle.status === 'completed' || cycle.status === 'archived') return 'Cykl zakończony';
  if (week === 0) return 'Test początkowy';
  if (week > cycle.weeks) return 'Test końcowy';
  if (isDeloadWeek(cycle, week)) return 'Deload + test kontrolny';
  const firstDeload = Math.min(...cycle.deloadWeeks, cycle.weeks + 1);
  return week < firstDeload ? 'Blok 1 – budowa bazy' : 'Blok 2 – rozwój';
}

/** Objętość w tygodniu deload: −40–50% (zaokrąglenie do najbliższej liczby całkowitej, nie mniej niż min) */
export function deloadVolume(n: number, min = 1): number {
  return Math.max(min, Math.min(n, Math.round(n * 0.55)));
}

/**
 * Deload: objętość −40–50%, bez prób maksymalnych, priorytetem jest regeneracja.
 * Obciążenie (ciężar zwisów, trudność) bez zmian – zmniejszamy tylko liczbę serii, dróg i prób.
 * Parametry cyklu nie są zmieniane: po deloadzie trening wraca do ostatniego dobrze tolerowanego poziomu.
 */
export function deloadParams(p: TrainingParams): TrainingParams {
  const d = structuredClone(p);
  d.hangboard.sets = deloadVolume(p.hangboard.sets, 1);
  d.hardRoutes.maxAttempts = deloadVolume(p.hardRoutes.maxAttempts, 2);
  d.aerobic.routes = deloadVolume(p.aerobic.routes, 2);
  d.powerEndurance.sets = deloadVolume(p.powerEndurance.sets, 1);
  return d;
}

/** Wersja „lżej” przy obniżonej gotowości – jak deload, plus niższa trudność dróg tlenowych */
export function easyParams(p: TrainingParams): TrainingParams {
  const d = deloadParams(p);
  d.aerobic.grade = shiftGrade(p.aerobic.grade, -1);
  return d;
}

export function prescriptionFor(cycle: TrainingCycle, week: number): { params: TrainingParams; deload: boolean } {
  const deload = isDeloadWeek(cycle, week);
  return { params: deload ? deloadParams(cycle.params) : structuredClone(cycle.params), deload };
}

/** Walidacja dni treningowych – ciężkie jednostki nie mogą wypadać dzień po dniu (również przez weekend). */
export function validateTrainingDays(days: Record<TrainingType, Weekday>): string[] {
  const msgs: string[] = [];
  const vals = Object.values(days);
  if (new Set(vals).size !== vals.length) msgs.push('Każdy trening musi mieć inny dzień tygodnia.');
  const heavy = TRAINING_TYPES.filter((t) => isHeavy(t)).map((t) => days[t]);
  for (let i = 0; i < heavy.length; i++) {
    for (let j = i + 1; j < heavy.length; j++) {
      const diff = Math.abs(heavy[i] - heavy[j]);
      if (diff === 1 || diff === 6) {
        msgs.push('Ciężkie treningi (A – trudne drogi, B – Max Hangs, C – obwody) nie mogą być dzień po dniu – potrzebny co najmniej 1 dzień przerwy.');
      }
    }
  }
  return [...new Set(msgs)];
}

/** Przelicza daty przyszłych, niezrealizowanych treningów po zmianie dni treningowych */
export function redistributeFuture(
  items: PlannedWorkout[],
  cycle: TrainingCycle,
  days: Record<TrainingType, Weekday>,
  from: ISODate,
  ts: string,
): PlannedWorkout[] {
  if (!cycle.planStart) return [];
  const changed: PlannedWorkout[] = [];
  for (const p of items) {
    if (p.cycleId !== cycle.id || p.status !== 'planned' || p.date < from) continue;
    let day: Weekday;
    if (p.type === 'A' || p.type === 'B' || p.type === 'C') day = days[p.type];
    else if (p.type === 'CONTROL') day = days.B;
    else if (p.type === 'FINAL') day = Math.min(days.A, days.B, days.C) as Weekday;
    else continue;
    let date = dateForWeekday(cycle.planStart, p.week, day);
    if (p.type === 'FINAL' && p.part === 'climbing') date = addDays(date, BASELINE_DAY_GAP);
    if (date !== p.date && date >= from) {
      changed.push({ ...p, date, originalDate: date, updatedAt: ts });
    }
  }
  return changed;
}
