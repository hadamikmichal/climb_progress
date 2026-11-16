import type { Assessment, AssessmentPart } from './assessment';

/**
 * Model danych ClimbProgress.
 * Wszystkie daty kalendarzowe są w formacie lokalnym `YYYY-MM-DD` (ISODate),
 * a znaczniki czasu w ISO 8601 (`new Date().toISOString()`).
 */

export type ISODate = string;
export type Timestamp = string;

/** 1 = poniedziałek ... 7 = niedziela */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** A – trudne drogi i cruxy, B – Max Hangs + wytrzymałość tlenowa, C – wytrzymałość siłowa */
export type TrainingType = 'A' | 'B' | 'C';
export type TestKind = 'BASELINE' | 'CONTROL' | 'FINAL';
export type WorkoutType = TrainingType | TestKind;

export type WorkoutStatus = 'planned' | 'done' | 'partial' | 'skipped' | 'moved';
export type SkipReason = 'time' | 'fatigue' | 'pain' | 'illness' | 'other' | 'no_slot';

/** Styl przejścia trudnej drogi (trening A) */
export type AscentStyle = 'onsight' | 'flash' | 'redpoint';

export type GripPosition = 'half_crimp' | 'open_hand' | 'full_crimp' | 'three_finger_drag';
export type HoldType = 'edge' | 'pocket' | 'sloper' | 'jug';

export interface UserProfile {
  id: 'me';
  name: string;
  heightCm: number;
  weightKg: number;
  /** Aktualny deklarowany poziom (najtrudniejsza droga RP/OS), np. "6b+" */
  grade: string;
  targetGrade: string;
  routeLengthM: number;
  /** Przypisanie typów treningów do dni tygodnia */
  trainingDays: Record<TrainingType, Weekday>;
  hangboard: HangboardSetup;
  /** Wywiad do kalibracji testu (Adaptive Engine v2); brak = wartości wyprowadzane z `grade` */
  intake?: ClimberIntake;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface HangboardSetup {
  board: string;
  holdType: HoldType;
  /** Etykieta krawądki, np. "Krawądka środkowa, 2. rząd" */
  edge: string;
  /** Rozmiar w mm – opcjonalny, bo rozmiary krawądek Beastmakera 2000 nie są jednakowe */
  edgeSizeMm: number | null;
  grip: GripPosition;
}

/* ---------------- Parametry treningowe (poziom obciążenia) ---------------- */

export interface HangboardParams {
  holdType: HoldType;
  edge: string;
  edgeSizeMm: number | null;
  grip: GripPosition;
  hangSec: number;
  sets: number;
  restSec: number;
  addedKg: number;
  assistKg: number;
  /** Max Hangs (domyślnie) lub Repeaters – osobne protokoły, Repeaters wyłącznie z wyboru użytkownika */
  protocol?: FingerProtocol;
  /** Repeaters: czas zwisu / przerwy w powtórzeniu i liczba powtórzeń w serii */
  repeaterOnSec?: number;
  repeaterOffSec?: number;
  repeaterReps?: number;
}

export type FingerProtocol = 'max_hangs' | 'repeaters';

export interface HardRoutesParams {
  gradeFrom: string;
  gradeTo: string;
  maxAttempts: number;
}

export interface AerobicParams {
  routes: number;
  grade: string;
  restMin: number;
  targetMaxPump: number;
  /** Górna granica trudności dróg tlenowych wynikająca z profilu (brak = bez limitu) */
  gradeCap?: string;
}

/**
 * Protokoły wytrzymałości siłowej. Każdy jest odwzorowany na kształt serie × jednostki:
 * - rope_NxM: serie × drogi w serii,
 * - boulder_4x4: rundy × problemy (wycena Font),
 * - route_intervals: rundy × 1 interwał (czas wspinania `workSec`, odpoczynek `restBetweenSetsMin`),
 * - linked_routes: serie × drogi łączone bez długiego odpoczynku.
 */
export type PeProtocol = 'rope_2x3' | 'rope_3x3' | 'rope_4x4' | 'boulder_4x4' | 'route_intervals' | 'linked_routes';

export interface PowerEnduranceParams {
  sets: number;
  routesPerSet: number;
  grade: string;
  restBetweenRoutesMin: number;
  restBetweenSetsMin: number;
  /** Brak = wyprowadzany z kształtu (2 × 3 / 3 × 3 / 4 × 4) – dane sprzed v2 */
  protocol?: PeProtocol;
  /** Interwały: czas wspinania w jednej rundzie (s) */
  workSec?: number;
  /** Boulder 4 × 4: orientacyjna liczba przechwytów w problemie */
  movesPerProblem?: number;
  /** Górna granica trudności wynikająca z profilu zdolności (brak = bez limitu) */
  gradeCap?: string;
}

export interface TrainingParams {
  hangboard: HangboardParams;
  hardRoutes: HardRoutesParams;
  aerobic: AerobicParams;
  powerEndurance: PowerEnduranceParams;
}

export interface TrainingCycle {
  id: string;
  name: string;
  status: 'baseline' | 'active' | 'completed' | 'archived';
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** Data testu początkowego */
  baselineDate: ISODate;
  /** Poniedziałek 1. tygodnia treningowego – ustawiany po teście początkowym */
  planStart: ISODate | null;
  weeks: number;
  /** Tygodnie z obniżonym obciążeniem */
  deloadWeeks: number[];
  /** Tygodnie, po których wykonywany jest test kontrolny */
  controlTestAfterWeeks: number[];
  /** Aktualny poziom obciążenia – zmieniany wyłącznie przez moduł adaptacji lub ręcznie */
  params: TrainingParams;
  /** Parametry na starcie cyklu – do porównań */
  initialParams: TrainingParams;
  /** Kalibracja trudności testu dróg (Baseline) – może wymagać kolejnej sesji */
  calibration?: CalibrationState;
  /** Zablokowany protokół testu dróg – przenoszony do kolejnych cykli bez zmian */
  benchmark?: BenchmarkProtocol;
  /** Dodatkowe testy na wyższym poziomie (gdy test bazowy stał się zbyt łatwy) */
  extraBenchmarks?: BenchmarkProtocol[];
  /** Profile zdolności i priorytety wyliczone po Baseline Test – podstawa doboru planu */
  abilities?: AbilityReport;
}

/* ---------------- Profile zdolności i kalibracja ---------------- */

export type AbilityKey = 'finger' | 'powerEndurance' | 'aerobic';
/** Wewnętrzna klasyfikacja programu – nie jest oficjalną oceną sportową */
export type AbilityStatus = 'underdeveloped' | 'developing' | 'established' | 'advanced';

export interface AbilityProfile {
  key: AbilityKey;
  status: AbilityStatus;
  /** Wynik 0–1 w obrębie skali (rozstrzyga remisy statusów) */
  score: number;
  /** Ile danych wejściowych było dostępnych */
  confidence: 'low' | 'medium' | 'high';
  /** Fakty, z których wynika status – zawsze widoczne dla użytkownika */
  evidence: string[];
  /** Czego brakowało do pełnej oceny */
  missing: string[];
}

export interface AbilityReport {
  generatedAt: Timestamp;
  sourceAssessmentId: string | null;
  profiles: Record<AbilityKey, AbilityProfile>;
  strongest: AbilityKey;
  mainLimitation: AbilityKey;
  secondaryLimitation: AbilityKey;
  /** Priorytet treningowy – zdanie dla użytkownika */
  priority: string;
  recommendedProtocol: PeProtocol;
  fingerProtocol: FingerProtocol;
  /** Uzasadnienie doboru protokołów i parametrów */
  reasons: string[];
}

export type TestLevel = 'foundation' | 'intermediate' | 'intermediate_plus' | 'advanced' | 'performance';
export type CalibrationOutcome = 'confirmed' | 'raise' | 'lower' | 'hold';

export interface CalibrationRun {
  date: ISODate;
  grade: string;
  outcome: CalibrationOutcome;
  reasons: string[];
  /** Zaplanowana jednostka, w której wykonano tę próbę kalibracyjną */
  plannedId: string | null;
}

export interface CalibrationState {
  status: 'pending' | 'confirmed';
  level: TestLevel;
  /** Trudność na kolejną (lub bieżącą) sesję testu dróg */
  grade: string;
  /** Uzasadnienie trudności kandydackiej z wywiadu */
  candidateReasons: string[];
  runs: CalibrationRun[];
}

export interface BenchmarkProtocol {
  id: string;
  level: TestLevel;
  grade: string;
  routeName: string;
  location: string;
  wallStyle: import('./assessment').WallStyle;
  /** Sposób asekuracji */
  climbingStyle: import('./assessment').ClimbingStyle;
  heightMeters: number;
  restSeconds: number;
  /** Liczba prób w ustalonej kolejności na tej samej drodze */
  attempts: number;
  lockedAt: Timestamp;
  sourceAssessmentId: string | null;
  /** Jawne zmiany protokołu – każda z powodem */
  changes: { at: Timestamp; field: string; from: string; to: string; reason: string }[];
  /** Dla testów dodatkowych: powód dodania */
  note?: string;
}

/* ---------------- Szablony ---------------- */

export type ExerciseKind = 'warmup' | 'hangboard' | 'hard_routes' | 'routes' | 'circuit' | 'technique' | 'test_routes' | 'test_extra' | 'cooldown';

export interface Exercise {
  id: string;
  kind: ExerciseKind;
  name: string;
  description: string;
  durationMin: number;
  /** Lista punktów do odhaczenia (np. elementy rozgrzewki) */
  checklist?: string[];
}

export interface WorkoutTemplate {
  type: WorkoutType;
  code: string;
  name: string;
  goal: string;
  durationMin: number;
  intensity: 'niska' | 'umiarkowana' | 'wysoka';
  heavy: boolean;
  exercises: Exercise[];
  safetyNotes: string[];
}

/* ---------------- Plan ---------------- */

export interface PlannedWorkout {
  id: string;
  cycleId: string;
  type: WorkoutType;
  /** 0 = test początkowy, 1..N = tydzień cyklu, N+1 = test końcowy */
  week: number;
  date: ISODate;
  originalDate: ISODate;
  /** Kolejność w ramach dnia (np. test kontrolny przed treningiem B) */
  order: number;
  /** Sesja Baseline Test v1.0: dzień 1 (siła) lub dzień 2 (drogi). Brak = test w starym formacie 3 × 6a */
  part?: AssessmentPart;
  status: WorkoutStatus;
  skipReason?: SkipReason;
  skipNote?: string;
  /** Historia przesunięć – zawsze z wyjaśnieniem */
  moves: { from: ISODate; to: ISODate; at: Timestamp; reason: string }[];
  completedWorkoutId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/* ---------------- Wykonanie ---------------- */

export interface RouteLog {
  id: string;
  order: number;
  /** Numer serii w obwodzie (0 dla treningów bez serii) */
  setIndex: number;
  grade: string;
  lengthM: number;
  /** Ukończona bez odpadnięcia */
  completed: boolean;
  pump: number | null;
  rpe: number | null;
  cruxSent?: boolean | null;
  techniqueDegraded?: boolean | null;
  /** Styl przejścia (tylko ukończone trudne drogi); brak = nie podano */
  ascent?: AscentStyle | null;
  notes: string;
  timestamp: Timestamp;
}

export interface HangboardLog {
  id: string;
  date: ISODate;
  board: string;
  holdType: HoldType;
  edge: string;
  edgeSizeMm: number | null;
  grip: GripPosition;
  hangSec: number;
  setsPlanned: number;
  setsDone: number;
  addedKg: number;
  assistKg: number;
  rpe: number | null;
  pain: boolean;
  notes: string;
  timestamp: Timestamp;
}

export interface SetLog {
  setIndex: number;
  rpe: number | null;
  pump: number | null;
  notes: string;
}

export interface ExerciseLog {
  exerciseId: string;
  name: string;
  kind: ExerciseKind;
  done: boolean;
  checked: string[];
}

export interface CompletedWorkout {
  id: string;
  plannedWorkoutId: string | null;
  cycleId: string;
  type: TrainingType;
  week: number;
  deload: boolean;
  date: ISODate;
  startedAt: Timestamp;
  finishedAt: Timestamp;
  durationMin: number;
  completion: 'full' | 'partial';
  /** Parametry, z jakimi trening był zaplanowany (snapshot) */
  prescription: TrainingParams;
  exercises: ExerciseLog[];
  routes: RouteLog[];
  hangs: HangboardLog[];
  sets: SetLog[];
  rpe: number | null;
  pump: number | null;
  /** Jakość techniki 1–5 */
  technique: number | null;
  /** Samopoczucie po treningu 1–5 */
  feelingAfter: number | null;
  notes: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/* ---------------- Gotowość ---------------- */

export interface ReadinessCheck {
  id: string;
  date: ISODate;
  timestamp: Timestamp;
  wellbeing: number;
  fatigue: number;
  sleep: number;
  fingerPain: boolean;
  elbowShoulderPain: boolean;
  unusualFatigue: boolean;
  notes: string;
}

/* ---------------- Testy ---------------- */

export interface TestRouteLog {
  order: number;
  grade: string;
  completed: boolean;
  rpe: number | null;
  pump: number | null;
  techniqueDegraded: boolean;
  notes: string;
}

export interface TestBase {
  id: string;
  cycleId: string;
  plannedWorkoutId: string | null;
  date: ISODate;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  routes: TestRouteLog[];
  /** Subiektywna rezerwa siłowa po teście: 1 (brak) – 5 (duża) */
  reserve: number | null;
  notes: string;
}

/** Test 3 × 6a – początkowy lub końcowy (identyczna procedura) */
export interface BaselineTest extends TestBase {
  kind: 'BASELINE' | 'FINAL';
  crux?: CruxCheck | null;
  hangboard?: HangboardCheck | null;
}

/** Test kontrolny w trakcie cyklu */
export interface ProgressTest extends TestBase {
  kind: 'CONTROL';
  afterWeek: number;
  crux: CruxCheck | null;
  hangboard: HangboardCheck | null;
}

export type TestResult = BaselineTest | ProgressTest;

export interface CruxCheck {
  attempts: number;
  sent: number;
}

export interface HangboardCheck {
  edge: string;
  grip: GripPosition;
  hangSec: number;
  addedKg: number;
  assistKg: number;
  rpe: number | null;
}

/* ---------------- Adaptacja i raporty ---------------- */

export type AdaptationKind = 'progress' | 'hold' | 'reduce' | 'reschedule' | 'skip' | 'deload' | 'readiness' | 'manual' | 'plan';

export interface AdaptationEvent {
  id: string;
  cycleId: string;
  timestamp: Timestamp;
  kind: AdaptationKind;
  workoutType?: WorkoutType;
  parameter?: string;
  from?: string;
  to?: string;
  /** Wyjaśnienie w języku polskim – zawsze widoczne dla użytkownika */
  reason: string;
  sourceIds: string[];
}

export interface WeeklyReport {
  id: string;
  cycleId: string;
  week: number;
  weekStart: ISODate;
  generatedAt: Timestamp;
  planned: number;
  done: number;
  partial: number;
  skipped: number;
  aerobicRoutes: number;
  avgPump: number | null;
  prevAvgPump: number | null;
  hangboardChange: string | null;
  lines: string[];
  nextWeek: string[];
}

/** Szkic aktywnej sesji – zapisywany na bieżąco, aby odświeżenie strony nie gubiło danych */
export interface SessionDraft {
  id: string;
  kind: 'workout' | 'test';
  startedAt: Timestamp;
  updatedAt: Timestamp;
  data: unknown;
}

export interface ExportFile {
  app: 'ClimbProgress';
  version: number;
  exportedAt: Timestamp;
  data: AppData;
}

export interface AppData {
  profile: UserProfile[];
  cycles: TrainingCycle[];
  planned: PlannedWorkout[];
  completed: CompletedWorkout[];
  readiness: ReadinessCheck[];
  tests: TestResult[];
  events: AdaptationEvent[];
  reports: WeeklyReport[];
  drafts: SessionDraft[];
  assessments: Assessment[];
}

/* ---------------- Adaptive Training Engine v2 ---------------- */

/** Charakterystyczny styl wspinania deklarowany przez użytkownika */
export type ClimbingStylePref = 'technical' | 'crimpy' | 'overhang' | 'endurance' | 'bouldery' | 'mixed';

/**
 * Wywiad przed Baseline Test – służy do dobrania kandydackiej trudności testu dróg.
 * Wszystkie wyceny w skali francuskiej; boulder w skali Font (opcjonalnie).
 */
export interface ClimberIntake {
  /** Najtrudniejsza droga RP */
  rpGrade: string | null;
  /** Najtrudniejsza droga OS / flash */
  osGrade: string | null;
  /** Trudność, na której użytkownik regularnie kończy kilka dróg w jednej sesji */
  repeatableGrade: string | null;
  style: ClimbingStylePref;
  /** Orientacyjna liczba dróg w typowej sesji */
  routesPerSession: number | null;
  /** Najtrudniejszy boulder (Font) – tylko do doboru Boulder 4 × 4 */
  boulderGrade: string | null;
}
