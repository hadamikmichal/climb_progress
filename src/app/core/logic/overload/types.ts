import { CompletedWorkout, TrainingParams } from '../../models/models';
import { Change, HistoryEntry, ProgressionContext, ProgressionDecision, SessionAssessment, Track } from '../progression';

/**
 * Kontrakt serwisów progresji (Progressive Overload Engine).
 * Każdy tor (Max Hangs, drogi tlenowe, obwody, trudne drogi) ma własny serwis z regułami,
 * a ProgressiveOverloadService prowadzi wspólny algorytm: pominięcia, deload, przerwy, seria udanych sesji.
 */

/** Jeden warunek progresji – pokazywany użytkownikowi przy każdej sesji */
export interface ProgressionCondition {
  key: string;
  label: string;
  /** true = spełniony, false = niespełniony (blokuje progresję), null = brak danych (nie blokuje) */
  met: boolean | null;
  detail: string;
}

/** Ocena jednej sesji w danym torze */
export interface SessionCheck extends SessionAssessment {
  conditions: ProgressionCondition[];
  /** Wszystkie warunki spełnione – sesja liczy się do serii udanych */
  successful: boolean;
  /** Ból palców (podczas zwisów lub następnego dnia) */
  pain: boolean;
}

/** Przyczyna niepowodzenia – decyduje, który parametr zmieniamy */
export type FailureCause = 'pain' | 'technique' | 'fatigue' | 'volume';
/** Kontekst zmniejszenia: zła sesja, dwie częściowe z rzędu, powrót po przerwie / pominięciach */
export type ReduceReason = 'bad' | 'partials' | 'break';

export type CompletedEntry = Extract<HistoryEntry, { kind: 'completed' }>;

/** Dane dla reguł specyficznych toru (kalibracja, ból) */
export interface SpecialInput {
  history: HistoryEntry[];
  last: CompletedWorkout;
  check: SessionCheck;
  params: TrainingParams;
  ctx: ProgressionContext;
  /** Gotowe konstruktory decyzji z ujednoliconym nextStep / blockers */
  hold: (reason: string, ids?: string[], blockers?: string[], extra?: Partial<ProgressionDecision>) => ProgressionDecision;
  change: (action: 'progress' | 'reduce' | 'hold', ch: Change, reason: string, ids: string[], extra?: Partial<ProgressionDecision>) => ProgressionDecision;
}

export interface TrackProgressionService {
  readonly track: Track;
  /** Ocena sesji: warunki progresji, fakty, problemy */
  check(w: CompletedWorkout): SessionCheck;
  /** Kolejny krok progresji (zawsze jeden parametr) albo null = górna granica */
  progress(params: TrainingParams, good: CompletedWorkout[]): Change | null;
  /** Zmniejszenie jednego parametru albo null = bez automatycznego zmniejszania */
  reduce(params: TrainingParams, cause: FailureCause, reason: ReduceReason): Change | null;
  /** Przyczyna niepowodzenia sesji */
  cause(w: CompletedWorkout): FailureCause;
  /** Warunki progresji – krótki opis */
  criteria(params: TrainingParams): string;
  /** Reguły sprawdzane przed wspólnym algorytmem (np. kalibracja, ból palców) */
  special?(input: SpecialInput): ProgressionDecision | null;
  /** Zła sesja: zmiana (zmniejszenie) albo null = utrzymanie z analizą przyczyny */
  onBad?(params: TrainingParams, w: CompletedWorkout, check: SessionCheck): { change: Change | null; reason: string };
  /** Uzasadnienie utrzymania po sesji, która nie spełniła warunków */
  explainHold?(w: CompletedWorkout, check: SessionCheck): string;
  /** Uzasadnienie progresji */
  explainProgress?(ch: Change, good: CompletedWorkout[]): string;
  /** Dodatkowa analiza historii (np. poprawa konkretnych sekwencji) */
  analyze?(sessions: CompletedWorkout[]): string[];
  /** Propozycja przy górnej granicy (do ręcznego zatwierdzenia) */
  ceiling?(params: TrainingParams): string | undefined;
}
