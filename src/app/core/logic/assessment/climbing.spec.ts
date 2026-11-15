import { calculateClimbingTimeStats, calculateRecoveryCurve, climbingPhase, emptyRecoveryCurve, formatSeconds } from './climbing';
import { RecoveryMeasurement, RouteAttempt } from '../../models/assessment';
import { newClimbingSession } from './factory';

const att = (index: number, o: Partial<RouteAttempt> = {}): RouteAttempt => ({
  index, status: 'success', startedAt: 't', endedAt: 't', ascentTimeSeconds: 120, restBeforeSeconds: 180, completed: true, failReason: null,
  rpe: 6, forearmPump: 4, techniqueDegraded: false, problemMove: false, failurePoint: '', notes: '', saved: true, ...o,
});
const curve = (vals: (number | null)[]): RecoveryMeasurement[] => emptyRecoveryCurve().map((m, i) => ({ ...m, forearmPump: vals[i] }));

describe('calculateClimbingTimeStats', () => {
  it('średnia, min., maks. i zmiana czasu pierwsza → ostatnia', () => {
    const s = calculateClimbingTimeStats([att(1, { ascentTimeSeconds: 120 }), att(2, { ascentTimeSeconds: 130 }), att(3, { ascentTimeSeconds: 125 }), att(4, { ascentTimeSeconds: 150 })], 4);
    expect(s.completedRoutes).toBe(4);
    expect(s.averageTimeSeconds).toBe(131.3);
    expect(s.fastestTimeSeconds).toBe(120);
    expect(s.slowestTimeSeconds).toBe(150);
    expect(s.timeChangeSeconds).toBe(30);
    expect(s.timeChangePercent).toBe(25);
  });

  it('pomija próby nieważne i niezatwierdzone; nieukończone nie wchodzą do statystyk czasu', () => {
    const s = calculateClimbingTimeStats([
      att(1, { ascentTimeSeconds: 100 }),
      att(2, { status: 'invalid', ascentTimeSeconds: 50 }),
      att(3, { ascentTimeSeconds: 110 }),
      att(4, { completed: false, status: 'failed', ascentTimeSeconds: 90 }),
      att(5, { saved: false }),
    ], 4);
    expect(s.attempted).toBe(3);
    expect(s.completedRoutes).toBe(2);
    expect(s.times).toEqual([100, 110, 90]);
    expect(s.fastestTimeSeconds).toBe(100);
    expect(s.timeChangePercent).toBe(10);
  });

  it('jedna ukończona droga → brak zmiany czasu', () => {
    const s = calculateClimbingTimeStats([att(1), att(2, { completed: false, status: 'failed' })], 4);
    expect(s.timeChangeSeconds).toBeNull();
    expect(s.timeChangePercent).toBeNull();
  });

  it('limit porównania 4 × 6a z 3 × 6a – tylko pierwsze 3 próby', () => {
    const s = calculateClimbingTimeStats([att(1, { ascentTimeSeconds: 100 }), att(2, { ascentTimeSeconds: 100 }), att(3, { ascentTimeSeconds: 100 }), att(4, { ascentTimeSeconds: 200 })], 4, 3);
    expect(s.totalAttempts).toBe(3);
    expect(s.slowestTimeSeconds).toBe(100);
  });

  it('brak danych → wartości null, nie zera', () => {
    const s = calculateClimbingTimeStats([], 4);
    expect(s.averageTimeSeconds).toBeNull();
    expect(s.averageRpe).toBeNull();
    expect(s.completedRoutes).toBe(0);
  });
});

describe('calculateRecoveryCurve', () => {
  it('przykład demonstracyjny 8 → 6 → 4 → 2', () => {
    const r = calculateRecoveryCurve(curve([8, 6, 4, 2]), [att(1, { forearmPump: 4 }), att(4, { forearmPump: 8 })]);
    expect(r.deltas.map((d) => d.change)).toEqual([-2, -2, -2]);
    expect(r.halfRecovery).toBe('reached');
    expect(r.halfRecoverySeconds).toBe(120);
    expect(r.pumpAfterFirstRoute).toBe(4);
    expect(r.pumpAfterLastRoute).toBe(8);
    expect(r.pumpRiseFirstToLast).toBe(4);
    expect(r.complete).toBe(true);
  });

  it('spadek o 50% liczony względem 0 s – dokładnie połowa się liczy', () => {
    expect(calculateRecoveryCurve(curve([7, 5, 4, 3.5]), []).halfRecoverySeconds).toBe(180);
    expect(calculateRecoveryCurve(curve([6, 3, 2, 1]), []).halfRecoverySeconds).toBe(60);
  });

  it('brak spadku o 50% w 3 min → „nie osiągnięto w okresie obserwacji”', () => {
    const r = calculateRecoveryCurve(curve([9, 8, 7, 6]), []);
    expect(r.halfRecovery).toBe('not_reached');
    expect(r.halfRecoverySeconds).toBeNull();
  });

  it('brak pompowania na starcie lub brak danych → nie dotyczy', () => {
    expect(calculateRecoveryCurve(curve([0, 0, 0, 0]), []).halfRecovery).toBe('not_applicable');
    const r = calculateRecoveryCurve(curve([null, 5, null, 2]), []);
    expect(r.halfRecovery).toBe('not_applicable');
    expect(r.deltas.map((d) => d.change)).toEqual([null, null, null]);
    expect(r.complete).toBe(false);
  });

  it('nieważne próby nie są brane jako pierwsza/ostatnia', () => {
    const r = calculateRecoveryCurve(curve([5, 4, 3, 2]), [att(1, { status: 'invalid', forearmPump: 9 }), att(2, { forearmPump: 3 }), att(3, { forearmPump: 6 })]);
    expect(r.pumpAfterFirstRoute).toBe(3);
    expect(r.pumpAfterLastRoute).toBe(6);
  });
});

describe('climbingPhase', () => {
  const s = () => newClimbingSession('2026-01-07', '2026-01-07T10:00:00Z', 70, 4, null);
  it('przechodzi przez kolejne etapy testu', () => {
    const c = s();
    expect(climbingPhase(c)).toBe('next_attempt');
    c.attempts.push(att(1, { endedAt: null, saved: false }));
    expect(climbingPhase(c)).toBe('climbing');
    c.attempts[0].endedAt = 't';
    expect(climbingPhase(c)).toBe('form');
    c.attempts[0].saved = true;
    expect(climbingPhase(c)).toBe('next_attempt');
    c.attempts.push(att(2), att(3), att(4));
    expect(climbingPhase(c)).toBe('recovery');
    c.recoveryCurve = curve([8, 6, 4, 2]);
    expect(climbingPhase(c)).toBe('done');
  });

  it('próba nieważna nie zużywa limitu prób; zmęczenie kończy test', () => {
    const c = s();
    c.attempts.push(att(1), att(2, { status: 'invalid' }), att(3), att(4));
    expect(climbingPhase(c)).toBe('next_attempt');
    c.stoppedByFatigue = true;
    expect(climbingPhase(c)).toBe('recovery');
  });
});

describe('formatSeconds', () => {
  it('formatuje czasy', () => {
    expect(formatSeconds(75)).toBe('1:15');
    expect(formatSeconds(42.3)).toBe('42.3 s');
    expect(formatSeconds(5)).toBe('5 s');
    expect(formatSeconds(null)).toBe('–');
  });
});
