import { ClimbingAssessment } from '../../models/assessment';
import { CalibrationOutcome, CalibrationRun, CalibrationState, ClimberIntake, ClimbingStylePref, TestLevel, UserProfile } from '../../models/models';
import { validAttempts } from '../assessment/climbing';
import { gradeIndex, GRADES, shiftGrade } from '../grades';

/**
 * Adaptacyjny Baseline Test – dobór trudności testu powtarzalności (4 próby na tej samej drodze).
 *
 * Cel kalibracji: pierwsza droga kontrolowana, ostatnia wyraźnym wyzwaniem (RPE ok. 7–8/10),
 * realna szansa ukończenia wszystkich prób, zmęczenie narasta, ale technika się nie rozpada.
 * Jedna trudność na sesję – nigdy kilka maksymalnych testów w jednej sesji. Jeśli kalibracja
 * wymaga zmiany trudności, Baseline pozostaje oczekujący do kolejnej sesji.
 */

export const TEST_LEVELS: Record<TestLevel, { label: string; example: string }> = {
  foundation: { label: 'Foundation', example: '4 × 5c' },
  intermediate: { label: 'Intermediate', example: '4 × 6a' },
  intermediate_plus: { label: 'Intermediate+', example: '4 × 6b' },
  advanced: { label: 'Advanced', example: '4 × 6b+ / 6c' },
  performance: { label: 'Performance', example: '4 × 6c+ / 7a i wyżej' },
};

export const STYLE_LABELS: Record<ClimbingStylePref, string> = {
  technical: 'Techniczny, pionowy',
  crimpy: 'Krawądkowy',
  overhang: 'Przewieszony, siłowy',
  endurance: 'Długie drogi, wytrzymałościowy',
  bouldery: 'Boulderowy, krótkie mocne sekwencje',
  mixed: 'Mieszany',
};

/** Poziom kalibracyjny dla trudności testu */
export function levelForGrade(g: string): TestLevel {
  const i = gradeIndex(g);
  if (i <= gradeIndex('5c+')) return 'foundation';
  if (i <= gradeIndex('6a+')) return 'intermediate';
  if (i <= gradeIndex('6b')) return 'intermediate_plus';
  if (i <= gradeIndex('6c')) return 'advanced';
  return 'performance';
}

/** Wywiad z profilu; brakujące pola wyprowadzone z deklarowanego poziomu (`grade`) */
export function resolveIntake(p: Pick<UserProfile, 'grade' | 'intake'>): ClimberIntake {
  const i = p.intake;
  const rp = i?.rpGrade ?? (gradeIndex(p.grade) >= 0 ? p.grade : null);
  return {
    rpGrade: rp,
    osGrade: i?.osGrade ?? null,
    repeatableGrade: i?.repeatableGrade ?? null,
    style: i?.style ?? 'mixed',
    routesPerSession: i?.routesPerSession ?? null,
    boulderGrade: i?.boulderGrade ?? null,
  };
}

export interface TestCandidate {
  level: TestLevel;
  grade: string;
  reasons: string[];
}

/**
 * Kandydacka trudność testu. Punktem wyjścia jest zdolność do POWTARZANIA dróg (nie sam RP):
 * trudność, na której użytkownik regularnie kończy kilka dróg. Ograniczenia: nie wyżej niż OS/flash
 * i co najmniej 1 stopień poniżej RP.
 */
export function candidateTest(intake: ClimberIntake): TestCandidate {
  const reasons: string[] = [];
  const rp = gradeIndex(intake.rpGrade);
  const os = gradeIndex(intake.osGrade);
  const rep = gradeIndex(intake.repeatableGrade);
  let idx: number;
  if (rep >= 0) {
    idx = rep;
    reasons.push(`Punkt wyjścia: trudność, na której regularnie kończysz kilka dróg (${intake.repeatableGrade}).`);
  } else if (os >= 0) {
    idx = os - 1;
    reasons.push(`Brak deklaracji trudności powtarzalnej – 1 stopień poniżej OS/flash (${intake.osGrade}).`);
  } else if (rp >= 0) {
    idx = rp - 3;
    reasons.push(`Podano tylko RP (${intake.rpGrade}) – test 3 stopnie niżej; poziom potwierdzi kalibracja.`);
  } else {
    idx = gradeIndex('5c');
    reasons.push('Brak danych o poziomie – start od 5c; poziom potwierdzi kalibracja.');
  }
  if (os >= 0 && idx > os) {
    idx = os;
    reasons.push(`Ograniczenie: nie trudniej niż OS/flash (${intake.osGrade}) – test ma być powtarzalny, nie maksymalny.`);
  }
  if (rp >= 0 && idx > rp - 1) {
    idx = rp - 1;
    reasons.push(`Ograniczenie: co najmniej 1 stopień poniżej RP (${intake.rpGrade}).`);
  }
  idx = Math.max(gradeIndex('4c'), Math.min(GRADES.length - 1, idx));
  const grade = GRADES[idx];
  const level = levelForGrade(grade);
  reasons.push(`Poziom kalibracyjny: ${TEST_LEVELS[level].label} – 4 próby na ${grade}. To propozycja startowa, nie przydział.`);
  return { level, grade, reasons };
}

export interface CalibrationVerdict {
  outcome: CalibrationOutcome;
  reasons: string[];
}

/** Docelowe RPE ostatniej próby */
export const TARGET_LAST_RPE = { min: 7, max: 8 } as const;
/** Próg „wszystko bardzo łatwe” */
export const EASY = { maxRpe: 5, maxPump: 4 } as const;

/** Ocena jednej sesji testu dróg pod kątem trafności trudności */
export function evaluateCalibration(c: ClimbingAssessment): CalibrationVerdict {
  const valid = validAttempts(c.attempts);
  const N = c.plannedAttempts;
  const done = valid.filter((a) => a.completed === true).length;
  const degraded = valid.filter((a) => a.techniqueDegraded).length;
  const last = valid[valid.length - 1];
  const rpes = valid.map((a) => a.rpe).filter((x): x is number => x != null);
  const pumps = valid.map((a) => a.forearmPump).filter((x): x is number => x != null);
  const maxRpe = rpes.length ? Math.max(...rpes) : null;
  const maxPump = pumps.length ? Math.max(...pumps) : null;
  const facts = `${done}/${N} ukończonych, RPE ostatniej ${last?.rpe ?? '–'}, maks. pompowanie ${maxPump ?? '–'}/10, technika pogorszona w ${degraded} próbach`;

  if (!valid.length) return { outcome: 'hold', reasons: ['Brak ważnych prób – utrzymujemy trudność i zbieramy dane w kolejnej sesji.'] };

  const unsafe = done <= N - 2 || c.stoppedByFatigue || (done < N && degraded >= 2) || degraded > Math.ceil(N / 2);
  if (unsafe) {
    return {
      outcome: 'lower',
      reasons: [`${facts}.`, 'Nie da się ukończyć prób przy zachowaniu bezpiecznej techniki – w kolejnej sesji obniżamy trudność o 1 stopień.'],
    };
  }
  if (done === N && maxRpe != null && maxRpe <= EASY.maxRpe && maxPump != null && maxPump <= EASY.maxPump) {
    return {
      outcome: 'raise',
      reasons: [`${facts}.`, `Wszystkie próby bardzo łatwe (RPE ≤ ${EASY.maxRpe}, pompowanie ≤ ${EASY.maxPump}/10) – test nie mierzy zmęczenia. W kolejnej sesji podnosimy trudność o 1 stopień.`],
    };
  }
  const lastRpe = last?.rpe ?? null;
  if (done === N && lastRpe != null && lastRpe >= TARGET_LAST_RPE.min && lastRpe <= TARGET_LAST_RPE.max) {
    return {
      outcome: 'confirmed',
      reasons: [`${facts}.`, `Ostatnia próba w docelowym zakresie RPE ${TARGET_LAST_RPE.min}–${TARGET_LAST_RPE.max} przy ukończeniu wszystkich prób – trudność potwierdzona.`],
    };
  }
  return {
    outcome: 'hold',
    reasons: [`${facts}.`, `Wynik mieszany (cel: wszystkie próby ukończone, ostatnia RPE ${TARGET_LAST_RPE.min}–${TARGET_LAST_RPE.max}) – utrzymujemy trudność i zbieramy dodatkowe dane w kolejnej sesji.`],
  };
}

/** Maksymalna liczba sesji kalibracyjnych – potem przyjmujemy najlepiej dopasowaną trudność */
export const MAX_CALIBRATION_RUNS = 3;

export function initialCalibration(c: TestCandidate): CalibrationState {
  return { status: 'pending', level: c.level, grade: c.grade, candidateReasons: c.reasons, runs: [] };
}

/**
 * Zapis wyniku sesji kalibracyjnej i decyzja o kolejnej.
 * - confirmed → koniec kalibracji,
 * - hold dwa razy z rzędu na tej samej trudności → wystarczająco danych, trudność potwierdzona,
 * - limit sesji → kończymy kalibrację bez kolejnych testów: przyjmujemy trudność bieżącej sesji (jej dane już są),
 *   a jeśli wymagała obniżenia – najtrudniejszą wcześniejszą trudność bez obniżenia.
 */
export function applyCalibrationRun(state: CalibrationState, run: CalibrationRun): CalibrationState {
  const runs = [...state.runs, run];
  const prev = state.runs[state.runs.length - 1];
  let status: CalibrationState['status'] = 'pending';
  let grade = run.grade;
  if (run.outcome === 'confirmed') status = 'confirmed';
  else if (run.outcome === 'hold' && prev?.outcome === 'hold' && prev.grade === run.grade) status = 'confirmed';
  else if (run.outcome === 'raise') grade = shiftGrade(run.grade, 1);
  else if (run.outcome === 'lower') grade = shiftGrade(run.grade, -1);

  if (runs.length > MAX_CALIBRATION_RUNS) {
    // Bezpiecznik: sesja dodatkowa po limicie zawsze kończy kalibrację na trudności, którą faktycznie wykonano
    return { ...state, status: 'confirmed', grade: run.grade, level: levelForGrade(run.grade), runs };
  }
  if (status === 'pending' && runs.length >= MAX_CALIBRATION_RUNS) {
    if (run.outcome !== 'lower') grade = run.grade;
    else grade = runs.filter((r) => r.outcome !== 'lower').sort((a, b) => gradeIndex(b.grade) - gradeIndex(a.grade))[0]?.grade ?? grade;
    status = 'confirmed';
  }
  return { ...state, status, grade, level: levelForGrade(grade), runs };
}

/**
 * Retest: test bazowy zostaje bez zmian. Jeśli stał się zbyt łatwy, proponujemy osobny benchmark
 * o 1 stopień trudniejszy – jako dodatkowy test, nie zamiennik.
 */
export function retestTooEasy(c: ClimbingAssessment): { tooEasy: boolean; suggestedGrade: string | null; reason: string | null } {
  const v = evaluateCalibration(c);
  if (v.outcome !== 'raise') return { tooEasy: false, suggestedGrade: null, reason: null };
  const g = shiftGrade(c.route.frenchGrade, 1);
  return {
    tooEasy: true,
    suggestedGrade: g,
    reason: `Test bazowy (${c.plannedAttempts} × ${c.route.frenchGrade}) był bardzo łatwy. Zostaje bez zmian dla porównań; dodajemy osobny benchmark na ${g} na kolejne cykle.`,
  };
}
