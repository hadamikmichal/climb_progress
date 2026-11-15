import { ClimbingAssessment, RECOVERY_POINTS, RecoveryMeasurement, RecoveryPoint, RouteAttempt } from '../../models/assessment';

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Próby, które liczą się do wyniku: zatwierdzone, nie nieważne i nie pominięte */
export function validAttempts(attempts: RouteAttempt[]): RouteAttempt[] {
  return attempts.filter((a) => a.saved && a.status !== 'invalid' && a.status !== 'not_tested');
}

export interface ClimbingTimeStats {
  /** Liczba ważnych prób (maks. planowana) */
  attempted: number;
  completedRoutes: number;
  totalAttempts: number;
  /** Czasy wszystkich ważnych prób (null, jeśli brak pomiaru) */
  times: (number | null)[];
  rpe: (number | null)[];
  pump: (number | null)[];
  averageTimeSeconds: number | null;
  fastestTimeSeconds: number | null;
  slowestTimeSeconds: number | null;
  /** Pierwsza vs ostatnia ukończona droga */
  firstTimeSeconds: number | null;
  lastTimeSeconds: number | null;
  timeChangeSeconds: number | null;
  timeChangePercent: number | null;
  averageRpe: number | null;
}

/**
 * Statystyki czasu przejść. Średnia, min. i maks. liczone wyłącznie z ukończonych ważnych prób
 * (czas drogi nieukończonej nie jest porównywalny).
 * @param limit porównanie testu 4 × 6a z testem 3 × 6a – bierzemy tylko pierwsze `limit` ważnych prób
 */
export function calculateClimbingTimeStats(attempts: RouteAttempt[], plannedAttempts: number, limit?: number): ClimbingTimeStats {
  let valid = validAttempts(attempts);
  const total = limit != null ? Math.min(limit, plannedAttempts) : plannedAttempts;
  valid = valid.slice(0, total);
  const done = valid.filter((a) => a.completed === true);
  const timed = done.map((a) => a.ascentTimeSeconds).filter((t): t is number => t != null && t > 0);
  const rpes = valid.map((a) => a.rpe).filter((r): r is number => r != null);
  const firstDone = done.find((a) => a.ascentTimeSeconds != null);
  const lastDone = [...done].reverse().find((a) => a.ascentTimeSeconds != null);
  const first = firstDone?.ascentTimeSeconds ?? null;
  const last = lastDone && lastDone !== firstDone ? lastDone.ascentTimeSeconds : null;
  return {
    attempted: valid.length,
    completedRoutes: done.length,
    totalAttempts: total,
    times: valid.map((a) => a.ascentTimeSeconds),
    rpe: valid.map((a) => a.rpe),
    pump: valid.map((a) => a.forearmPump),
    averageTimeSeconds: timed.length ? round1(timed.reduce((a, b) => a + b, 0) / timed.length) : null,
    fastestTimeSeconds: timed.length ? Math.min(...timed) : null,
    slowestTimeSeconds: timed.length ? Math.max(...timed) : null,
    firstTimeSeconds: first,
    lastTimeSeconds: last,
    timeChangeSeconds: first != null && last != null ? round1(last - first) : null,
    timeChangePercent: first != null && last != null && first > 0 ? round1(((last - first) / first) * 100) : null,
    averageRpe: rpes.length ? round1(rpes.reduce((a, b) => a + b, 0) / rpes.length) : null,
  };
}

export interface RecoveryCurveResult {
  points: { elapsedSeconds: RecoveryPoint; pump: number | null }[];
  /** Zmiana pompowania między kolejnymi pomiarami (ujemna = spadek) */
  deltas: { from: RecoveryPoint; to: RecoveryPoint; change: number | null }[];
  initialPump: number | null;
  /** Czas do spadku pompowania o min. 50% względem pomiaru 0 s */
  halfRecoverySeconds: RecoveryPoint | null;
  /** 'reached' | 'not_reached' (nie osiągnięto w okresie obserwacji) | 'not_applicable' (brak pompowania / brak danych) */
  halfRecovery: 'reached' | 'not_reached' | 'not_applicable';
  pumpAfterFirstRoute: number | null;
  pumpAfterLastRoute: number | null;
  /** Różnica pompowania: ostatnia – pierwsza próba */
  pumpRiseFirstToLast: number | null;
  complete: boolean;
}

export function emptyRecoveryCurve(): RecoveryMeasurement[] {
  return RECOVERY_POINTS.map((elapsedSeconds) => ({ elapsedSeconds, forearmPump: null }));
}

/** Krzywa regeneracji – standaryzowana ocena subiektywna, nie pomiar fizjologiczny */
export function calculateRecoveryCurve(curve: RecoveryMeasurement[], attempts: RouteAttempt[]): RecoveryCurveResult {
  const at = (t: RecoveryPoint) => curve.find((m) => m.elapsedSeconds === t)?.forearmPump ?? null;
  const points = RECOVERY_POINTS.map((t) => ({ elapsedSeconds: t, pump: at(t) }));
  const deltas = RECOVERY_POINTS.slice(1).map((t, i) => {
    const prev = points[i].pump;
    const cur = points[i + 1].pump;
    return { from: RECOVERY_POINTS[i], to: t, change: prev != null && cur != null ? cur - prev : null };
  });
  const p0 = points[0].pump;
  let halfRecoverySeconds: RecoveryPoint | null = null;
  let halfRecovery: RecoveryCurveResult['halfRecovery'] = 'not_applicable';
  if (p0 != null && p0 > 0) {
    halfRecovery = 'not_reached';
    for (const p of points.slice(1)) {
      if (p.pump != null && p.pump <= p0 * 0.5) {
        halfRecoverySeconds = p.elapsedSeconds;
        halfRecovery = 'reached';
        break;
      }
    }
  }
  const valid = validAttempts(attempts);
  const firstPump = valid[0]?.forearmPump ?? null;
  const lastPump = valid.length > 1 ? valid[valid.length - 1].forearmPump : null;
  return {
    points,
    deltas,
    initialPump: p0,
    halfRecoverySeconds,
    halfRecovery,
    pumpAfterFirstRoute: firstPump,
    pumpAfterLastRoute: lastPump ?? (valid.length === 1 ? firstPump : null),
    pumpRiseFirstToLast: firstPump != null && lastPump != null ? lastPump - firstPump : null,
    complete: points.every((p) => p.pump != null),
  };
}

export function climbingResults(c: ClimbingAssessment, limit?: number) {
  return {
    time: calculateClimbingTimeStats(c.attempts, c.plannedAttempts, limit),
    recovery: calculateRecoveryCurve(c.recoveryCurve, limit != null ? validAttempts(c.attempts).slice(0, limit) : c.attempts),
  };
}

/** Kolejny krok testu dróg */
export type ClimbPhase = 'next_attempt' | 'climbing' | 'form' | 'recovery' | 'done';

export function climbingPhase(c: ClimbingAssessment): ClimbPhase {
  const last = c.attempts[c.attempts.length - 1];
  if (last && last.startedAt && !last.endedAt) return 'climbing';
  if (last && last.endedAt && !last.saved) return 'form';
  const enough = validAttempts(c.attempts).length >= c.plannedAttempts;
  if (enough || c.stoppedByFatigue) {
    return c.recoveryCurve.every((m) => m.forearmPump != null) ? 'done' : 'recovery';
  }
  return 'next_attempt';
}

export function formatSeconds(s: number | null | undefined): string {
  if (s == null) return '–';
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  const ss = sec.toFixed(sec % 1 ? 1 : 0).padStart(sec % 1 ? 4 : 2, '0');
  return m ? `${m}:${ss}` : `${ss.replace(/^0(?=\d)/, '')} s`;
}
