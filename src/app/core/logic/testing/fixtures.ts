import { CompletedWorkout, HangboardLog, PlannedWorkout, RouteLog, TrainingParams, TrainingType, WorkoutType } from '../../models/models';
import { defaultProfile, initialParams } from '../templates';

export const P0: TrainingParams = initialParams(defaultProfile('2026-01-01T00:00:00Z'));

let n = 0;
export function route(o: Partial<RouteLog> = {}): RouteLog {
  return { id: `r${++n}`, order: n, setIndex: 0, grade: '5c+', lengthM: 13, completed: true, pump: 3, rpe: 6, notes: '', timestamp: '', ...o };
}

export function hang(o: Partial<HangboardLog> = {}): HangboardLog {
  const h = P0.hangboard;
  return {
    id: `h${++n}`, date: '2026-01-05', board: 'Beastmaker 2000', holdType: h.holdType, edge: h.edge, edgeSizeMm: null, grip: h.grip,
    hangSec: h.hangSec, setsPlanned: h.sets, setsDone: h.sets, addedKg: 0, assistKg: 0, rpe: 8, pain: false, notes: '', timestamp: '', ...o,
  };
}

/** Trening dobrze wykonany zgodnie z prescription */
export function workout(type: TrainingType, date: string, params: TrainingParams = P0, o: Partial<CompletedWorkout> = {}): CompletedWorkout {
  let routes: RouteLog[] = [];
  let hangs: HangboardLog[] = [];
  if (type === 'B') hangs = [hang({ date, setsPlanned: params.hangboard.sets, setsDone: params.hangboard.sets, addedKg: params.hangboard.addedKg, assistKg: params.hangboard.assistKg })];
  if (type === 'B') routes = Array.from({ length: params.aerobic.routes }, () => route({ grade: params.aerobic.grade, pump: 3 }));
  if (type === 'C') {
    const pe = params.powerEndurance;
    for (let s = 1; s <= pe.sets; s++) for (let i = 0; i < pe.routesPerSet; i++) routes.push(route({ setIndex: s, grade: pe.grade, pump: 6 }));
  }
  return {
    id: `w${++n}`, plannedWorkoutId: null, cycleId: 'c1', type, week: 1, deload: false, date,
    startedAt: `${date}T10:00:00Z`, finishedAt: `${date}T11:30:00Z`, durationMin: 90, completion: 'full',
    prescription: structuredClone(params), exercises: [], routes, hangs, sets: [],
    rpe: type === 'B' ? 5 : 7, pump: null, technique: 4, feelingAfter: 4, notes: '', createdAt: '', updatedAt: '', ...o,
  };
}

export function plannedItem(type: WorkoutType, date: string, o: Partial<PlannedWorkout> = {}): PlannedWorkout {
  return { id: `p${++n}`, cycleId: 'c1', type, week: 1, date, originalDate: date, order: 1, status: 'planned', moves: [], createdAt: '', updatedAt: '', ...o };
}
