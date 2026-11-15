/**
 * Timer faz treningu oparty na znacznikach czasu (nie na stanie komponentu).
 * Stan timera jest zapisywany w szkicu sesji, więc po odświeżeniu, zmianie widoku lub powrocie
 * do aplikacji pozostały czas jest odtwarzany z zegara systemowego.
 */
export type TimerKind = 'work' | 'rest';

export interface PhaseTimer {
  kind: TimerKind;
  /** Krótki opis fazy, np. „Zwis”, „Przerwa między seriami” */
  label: string;
  startedAt: string;
  durationSec: number;
  /** Moment wstrzymania (null = biegnie) */
  pausedAt: string | null;
  /** Suma wcześniejszych pauz w ms */
  pausedMs: number;
}

export function startTimer(kind: TimerKind, label: string, durationSec: number, at: string): PhaseTimer {
  return { kind, label, startedAt: at, durationSec, pausedAt: null, pausedMs: 0 };
}

/** Upływ czasu w sekundach (bez pauz), ograniczony do długości fazy */
export function timerElapsed(t: PhaseTimer, nowMs: number): number {
  const end = t.pausedAt ? Date.parse(t.pausedAt) : nowMs;
  const e = (end - Date.parse(t.startedAt) - t.pausedMs) / 1000;
  return Math.min(t.durationSec, Math.max(0, e));
}

export function timerRemaining(t: PhaseTimer, nowMs: number): number {
  return Math.max(0, t.durationSec - timerElapsed(t, nowMs));
}

export function timerDone(t: PhaseTimer, nowMs: number): boolean {
  return !t.pausedAt && timerRemaining(t, nowMs) <= 0;
}

/** Moment końca fazy (ms) – podstawa do deterministycznego odtworzenia kolejnych faz */
export function timerEndMs(t: PhaseTimer): number {
  return Date.parse(t.startedAt) + t.pausedMs + t.durationSec * 1000;
}

export function pauseTimer(t: PhaseTimer, at: string): PhaseTimer {
  return t.pausedAt ? t : { ...t, pausedAt: at };
}

export function resumeTimer(t: PhaseTimer, at: string): PhaseTimer {
  if (!t.pausedAt) return t;
  return { ...t, pausedAt: null, pausedMs: t.pausedMs + Math.max(0, Date.parse(at) - Date.parse(t.pausedAt)) };
}

export function timerProgress(t: PhaseTimer, nowMs: number): number {
  return t.durationSec > 0 ? timerElapsed(t, nowMs) / t.durationSec : 1;
}

/** mm:ss (sekundy w górę – 0:01 do ostatniej chwili) */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec - 1e-6));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
