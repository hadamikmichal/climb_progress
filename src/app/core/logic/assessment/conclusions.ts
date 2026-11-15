import { Assessment } from '../../models/assessment';
import { climbingResults } from './climbing';
import { strengthResults } from './scoring';

export type FocusArea = 'finger' | 'repeatability' | 'pacing' | 'pump' | 'recovery' | 'grip_endurance' | 'pulling' | 'core';

/** Kolejność priorytetów wg zasady nadrzędnej testu – siła palców, powtarzalność, tempo, pompowanie, regeneracja */
export const FOCUS_PRIORITY: FocusArea[] = ['finger', 'repeatability', 'pacing', 'pump', 'recovery', 'grip_endurance', 'pulling', 'core'];

export const FOCUS_LABELS: Record<FocusArea, string> = {
  finger: 'Siła palców',
  repeatability: 'Powtarzalność trudnych dróg',
  pacing: 'Utrzymanie tempa przy narastającym zmęczeniu',
  pump: 'Pompowanie przedramion',
  recovery: 'Tempo regeneracji przedramion',
  grip_endurance: 'Wytrzymałość chwytu',
  pulling: 'Siła przyciągania',
  core: 'Siła core',
};

export interface Conclusion {
  kind: 'weakness' | 'strength' | 'info';
  text: string;
  area?: FocusArea;
}

export interface ConclusionsResult {
  lines: Conclusion[];
  /** Obszary wymagające największej pracy – uporządkowane wg priorytetu */
  focus: { area: FocusArea; label: string; reasons: string[] }[];
  missing: string[];
}

/**
 * Wnioski wyłącznie na podstawie rzeczywistych wyników. Nie diagnozują problemów zdrowotnych
 * i nie łączą zdolności w jeden wynik – każda reguła dotyczy konkretnej zależności.
 */
export function generateConclusions(a: Assessment): ConclusionsResult {
  const lines: Conclusion[] = [];
  const missing: string[] = [];
  const s = a.strength ? strengthResults(a.strength) : null;
  const c = a.climbing ? climbingResults(a.climbing) : null;

  const finger = s?.finger.score ?? null;
  const pull = s?.pullUp.score ?? null;
  const hang = s?.deadHang.score ?? null;
  const core = s?.core.score ?? null;
  if (a.strength) {
    if (finger == null) missing.push('Max Finger Strength');
    if (pull == null) missing.push('Weighted Pull-up');
    if (core == null) missing.push('Core');
    if (hang == null) missing.push('Dead Hang');
  }
  if (a.kind !== 'CONTROL' && !a.strength) missing.push('Dzień 1 – Strength Assessment');
  if (!a.climbing) missing.push('Dzień 2 – Climbing Performance');

  // Siła palców vs przyciąganie
  if (finger != null && pull != null) {
    if (finger <= pull - 2) {
      lines.push({ kind: 'weakness', area: 'finger', text: `Relatywnie słaba siła palców w stosunku do siły przyciągania (palce ${finger}/10, podciąganie ${pull}/10).` });
    } else if (finger >= pull + 2) {
      lines.push({ kind: 'info', area: 'pulling', text: `Siła palców wyraźnie wyprzedza siłę przyciągania (palce ${finger}/10, podciąganie ${pull}/10).` });
    }
  }
  if (finger != null && finger <= 2) {
    const pct = s!.finger.bodyMassRatioPercent;
    lines.push({ kind: 'weakness', area: 'finger', text: `Niska siła palców w wartościach bezwzględnych${pct != null ? ` (${Math.round(pct)}% masy ciała na krawądce)` : ''}.` });
  }

  if (c) {
    const t = c.time;
    const r = c.recovery;
    const planned = a.climbing!.plannedAttempts;
    const lastPump = r.pumpAfterLastRoute;

    if (t.completedRoutes < planned) {
      lines.push({ kind: 'weakness', area: 'repeatability', text: `Ukończono ${t.completedRoutes} z ${planned} powtórzeń drogi${a.climbing!.stoppedByFatigue ? ' – test przerwany z powodu narastającego zmęczenia' : ''}.` });
    } else {
      lines.push({ kind: 'strength', text: `Wszystkie ${planned} powtórzenia drogi ukończone.` });
    }
    if (finger != null && pull != null && finger >= pull && finger >= 4 && (t.completedRoutes < planned || (lastPump != null && lastPump >= 7))) {
      lines.push({ kind: 'weakness', area: 'repeatability', text: `Duża siła palców (${finger}/10) przy słabej powtarzalności wysiłku – rezerwa siły nie przekłada się na kolejne powtórzenia.` });
    }
    if (t.timeChangePercent != null) {
      if (t.timeChangePercent >= 10) {
        lines.push({ kind: 'weakness', area: 'pacing', text: `Spadek tempa na kolejnych powtórzeniach drogi: czas ostatniej ukończonej drogi dłuższy o ${t.timeChangePercent}% niż pierwszej.` });
      } else if (t.timeChangePercent <= 3) {
        lines.push({ kind: 'strength', text: `Tempo utrzymane mimo narastającego zmęczenia (zmiana czasu ${t.timeChangePercent > 0 ? '+' : ''}${t.timeChangePercent}%).` });
      }
    }
    if (lastPump != null && lastPump >= 7 && (t.timeChangePercent == null || t.timeChangePercent < 5)) {
      lines.push({ kind: 'weakness', area: 'pump', text: `Wysokie pompowanie po ostatniej drodze (${lastPump}/10) przy stosunkowo niewielkiej zmianie czasu przejścia – zmęczenie narasta w przedramionach, zanim spadnie tempo.` });
    }
    if (r.pumpRiseFirstToLast != null && r.pumpRiseFirstToLast >= 3) {
      lines.push({ kind: 'weakness', area: 'pump', text: `Pompowanie wyraźnie narasta między pierwszą a ostatnią próbą (${r.pumpAfterFirstRoute}/10 → ${r.pumpAfterLastRoute}/10).` });
    }
    if (r.halfRecovery === 'not_reached') {
      lines.push({ kind: 'weakness', area: 'recovery', text: 'Wolniejszy subiektywny powrót przedramion do komfortowego stanu – spadek pompowania o 50% nie nastąpił w ciągu 3 minut.' });
    } else if (r.halfRecovery === 'reached' && r.halfRecoverySeconds != null && r.halfRecoverySeconds <= 60) {
      lines.push({ kind: 'strength', text: 'Szybki subiektywny powrót przedramion – pompowanie spadło o połowę w ciągu 1 minuty.' });
    }
  }

  if (hang != null && finger != null && hang <= finger - 3) {
    lines.push({ kind: 'weakness', area: 'grip_endurance', text: `Wytrzymałość chwytu na drążku (${hang}/10) niska w stosunku do siły maksymalnej palców (${finger}/10).` });
  }
  if (core != null && core <= 3) {
    lines.push({ kind: 'info', area: 'core', text: `Core na poziomie A (${core}/10) – warto dodać ćwiczenia napięcia całego ciała.` });
  }
  if (pull != null && pull <= 2 && !(finger != null && finger >= pull + 2)) {
    lines.push({ kind: 'info', area: 'pulling', text: `Siła przyciągania na niskim poziomie (${pull}/10).` });
  }

  const byArea = new Map<FocusArea, string[]>();
  for (const l of lines) {
    if (l.kind !== 'weakness' || !l.area) continue;
    byArea.set(l.area, [...(byArea.get(l.area) ?? []), l.text]);
  }
  const focus = FOCUS_PRIORITY.filter((f) => byArea.has(f)).map((area) => ({ area, label: FOCUS_LABELS[area], reasons: byArea.get(area)! }));
  return { lines, focus, missing };
}
