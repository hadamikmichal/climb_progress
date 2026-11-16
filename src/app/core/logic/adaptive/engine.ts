import { ClimbingAssessment, TestRoute } from '../../models/assessment';
import { BenchmarkProtocol, CalibrationState, CompletedWorkout, ISODate, TestLevel } from '../../models/models';
import { emptyRoute } from '../assessment/factory';
import { levelForGrade } from './calibration';

/**
 * Funkcje pomocnicze łączące silnik adaptacyjny z zapisem danych (store) – bez efektów ubocznych.
 */

/** Zablokowanie protokołu testu dróg po potwierdzeniu kalibracji */
export function benchmarkFromClimbing(c: ClimbingAssessment, id: string, sourceAssessmentId: string | null, ts: string, level?: TestLevel): BenchmarkProtocol {
  return {
    id,
    level: level ?? levelForGrade(c.route.frenchGrade),
    grade: c.route.frenchGrade,
    routeName: c.route.name,
    location: c.route.location,
    wallStyle: c.route.wallStyle,
    climbingStyle: c.route.climbingStyle,
    heightMeters: c.route.heightMeters,
    restSeconds: c.restSeconds,
    attempts: c.plannedAttempts,
    lockedAt: ts,
    sourceAssessmentId,
    changes: [],
  };
}

const CHANGE_LABELS: Record<string, string> = {
  grade: 'trudność', routeName: 'droga', wallStyle: 'styl ściany', climbingStyle: 'asekuracja', heightMeters: 'długość', restSeconds: 'odpoczynek',
};

/** Parametry testu różniące się od zablokowanego benchmarku (liczba prób zależy od rodzaju testu i nie jest porównywana) */
export function protocolDiff(b: BenchmarkProtocol, c: ClimbingAssessment): { field: string; label: string; from: string; to: string }[] {
  const cur: Record<string, string> = {
    grade: c.route.frenchGrade, routeName: c.route.name, wallStyle: c.route.wallStyle, climbingStyle: c.route.climbingStyle,
    heightMeters: String(c.route.heightMeters), restSeconds: String(c.restSeconds),
  };
  const ref: Record<string, string> = {
    grade: b.grade, routeName: b.routeName, wallStyle: b.wallStyle, climbingStyle: b.climbingStyle, heightMeters: String(b.heightMeters), restSeconds: String(b.restSeconds),
  };
  return Object.keys(cur)
    .filter((k) => (k !== 'routeName' || !!ref[k]) && cur[k] !== ref[k])
    .map((k) => ({ field: k, label: CHANGE_LABELS[k], from: ref[k], to: cur[k] }));
}

/** Droga do kolejnej sesji testu: zablokowany benchmark > kalibracja > poprzednia droga */
export function testRouteFor(benchmark: BenchmarkProtocol | null | undefined, calibration: CalibrationState | null | undefined, prev: TestRoute | null): TestRoute {
  if (benchmark) {
    return {
      ...(prev ?? emptyRoute()), name: benchmark.routeName, location: benchmark.location, frenchGrade: benchmark.grade,
      heightMeters: benchmark.heightMeters, wallStyle: benchmark.wallStyle, climbingStyle: benchmark.climbingStyle,
    };
  }
  const base = prev ?? emptyRoute();
  if (calibration && calibration.grade !== base.frenchGrade) {
    // Nowa trudność kalibracyjna = inna droga; zachowujemy tylko miejsce i warunki
    return { ...base, routeId: '', name: '', frenchGrade: calibration.grade, knownAndSent: true };
  }
  return { ...base };
}

/** Przerwa w treningach ≥ 21 dni (do powrotu z mniejszą objętością) */
export function returningAfterBreak(ws: CompletedWorkout[], today: ISODate, days = 21): boolean {
  if (!ws.length) return false;
  const last = ws.reduce((m, w) => (w.date > m ? w.date : m), ws[0].date);
  return (Date.parse(today) - Date.parse(last)) / 86_400_000 >= days;
}

/** Treningi z ostatnich 8 tygodni (wszystkie cykle) – podstawa profili i doboru */
export function recentWorkouts(ws: CompletedWorkout[], today: ISODate, days = 56): CompletedWorkout[] {
  const cutoff = new Date(Date.parse(today) - days * 86_400_000).toISOString().slice(0, 10);
  return ws.filter((w) => w.date >= cutoff);
}
