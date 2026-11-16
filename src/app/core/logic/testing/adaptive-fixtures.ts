import { Assessment, ClimbingAssessment, RouteAttempt } from '../../models/assessment';
import { ClimberIntake, CompletedWorkout, PeProtocol, TrainingParams } from '../../models/models';
import { configureProtocol } from '../adaptive/protocols';
import { newAssessment, newClimbingSession, newStrengthSession } from '../assessment/factory';
import { P0, route, workout } from './fixtures';

/** Wyłącznie dane testowe – nie są używane poza testami jednostkowymi */

const TS = '2026-03-02T17:00:00.000Z';

export interface TrialSpec {
  done: boolean;
  rpe: number;
  pump: number;
  time?: number;
  degraded?: boolean;
}

export function attempts(specs: TrialSpec[]): RouteAttempt[] {
  return specs.map((s, i) => ({
    index: i + 1, status: s.done ? 'success' : 'failed', startedAt: TS, endedAt: TS, ascentTimeSeconds: s.time ?? 150 + i * 3,
    restBeforeSeconds: i ? 180 : null, completed: s.done, failReason: s.done ? null : 'fatigue', rpe: s.rpe, forearmPump: s.pump,
    techniqueDegraded: s.degraded ?? false, problemMove: false, failurePoint: '', notes: '', saved: true,
  }));
}

export function climbingTest(grade: string, specs: TrialSpec[], recovery: [number, number, number, number] = [6, 4, 2, 1]): ClimbingAssessment {
  const c = newClimbingSession('2026-03-04', TS, 70, specs.length, null);
  c.route = { ...c.route, name: 'Testowa', frenchGrade: grade };
  c.attempts = attempts(specs);
  c.recoveryCurve = c.recoveryCurve.map((m, i) => ({ ...m, forearmPump: recovery[i] }));
  c.status = 'completed';
  return c;
}

/** Baseline z wynikiem Max Hang (obciążenie dodatkowe względem masy) i opcjonalnym testem dróg */
export function baseline(o: { mass?: number; fingerAddedKg?: number; fingerAssistKg?: number; edgeMm?: number; climbing?: ClimbingAssessment | null }): Assessment {
  const mass = o.mass ?? 70;
  const a = newAssessment('a1', 'c1', 'BASELINE', TS);
  const s = newStrengthSession('2026-03-02', TS, mass, null, 'Krawądka 20 mm', o.edgeMm ?? 20);
  s.status = 'completed';
  s.maxFingerStrength.attempts = [
    { addedWeightKg: o.fingerAddedKg ?? 0, assistanceKg: o.fingerAssistKg ?? 0, holdSeconds: 5, successful: true, technicallyValid: true, rpe: 9, notes: '' },
  ];
  a.strength = s;
  a.climbing = o.climbing ?? null;
  return a;
}

export function intake(o: Partial<ClimberIntake> = {}): ClimberIntake {
  return { rpGrade: '6c', osGrade: '6b', repeatableGrade: '6a+', style: 'mixed', routesPerSession: 8, boulderGrade: null, ...o };
}

/** Parametry z obwodem danego protokołu na danej trudności */
export function peParams(protocol: PeProtocol, grade: string, gradeCap?: string): TrainingParams {
  const p = structuredClone(P0);
  p.powerEndurance = configureProtocol(protocol, grade, gradeCap ? { gradeCap } : {});
  return p;
}

/** Sesja obwodów: wszystkie drogi ukończone, z podanym RPE i pompowaniem */
export function circuit(date: string, params: TrainingParams, o: { rpe?: number; pump?: number; completedRoutes?: number; technique?: number; deload?: boolean } = {}): CompletedWorkout {
  const pe = params.powerEndurance;
  const total = pe.sets * pe.routesPerSet;
  const done = o.completedRoutes ?? total;
  const routes = [];
  for (let s = 1, k = 0; s <= pe.sets; s++) {
    for (let i = 0; i < pe.routesPerSet; i++, k++) routes.push(route({ setIndex: s, grade: pe.grade, pump: o.pump ?? 6, rpe: o.rpe ?? 7, completed: k < done }));
  }
  return workout('C', date, params, {
    routes, rpe: o.rpe ?? 7, technique: o.technique ?? 4, deload: o.deload ?? false, completion: done < total ? 'partial' : 'full',
  });
}
