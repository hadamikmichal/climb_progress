import {
  AscentStyle, CompletedWorkout, ExerciseLog, GripPosition, HoldType, PlannedWorkout, RouteLog, SetLog, TrainingCycle, TrainingParams, TrainingType,
} from '../../core/models/models';
import { uid } from '../../core/logic/ids';
import { TEMPLATES } from '../../core/logic/templates';
import { PhaseTimer, startTimer, timerDone, timerEndMs } from '../../core/logic/timer';

/** Stan drogi w trakcie sesji: jeszcze nie wspinana / ukończona / odpadnięcie */
export type RouteState = 'todo' | 'sent' | 'fell';

export interface DraftRoute {
  id: string;
  setIndex: number;
  grade: string;
  state: RouteState;
  pump: number | null;
  rpe: number | null;
  cruxSent: boolean | null;
  ascent?: AscentStyle | null;
  notes: string;
  timestamp: string;
}

export interface DraftHang {
  holdType: HoldType;
  edge: string;
  edgeSizeMm: number | null;
  grip: GripPosition;
  hangSec: number;
  addedKg: number;
  assistKg: number;
  setsPlanned: number;
  setsDone: number;
  rpe: number | null;
  pain: boolean | null;
  notes: string;
  /** Zwisy zablokowane (ból / gotowość) */
  blocked: boolean;
}

export interface WorkoutDraft {
  plannedId: string;
  type: TrainingType;
  startedAt: string;
  /** Lżejsza wersja wybrana z powodu obniżonej gotowości – nie liczy się do progresji */
  light: boolean;
  deload: boolean;
  params: TrainingParams;
  exercises: ExerciseLog[];
  routes: DraftRoute[];
  hang: DraftHang | null;
  sets: SetLog[];
  /** Aktywna seria obwodu (C) */
  currentSet: number;
  rpe: number | null;
  pump: number | null;
  technique: number | null;
  feelingAfter: number | null;
  notes: string;
  durationMin: number | null;
  forcePartial: boolean;
  /** Aktualny krok (indeks ćwiczenia w szablonie) w trybie aktywnego treningu */
  step?: number;
  /** Bieżąca faza timera – znaczniki czasu, odtwarzane po odświeżeniu */
  timer?: PhaseTimer | null;
}

export function newDraft(p: PlannedWorkout, params: TrainingParams, deload: boolean, light: boolean, ts: string, hangBlocked: boolean): WorkoutDraft {
  const type = p.type as TrainingType;
  const t = TEMPLATES[type];
  const routes: DraftRoute[] = [];
  const mk = (setIndex: number, grade: string): DraftRoute => ({ id: uid(), setIndex, grade, state: 'todo', pump: null, rpe: null, cruxSent: null, notes: '', timestamp: ts });
  if (type === 'B') for (let i = 0; i < params.aerobic.routes; i++) routes.push(mk(0, params.aerobic.grade));
  if (type === 'C') {
    for (let s = 1; s <= params.powerEndurance.sets; s++) for (let i = 0; i < params.powerEndurance.routesPerSet; i++) routes.push(mk(s, params.powerEndurance.grade));
  }
  const h = params.hangboard;
  return {
    plannedId: p.id,
    type,
    startedAt: ts,
    light,
    deload,
    params,
    exercises: t.exercises.map((e) => ({ exerciseId: e.id, name: e.name, kind: e.kind, done: false, checked: [] })),
    routes,
    hang: t.exercises.some((e) => e.kind === 'hangboard')
      ? { holdType: h.holdType, edge: h.edge, edgeSizeMm: h.edgeSizeMm, grip: h.grip, hangSec: h.hangSec, addedKg: h.addedKg, assistKg: h.assistKg, setsPlanned: h.sets, setsDone: 0, rpe: null, pain: null, notes: '', blocked: hangBlocked }
      : null,
    sets: type === 'C' ? Array.from({ length: params.powerEndurance.sets }, (_, i) => ({ setIndex: i + 1, rpe: null, pump: null, notes: '' })) : [],
    currentSet: 1,
    rpe: null,
    pump: null,
    technique: null,
    feelingAfter: null,
    notes: '',
    durationMin: null,
    forcePartial: false,
    step: 0,
    timer: null,
  };
}

/** Co nie zostało wykonane – podstawa do rozróżnienia treningu pełnego i częściowego */
export function missingParts(d: WorkoutDraft): string[] {
  const out: string[] = [];
  for (const e of d.exercises) {
    if (e.kind === 'technique') continue;
    if (e.kind === 'hangboard') {
      if (!d.hang || d.hang.blocked) out.push('Zwisy pominięte');
      else if (d.hang.setsDone < d.hang.setsPlanned) out.push(`Zwisy: ${d.hang.setsDone}/${d.hang.setsPlanned} serii`);
      continue;
    }
    if (e.kind === 'routes' || e.kind === 'circuit') {
      const todo = d.routes.filter((r) => r.state === 'todo').length;
      if (todo) out.push(`${e.name}: ${todo} ${todo === 1 ? 'droga niewspinana' : 'dróg niewspinanych'}`);
      continue;
    }
    if (e.kind === 'hard_routes') {
      if (!d.routes.length) out.push('Trudne drogi: brak zapisanych prób');
      continue;
    }
    if (!e.done) out.push(`${e.name}: nieodhaczone`);
  }
  return out;
}

export function draftToCompleted(d: WorkoutDraft, p: PlannedWorkout, cycle: TrainingCycle, finishedAt: string, date: string): CompletedWorkout {
  const missing = missingParts(d);
  const elapsed = Math.max(1, Math.round((Date.parse(finishedAt) - Date.parse(d.startedAt)) / 60000));
  const routes: RouteLog[] = d.routes
    .filter((r) => r.state !== 'todo')
    .map((r, i) => ({
      id: r.id, order: i + 1, setIndex: r.setIndex, grade: r.grade, lengthM: 13, completed: r.state === 'sent',
      pump: r.pump, rpe: r.rpe, cruxSent: r.cruxSent, ascent: r.state === 'sent' ? r.ascent ?? null : null, notes: r.notes, timestamp: r.timestamp,
    }));
  const h = d.hang;
  const hangs = h && !h.blocked && h.setsDone > 0
    ? [{
      id: uid(), date, board: 'Beastmaker 2000', holdType: h.holdType, edge: h.edge, edgeSizeMm: h.edgeSizeMm, grip: h.grip, hangSec: h.hangSec,
      setsPlanned: h.setsPlanned, setsDone: h.setsDone, addedKg: h.addedKg, assistKg: h.assistKg, rpe: h.rpe, pain: !!h.pain, notes: h.notes, timestamp: finishedAt,
    }]
    : [];
  // Zapisujemy rzeczywiście wykonane parametry zwisu w snapshocie (krawądka/obciążenie mogły zostać zmienione na miejscu)
  const prescription = structuredClone(d.params);
  return {
    id: uid(),
    plannedWorkoutId: p.id,
    cycleId: cycle.id,
    type: d.type,
    week: p.week,
    deload: d.deload || d.light,
    date,
    startedAt: d.startedAt,
    finishedAt,
    durationMin: d.durationMin ?? elapsed,
    completion: missing.length || d.forcePartial ? 'partial' : 'full',
    prescription,
    exercises: d.exercises.map((e) => ({
      ...e,
      done: e.kind === 'hangboard' ? !!h && !h.blocked && h.setsDone >= h.setsPlanned
        : e.kind === 'routes' || e.kind === 'circuit' ? d.routes.length > 0 && d.routes.every((r) => r.state !== 'todo')
          : e.kind === 'hard_routes' ? d.routes.length > 0 : e.done,
    })),
    routes,
    hangs,
    sets: d.sets,
    rpe: d.rpe,
    pump: d.pump,
    technique: d.technique,
    feelingAfter: d.feelingAfter,
    notes: d.notes,
    createdAt: finishedAt,
    updatedAt: finishedAt,
  };
}

export function elapsedMin(startedAt: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(startedAt)) / 60000));
}


/* ---------------- timer faz (Active Workout Mode) ---------------- */

export const HARD_ROUTE_REST_SEC = 240;

/** Start zwisu – faza pracy o długości z parametrów (lub z korekty na miejscu) */
export function startHang(d: WorkoutDraft, at: string): void {
  if (!d.hang || d.hang.blocked || d.hang.setsDone >= d.hang.setsPlanned) return;
  d.timer = startTimer('work', 'Zwis', d.hang.hangSec, at);
}

/** Przerwa po drodze / próbie / serii */
export function startRest(d: WorkoutDraft, label: string, sec: number, at: string): void {
  d.timer = startTimer('rest', label, sec, at);
}

/**
 * Deterministyczne „dogonienie” zegara: zakończony zwis zalicza serię i od razu (od momentu końca zwisu)
 * uruchamia przerwę; zakończona przerwa czyści timer. Działa tak samo na żywo i po powrocie do aplikacji.
 * @returns true, jeśli stan się zmienił
 */
export function advanceTimers(d: WorkoutDraft, nowMs: number): boolean {
  let changed = false;
  for (let guard = 0; guard < 4 && d.timer && timerDone(d.timer, nowMs); guard++) {
    const t = d.timer;
    changed = true;
    if (t.kind === 'work' && d.hang) {
      d.hang.setsDone = Math.min(d.hang.setsPlanned, d.hang.setsDone + 1);
      d.timer = d.hang.setsDone < d.hang.setsPlanned
        ? startTimer('rest', 'Przerwa między seriami', d.params.hangboard.restSec, new Date(timerEndMs(t)).toISOString())
        : null;
    } else {
      d.timer = null;
    }
  }
  return changed;
}
