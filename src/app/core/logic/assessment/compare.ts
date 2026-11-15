import { Assessment, WeeklyTestComparison } from '../../models/assessment';
import { climbingResults } from './climbing';
import { strengthResults } from './scoring';
import { CORE_LABELS } from './labels';

const round1 = (n: number) => Math.round(n * 10) / 10;

interface MetricDef {
  key: string;
  label: string;
  unit: string;
  group: 'finger' | 'pulling' | 'core' | 'endurance' | 'climbing' | 'recovery' | 'nine_c';
  higherIsBetter: boolean;
  /** Skala ilorazowa (kg całkowite, sekundy) – tylko wtedy zmiana procentowa ma sens */
  ratioScale: boolean;
}

export interface ComparisonRow extends WeeklyTestComparison {
  group: MetricDef['group'];
  note?: string;
}

export interface ConditionsCheck {
  limited: boolean;
  reasons: string[];
}

export function compareMetric(def: MetricDef, a: Assessment, b: Assessment, va: number | null, vb: number | null, note?: string, forceNotComparable = false): ComparisonRow {
  const base = { key: def.key, label: def.label, unit: def.unit, group: def.group, initialTestId: a.id, comparisonTestId: b.id, initialValue: va, currentValue: vb, note };
  if (va == null || vb == null || forceNotComparable) {
    return { ...base, absoluteChange: va != null && vb != null ? round1(vb - va) : null, percentageChange: null, interpretation: 'not_comparable' };
  }
  const abs = round1(vb - va);
  const pct = def.ratioScale && va > 0 ? round1(((vb - va) / va) * 100) : null;
  const interpretation = abs === 0 ? 'unchanged' : (abs > 0) === def.higherIsBetter ? 'improved' : 'declined';
  return { ...base, absoluteChange: abs, percentageChange: pct, interpretation };
}

const M = (key: string, label: string, unit: string, group: MetricDef['group'], higherIsBetter: boolean, ratioScale: boolean): MetricDef =>
  ({ key, label, unit, group, higherIsBetter, ratioScale });

export const METRICS = {
  fingerAdded: M('finger_added', 'Max Hang – dodatkowe obciążenie', 'kg', 'finger', true, false),
  fingerTotal: M('finger_total', 'Max Hang – obciążenie całkowite', 'kg', 'finger', true, true),
  fingerPct: M('finger_pct', 'Max Hang – % masy ciała', '%', 'finger', true, false),
  fingerScore: M('finger_score', 'Finger Strength 9c', 'pkt', 'finger', true, false),
  pullAdded: M('pull_added', 'Podciąganie – dodatkowe obciążenie', 'kg', 'pulling', true, false),
  pullTotal: M('pull_total', 'Podciąganie – łączna masa', 'kg', 'pulling', true, true),
  pullPct: M('pull_pct', 'Podciąganie – % masy ciała', '%', 'pulling', true, false),
  pullScore: M('pull_score', 'Pulling Strength 9c', 'pkt', 'pulling', true, false),
  coreSec: M('core_sec', 'Core – czas utrzymania', 's', 'core', true, true),
  coreScore: M('core_score', 'Core Strength 9c', 'pkt', 'core', true, false),
  hangSec: M('hang_sec', 'Dead Hang – czas', 's', 'endurance', true, true),
  hangScore: M('hang_score', 'Endurance 9c', 'pkt', 'endurance', true, false),
  total: M('nine_c_total', 'Suma 9c', 'pkt', 'nine_c', true, false),
  routesDone: M('routes_done', 'Ukończone drogi', '', 'climbing', true, false),
  avgTime: M('avg_time', 'Średni czas przejścia', 's', 'climbing', false, true),
  fastest: M('fastest', 'Najkrótszy czas', 's', 'climbing', false, true),
  timeChange: M('time_change', 'Zmiana czasu 1. → ostatnia droga', '%', 'climbing', false, false),
  avgRpe: M('avg_rpe', 'Średnie RPE', '', 'climbing', false, false),
  lastPump: M('last_pump', 'Pompowanie po ostatniej drodze', '/10', 'climbing', false, false),
  pumpRise: M('pump_rise', 'Wzrost pompowania 1. → ostatnia', 'pkt', 'climbing', false, false),
  rec0: M('rec_0', 'Pompowanie 0 min', '/10', 'recovery', false, false),
  rec60: M('rec_60', 'Pompowanie 1 min', '/10', 'recovery', false, false),
  rec120: M('rec_120', 'Pompowanie 2 min', '/10', 'recovery', false, false),
  rec180: M('rec_180', 'Pompowanie 3 min', '/10', 'recovery', false, false),
  half: M('half', 'Czas do spadku pompowania o 50%', 's', 'recovery', false, false),
} satisfies Record<string, MetricDef>;

/** Czy warunki dwóch testów pozwalają na pełne porównanie */
export function compareConditions(a: Assessment, b: Assessment): ConditionsCheck {
  const reasons: string[] = [];
  const sa = a.strength;
  const sb = b.strength;
  if (sa && sb) {
    const fa = sa.maxFingerStrength;
    const fb = sb.maxFingerStrength;
    if (fa.edgeDepthMm != null && fb.edgeDepthMm != null && fa.edgeDepthMm !== fb.edgeDepthMm) reasons.push(`Inna głębokość krawądki (${fa.edgeDepthMm} → ${fb.edgeDepthMm} mm).`);
    if (fa.edgeLabel.trim() && fb.edgeLabel.trim() && fa.edgeLabel.trim() !== fb.edgeLabel.trim()) reasons.push('Inna krawądka testowa.');
    const ba = sa.deadHang.barDiameterMm;
    const bb = sb.deadHang.barDiameterMm;
    if (ba != null && bb != null && ba !== bb) reasons.push(`Inny drążek (średnica ${ba} → ${bb} mm).`);
    const ca = strengthResults(sa).core.exercise;
    const cb = strengthResults(sb).core.exercise;
    if (ca && cb && ca !== cb) reasons.push(`Inny wariant core (${CORE_LABELS[ca]} → ${CORE_LABELS[cb]}) – czasy nieporównywalne, porównuj punktację.`);
    const ma = sa.readiness.bodyMassKg;
    const mb = sb.readiness.bodyMassKg;
    if (ma && mb && Math.abs(mb - ma) / ma > 0.03) reasons.push(`Masa ciała różni się o ${round1(mb - ma)} kg (> 3%).`);
    if (sa.readiness.acknowledgedWarnings || sb.readiness.acknowledgedWarnings) reasons.push('Dzień siłowy wykonany mimo ostrzeżeń gotowości.');
  }
  const ca = a.climbing;
  const cb = b.climbing;
  if (ca && cb) {
    const ra = ca.route;
    const rb = cb.route;
    const sameRoute = ra.routeId && rb.routeId ? ra.routeId === rb.routeId : ra.name.trim().toLowerCase() === rb.name.trim().toLowerCase() && ra.location.trim().toLowerCase() === rb.location.trim().toLowerCase();
    if (!sameRoute || cb.routeChanged) reasons.push(`Inna droga testowa (${ra.name || '–'} → ${rb.name || '–'}).`);
    if (ra.climbingStyle !== rb.climbingStyle) reasons.push('Inny sposób wspinania (prowadzenie / wędka).');
    if (ca.restSeconds !== cb.restSeconds) reasons.push('Inny czas odpoczynku między próbami.');
    if (ca.plannedAttempts !== cb.plannedAttempts) reasons.push(`Różna liczba prób (${ca.plannedAttempts} vs ${cb.plannedAttempts}) – porównujemy pierwsze ${Math.min(ca.plannedAttempts, cb.plannedAttempts)}.`);
    if (ca.readiness.acknowledgedWarnings || cb.readiness.acknowledgedWarnings) reasons.push('Dzień wspinaczkowy wykonany mimo ostrzeżeń gotowości.');
  }
  return { limited: reasons.length > 0, reasons };
}

/**
 * Baseline vs Retest – każdy wskaźnik osobno. Nie zakładamy, że poprawa jednego oznacza poprawę pozostałych.
 */
export function compareBaselineResults(a: Assessment, b: Assessment): { rows: ComparisonRow[]; conditions: ConditionsCheck } {
  const rows: ComparisonRow[] = [];
  if (a.strength && b.strength) {
    const x = strengthResults(a.strength);
    const y = strengthResults(b.strength);
    const net = (s: typeof x.finger) => (s.addedWeightKg != null ? s.addedWeightKg - (s.assistanceKg ?? 0) : null);
    rows.push(
      compareMetric(METRICS.fingerAdded, a, b, net(x.finger), net(y.finger)),
      compareMetric(METRICS.fingerTotal, a, b, x.finger.totalLoadKg, y.finger.totalLoadKg),
      compareMetric(METRICS.fingerPct, a, b, r1(x.finger.bodyMassRatioPercent), r1(y.finger.bodyMassRatioPercent)),
      compareMetric(METRICS.fingerScore, a, b, x.finger.score, y.finger.score),
      compareMetric(METRICS.pullAdded, a, b, x.pullUp.addedWeightKg, y.pullUp.addedWeightKg),
      compareMetric(METRICS.pullTotal, a, b, x.pullUp.totalLoadKg, y.pullUp.totalLoadKg),
      compareMetric(METRICS.pullPct, a, b, r1(x.pullUp.bodyMassRatioPercent), r1(y.pullUp.bodyMassRatioPercent)),
      compareMetric(METRICS.pullScore, a, b, x.pullUp.score, y.pullUp.score),
    );
    const sameCore = x.core.exercise != null && x.core.exercise === y.core.exercise;
    rows.push(
      compareMetric(METRICS.coreSec, a, b, x.core.holdSeconds, y.core.holdSeconds, sameCore ? undefined : 'różne warianty ćwiczenia', !sameCore),
      compareMetric(METRICS.coreScore, a, b, x.core.score, y.core.score),
      compareMetric(METRICS.hangSec, a, b, x.deadHang.holdSeconds, y.deadHang.holdSeconds),
      compareMetric(METRICS.hangScore, a, b, x.deadHang.score, y.deadHang.score),
      compareMetric(METRICS.total, a, b, x.nineC.totalPoints, y.nineC.totalPoints, x.nineC.isComplete && y.nineC.isComplete ? undefined : 'niekompletny test 9c'),
    );
  }
  if (a.climbing && b.climbing) {
    const n = Math.min(a.climbing.plannedAttempts, b.climbing.plannedAttempts);
    const x = climbingResults(a.climbing, n);
    const y = climbingResults(b.climbing, n);
    rows.push(
      compareMetric({ ...METRICS.routesDone, unit: `/${n}` }, a, b, x.time.completedRoutes, y.time.completedRoutes),
      compareMetric(METRICS.avgTime, a, b, x.time.averageTimeSeconds, y.time.averageTimeSeconds),
      compareMetric(METRICS.fastest, a, b, x.time.fastestTimeSeconds, y.time.fastestTimeSeconds),
      compareMetric(METRICS.timeChange, a, b, x.time.timeChangePercent, y.time.timeChangePercent),
      compareMetric(METRICS.avgRpe, a, b, x.time.averageRpe, y.time.averageRpe),
      compareMetric(METRICS.lastPump, a, b, x.recovery.pumpAfterLastRoute, y.recovery.pumpAfterLastRoute),
      compareMetric(METRICS.pumpRise, a, b, x.recovery.pumpRiseFirstToLast, y.recovery.pumpRiseFirstToLast),
    );
    // Krzywa regeneracji – zawsze pełna krzywa danego testu (po ostatniej wykonanej drodze)
    const rx = climbingResults(a.climbing).recovery;
    const ry = climbingResults(b.climbing).recovery;
    const recDefs = [METRICS.rec0, METRICS.rec60, METRICS.rec120, METRICS.rec180];
    rx.points.forEach((p, i) => rows.push(compareMetric(recDefs[i], a, b, p.pump, ry.points[i].pump)));
    const half = (r: typeof rx) => (r.halfRecovery === 'reached' ? r.halfRecoverySeconds : null);
    rows.push(compareMetric(METRICS.half, a, b, half(rx), half(ry), rx.halfRecovery === 'not_reached' || ry.halfRecovery === 'not_reached' ? 'w jednym z testów nie osiągnięto w okresie obserwacji' : undefined));
  }
  return { rows, conditions: compareConditions(a, b) };
}

function r1(n: number | null): number | null {
  return n == null ? null : round1(n);
}
