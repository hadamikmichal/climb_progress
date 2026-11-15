import {
  AttemptStatus, CoreExercise, CoreStrengthResult, CoreTrial, DeadHangResult, FingerStrengthTrial, MaxFingerStrengthResult,
  NineCScore, StrengthAssessment, StrengthTrial, WeightedPullUpResult,
} from '../../models/assessment';

/**
 * Punktacja 9c – czyste funkcje.
 * Zasady: rzeczywista masa ciała z dnia testu, brak zaokrąglania danych wejściowych,
 * punkty tylko za osiągnięcie pełnego progu (bez interpolacji), wynik niezmierzony ≠ 0, maks. 10 pkt na kategorię.
 */

/** Progi % masy ciała (obciążenie całkowite) dla 1..10 punktów – podciąganie i siła palców */
export const RELATIVE_LOAD_THRESHOLDS = [100, 110, 120, 130, 140, 150, 160, 180, 200, 220] as const;
/** Progi czasu zwisu (s) dla 1..10 punktów */
export const DEAD_HANG_THRESHOLDS = [30, 60, 90, 120, 150, 180, 210, 240, 300, 360] as const;
export const DEAD_HANG_MAX_SEC = 360;
export const FINGER_HOLD_SEC = 5;

/** Progi core: [czas s, punkty] – każdy wariant ma własny zakres punktów */
export const CORE_THRESHOLDS: Record<CoreExercise, readonly (readonly [number, number])[]> = {
  bent_knee_l_sit: [[10, 1], [20, 2], [30, 3]],
  full_l_sit: [[10, 4], [15, 5], [20, 6]],
  front_lever: [[5, 7], [10, 8], [20, 9], [30, 10]],
};

/** Tolerancja wyłącznie na błąd reprezentacji zmiennoprzecinkowej (np. 86,4 / 72), nie na zaokrąglanie danych */
const EPS = 1e-9;

export function relativeLoadPercent(bodyMassKg: number, addedKg: number, assistanceKg = 0): number {
  return ((bodyMassKg + addedKg - assistanceKg) / bodyMassKg) * 100;
}

/** Liczba pełnych progów osiągniętych przez wartość */
export function thresholdPoints(value: number, thresholds: readonly number[]): number {
  let pts = 0;
  for (const t of thresholds) if (value + EPS >= t) pts++;
  return Math.min(10, pts);
}

const validMass = (m: number | null | undefined): m is number => typeof m === 'number' && Number.isFinite(m) && m > 0;

export interface LoadScore {
  status: AttemptStatus;
  bodyMassKg: number | null;
  addedWeightKg: number | null;
  assistanceKg: number | null;
  totalLoadKg: number | null;
  bodyMassRatioPercent: number | null;
  /** Liczba poprawnych powtórzeń w najlepszej próbie (podciąganie) */
  reps: number | null;
  rpe: number | null;
  /** Indeks najlepszej próby */
  bestIndex: number | null;
  score: number | null;
}

const notTested = (bodyMassKg: number | null): LoadScore => ({
  status: 'not_tested', bodyMassKg, addedWeightKg: null, assistanceKg: null, totalLoadKg: null, bodyMassRatioPercent: null, reps: null, rpe: null, bestIndex: null, score: null,
});

/** Max Finger Strength – największe obciążenie utrzymane poprawnie przez pełne 5 s */
export function calculateNineCStrengthScore(r: MaxFingerStrengthResult, bodyMassKg: number | null): LoadScore {
  if (r.status === 'not_tested' || !r.attempts.length || !validMass(bodyMassKg)) return notTested(bodyMassKg);
  const ok = (t: FingerStrengthTrial) => t.successful && t.technicallyValid && t.holdSeconds + EPS >= FINGER_HOLD_SEC;
  let best: number | null = null;
  r.attempts.forEach((t, i) => {
    if (!ok(t)) return;
    if (best == null) best = i;
    else {
      const b = r.attempts[best];
      if (t.addedWeightKg - t.assistanceKg > b.addedWeightKg - b.assistanceKg) best = i;
    }
  });
  if (best == null) {
    // Pomiar wykonany, ale żadna próba nie spełniła kryteriów – 0 pkt, nie „niezmierzony”
    return { ...notTested(bodyMassKg), status: 'failed', score: 0 };
  }
  const t = r.attempts[best];
  const pct = relativeLoadPercent(bodyMassKg, t.addedWeightKg, t.assistanceKg);
  return {
    status: 'success', bodyMassKg, addedWeightKg: t.addedWeightKg, assistanceKg: t.assistanceKg,
    totalLoadKg: bodyMassKg + t.addedWeightKg - t.assistanceKg, bodyMassRatioPercent: pct, reps: null, rpe: t.rpe, bestIndex: best,
    score: thresholdPoints(pct, RELATIVE_LOAD_THRESHOLDS),
  };
}

/** Weighted Pull-up 1RM – największe dodatkowe obciążenie przy poprawnym technicznie powtórzeniu */
export function calculateNineCPullUpScore(r: WeightedPullUpResult, bodyMassKg: number | null): LoadScore {
  if (r.status === 'not_tested' || !r.attempts.length || !validMass(bodyMassKg)) return notTested(bodyMassKg);
  const ok = (t: StrengthTrial) => t.successful && t.techniqueValid && t.reps >= 1;
  let best: number | null = null;
  r.attempts.forEach((t, i) => {
    if (ok(t) && (best == null || t.addedWeightKg > r.attempts[best].addedWeightKg)) best = i;
  });
  if (best == null) return { ...notTested(bodyMassKg), status: 'failed', score: 0 };
  const t = r.attempts[best];
  const pct = relativeLoadPercent(bodyMassKg, t.addedWeightKg);
  return {
    status: 'success', bodyMassKg, addedWeightKg: t.addedWeightKg, assistanceKg: 0, totalLoadKg: bodyMassKg + t.addedWeightKg,
    bodyMassRatioPercent: pct, reps: t.reps, rpe: t.rpe, bestIndex: best, score: thresholdPoints(pct, RELATIVE_LOAD_THRESHOLDS),
  };
}

export function coreTrialPoints(t: Pick<CoreTrial, 'exercise' | 'holdSeconds'>): number {
  let pts = 0;
  for (const [sec, p] of CORE_THRESHOLDS[t.exercise]) if (t.holdSeconds + EPS >= sec) pts = p;
  return pts;
}

export interface CoreScore {
  status: AttemptStatus;
  exercise: CoreExercise | null;
  holdSeconds: number | null;
  score: number | null;
  bestIndex: number | null;
}

/** Core – najwyższy osiągnięty poziom spośród poprawnych technicznie prób */
export function calculateNineCCoreScore(r: CoreStrengthResult): CoreScore {
  if (r.status === 'not_tested' || !r.attempts.length) return { status: 'not_tested', exercise: null, holdSeconds: null, score: null, bestIndex: null };
  let best: number | null = null;
  let bestPts = -1;
  r.attempts.forEach((t, i) => {
    if (!t.technicallyValid) return;
    const p = coreTrialPoints(t);
    // przy równej punktacji wygrywa dłuższy czas w tym samym wariancie
    if (p > bestPts || (p === bestPts && best != null && t.exercise === r.attempts[best].exercise && t.holdSeconds > r.attempts[best].holdSeconds)) {
      best = i;
      bestPts = p;
    }
  });
  if (best == null) return { status: 'failed', exercise: null, holdSeconds: null, score: 0, bestIndex: null };
  const t = r.attempts[best];
  return { status: bestPts > 0 ? 'success' : 'failed', exercise: t.exercise, holdSeconds: t.holdSeconds, score: bestPts, bestIndex: best };
}

export interface DeadHangScore {
  status: AttemptStatus;
  holdSeconds: number | null;
  score: number | null;
}

export function calculateNineCDeadHangScore(r: DeadHangResult): DeadHangScore {
  if (r.status === 'not_tested' || r.holdSeconds == null) return { status: 'not_tested', holdSeconds: null, score: null };
  const sec = Math.min(r.holdSeconds, DEAD_HANG_MAX_SEC);
  return { status: sec > 0 ? 'success' : 'failed', holdSeconds: r.holdSeconds, score: thresholdPoints(sec, DEAD_HANG_THRESHOLDS) };
}

const GRADE_LADDER = ['6a', '6b', '6c', '6c+', '7a', '7a+', '7b', '7b+', '7c', '7c+', '8a', '8a+', '8b', '8b+', '8c', '8c+', '9a', '9a+', '9b'];

/** Orientacyjny benchmark siłowy wg publikowanej tabeli 9c (nie przewidywany poziom wspinaczkowy) */
export function nineCBenchmarkGrade(total: number): string | null {
  if (total <= 0) return null;
  if (total >= 40) return '9c';
  if (total === 39) return '9b+';
  return GRADE_LADDER[Math.ceil(total / 2) - 1] ?? null;
}

export function calculateNineCTotalScore(parts: { finger: number | null; pulling: number | null; core: number | null; endurance: number | null }): NineCScore {
  const vals = [parts.finger, parts.pulling, parts.core, parts.endurance];
  const measured = vals.filter((v): v is number => v != null);
  const isComplete = measured.length === 4;
  const total = isComplete ? measured.reduce((a, b) => a + b, 0) : null;
  return {
    fingerStrength: parts.finger,
    pullingStrength: parts.pulling,
    coreStrength: parts.core,
    endurance: parts.endurance,
    totalPoints: total,
    maxPoints: 40,
    isComplete,
    estimatedGrade: total != null ? nineCBenchmarkGrade(total) : null,
    interpretation: isComplete ? 'complete' : measured.length ? 'incomplete' : 'not_available',
  };
}

export interface StrengthResults {
  bodyMassKg: number | null;
  finger: LoadScore;
  pullUp: LoadScore;
  core: CoreScore;
  deadHang: DeadHangScore;
  nineC: NineCScore;
}

/** Wszystkie wyniki dnia 1 – z masą ciała z dnia testu */
export function strengthResults(s: StrengthAssessment): StrengthResults {
  const bm = s.readiness.bodyMassKg;
  const finger = calculateNineCStrengthScore(s.maxFingerStrength, bm);
  const pullUp = calculateNineCPullUpScore(s.weightedPullUp, bm);
  const core = calculateNineCCoreScore(s.coreStrength);
  const deadHang = calculateNineCDeadHangScore(s.deadHang);
  return {
    bodyMassKg: bm, finger, pullUp, core, deadHang,
    nineC: calculateNineCTotalScore({ finger: finger.score, pulling: pullUp.score, core: core.score, endurance: deadHang.score }),
  };
}
