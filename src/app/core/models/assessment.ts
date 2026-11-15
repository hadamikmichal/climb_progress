/**
 * Baseline Test v1.0 – model danych.
 *
 * Zapisujemy wyłącznie surowe pomiary (próby, czasy, oceny). Wszystkie wartości pochodne
 * (obciążenie całkowite, % masy ciała, punktacja 9c, statystyki czasu, wskaźniki regeneracji)
 * liczą czyste funkcje z core/logic/assessment – dzięki temu poprawka pomiaru nie zostawia
 * nieaktualnych wyników.
 */
import { ISODate, Timestamp } from './models';

export type TestStatus = 'scheduled' | 'in_progress' | 'completed' | 'invalid' | 'postponed';
export type AttemptStatus = 'success' | 'failed' | 'invalid' | 'not_tested';
export type CoreExercise = 'bent_knee_l_sit' | 'full_l_sit' | 'front_lever';
export type AssessmentKind = 'BASELINE' | 'CONTROL' | 'FINAL';
export type AssessmentPart = 'strength' | 'climbing';
export type WallStyle = 'vertical' | 'overhang' | 'roof' | 'mixed';
export type ClimbingStyle = 'lead' | 'top_rope';
export type DeadHangEndReason = 'released' | 'position_lost' | 'regrip' | 'time_cap' | 'pain' | 'other';
export type RouteFailReason = 'fatigue' | 'non_effort';

export const PROTOCOL_VERSION = '1.0' as const;
/** Dokładna przerwa między próbami testu dróg */
export const ROUTE_REST_SEC = 180;
export const RECOVERY_POINTS = [0, 60, 120, 180] as const;
export type RecoveryPoint = (typeof RECOVERY_POINTS)[number];

/** Warunki początkowe – wypełniane przed każdą sesją */
export interface SessionReadiness {
  bodyMassKg: number | null;
  /** Data i godzina testu */
  testedAt: Timestamp;
  sleepHours: number | null;
  /** 1–5 */
  wellbeing: number | null;
  /** 1–5 */
  fatigue: number | null;
  fingerPain: boolean | null;
  elbowPain: boolean | null;
  shoulderPain: boolean | null;
  illness: boolean | null;
  /** Intensywny trening w ostatnich 48 h */
  recentHardTraining: boolean | null;
  painNotes: string;
  /** Użytkownik świadomie kontynuuje mimo ostrzeżeń (bez bólu) – wynik oznaczony jako mniej porównywalny */
  acknowledgedWarnings: boolean;
  confirmed: boolean;
}

/* ---------------- Dzień 1 – Strength Assessment ---------------- */

export interface StrengthTrial {
  addedWeightKg: number;
  reps: number;
  successful: boolean;
  techniqueValid: boolean;
  rpe: number | null;
  notes: string;
}

export interface WeightedPullUpResult {
  status: AttemptStatus;
  attempts: StrengthTrial[];
  /** Powód pominięcia (np. brak doświadczenia z obciążeniem) */
  skipReason: string;
  notes: string;
}

export interface FingerStrengthTrial {
  addedWeightKg: number;
  assistanceKg: number;
  holdSeconds: number;
  successful: boolean;
  technicallyValid: boolean;
  rpe: number | null;
  notes: string;
}

export interface MaxFingerStrengthResult {
  status: AttemptStatus;
  /** Rzeczywista głębokość krawądki podana przez użytkownika */
  edgeDepthMm: number | null;
  edgeLabel: string;
  gripType: 'half_crimp';
  holdDurationTargetSec: 5;
  attempts: FingerStrengthTrial[];
  skipReason: string;
  notes: string;
}

export interface CoreTrial {
  exercise: CoreExercise;
  holdSeconds: number;
  technicallyValid: boolean;
  notes: string;
}

export interface CoreStrengthResult {
  status: AttemptStatus;
  attempts: CoreTrial[];
  skipReason: string;
  notes: string;
}

export interface DeadHangResult {
  status: AttemptStatus;
  holdSeconds: number | null;
  barDiameterMm: number | null;
  gripType: 'pronated';
  endReason: DeadHangEndReason | null;
  /** Start stopera – zapisany, aby odświeżenie strony nie przerwało pomiaru */
  timerStartedAt: Timestamp | null;
  skipReason: string;
  notes: string;
}

export type StrengthStep = 'readiness' | 'warmup' | 'pullup' | 'finger' | 'core' | 'deadhang' | 'summary';

export interface StrengthAssessment {
  status: TestStatus;
  date: ISODate;
  startedAt: Timestamp;
  completedAt: Timestamp | null;
  readiness: SessionReadiness;
  warmupChecked: string[];
  step: StrengthStep;
  weightedPullUp: WeightedPullUpResult;
  maxFingerStrength: MaxFingerStrengthResult;
  coreStrength: CoreStrengthResult;
  deadHang: DeadHangResult;
  notes: string;
}

/* ---------------- Dzień 2 – Climbing Performance ---------------- */

export interface TestRoute {
  routeId: string;
  name: string;
  location: string;
  frenchGrade: string;
  heightMeters: number;
  wallStyle: WallStyle;
  climbingStyle: ClimbingStyle;
  imageUrl: string;
  /** Droga znana i wcześniej ukończona */
  knownAndSent: boolean;
}

export interface RouteAttempt {
  /** Kolejny numer próby (próby nieważne też dostają numer) */
  index: number;
  status: AttemptStatus;
  startedAt: Timestamp | null;
  endedAt: Timestamp | null;
  /** Czas przejścia w sekundach (bez opuszczania) */
  ascentTimeSeconds: number | null;
  /** Rzeczywista przerwa przed próbą (od powrotu na ziemię) */
  restBeforeSeconds: number | null;
  completed: boolean | null;
  failReason: RouteFailReason | null;
  rpe: number | null;
  forearmPump: number | null;
  techniqueDegraded: boolean | null;
  problemMove: boolean | null;
  failurePoint: string;
  notes: string;
  /** Formularz po drodze zatwierdzony */
  saved: boolean;
}

export interface RecoveryMeasurement {
  elapsedSeconds: RecoveryPoint;
  forearmPump: number | null;
}

export interface ClimbingAssessment {
  status: TestStatus;
  date: ISODate;
  startedAt: Timestamp;
  completedAt: Timestamp | null;
  readiness: SessionReadiness;
  warmupChecked: string[];
  route: TestRoute;
  /** 4 w teście pełnym, 3 w teście pośrednim */
  plannedAttempts: number;
  restSeconds: number;
  attempts: RouteAttempt[];
  /** Powrót na ziemię – start odliczania przerwy */
  restStartedAt: Timestamp | null;
  /** Test zakończony przed czasem z powodu narastającego zmęczenia */
  stoppedByFatigue: boolean;
  recoveryStartedAt: Timestamp | null;
  recoveryCurve: RecoveryMeasurement[];
  /** Droga inna niż w teście odniesienia – wynik mniej porównywalny */
  routeChanged: boolean;
  notes: string;
}

export interface Assessment {
  id: string;
  cycleId: string;
  kind: AssessmentKind;
  protocolVersion: typeof PROTOCOL_VERSION;
  status: TestStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt: Timestamp | null;
  /** Dzień 1 (BASELINE, FINAL); null w teście pośrednim */
  strength: StrengthAssessment | null;
  climbing: ClimbingAssessment | null;
  /** Identyfikatory zaplanowanych jednostek realizowanych przez ten test */
  plannedIds: string[];
  notes: string;
}

/* ---------------- Wyniki pochodne ---------------- */

export interface NineCScore {
  fingerStrength: number | null;
  pullingStrength: number | null;
  coreStrength: number | null;
  endurance: number | null;
  /** Tylko przy komplecie czterech pomiarów */
  totalPoints: number | null;
  maxPoints: 40;
  isComplete: boolean;
  estimatedGrade: string | null;
  interpretation: 'complete' | 'incomplete' | 'not_available';
}

export interface WeeklyTestComparison {
  key: string;
  label: string;
  unit: string;
  initialTestId: string;
  comparisonTestId: string;
  initialValue: number | null;
  currentValue: number | null;
  absoluteChange: number | null;
  /** Tylko dla skal ilorazowych i niezerowej wartości początkowej */
  percentageChange: number | null;
  interpretation: 'improved' | 'unchanged' | 'declined' | 'not_comparable';
}
