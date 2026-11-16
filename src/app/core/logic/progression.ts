import { CompletedWorkout, ISODate, TrainingParams, TrainingType } from '../models/models';
import { shiftGrade, gradeIndex, fontIndex, shiftFont } from './grades';
import { GRIP_LABELS } from './templates';
import { describePe, normalizeProtocol, PE_PROTOCOLS, PeLever, protocolOf } from './adaptive/protocols';

/**
 * Moduł progresji – czyste, deterministyczne funkcje.
 *
 * Reguły:
 *  R1 Sesja „zła” (ból, albo nieukończenie przy RPE/pompowaniu ≥ 9) → zmniejszenie jednego parametru.
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
  aerobicRoutesMin: 3,
  /** Dolna granica trudności – poniżej nie schodzimy automatycznie */
  gradeMin: '4c',
  /** Przerwa w treningach traktowana jako powrót */
  breakDays: 21,
  goodRpeA: 8,
  goodRpeB: 7,
  goodRpeC: 8,
  goodAvgPumpB: 4,
  goodMaxPumpB: 5,
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
    case 'pe': {
      const pe = p.powerEndurance;
      return `pe|${protocolOf(pe)}|${pe.sets}|${pe.routesPerSet}|${pe.grade}|${pe.workSec ?? ''}|${pe.restBetweenSetsMin}`;
    }
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

const fmtMin = (m: number) => (m >= 1 ? `${Math.round(m * 10) / 10} min` : `${Math.round(m * 60)} s`);

/** Zmiana jednego parametru wytrzymałości siłowej o jeden krok (dir = +1 trudniej / −1 łatwiej) */
function peLever(p: TrainingParams, lever: PeLever, dir: 1 | -1): Change | null {
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
      const routesMax = Math.max(LIMITS.aerobicRoutesMax, p.aerobic.routes);
      if (p.aerobic.routes < routesMax) {
        n.aerobic.routes++;
        return { parameter: 'Liczba dróg tlenowych', from: `${p.aerobic.routes}`, to: `${n.aerobic.routes}`, params: n };
      }
      const cap = gradeIndex(p.aerobic.gradeCap);
      if (cap < 0 || gradeIndex(p.aerobic.grade) < cap) {
        n.aerobic.grade = shiftGrade(p.aerobic.grade, 1);
        if (n.aerobic.grade !== p.aerobic.grade) return { parameter: 'Trudność dróg tlenowych', from: p.aerobic.grade, to: n.aerobic.grade, params: n };
      }
      return null;
    }
    case 'pe': {
      const def = PE_PROTOCOLS[protocolOf(p.powerEndurance)];
      for (const lever of def.progressLevers) {
        const ch = peLever(p, lever, 1);
        if (ch) return ch;
      }
      return null;
    }
  }
}

/** Przyczyna niepowodzenia – decyduje, który parametr zmniejszamy */
export type FailureCause = 'pain' | 'technique' | 'fatigue' | 'volume';

export function failureCause(track: Track, w: CompletedWorkout): FailureCause {
  if (track === 'hang') return w.hangs.some((h) => h.pain) ? 'pain' : 'fatigue';
  const degraded = w.routes.filter((r) => r.techniqueDegraded).length;
  if ((w.technique != null && w.technique < 3) || (w.routes.length && degraded * 2 >= w.routes.length)) return 'technique';
  const rpe = sessionRpe(w);
  const pump = sessionMaxPump(w);
  if ((rpe != null && rpe >= LIMITS.badStrain) || (pump != null && pump >= LIMITS.badStrain) || (w.feelingAfter != null && w.feelingAfter <= 2)) return 'fatigue';
  return 'volume';
}

export function reduceStep(track: Track, p: TrainingParams, cause: FailureCause | boolean = 'volume'): Change | null {
  // zgodność wsteczna: reduceStep(track, p, pain: boolean)
  const why: FailureCause = cause === true ? 'pain' : cause === false ? 'volume' : cause;
  const n = structuredClone(p);
  switch (track) {
    case 'hang': {
      if (why !== 'pain' && p.hangboard.sets > 3) {
        n.hangboard.sets--;
        return { parameter: 'Serie zwisów', from: `${p.hangboard.sets}`, to: `${n.hangboard.sets}`, params: n };
      }
      return changeLoad(p, -LIMITS.hangLoadStepKg);
    }
    case 'aerobic': {
      if (why !== 'technique' && p.aerobic.routes > LIMITS.aerobicRoutesMin) {
        n.aerobic.routes--;
        return { parameter: 'Liczba dróg tlenowych', from: `${p.aerobic.routes}`, to: `${n.aerobic.routes}`, params: n };
      }
      if (gradeIndex(p.aerobic.grade) > gradeIndex(LIMITS.gradeMin)) {
        n.aerobic.grade = shiftGrade(p.aerobic.grade, -1);
        return { parameter: 'Trudność dróg tlenowych', from: p.aerobic.grade, to: n.aerobic.grade, params: n };
      }
      return null;
    }
    case 'pe': {
      const def = PE_PROTOCOLS[protocolOf(p.powerEndurance)];
      // technika / odpadnięcia → trudność; zmęczenie i objętość → objętość (gdy protokół na to pozwala)
      const order: PeLever[] = why === 'technique' ? ['grade', ...def.volumeLevers] : [...def.volumeLevers, 'grade'];
      for (const lever of order) {
        const ch = peLever(p, lever, -1);
        if (ch) return ch;
      }
      return null;
    }
  }
}

/* -------------------- decyzja -------------------- */

const CAUSE_TEXT: Record<FailureCause, string> = {
  pain: 'ból – zmniejszamy obciążenie, nie objętość',
  technique: 'rozpad techniki / odpadnięcia – zmniejszamy trudność, objętość bez zmian',
  fatigue: 'skrajne zmęczenie przy zachowanej technice – zmniejszamy objętość',
  volume: 'za duża objętość – zmniejszamy objętość',
};

/** Warunki przejścia na kolejny poziom – pokazywane przy każdej decyzji */
export function nextStepText(track: Track, p: TrainingParams): string {
  const ch = progressStep(track, p);
  const crit: Record<Track, string> = {
    hang: `wszystkie serie, RPE zwisów ≤ ${LIMITS.goodRpeA}, bez bólu`,
    aerobic: `wszystkie drogi ukończone, średnie pompowanie ≤ ${LIMITS.goodAvgPumpB}/10, maks. ≤ ${LIMITS.goodMaxPumpB}/10, RPE ≤ ${LIMITS.goodRpeB}`,
    pe: `wszystkie ${PE_PROTOCOLS[protocolOf(p.powerEndurance)].unit.many} ukończone, RPE ≤ ${LIMITS.goodRpeC}, pompowanie ≤ ${LIMITS.goodMaxPumpC}/10, technika ≥ 3/5, samopoczucie ≥ 3/5`,
  };
  const then = ch ? ` Wtedy zmieni się tylko: ${ch.parameter.toLowerCase()} ${ch.from} → ${ch.to}.` : ' To górna granica w tym cyklu – kolejny poziom wyznaczy retest.';
  return `Aby przejść dalej: 2 kolejne dobre sesje na obecnym poziomie (${crit[track]}) i odpowiednia regeneracja.${then}`;
}

const daysBetween = (a: ISODate, b: ISODate) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/**
 * Ocena gotowości do progresji w danym torze.
 * @param history chronologiczna historia jednostek realizujących ten tor w bieżącym cyklu (wykonane – także deload – i pominięte)
 * @param params aktualne parametry cyklu
 * @param ctx regeneracja z oceny gotowości
 */
export function evaluateProgression(track: Track, history: HistoryEntry[], params: TrainingParams, ctx: ProgressionContext = {}): ProgressionDecision {
  const type = TRACK_HOST[track];
  const name = TRACK_NAMES[track];
  const level = levelKey(track, params);
  const levelText = describeTrack(track, params);
  const nextStep = nextStepText(track, params);
  const hold = (reason: string, ids: string[] = [], blockers: string[] = [reason]): ProgressionDecision => ({
    type, track, action: 'hold', params, reason, sourceIds: ids, nextStep, blockers,
  });
  const reduce = (ch: Change, reason: string, ids: string[]): ProgressionDecision => ({
    type, track, action: 'reduce', parameter: ch.parameter, from: ch.from, to: ch.to, params: ch.params, reason, sourceIds: ids,
    nextStep: nextStepText(track, ch.params), blockers: [reason],
  });

  const nonDeload = history.filter((h) => h.kind === 'skipped' || !h.workout.deload);
  const last = nonDeload[nonDeload.length - 1];
  if (!last) return hold(`${name}: brak danych – utrzymujemy poziom ${levelText}.`);

  // R7 – kilka opuszczonych jednostek z rzędu: powrót z mniejszą objętością
  let trailingSkips = 0;
  for (let i = nonDeload.length - 1; i >= 0 && nonDeload[i].kind === 'skipped'; i--) trailingSkips++;
  if (last.kind === 'skipped') {
    const ids = nonDeload.slice(-trailingSkips).map((h) => (h.kind === 'skipped' ? h.id : h.workout.id));
    if (trailingSkips >= 2) {
      const ch = reduceStep(track, params, 'volume');
      const why = `${name}: ${trailingSkips} kolejne jednostki pominięte – nie nadrabiamy zaległości. Po przerwie wracamy z mniejszą objętością`;
      if (ch) return reduce(ch, `${why}: ${ch.parameter.toLowerCase()} ${ch.from} → ${ch.to}. Trudność bez zmian.`, ids);
      return hold(`${why}, ale parametry są już minimalne – utrzymujemy ${levelText}.`, ids);
    }
    return hold(`${name}: ostatnia jednostka została pominięta. Utrzymujemy poziom ${levelText} – nie nadrabiamy zaległości.`, ids);
  }

  const lastAssessment = assessTrack(track, last.workout);
  const lastAtLevel = levelKey(track, last.workout.prescription) === level;
  const factText = lastAssessment.facts.join(', ');

  if (!lastAtLevel) {
    return hold(`${name}: ostatnia sesja była wykonana na innym poziomie niż obecny plan – nowy poziom ${levelText} wymaga dwóch dobrych sesji.`, [last.workout.id]);
  }

  // R1 – sesja zła: zmniejszenie parametru zależnego od przyczyny
  if (lastAssessment.quality === 'bad') {
    const cause = failureCause(track, last.workout);
    const ch = reduceStep(track, params, cause);
    const why = `${name}: ${lastAssessment.issues.join(', ')} (${factText}). Przyczyna: ${CAUSE_TEXT[cause]}.`;
    if (!ch) return hold(`${why} Parametry są już na minimalnym poziomie – utrzymujemy ${levelText}.`, [last.workout.id]);
    return reduce(ch, `${why} Zmieniamy jeden parametr: ${ch.parameter.toLowerCase()} ${ch.from} → ${ch.to}.${cause === 'pain' ? ' Przy utrzymującym się bólu zwisy będą blokowane w ocenie gotowości.' : ''}`, [last.workout.id]);
  }

  // R2 – dwie częściowe pod rząd
  const prevIdx = nonDeload.length - 2;
  const prev = nonDeload[prevIdx];
  if (
    trackPartial(track, last.workout) && prev?.kind === 'completed' && trackPartial(track, prev.workout) &&
    levelKey(track, prev.workout.prescription) === level
  ) {
    const ch = reduceStep(track, params, failureCause(track, last.workout));
    if (ch) {
      return reduce(ch, `${name}: dwie kolejne sesje na poziomie ${levelText} wykonane częściowo. Obciążenie jest za duże – ${ch.parameter.toLowerCase()} ${ch.from} → ${ch.to}.`, [prev.workout.id, last.workout.id]);
    }
  }

  // R3 – sesja nie „dobra”
  if (lastAssessment.quality === 'ok') {
    return hold(`${name}: ${lastAssessment.issues.join(', ')} (${factText}). Brak progresji – utrzymujemy ${levelText}.`, [last.workout.id], lastAssessment.issues);
  }

  // R7b – powrót po długiej przerwie: dobra sesja tylko potwierdza poziom.
  // Odstęp liczony do poprzedniej wykonanej jednostki, także deloadowej (deload to nie przerwa).
  const lastIdx = history.lastIndexOf(last);
  const prevDone = history.slice(0, lastIdx).reverse().find((h): h is Extract<HistoryEntry, { kind: 'completed' }> => h.kind === 'completed');
  const gap = prevDone ? daysBetween(prevDone.workout.date, last.workout.date) : 0;
  if (gap >= LIMITS.breakDays) {
    return hold(`${name}: pierwsza sesja po ${gap} dniach przerwy (${factText}) – potwierdza poziom ${levelText}. Progresja dopiero po kolejnej dobrej sesji.`, [last.workout.id]);
  }

  // R4/R5/R6 – seria dobrych sesji na tym samym poziomie, przerwana przez pominięcie lub deload
  let streak = 0;
  const ids: string[] = [];
  let brokenBy: 'skip' | 'deload' | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.kind === 'skipped') {
      brokenBy = 'skip';
      break;
    }
    if (h.workout.deload) {
      if (streak > 0) {
        brokenBy = 'deload';
        break;
      }
      continue;
    }
    if (levelKey(track, h.workout.prescription) !== level || assessTrack(track, h.workout).quality !== 'good') break;
    streak++;
    ids.unshift(h.workout.id);
    if (streak === 2) break;
  }

  if (streak < 2) {
    const extra =
      brokenBy === 'skip' ? ' Wcześniejsza seria została przerwana przez pominiętą jednostkę.'
        : brokenBy === 'deload' ? ' To pierwsza sesja po deloadzie – potwierdza poziom przed kolejną zmianą.'
          : '';
    return hold(`${name}: dobra sesja (${factText}) – to ${streak} z 2 wymaganych na poziomie ${levelText}.${extra} Utrzymujemy poziom.`, ids,
      [`${streak} z 2 wymaganych dobrych sesji${brokenBy === 'deload' ? ' (seria liczona od nowa po deloadzie)' : ''}`]);
  }

  // R8 – brak regeneracji blokuje progresję
  if (ctx.recovery && !ctx.recovery.ok) {
    return hold(`${name}: dwie dobre sesje (${factText}), ale brak odpowiedniej regeneracji: ${ctx.recovery.reason}. Utrzymujemy ${levelText}.`, ids, [`regeneracja: ${ctx.recovery.reason}`]);
  }

  const ch = progressStep(track, params);
  if (!ch) {
    return hold(`${name}: dwie dobre sesje, ale osiągnięto górną granicę wynikającą z profilu w tym cyklu (${levelText}). Utrzymujemy poziom – kolejny wyznaczy retest.`, ids);
  }
  return {
    type, track, action: 'progress', parameter: ch.parameter, from: ch.from, to: ch.to, params: ch.params,
    reason: `${name}: dwie kolejne dobre sesje na poziomie ${levelText} (ostatnia: ${factText}). Zwiększamy tylko jeden parametr: ${ch.parameter.toLowerCase()} ${ch.from} → ${ch.to}. Pozostałe parametry bez zmian.`,
    sourceIds: ids, nextStep: nextStepText(track, ch.params), blockers: [],
  };
}
