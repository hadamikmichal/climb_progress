import { Assessment, RouteAttempt } from '../../models/assessment';
import { newAssessment, newClimbingSession, newStrengthSession } from './factory';

/**
 * Dane demonstracyjne – WYŁĄCZNIE dla trybu Demo (/assessment/demo).
 * Nigdy nie są zapisywane w IndexedDB ani mieszane z danymi użytkownika.
 */
const attempt = (index: number, time: number | null, completed: boolean, rpe: number, pump: number, start: string): RouteAttempt => ({
  index, status: completed ? 'success' : 'failed', startedAt: start, endedAt: start, ascentTimeSeconds: time, restBeforeSeconds: index > 1 ? 180 : null,
  completed, failReason: completed ? null : 'fatigue', rpe, forearmPump: pump, techniqueDegraded: index >= 3, problemMove: !completed,
  failurePoint: completed ? '' : 'przechwyt pod ostatnim przelotem', notes: '', saved: true,
});

function build(id: string, date: string, climbDate: string, o: {
  added: number; pullAdded: number; coreSec: number; hang: number; times: (number | null)[]; done: boolean[]; rpe: number[]; pump: number[]; curve: number[];
}): Assessment {
  const ts = `${date}T17:00:00.000Z`;
  const a = newAssessment(id, 'demo', id === 'demo-baseline' ? 'BASELINE' : 'FINAL', ts);
  const s = newStrengthSession(date, ts, 72, null, 'Beastmaker 2000 – krawądka 20 mm', 20);
  s.status = 'completed';
  s.completedAt = ts;
  s.step = 'summary';
  s.readiness = { ...s.readiness, sleepHours: 8, wellbeing: 4, fatigue: 2, fingerPain: false, elbowPain: false, shoulderPain: false, illness: false, recentHardTraining: false, confirmed: true };
  s.weightedPullUp.attempts = [
    { addedWeightKg: o.pullAdded - 5, reps: 1, successful: true, techniqueValid: true, rpe: 7, notes: '' },
    { addedWeightKg: o.pullAdded, reps: 1, successful: true, techniqueValid: true, rpe: 9, notes: '' },
    { addedWeightKg: o.pullAdded + 2.5, reps: 0, successful: false, techniqueValid: true, rpe: 10, notes: '' },
  ];
  s.maxFingerStrength.attempts = [
    { addedWeightKg: o.added - 5, assistanceKg: 0, holdSeconds: 5, successful: true, technicallyValid: true, rpe: 7, notes: '' },
    { addedWeightKg: o.added, assistanceKg: 0, holdSeconds: 5, successful: true, technicallyValid: true, rpe: 9, notes: '' },
    { addedWeightKg: o.added + 2.5, assistanceKg: 0, holdSeconds: 3.2, successful: false, technicallyValid: true, rpe: 10, notes: '' },
  ];
  s.coreStrength.attempts = [{ exercise: 'full_l_sit', holdSeconds: o.coreSec, technicallyValid: true, notes: '' }];
  s.deadHang = { ...s.deadHang, holdSeconds: o.hang, barDiameterMm: 30, endReason: 'released' };
  const c = newClimbingSession(climbDate, `${climbDate}T17:00:00.000Z`, 72, 4, null);
  c.status = 'completed';
  c.completedAt = `${climbDate}T18:00:00.000Z`;
  c.readiness = { ...s.readiness, testedAt: `${climbDate}T17:00:00.000Z` };
  c.route = { routeId: 'K2-14', name: 'Demo 6a', location: 'Ściana demo, sektor A', frenchGrade: '6a', heightMeters: 13, wallStyle: 'vertical', climbingStyle: 'top_rope', imageUrl: '', knownAndSent: true };
  c.attempts = o.times.map((t, i) => attempt(i + 1, t, o.done[i], o.rpe[i], o.pump[i], c.startedAt));
  c.stoppedByFatigue = o.done.includes(false);
  c.recoveryCurve = c.recoveryCurve.map((m, i) => ({ ...m, forearmPump: o.curve[i] }));
  a.strength = s;
  a.climbing = c;
  a.status = 'completed';
  a.completedAt = c.completedAt;
  return a;
}

export function demoAssessments(): { baseline: Assessment; retest: Assessment } {
  return {
    baseline: build('demo-baseline', '2026-01-05', '2026-01-07', {
      added: 10, pullAdded: 14.4, coreSec: 12, hang: 95, times: [142, 151, 168, null], done: [true, true, true, false], rpe: [6, 7, 9, 10], pump: [4, 6, 8, 9], curve: [8, 6, 4, 2],
    }),
    retest: build('demo-retest', '2026-02-23', '2026-02-25', {
      added: 15, pullAdded: 17.5, coreSec: 16, hang: 128, times: [138, 140, 146, 155], done: [true, true, true, true], rpe: [5, 6, 7, 8], pump: [3, 4, 6, 7], curve: [7, 4, 2, 1],
    }),
  };
}
