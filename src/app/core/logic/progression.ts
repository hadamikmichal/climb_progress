import { CompletedWorkout, ISODate, TrainingParams, TrainingType } from '../models/models';
import { shiftGrade, gradeIndex, fontIndex, shiftFont } from './grades';
import { GRIP_LABELS } from './templates';
import { describePe, normalizeProtocol, PE_PROTOCOLS, PeLever, protocolOf } from './adaptive/protocols';

/**
 * Wspólne narzędzia progresji – czyste, deterministyczne funkcje (poziomy, opisy, zmiany jednego parametru).
 * Reguły decyzji (kiedy zwiększyć / utrzymać / zmniejszyć) są w core/logic/overload/* – osobny serwis na każdy tor.
 *
 * Reguły ogólne (wspólny algorytm ProgressiveOverloadService, szczegóły każdego toru w jego serwisie):
 *  R1 Sesja „zła” (nieukończenie przy RPE/pompowaniu ≥ 9) → analiza przyczyny; zmiana jednego parametru albo utrzymanie.
 *     Ból palców przy zwisach → koniec ciężkich zwisów, brak progresji, regeneracja i ponowna ocena gotowości.
 *  R2 Dwie ostatnie sesje częściowe na tym samym poziomie → zmniejszenie jednego parametru.
 *  R3 Sesja nie „dobra” (częściowa, wysokie RPE, mocne pompowanie) → utrzymanie poziomu.
 *  R4 Dwie kolejne „dobre” sesje na tym samym poziomie → zwiększenie JEDNEGO parametru.
 *  R5 Pominięcie przerywa serię dobrych sesji – po opuszczeniu utrzymujemy poziom, nie nadrabiamy.
 *  R6 Sesje deload / „lżejsze” nie są brane pod uwagę – ale przerywają serię: pierwsza sesja po deloadzie potwierdza poziom.
 *  R7 Co najmniej 2 kolejne pominięte jednostki albo ≥ 21 dni przerwy → powrót z mniejszą objętością (jeden parametr).
 *  R8 Brak regeneracji (gotowość: ból, duże zmęczenie, złe samopoczucie) → brak progresji mimo dobrej sesji.
 *  R9 Przy niepowodzeniu przyczyna decyduje o parametrze: rozpad techniki / odpadnięcia → trudność,
 *     zmęczenie przy zachowanej technice → objętość, ból → obciążenie. Nigdy nie zwiększamy po niepowodzeniu.
 *
 * Adaptive Engine v2: parametry i ich kolejność zależą od protokołu (Rope 2 × 3 / 3 × 3 / 4 × 4, Boulder 4 × 4,
 * Route Intervals, Linked Routes). Górne granice trudności wynikają z profilu użytkownika (gradeCap), nie ze
 * stałego limitu – silnik obsługuje zarówno 5c, jak i 7c.
 *
 * Progresja jest liczona osobno dla każdego „toru” (track): Max Hangs i drogi tlenowe (oba w treningu B),
 * obwody (C) oraz trudne drogi (A). W ramach jednego toru zmienia się co najwyżej jeden parametr na raz.
 * Progresja wynika z wykonanej pracy, jakości techniki i regeneracji – nigdy z samego upływu tygodni.
 */

export type Track = 'hang' | 'aerobic' | 'pe' | 'hard';
/** Tory progresji realizowane w danym typie treningu */
export const TRACKS: Record<TrainingType, Track[]> = { A: ['hard'], B: ['hang', 'aerobic'], C: ['pe'] };
/** Typ treningu, w którym realizowany jest dany tor */
export const TRACK_HOST: Record<Track, TrainingType> = { hang: 'B', aerobic: 'B', pe: 'C', hard: 'A' };
export const TRACK_NAMES: Record<Track, string> = {
  hang: 'Max Hangs (trening B)',
  aerobic: 'Drogi tlenowe (trening B)',
  pe: 'Trening C (wytrzymałość siłowa)',
  hard: 'Trudne drogi (trening A)',
};

export const LIMITS = {
  /** Docelowa liczba serii Max Hangs – progresja odbywa się przez ciężar, nie przez serie */
  hangSets: 4,
  hangSetsMin: 3,
  /** Krok progresji ciężaru (zakres 1,0–1,25 kg – domyślnie 1,25 kg, najmniejsza para talerzy) */
  hangLoadStepKg: 1.25,
  /** Docelowe RPE zwisów: 7–8/10 */
  hangRpeMin: 7,
  hangRpeMax: 8,
  aerobicRoutesMax: 6,
  aerobicRoutesMin: 3,
  /** Dolna granica trudności – poniżej nie schodzimy automatycznie */
  gradeMin: '4c',
  /** Przerwa w treningach traktowana jako powrót */
  breakDays: 21,
  goodRpeA: 8,
  goodRpeB: 7,
  goodRpeC: 8,
  goodAvgPumpB: 4,
  /** Domyślne maksymalne pompowanie dróg tlenowych (gdy parametry go nie podają) */
  goodMaxPumpB: 4,
  goodMaxPumpC: 8,
  badStrain: 9,
} as const;

/** Wejście historii: wykonana jednostka (także deload) albo pominięta */
export type HistoryEntry =
  | { kind: 'completed'; date: ISODate; workout: CompletedWorkout }
  | { kind: 'skipped'; date: ISODate; id: string };

export type Quality = 'good' | 'ok' | 'bad';

export interface SessionAssessment {
  quality: Quality;
  /** Uzasadnienie oceny – krótkie fakty */
  facts: string[];
  /** Dlaczego sesja nie jest „dobra” */
  issues: string[];
}

export interface ProgressionDecision {
  type: TrainingType;
  track: Track;
  action: 'progress' | 'hold' | 'reduce';
  parameter?: string;
  from?: string;
  to?: string;
  params: TrainingParams;
  reason: string;
  sourceIds: string[];
  /** Co trzeba poprawić / spełnić, aby przejść na kolejny poziom */
  nextStep: string;
  /** Dlaczego obciążenie nie zostało zwiększone (puste przy progresji) */
  blockers: string[];
  /** Wymagana regeneracja i ponowna ocena gotowości przed kolejną ciężką sesją (np. ból palców) */
  recovery?: boolean;
  /** Propozycja do ręcznego zatwierdzenia (np. zmiana protokołu) – nigdy nie stosowana automatycznie */
  suggestion?: string;
}

/** Kontekst spoza historii jednostek: regeneracja z oceny gotowości */
export interface ProgressionContext {
  recovery?: { ok: boolean; reason: string };
}

/* -------------------- pomocnicze -------------------- */

const maxOf = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === 'number');
  return v.length ? Math.max(...v) : null;
};
const avgOf = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === 'number');
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};

export function sessionMaxPump(w: CompletedWorkout): number | null {
  return maxOf([w.pump, ...w.routes.map((r) => r.pump), ...w.sets.map((s) => s.pump)]);
}
export function sessionAvgPump(w: CompletedWorkout): number | null {
  const routePumps = w.routes.map((r) => r.pump).filter((p) => p != null);
  if (routePumps.length) return avgOf(routePumps);
  const setPumps = w.sets.map((s) => s.pump).filter((p) => p != null);
  if (setPumps.length) return avgOf(setPumps);
  return w.pump;
}
export function sessionRpe(w: CompletedWorkout): number | null {
  return w.rpe ?? maxOf(w.sets.map((s) => s.rpe));
}

export function effectiveLoadKg(h: { addedKg: number; assistKg: number }): number {
  return h.addedKg - h.assistKg;
}

const kg = (n: number) => `${Math.round(n * 100) / 100}`.replace('.', ',');

export function formatLoad(h: { addedKg: number; assistKg: number }): string {
  const l = effectiveLoadKg(h);
  if (l === 0) return 'masa ciała';
  return l > 0 ? `+${kg(l)} kg` : `−${kg(-l)} kg (odciążenie)`;
}

/** Obciążenie efektywne → parametry (dodatkowy ciężar albo odciążenie) */
export function loadParts(load: number): { addedKg: number; assistKg: number } {
  const r = Math.round(load * 100) / 100;
  return { addedKg: Math.max(0, r), assistKg: Math.max(0, -r) };
}

/** Pierwsza sesja Max Hangs ustala ciężar treningowy */
export function hangCalibrating(p: TrainingParams): boolean {
  return p.hangboard.calibration === 'pending';
}

/** Klucz poziomu – dwie sesje są „na tym samym poziomie”, jeśli klucz jest identyczny */
export function levelKey(track: Track, p: TrainingParams): string {
  switch (track) {
    case 'hang': {
      const h = p.hangboard;
      return `hang|${h.holdType}|${h.edge}|${h.grip}|${h.hangSec}|${h.sets}|${effectiveLoadKg(h)}`;
    }
    case 'aerobic':
      return `aer|${p.aerobic.routes}|${p.aerobic.grade}`;
    case 'pe': {
      const pe = p.powerEndurance;
      return `pe|${protocolOf(pe)}|${pe.sets}|${pe.routesPerSet}|${pe.grade}|${pe.workSec ?? ''}|${pe.restBetweenSetsMin}`;
    }
    case 'hard':
      return `hard|${p.hardRoutes.gradeFrom}|${p.hardRoutes.gradeTo}`;
  }
}

export function describeTrack(track: Track, p: TrainingParams): string {
  switch (track) {
    case 'hang': {
      const h = p.hangboard;
      return `zwisy ${h.sets} × ${h.hangSec} s, ${GRIP_LABELS[h.grip]}, ${h.edge}, ${formatLoad(h)}`;
    }
    case 'aerobic':
      return `${p.aerobic.routes} dróg ${p.aerobic.grade}`;
    case 'pe':
      return describePe(p.powerEndurance);
    case 'hard':
      return `trudne drogi ${p.hardRoutes.gradeFrom}–${p.hardRoutes.gradeTo}, maks. ${p.hardRoutes.maxAttempts} prób`;
  }
}

/** Opis aktualnego poziomu całej jednostki danego typu */
export function describeLevel(type: TrainingType, p: TrainingParams): string {
  return TRACKS[type].map((t) => describeTrack(t, p)).join(' + ');
}

/** Czy część jednostki odpowiadająca danemu torowi została wykonana tylko częściowo */
export function trackPartial(track: Track, w: CompletedWorkout): boolean {
  switch (track) {
    case 'hang': {
      const h = w.hangs[0];
      return !h || h.setsDone < w.prescription.hangboard.sets;
    }
    case 'aerobic':
      return w.routes.filter((r) => r.completed).length < w.prescription.aerobic.routes;
    case 'pe':
    case 'hard':
      return w.completion === 'partial';
  }
}

/** Samopoczucie następnego dnia: null = brak danych, false = sygnał przeciążenia */
export function followUpOk(w: CompletedWorkout): boolean | null {
  const f = w.followUp;
  if (!f) return null;
  return !f.fingerPain && f.feeling >= 3;
}

export const daysBetween = (a: ISODate, b: ISODate) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/* -------------------- zmiany parametrów (zawsze jeden) -------------------- */

export interface Change {
  parameter: string;
  from: string;
  to: string;
  params: TrainingParams;
  /** Dlaczego wybrano właśnie ten parametr (np. indywidualna ścieżka obwodów) */
  why?: string;
}

/** Zmiana obciążenia zwisów o deltaKg (dodatni = trudniej); zdejmuje najpierw odciążenie */
export function changeLoad(p: TrainingParams, deltaKg: number, parameter = 'Obciążenie zwisów'): Change {
  const n = structuredClone(p);
  const before = formatLoad(p.hangboard);
  Object.assign(n.hangboard, loadParts(effectiveLoadKg(p.hangboard) + deltaKg));
  return { parameter, from: before, to: formatLoad(n.hangboard), params: n };
}

/** Ustawienie konkretnego obciążenia efektywnego */
export function setLoad(p: TrainingParams, load: number, parameter = 'Obciążenie zwisów'): Change {
  return changeLoad(p, load - effectiveLoadKg(p.hangboard), parameter);
}

const fmtMin = (m: number) => (m >= 1 ? `${Math.round(m * 10) / 10} min` : `${Math.round(m * 60)} s`);

/** Zmiana jednego parametru wytrzymałości siłowej o jeden krok (dir = +1 trudniej / −1 łatwiej) */
export function peLever(p: TrainingParams, lever: PeLever, dir: 1 | -1): Change | null {
  const n = structuredClone(p);
  const pe = p.powerEndurance;
  const proto = protocolOf(pe);
  const def = PE_PROTOCOLS[proto];
  const L = def.limits;
  const shape = (x: typeof pe) => `${x.sets} × ${x.routesPerSet}`;
  const done = (parameter: string, from: string, to: string): Change => {
    n.powerEndurance = normalizeProtocol(n.powerEndurance);
    return { parameter, from, to, params: n };
  };
  switch (lever) {
    case 'grade': {
      if (def.font) {
        const next = shiftFont(pe.grade, dir);
        if (next === pe.grade || fontIndex(next) < 0) return null;
        n.powerEndurance.grade = next;
        return done(`Trudność (${def.name})`, pe.grade, next);
      }
      const capIdx = gradeIndex(pe.gradeCap);
      if (dir > 0 && capIdx >= 0 && gradeIndex(pe.grade) >= capIdx) return null;
      if (dir < 0 && gradeIndex(pe.grade) <= gradeIndex(LIMITS.gradeMin)) return null;
      n.powerEndurance.grade = shiftGrade(pe.grade, dir);
      if (n.powerEndurance.grade === pe.grade) return null;
      return done(`Trudność (${def.name})`, pe.grade, n.powerEndurance.grade);
    }
    case 'sets':
    case 'rounds': {
      const v = pe.sets + dir;
      if (v < L.setsMin || v > L.setsMax) return null;
      n.powerEndurance.sets = v;
      const label = lever === 'rounds' ? 'Liczba rund' : proto === 'boulder_4x4' ? 'Liczba rund' : 'Liczba serii';
      return done(label, lever === 'rounds' ? `${pe.sets}` : shape(pe), lever === 'rounds' ? `${v}` : shape(n.powerEndurance));
    }
    case 'routesPerSet': {
      const v = pe.routesPerSet + dir;
      if (v < L.unitsMin || v > L.unitsMax) return null;
      n.powerEndurance.routesPerSet = v;
      return done(proto === 'linked_routes' ? 'Liczba łączonych dróg' : 'Liczba dróg w serii', shape(pe), shape(n.powerEndurance));
    }
    case 'restBetweenSets': {
      const step = proto === 'boulder_4x4' ? 1 : 2;
      const v = pe.restBetweenSetsMin - dir * step;
      if (dir > 0 && v < L.restSetsMinMin) return null;
      n.powerEndurance.restBetweenSetsMin = v;
      return done('Przerwa między seriami', fmtMin(pe.restBetweenSetsMin), fmtMin(v));
    }
    case 'workSec': {
      const cur = pe.workSec ?? 120;
      const v = cur + dir * 15;
      if (v < 45 || (L.workSecMax != null && v > L.workSecMax)) return null;
      n.powerEndurance.workSec = v;
      return done('Czas wspinania w interwale', `${cur} s`, `${v} s`);
    }
  }
}
