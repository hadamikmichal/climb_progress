import { CompletedWorkout, ISODate, TrainingParams, TrainingType } from '../models/models';
import { shiftGrade, gradeIndex } from './grades';
import { GRIP_LABELS } from './templates';

/**
 * Moduł progresji – czyste, deterministyczne funkcje.
 *
 * Reguły:
 *  R1 Sesja „zła” (ból, albo nieukończenie przy RPE/pompowaniu ≥ 9) → zmniejszenie jednego parametru.
 *  R2 Dwie ostatnie sesje częściowe na tym samym poziomie → zmniejszenie jednego parametru.
 *  R3 Sesja nie „dobra” (częściowa, wysokie RPE, mocne pompowanie) → utrzymanie poziomu.
 *  R4 Dwie kolejne „dobre” sesje na tym samym poziomie → zwiększenie JEDNEGO parametru.
 *  R5 Pominięcie przerywa serię dobrych sesji – po opuszczeniu utrzymujemy poziom, nie nadrabiamy.
 *  R6 Sesje deload / „lżejsze” nie są brane pod uwagę.
 *
 * Progresja jest liczona osobno dla każdego „toru” (track): Max Hangs i drogi tlenowe (oba w treningu B)
 * oraz obwody (C). W ramach jednego toru zmienia się co najwyżej jeden parametr na raz.
 * Trening A (trudne drogi i cruxy) nie ma automatycznej progresji.
 */

export type Track = 'hang' | 'aerobic' | 'pe';
/** Tory progresji realizowane w danym typie treningu */
export const TRACKS: Record<TrainingType, Track[]> = { A: [], B: ['hang', 'aerobic'], C: ['pe'] };
/** Typ treningu, w którym realizowany jest dany tor */
export const TRACK_HOST: Record<Track, TrainingType> = { hang: 'B', aerobic: 'B', pe: 'C' };
export const TRACK_NAMES: Record<Track, string> = {
  hang: 'Max Hangs (trening B)',
  aerobic: 'Drogi tlenowe (trening B)',
  pe: 'Trening C (wytrzymałość siłowa)',
};

export const LIMITS = {
  hangSetsMax: 5,
  hangLoadStepKg: 2,
  aerobicRoutesMax: 5,
  aerobicRoutesMin: 4,
  aerobicGradeMax: '6a',
  aerobicGradeMin: '5a',
  peSetsMax: 3,
  peSetsMin: 2,
  peGradeMax: '6a+',
  peGradeMin: '5c',
  goodRpeA: 8,
  goodRpeB: 7,
  goodRpeC: 8,
  goodAvgPumpB: 4,
  goodMaxPumpB: 5,
  goodMaxPumpC: 8,
  badStrain: 9,
} as const;

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

export function formatLoad(h: { addedKg: number; assistKg: number }): string {
  const l = effectiveLoadKg(h);
  if (l === 0) return 'masa ciała';
  return l > 0 ? `+${l} kg` : `−${-l} kg (odciążenie)`;
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
    case 'pe':
      return `pe|${p.powerEndurance.sets}|${p.powerEndurance.routesPerSet}|${p.powerEndurance.grade}`;
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
      return `${p.powerEndurance.sets} × ${p.powerEndurance.routesPerSet} na ${p.powerEndurance.grade}`;
  }
}

/** Opis aktualnego poziomu całej jednostki danego typu */
export function describeLevel(type: TrainingType, p: TrainingParams): string {
  if (type === 'A') return `trudne drogi ${p.hardRoutes.gradeFrom}–${p.hardRoutes.gradeTo}, maks. ${p.hardRoutes.maxAttempts} prób`;
  return TRACKS[type].map((t) => describeTrack(t, p)).join(' + ');
}

/* -------------------- ocena pojedynczej sesji -------------------- */

const routeRpe = (w: CompletedWorkout) => maxOf(w.routes.map((r) => r.rpe)) ?? w.rpe;

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
      return w.completion === 'partial';
  }
}

/** Ocena jednej części sesji (toru progresji) */
export function assessTrack(track: Track, w: CompletedWorkout): SessionAssessment {
  const facts: string[] = [];
  const issues: string[] = [];
  let bad = false;
  const maxPump = sessionMaxPump(w);

  switch (track) {
    case 'hang': {
      const plan = w.prescription.hangboard;
      const hang = w.hangs[0];
      if (!hang) {
        issues.push('brak zapisanych zwisów');
        break;
      }
      const hangRpe = hang.rpe ?? w.rpe;
      facts.push(`zwisy ${hang.setsDone}/${hang.setsPlanned}`);
      if (hangRpe != null) facts.push(`RPE zwisów ${hangRpe}`);
      if (hang.pain) {
        issues.push('zgłoszony ból/dyskomfort podczas zwisów');
        bad = true;
      }
      if (hang.setsDone < plan.sets) issues.push('nie wszystkie serie zwisów');
      if (hangRpe != null && hangRpe > LIMITS.goodRpeA) issues.push(`RPE zwisów ${hangRpe} > ${LIMITS.goodRpeA}`);
      if (hang.setsDone < plan.sets && hangRpe != null && hangRpe >= LIMITS.badStrain) bad = true;
      break;
    }
    case 'aerobic': {
      const plan = w.prescription.aerobic;
      const done = w.routes.filter((r) => r.completed).length;
      const avg = sessionAvgPump(w);
      const rpe = routeRpe(w);
      if (rpe != null) facts.push(`RPE dróg ${rpe}`);
      if (maxPump != null) facts.push(`maks. pompowanie ${maxPump}/10`);
      facts.push(`ukończone drogi ${done}/${plan.routes}`);
      if (avg != null) facts.push(`średnie pompowanie ${avg}/10`);
      if (done < plan.routes) issues.push('nie wszystkie drogi ukończone');
      if (avg != null && avg > LIMITS.goodAvgPumpB) issues.push(`średnie pompowanie ${avg} > ${LIMITS.goodAvgPumpB}`);
      if (maxPump != null && maxPump > LIMITS.goodMaxPumpB) issues.push(`pompowanie do ${maxPump}/10 – za mocno jak na trening tlenowy`);
      if (rpe != null && rpe > LIMITS.goodRpeB) issues.push(`RPE ${rpe} > ${LIMITS.goodRpeB}`);
      if ((avg != null && avg >= 7) || (rpe != null && rpe >= LIMITS.badStrain)) bad = true;
      break;
    }
    case 'pe': {
      const plan = w.prescription.powerEndurance;
      const total = plan.sets * plan.routesPerSet;
      const done = w.routes.filter((r) => r.completed).length;
      const rpe = sessionRpe(w);
      if (rpe != null) facts.push(`RPE ${rpe}`);
      if (maxPump != null) facts.push(`maks. pompowanie ${maxPump}/10`);
      if (w.completion === 'partial') issues.push('trening wykonany częściowo');
      facts.push(`ukończone drogi ${done}/${total}`);
      if (done < total) issues.push('odpadnięcie lub nieukończone drogi w obwodzie');
      if (maxPump != null && maxPump > LIMITS.goodMaxPumpC) issues.push(`skrajne pompowanie (${maxPump}/10)`);
      if (rpe != null && rpe > LIMITS.goodRpeC) issues.push(`RPE ${rpe} > ${LIMITS.goodRpeC}`);
      if (w.technique != null && w.technique < 3) issues.push(`jakość techniki ${w.technique}/5`);
      if (w.feelingAfter != null && w.feelingAfter < 3) issues.push(`samopoczucie po treningu ${w.feelingAfter}/5`);
      if (done < total && ((rpe != null && rpe >= LIMITS.badStrain) || (maxPump != null && maxPump >= LIMITS.badStrain))) bad = true;
      break;
    }
  }
  return { quality: bad ? 'bad' : issues.length ? 'ok' : 'good', facts, issues };
}

const QUALITY_RANK: Record<Quality, number> = { good: 0, ok: 1, bad: 2 };

/** Ocena całej sesji – najsłabsza z ocen jej części */
export function assessSession(w: CompletedWorkout): SessionAssessment {
  const tracks = TRACKS[w.type];
  if (!tracks.length) {
    // A – trudne drogi: tylko fakty, bez automatycznej progresji
    const facts: string[] = [];
    const issues: string[] = [];
    const rpe = sessionRpe(w);
    const maxPump = sessionMaxPump(w);
    if (rpe != null) facts.push(`RPE ${rpe}`);
    if (maxPump != null) facts.push(`maks. pompowanie ${maxPump}/10`);
    if (w.routes.length) facts.push(`udane próby ${w.routes.filter((r) => r.completed).length}/${w.routes.length}`);
    if (w.completion === 'partial') issues.push('trening wykonany częściowo');
    return { quality: issues.length ? 'ok' : 'good', facts, issues };
  }
  const parts = tracks.map((t) => assessTrack(t, w));
  const quality = parts.reduce<Quality>((q, p) => (QUALITY_RANK[p.quality] > QUALITY_RANK[q] ? p.quality : q), 'good');
  return { quality, facts: parts.flatMap((p) => p.facts), issues: parts.flatMap((p) => p.issues) };
}

/* -------------------- zmiany parametrów (zawsze jeden) -------------------- */

interface Change {
  parameter: string;
  from: string;
  to: string;
  params: TrainingParams;
}

function changeLoad(p: TrainingParams, deltaKg: number): Change {
  const n = structuredClone(p);
  const h = n.hangboard;
  const before = formatLoad(h);
  if (deltaKg > 0) {
    if (h.assistKg > 0) h.assistKg = Math.max(0, h.assistKg - deltaKg);
    else h.addedKg += deltaKg;
  } else {
    if (h.addedKg > 0) h.addedKg = Math.max(0, h.addedKg + deltaKg);
    else h.assistKg += -deltaKg;
  }
  return { parameter: 'Obciążenie zwisów', from: before, to: formatLoad(h), params: n };
}

export function progressStep(track: Track, p: TrainingParams): Change | null {
  const n = structuredClone(p);
  switch (track) {
    case 'hang': {
      if (p.hangboard.sets < LIMITS.hangSetsMax) {
        n.hangboard.sets++;
        return { parameter: 'Serie zwisów', from: `${p.hangboard.sets}`, to: `${n.hangboard.sets}`, params: n };
      }
      return changeLoad(p, LIMITS.hangLoadStepKg);
    }
    case 'aerobic': {
      if (p.aerobic.routes < LIMITS.aerobicRoutesMax) {
        n.aerobic.routes++;
        return { parameter: 'Liczba dróg tlenowych', from: `${p.aerobic.routes}`, to: `${n.aerobic.routes}`, params: n };
      }
      if (gradeIndex(p.aerobic.grade) < gradeIndex(LIMITS.aerobicGradeMax)) {
        n.aerobic.grade = shiftGrade(p.aerobic.grade, 1);
        return { parameter: 'Trudność dróg tlenowych', from: p.aerobic.grade, to: n.aerobic.grade, params: n };
      }
      return null;
    }
    case 'pe': {
      const pe = p.powerEndurance;
      if (pe.sets < LIMITS.peSetsMax) {
        n.powerEndurance.sets++;
        return { parameter: 'Liczba serii obwodu', from: `${pe.sets} × ${pe.routesPerSet}`, to: `${n.powerEndurance.sets} × ${pe.routesPerSet}`, params: n };
      }
      if (gradeIndex(pe.grade) < gradeIndex(LIMITS.peGradeMax)) {
        n.powerEndurance.grade = shiftGrade(pe.grade, 1);
        return { parameter: 'Trudność obwodu', from: pe.grade, to: n.powerEndurance.grade, params: n };
      }
      return null;
    }
  }
}

export function reduceStep(track: Track, p: TrainingParams, pain = false): Change | null {
  const n = structuredClone(p);
  switch (track) {
    case 'hang': {
      if (!pain && p.hangboard.sets > 3) {
        n.hangboard.sets--;
        return { parameter: 'Serie zwisów', from: `${p.hangboard.sets}`, to: `${n.hangboard.sets}`, params: n };
      }
      return changeLoad(p, -LIMITS.hangLoadStepKg);
    }
    case 'aerobic': {
      if (p.aerobic.routes > LIMITS.aerobicRoutesMin) {
        n.aerobic.routes--;
        return { parameter: 'Liczba dróg tlenowych', from: `${p.aerobic.routes}`, to: `${n.aerobic.routes}`, params: n };
      }
      if (gradeIndex(p.aerobic.grade) > gradeIndex(LIMITS.aerobicGradeMin)) {
        n.aerobic.grade = shiftGrade(p.aerobic.grade, -1);
        return { parameter: 'Trudność dróg tlenowych', from: p.aerobic.grade, to: n.aerobic.grade, params: n };
      }
      return null;
    }
    case 'pe': {
      const pe = p.powerEndurance;
      if (pe.sets > LIMITS.peSetsMin) {
        n.powerEndurance.sets--;
        return { parameter: 'Liczba serii obwodu', from: `${pe.sets} × ${pe.routesPerSet}`, to: `${n.powerEndurance.sets} × ${pe.routesPerSet}`, params: n };
      }
      if (gradeIndex(pe.grade) > gradeIndex(LIMITS.peGradeMin)) {
        n.powerEndurance.grade = shiftGrade(pe.grade, -1);
        return { parameter: 'Trudność obwodu', from: pe.grade, to: n.powerEndurance.grade, params: n };
      }
      return null;
    }
  }
}

/* -------------------- decyzja -------------------- */

/**
 * Ocena gotowości do progresji w danym torze.
 * @param history chronologiczna historia jednostek realizujących ten tor w bieżącym cyklu (wykonane i pominięte)
 * @param params aktualne parametry cyklu
 */
export function evaluateProgression(track: Track, history: HistoryEntry[], params: TrainingParams): ProgressionDecision {
  const type = TRACK_HOST[track];
  const name = TRACK_NAMES[track];
  const level = levelKey(track, params);
  const levelText = describeTrack(track, params);
  const relevant = history.filter((h) => h.kind === 'skipped' || !h.workout.deload);
  const hold = (reason: string, ids: string[] = []): ProgressionDecision => ({ type, track, action: 'hold', params, reason, sourceIds: ids });

  const last = relevant[relevant.length - 1];
  if (!last) return hold(`${name}: brak danych – utrzymujemy poziom ${levelText}.`);
  if (last.kind === 'skipped') {
    return hold(`${name}: ostatnia jednostka została pominięta. Utrzymujemy poziom ${levelText} – nie nadrabiamy zaległości.`, [last.id]);
  }

  const lastAssessment = assessTrack(track, last.workout);
  const lastAtLevel = levelKey(track, last.workout.prescription) === level;
  const factText = lastAssessment.facts.join(', ');

  if (!lastAtLevel) {
    return hold(`${name}: ostatnia sesja była wykonana na innym poziomie niż obecny plan – nowy poziom ${levelText} wymaga dwóch dobrych sesji.`, [last.workout.id]);
  }

  // R1 – sesja zła
  if (lastAssessment.quality === 'bad') {
    const pain = track === 'hang' && last.workout.hangs.some((h) => h.pain);
    const ch = reduceStep(track, params, pain);
    const why = `${name}: ${lastAssessment.issues.join(', ')} (${factText}).`;
    if (!ch) return hold(`${why} Parametry są już na minimalnym poziomie – utrzymujemy ${levelText}.`, [last.workout.id]);
    return {
      type, track, action: 'reduce', parameter: ch.parameter, from: ch.from, to: ch.to, params: ch.params,
      reason: `${why} Zmniejszamy jeden parametr: ${ch.parameter.toLowerCase()} ${ch.from} → ${ch.to}.${pain ? ' Przy utrzymującym się bólu zwisy będą blokowane w ocenie gotowości.' : ''}`,
      sourceIds: [last.workout.id],
    };
  }

  // R2 – dwie częściowe pod rząd
  const prev = relevant[relevant.length - 2];
  if (
    trackPartial(track, last.workout) && prev?.kind === 'completed' && trackPartial(track, prev.workout) &&
    levelKey(track, prev.workout.prescription) === level
  ) {
    const ch = reduceStep(track, params);
    if (ch) {
      return {
        type, track, action: 'reduce', parameter: ch.parameter, from: ch.from, to: ch.to, params: ch.params,
        reason: `${name}: dwie kolejne sesje na poziomie ${levelText} wykonane częściowo. Obciążenie jest za duże – ${ch.parameter.toLowerCase()} ${ch.from} → ${ch.to}.`,
        sourceIds: [prev.workout.id, last.workout.id],
      };
    }
  }

  // R3 – sesja nie „dobra”
  if (lastAssessment.quality === 'ok') {
    return hold(`${name}: ${lastAssessment.issues.join(', ')} (${factText}). Brak progresji – utrzymujemy ${levelText}.`, [last.workout.id]);
  }

  // R4/R5 – seria dobrych sesji na tym samym poziomie, przerwana przez pominięcie
  let streak = 0;
  const ids: string[] = [];
  let brokenBySkip = false;
  for (let i = relevant.length - 1; i >= 0; i--) {
    const h = relevant[i];
    if (h.kind === 'skipped') {
      brokenBySkip = true;
      break;
    }
    if (levelKey(track, h.workout.prescription) !== level || assessTrack(track, h.workout).quality !== 'good') break;
    streak++;
    ids.unshift(h.workout.id);
    if (streak === 2) break;
  }

  if (streak < 2) {
    const extra = brokenBySkip ? ' Wcześniejsza seria została przerwana przez pominiętą jednostkę.' : '';
    return hold(`${name}: dobra sesja (${factText}) – to ${streak} z 2 wymaganych na poziomie ${levelText}.${extra} Utrzymujemy poziom.`, ids);
  }

  const ch = progressStep(track, params);
  if (!ch) {
    return hold(`${name}: dwie dobre sesje, ale osiągnięto górny limit progresji w tym cyklu (${levelText}). Utrzymujemy poziom.`, ids);
  }
  return {
    type, track, action: 'progress', parameter: ch.parameter, from: ch.from, to: ch.to, params: ch.params,
    reason: `${name}: dwie kolejne dobre sesje na poziomie ${levelText} (ostatnia: ${factText}). Zwiększamy tylko jeden parametr: ${ch.parameter.toLowerCase()} ${ch.from} → ${ch.to}. Pozostałe parametry bez zmian.`,
    sourceIds: ids,
  };
}
