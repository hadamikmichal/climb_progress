import { AdaptationEvent, CompletedWorkout, TrainingParams } from '../../models/models';
import { deloadParams } from '../plan';
import {
  Change, daysBetween, describeTrack, effectiveLoadKg, followUpOk, formatLoad, HistoryEntry, levelKey, LIMITS, ProgressionContext,
  ProgressionDecision, Quality, SessionAssessment, Track, TRACK_HOST, TRACK_NAMES, TRACKS, trackPartial,
} from '../progression';
import { PE_PROTOCOLS, protocolOf } from '../adaptive/protocols';
import { AerobicProgressionService } from './aerobic-progression.service';
import { num } from './conditions';
import { HangboardProgressionService, HANG_START } from './hangboard-progression.service';
import { HardRoutesProgressionService } from './hard-routes-progression.service';
import { PowerEnduranceProgressionService } from './power-endurance-progression.service';
import { CompletedEntry, FailureCause, ProgressionCondition, SessionCheck, TrackProgressionService } from './types';

/**
 * Progressive Overload Engine – wspólny algorytm decyzji dla wszystkich torów.
 *
 * Progresja wynika z wykonanej pracy, jakości techniki i regeneracji – nie z kalendarza.
 * Upływ tygodni sam w sobie nigdy nie zwiększa obciążenia: zmiana parametru wymaga dwóch kolejnych udanych sesji
 * na tym samym poziomie (+ regeneracji), a każda decyzja ma uzasadnienie zapisywane w historii zmian.
 */

const CAUSE_TEXT: Record<FailureCause, string> = {
  pain: 'ból – zmniejszamy obciążenie, nie objętość',
  technique: 'rozpad techniki / odpadnięcia – zmniejszamy trudność, objętość bez zmian',
  fatigue: 'skrajne zmęczenie przy zachowanej technice – zmniejszamy objętość',
  volume: 'za duża objętość – zmniejszamy objętość',
};

const QUALITY_RANK: Record<Quality, number> = { good: 0, ok: 1, bad: 2 };

/** Wymagana liczba kolejnych udanych sesji przed progresją */
export const REQUIRED_SUCCESSES = 2;

export interface StreakInfo {
  count: number;
  ids: string[];
  workouts: CompletedWorkout[];
  brokenBy: 'skip' | 'deload' | null;
}

export interface TrackStatus {
  track: Track;
  streak: number;
  required: number;
  calibrating: boolean;
  recovery: boolean;
  lastWorkout: CompletedWorkout | null;
  lastCheck: SessionCheck | null;
  /** Ostatnia sesja wykonana na obecnym poziomie */
  lastAtLevel: boolean;
  next: Change | null;
  text: string;
  suggestion?: string;
}

export interface LoadSessionRow {
  id: string;
  date: string;
  planned: string;
  actual: string;
  summary: string;
  successful: boolean;
  deload: boolean;
  calibration: boolean;
}

export interface LoadChangeRow {
  id: string;
  timestamp: string;
  kind: AdaptationEvent['kind'];
  parameter: string;
  from: string;
  to: string;
  reason: string;
}

export interface TrackLoadView {
  track: Track;
  title: string;
  current: string;
  currentDetail: string;
  previous: string | null;
  next: string | null;
  nextDetail: string | null;
  lastLines: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' }[];
  lastDate: string | null;
  successful: number;
  required: number;
  conditions: ProgressionCondition[];
  status: string;
  calibrating: boolean;
  recovery: boolean;
  suggestion?: string;
  changes: LoadChangeRow[];
  sessions: LoadSessionRow[];
}

/** Tor zdarzenia – zapisany jawnie albo (dane sprzed silnika) wyprowadzony z nazwy parametru */
export function eventTrack(e: AdaptationEvent): Track | null {
  if (e.track) return e.track;
  const p = (e.parameter ?? '').toLowerCase();
  if (p.includes('zwis')) return 'hang';
  if (p.includes('tlenow')) return 'aerobic';
  if (e.workoutType === 'C') return 'pe';
  if (e.workoutType === 'A') return 'hard';
  return null;
}

export class ProgressiveOverloadService {
  readonly hangboard: HangboardProgressionService;
  readonly aerobic: AerobicProgressionService;
  readonly powerEndurance: PowerEnduranceProgressionService;
  readonly hardRoutes: HardRoutesProgressionService;
  private readonly services: Record<Track, TrackProgressionService>;

  constructor(
    hangboard = new HangboardProgressionService(),
    aerobic = new AerobicProgressionService(),
    powerEndurance = new PowerEnduranceProgressionService(),
    hardRoutes = new HardRoutesProgressionService(),
  ) {
    this.hangboard = hangboard;
    this.aerobic = aerobic;
    this.powerEndurance = powerEndurance;
    this.hardRoutes = hardRoutes;
    this.services = { hang: hangboard, aerobic, pe: powerEndurance, hard: hardRoutes };
  }

  service(track: Track): TrackProgressionService {
    return this.services[track];
  }

  /* ---------------- ocena sesji ---------------- */

  check(track: Track, w: CompletedWorkout): SessionCheck {
    return this.services[track].check(w);
  }

  /** Ocena całej sesji – najsłabsza z ocen jej części */
  assessSession(w: CompletedWorkout): SessionAssessment {
    const parts = TRACKS[w.type].map((t) => this.check(t, w));
    const quality = parts.reduce<Quality>((q, p) => (QUALITY_RANK[p.quality] > QUALITY_RANK[q] ? p.quality : q), 'good');
    return { quality, facts: parts.flatMap((p) => p.facts), issues: parts.flatMap((p) => p.issues) };
  }

  failureCause(track: Track, w: CompletedWorkout): FailureCause {
    return this.services[track].cause(w);
  }

  /** Warunki przejścia na kolejny poziom – pokazywane przy każdej decyzji */
  nextStepText(track: Track, p: TrainingParams): string {
    if (track === 'hang' && p.hangboard.calibration === 'pending') {
      return `Najpierw sesja kalibracyjna: ${p.hangboard.sets} × ${p.hangboard.hangSec} s, ${formatLoad(p.hangboard)}, cel RPE ${HANG_START.rpe}. Ciężar zostanie zatwierdzony po sesji.`;
    }
    const svc = this.services[track];
    const ch = svc.progress(p, []);
    const then = ch ? ` Wtedy zmieni się tylko: ${ch.parameter.toLowerCase()} ${ch.from} → ${ch.to}.` : ' To górna granica w tym cyklu – kolejny poziom wyznaczy retest.';
    return `Aby przejść dalej: ${REQUIRED_SUCCESSES} kolejne udane sesje na obecnym poziomie (${svc.criteria(p)}) i odpowiednia regeneracja.${then}`;
  }

  /* ---------------- seria udanych sesji ---------------- */

  streak(track: Track, history: HistoryEntry[], params: TrainingParams): StreakInfo {
    const level = levelKey(track, params);
    const out: StreakInfo = { count: 0, ids: [], workouts: [], brokenBy: null };
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      if (h.kind === 'skipped') {
        out.brokenBy = 'skip';
        break;
      }
      if (h.workout.deload) {
        if (out.count > 0) {
          out.brokenBy = 'deload';
          break;
        }
        continue;
      }
      if (levelKey(track, h.workout.prescription) !== level || !this.check(track, h.workout).successful) break;
      out.count++;
      out.ids.unshift(h.workout.id);
      out.workouts.unshift(h.workout);
      if (out.count === REQUIRED_SUCCESSES) break;
    }
    return out;
  }

  /* ---------------- decyzja ---------------- */

  /**
   * Decyzja progresji w danym torze.
   * @param history chronologiczna historia jednostek tego toru w bieżącym cyklu (wykonane – także deload – i pominięte)
   * @param params aktualne parametry cyklu
   * @param ctx regeneracja z oceny gotowości
   */
  evaluate(track: Track, history: HistoryEntry[], params: TrainingParams, ctx: ProgressionContext = {}): ProgressionDecision {
    const svc = this.services[track];
    const type = TRACK_HOST[track];
    const name = TRACK_NAMES[track];
    const level = levelKey(track, params);
    const levelText = describeTrack(track, params);
    const nextStep = this.nextStepText(track, params);
    const hold = (reason: string, ids: string[] = [], blockers: string[] = [reason], extra: Partial<ProgressionDecision> = {}): ProgressionDecision => ({
      type, track, action: 'hold', params, reason, sourceIds: ids, nextStep, blockers, ...extra,
    });
    const change = (action: 'progress' | 'reduce' | 'hold', ch: Change, reason: string, ids: string[], extra: Partial<ProgressionDecision> = {}): ProgressionDecision => ({
      type, track, action, parameter: ch.parameter, from: ch.from, to: ch.to, params: ch.params, reason, sourceIds: ids,
      nextStep: this.nextStepText(track, ch.params), blockers: action === 'progress' ? [] : [reason], ...extra,
    });

    const nonDeload = history.filter((h) => h.kind === 'skipped' || !h.workout.deload);
    const last = nonDeload[nonDeload.length - 1];
    if (!last) {
      if (track === 'hang' && params.hangboard.calibration === 'pending') {
        return hold(`${name}: kalibracja ciężaru w pierwszej sesji (${levelText}, cel RPE ${HANG_START.rpe}).`, [], ['kalibracja ciężaru w toku']);
      }
      return hold(`${name}: brak danych – utrzymujemy poziom ${levelText}.`);
    }

    // R7 / R5 – pominięcia: nie nadrabiamy; kilka z rzędu → powrót z mniejszą objętością
    if (last.kind === 'skipped') {
      let trailing = 0;
      for (let i = nonDeload.length - 1; i >= 0 && nonDeload[i].kind === 'skipped'; i--) trailing++;
      const ids = nonDeload.slice(-trailing).map((h) => (h.kind === 'skipped' ? h.id : h.workout.id));
      if (trailing >= 2 && !(track === 'hang' && params.hangboard.calibration === 'pending')) {
        const ch = svc.reduce(params, 'volume', 'break');
        const why = `${name}: ${trailing} kolejne jednostki pominięte – nie nadrabiamy zaległości. Po przerwie wracamy z ${track === 'hang' ? 'mniejszym ciężarem' : 'mniejszą objętością'}`;
        if (ch) return change('reduce', ch, `${why}: ${ch.parameter.toLowerCase()} ${ch.from} → ${ch.to}. Pozostałe parametry bez zmian.`, ids);
        return hold(`${why}, ale ten tor nie jest zmniejszany automatycznie – utrzymujemy ${levelText}.`, ids);
      }
      return hold(`${name}: ostatnia jednostka została pominięta. Utrzymujemy poziom ${levelText} – nie nadrabiamy zaległości, seria udanych sesji liczy się od nowa.`, ids);
    }

    const w = last.workout;
    const check = svc.check(w);
    const facts = check.facts.join(', ');
    const sessions = nonDeload.filter((h): h is CompletedEntry => h.kind === 'completed').map((h) => h.workout);
    const analysis = svc.analyze?.(sessions) ?? [];
    const withAnalysis = (r: string) => (analysis.length ? `${r} ${analysis.join(' ')}` : r);

    // reguły toru: ból, kalibracja
    const special = svc.special?.({ history, last: w, check, params, ctx, hold, change });
    if (special) return special;

    if (levelKey(track, w.prescription) !== level) {
      return hold(`${name}: ostatnia sesja była wykonana na innym poziomie niż obecny plan – nowy poziom ${levelText} wymaga ${REQUIRED_SUCCESSES} udanych sesji.`, [w.id]);
    }

    // R1 – sesja zła: analiza przyczyny
    if (check.quality === 'bad') {
      if (svc.onBad) {
        const r = svc.onBad(params, w, check);
        return r.change ? change('reduce', r.change, r.reason, [w.id]) : hold(r.reason, [w.id], check.issues);
      }
      const cause = svc.cause(w);
      const ch = svc.reduce(params, cause, 'bad');
      const why = `${name}: ${check.issues.join(', ')} (${facts}). Przyczyna: ${CAUSE_TEXT[cause]}.`;
      if (!ch) return hold(withAnalysis(`${why} Parametry są już na minimalnym poziomie – utrzymujemy ${levelText}.`), [w.id]);
      const lead = cause === 'technique' || cause === 'fatigue' ? 'Zmniejszamy obciążenie. Wykryto podwyższone zmęczenie i pogorszenie jakości wykonania. ' : '';
      return change('reduce', ch, `${lead}${why} Zmieniamy jeden parametr: ${ch.parameter.toLowerCase()} ${ch.from} → ${ch.to}.`, [w.id]);
    }

    // R2 – dwie częściowe pod rząd na tym samym poziomie
    const prev = nonDeload[nonDeload.length - 2];
    if (trackPartial(track, w) && prev?.kind === 'completed' && trackPartial(track, prev.workout) && levelKey(track, prev.workout.prescription) === level) {
      const ch = svc.reduce(params, svc.cause(w), 'partials');
      if (ch) {
        return change('reduce', ch, `${name}: dwie kolejne sesje na poziomie ${levelText} nie zostały ukończone. Wracamy do lżejszego obciążenia – ${ch.parameter.toLowerCase()} ${ch.from} → ${ch.to}.`, [prev.workout.id, w.id]);
      }
    }

    // R3 – warunki niespełnione → utrzymanie i analiza przyczyny
    if (!check.successful) {
      const reason = svc.explainHold ? svc.explainHold(w, check) : `${name}: ${check.issues.join(', ')} (${facts}). Brak progresji – utrzymujemy ${levelText}.`;
      return hold(withAnalysis(reason), [w.id], check.issues);
    }

    // R7b – powrót po długiej przerwie: udana sesja tylko potwierdza poziom
    const idx = history.lastIndexOf(last);
    const prevDone = history.slice(0, idx).reverse().find((h): h is CompletedEntry => h.kind === 'completed');
    const gap = prevDone ? daysBetween(prevDone.workout.date, w.date) : 0;
    if (gap >= LIMITS.breakDays) {
      return hold(`${name}: pierwsza sesja po ${gap} dniach przerwy (${facts}) – potwierdza poziom ${levelText}. Progresja dopiero po kolejnej udanej sesji.`, [w.id]);
    }

    // R4 / R5 / R6 – seria udanych sesji
    const st = this.streak(track, history, params);
    if (st.count < REQUIRED_SUCCESSES) {
      const extra = st.brokenBy === 'skip' ? ' Wcześniejsza seria została przerwana przez pominiętą jednostkę.'
        : st.brokenBy === 'deload' ? ' To pierwsza sesja po deloadzie – potwierdza poziom przed kolejną zmianą.' : '';
      const left = REQUIRED_SUCCESSES - st.count;
      return hold(
        withAnalysis(`${name}: udana sesja (${facts}) – to ${st.count} z ${REQUIRED_SUCCESSES} wymaganych na poziomie ${levelText}.${extra} Utrzymujemy poziom – ${left === 1 ? 'jeszcze jedna udana sesja przed progresją' : `jeszcze ${left} udane sesje przed progresją`}.`),
        st.ids,
        [`${st.count} z ${REQUIRED_SUCCESSES} wymaganych udanych sesji${st.brokenBy === 'deload' ? ' (seria liczona od nowa po deloadzie)' : ''}`],
      );
    }

    // R8 – brak regeneracji blokuje progresję
    if (ctx.recovery && !ctx.recovery.ok) {
      return hold(`${name}: dwie udane sesje (${facts}), ale brak odpowiedniej regeneracji: ${ctx.recovery.reason}. Utrzymujemy ${levelText}.`, st.ids, [`regeneracja: ${ctx.recovery.reason}`]);
    }

    const ch = svc.progress(params, st.workouts);
    if (!ch) {
      const suggestion = svc.ceiling?.(params);
      return hold(
        `${name}: dwie udane sesje, ale osiągnięto górną granicę wynikającą z profilu w tym cyklu (${levelText}). Utrzymujemy poziom – kolejny wyznaczy retest.${suggestion ? ' ' + suggestion : ''}`,
        st.ids, ['górna granica w tym cyklu'], suggestion ? { suggestion } : {},
      );
    }
    const reason = svc.explainProgress
      ? svc.explainProgress(ch, st.workouts)
      : `${name}: dwie kolejne udane sesje na poziomie ${levelText} (ostatnia: ${facts}). Zwiększamy tylko jeden parametr: ${ch.parameter.toLowerCase()} ${ch.from} → ${ch.to}${ch.why ? ` – ${ch.why}` : ''}. Pozostałe parametry bez zmian.`;
    return change('progress', ch, withAnalysis(reason), st.ids);
  }

  /** Decyzje dla wszystkich torów jednostki – zmiany różnych torów nie kolidują ze sobą */
  evaluateWorkout(w: CompletedWorkout, historyFor: (track: Track) => HistoryEntry[], params: TrainingParams, ctx: ProgressionContext = {}): ProgressionDecision[] {
    const out: ProgressionDecision[] = [];
    let p = params;
    for (const track of TRACKS[w.type]) {
      const d = this.evaluate(track, historyFor(track), p, ctx);
      p = d.params;
      out.push(d);
    }
    return out;
  }

  /* ---------------- deload, przerwy, samopoczucie następnego dnia ---------------- */

  /** Tydzień deload: objętość −40–50%, bez prób maksymalnych */
  deload(params: TrainingParams): TrainingParams {
    return deloadParams(params);
  }

  /** Po sesji deload: wznowienie od ostatniego dobrze tolerowanego obciążenia (Max Hangs) */
  afterDeload(track: Track, history: HistoryEntry[], params: TrainingParams): ProgressionDecision | null {
    if (track !== 'hang') return null;
    const r = this.hangboard.afterDeload(history, params);
    if (!r) return null;
    return {
      type: 'B', track, action: 'reduce', parameter: r.change.parameter, from: r.change.from, to: r.change.to, params: r.change.params,
      reason: r.reason, sourceIds: r.sourceIds, nextStep: this.nextStepText(track, r.change.params), blockers: [r.reason],
    };
  }

  /**
   * Samopoczucie następnego dnia dopisane do sesji.
   * Negatywne (ból palców, samopoczucie ≤ 2/5) po sesji, która spowodowała progresję → cofnięcie tej progresji.
   * Ból palców po zwisach bez progresji → zapis decyzji o regeneracji.
   */
  onFollowUp(track: Track, w: CompletedWorkout, params: TrainingParams, causedProgress: boolean): ProgressionDecision | null {
    if (followUpOk(w) !== false || w.deload) return null;
    const f = w.followUp!;
    const name = TRACK_NAMES[track];
    const pain = f.fingerPain && track === 'hang';
    const what = f.fingerPain ? 'ból palców' : `samopoczucie ${f.feeling}/5`;
    const nextStep = this.nextStepText(track, params);
    if (causedProgress) {
      const n = structuredClone(params);
      const part = ({ hang: 'hangboard', aerobic: 'aerobic', pe: 'powerEndurance', hard: 'hardRoutes' } as const)[track];
      (n as unknown as Record<string, unknown>)[part] = structuredClone(w.prescription[part]);
      if (track === 'hang') n.hangboard.calibration = params.hangboard.calibration;
      const from = this.shortLevel(track, params);
      const to = this.shortLevel(track, n);
      const reason = `${name}: następnego dnia po sesji z ${w.date} zgłoszono ${what}. Cofamy ostatnią progresję (${from} → ${to}) – wracamy do ostatniego dobrze tolerowanego poziomu.` +
        (pain ? ' Kończymy ciężkie zwisy do czasu regeneracji i ponownej oceny gotowości.' : '');
      return {
        type: TRACK_HOST[track], track, action: 'reduce', parameter: 'Cofnięcie progresji', from, to, params: n, reason, sourceIds: [w.id],
        nextStep: this.nextStepText(track, n), blockers: [reason], recovery: pain || undefined,
      };
    }
    if (!pain) return null;
    const reason = `${name}: następnego dnia po sesji z ${w.date} zgłoszono ból palców. Brak progresji – zalecana regeneracja i ponowna ocena gotowości przed kolejnymi zwisami.`;
    return { type: 'B', track, action: 'hold', params, reason, sourceIds: [w.id], nextStep, blockers: [reason], recovery: true };
  }

  /* ---------------- status i widok ---------------- */

  status(track: Track, history: HistoryEntry[], params: TrainingParams): TrackStatus {
    const svc = this.services[track];
    const nonDeload = history.filter((h) => h.kind === 'skipped' || !h.workout.deload);
    const last = nonDeload[nonDeload.length - 1];
    const lastDone = [...nonDeload].reverse().find((h): h is CompletedEntry => h.kind === 'completed') ?? null;
    const lastCheck = lastDone ? svc.check(lastDone.workout) : null;
    const st = this.streak(track, history, params);
    const calibrating = track === 'hang' && params.hangboard.calibration === 'pending';
    const recovery = track === 'hang' && !!lastCheck?.pain;
    const lastAtLevel = !!lastDone && levelKey(track, lastDone.workout.prescription) === levelKey(track, params);
    const next = calibrating ? null : svc.progress(params, st.workouts);
    let text: string;
    let suggestion: string | undefined;
    if (calibrating) text = `Kalibracja: pierwsza sesja ustala ciężar treningowy (start ${formatLoad(params.hangboard)}, cel RPE ${HANG_START.rpe}). Za trudno → mniej lub odciążenie, bardzo łatwo → ostrożnie więcej.`;
    else if (recovery) text = 'Ból palców w ostatniej sesji – przerwa w ciężkich zwisach. Wymagana regeneracja i ponowna ocena gotowości. Brak progresji.';
    else if (last?.kind === 'skipped') text = 'Ostatnia jednostka pominięta – seria udanych sesji liczy się od nowa. Zaległości nie są nadrabiane.';
    else if (!next) {
      suggestion = svc.ceiling?.(params);
      text = 'Górna granica w tym cyklu – kolejny poziom wyznaczy retest.';
    } else if (st.count >= REQUIRED_SUCCESSES) text = 'Warunki progresji spełnione – zmiana przy kolejnej decyzji.';
    else if (st.count === 1) text = 'Jeszcze jedna udana sesja przed progresją.';
    else if (lastDone && lastAtLevel && lastCheck && !lastCheck.successful) text = `Brak progresji: ${lastCheck.issues.join(', ')}. Potrzebne ${REQUIRED_SUCCESSES} kolejne udane sesje.`;
    else text = `Potrzebne ${REQUIRED_SUCCESSES} kolejne udane sesje na obecnym poziomie.`;
    return {
      track, streak: st.count, required: REQUIRED_SUCCESSES, calibrating, recovery, lastWorkout: lastDone?.workout ?? null, lastCheck,
      lastAtLevel, next, text, suggestion,
    };
  }

  /** Krótka wartość poziomu (główna liczba w widoku) */
  shortLevel(track: Track, p: TrainingParams): string {
    switch (track) {
      case 'hang':
        return formatLoad(p.hangboard);
      case 'aerobic':
        return `${p.aerobic.routes} × ${p.aerobic.grade}`;
      case 'pe':
        return `${p.powerEndurance.sets} × ${p.powerEndurance.routesPerSet} @ ${p.powerEndurance.grade}`;
      case 'hard':
        return `${p.hardRoutes.gradeFrom}–${p.hardRoutes.gradeTo}`;
    }
  }

  private title(track: Track, p: TrainingParams): string {
    switch (track) {
      case 'hang': {
        const h = p.hangboard;
        return `MAX HANG / ${h.edgeSizeMm ? `${h.edgeSizeMm} MM` : h.edge.toUpperCase()}`;
      }
      case 'aerobic':
        return 'AEROBIC ENDURANCE / DROGI';
      case 'pe':
        return `POWER ENDURANCE / ${PE_PROTOCOLS[protocolOf(p.powerEndurance)].name.toUpperCase()}`;
      case 'hard':
        return 'HARD ROUTES / PROJEKTY';
    }
  }

  private lastLines(track: Track, w: CompletedWorkout, check: SessionCheck): TrackLoadView['lastLines'] {
    const c = (k: string) => check.conditions.find((x) => x.key === k);
    const tone = (k: string): 'good' | 'bad' | undefined => (c(k)?.met === true ? 'good' : c(k)?.met === false ? 'bad' : undefined);
    const line = (label: string, k: string, value?: string) => ({ label, value: value ?? c(k)?.detail ?? '–', tone: tone(k) });
    switch (track) {
      case 'hang': {
        const h = w.hangs[0];
        const tech = c('technique');
        return [
          line('Wykonane', 'sets', h ? `${h.setsDone}/${w.prescription.hangboard.sets} serii` : '–'),
          line('Czas zwisów', 'time'),
          line('RPE', 'rpe', h?.rpe != null ? num(h.rpe) : w.rpe != null ? num(w.rpe) : '–'),
          line('Technika', 'technique', tech?.met === true ? 'PRAWIDŁOWA' : tech?.met === false ? (tech.detail === 'brak oceny techniki' ? 'BRAK OCENY' : 'NIEPRAWIDŁOWA') : '–'),
          line('Ciężar', 'load'),
          line('Ból palców', 'pain'),
          line('Następny dzień', 'followUp'),
        ];
      }
      case 'aerobic':
        return [line('Drogi', 'routes'), line('Maks. pompowanie', 'pump'), line('RPE', 'rpe'), line('Technika', 'technique'), line('Następny dzień', 'followUp')];
      case 'pe':
        return [line('Ukończone', 'routes'), line('RPE', 'rpe'), line('Pompowanie', 'pump'), line('Technika', 'technique'), line('Następny dzień', 'followUp')];
      case 'hard':
        return [line('Próby', 'attempts'), line('Jakość przejść', 'quality'), line('Technika', 'technique'), line('Następny dzień', 'followUp')];
    }
  }

  private actualOf(track: Track, w: CompletedWorkout): string {
    switch (track) {
      case 'hang': {
        const h = w.hangs[0];
        return h ? `${formatLoad(h)} · ${h.setsDone}/${w.prescription.hangboard.sets} × ${h.hangSec} s` : 'brak zwisów';
      }
      case 'aerobic':
        return `${w.routes.filter((r) => r.completed).length}/${w.prescription.aerobic.routes} dróg`;
      case 'pe': {
        const pe = w.prescription.powerEndurance;
        return `${w.routes.filter((r) => r.completed).length}/${pe.sets * pe.routesPerSet} ukończonych`;
      }
      case 'hard':
        return `${w.routes.filter((r) => r.completed).length}/${w.routes.length} przejść`;
    }
  }

  /** Model widoku TRAINING LOAD PROGRESSION dla jednego toru */
  trackView(track: Track, history: HistoryEntry[], params: TrainingParams, events: AdaptationEvent[]): TrackLoadView {
    const st = this.status(track, history, params);
    const done = history.filter((h): h is CompletedEntry => h.kind === 'completed');
    const level = levelKey(track, params);
    const prevW = [...done].reverse().find((h) => !h.workout.deload && levelKey(track, h.workout.prescription) !== level);
    const changes: LoadChangeRow[] = events
      .filter((e) => (e.kind === 'progress' || e.kind === 'reduce' || e.kind === 'manual') && e.from != null && e.to != null && eventTrack(e) === track)
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
      .map((e) => ({ id: e.id, timestamp: e.timestamp, kind: e.kind, parameter: e.parameter ?? '', from: e.from!, to: e.to!, reason: e.reason }));
    const sessions: LoadSessionRow[] = [...done].reverse().slice(0, 12).map((h) => {
      const w = h.workout;
      const c = this.check(track, w);
      return {
        id: w.id, date: w.date, planned: this.shortLevel(track, w.prescription), actual: this.actualOf(track, w), summary: c.facts.join(' · '),
        successful: c.successful, deload: w.deload, calibration: track === 'hang' && w.prescription.hangboard.calibration === 'pending',
      };
    });
    const nextDetail = st.next ? `${st.next.parameter}: ${st.next.from} → ${st.next.to}${st.next.why ? ` (${st.next.why})` : ''}` : null;
    return {
      track,
      title: this.title(track, params),
      current: this.shortLevel(track, params),
      currentDetail: describeTrack(track, params),
      previous: prevW ? this.shortLevel(track, prevW.workout.prescription) : changes[0]?.from ?? null,
      next: st.next ? this.shortLevel(track, st.next.params) : null,
      nextDetail,
      lastLines: st.lastWorkout && st.lastCheck ? this.lastLines(track, st.lastWorkout, st.lastCheck) : [],
      lastDate: st.lastWorkout?.date ?? null,
      successful: st.streak,
      required: st.required,
      conditions: st.lastCheck?.conditions ?? [],
      status: st.text,
      calibrating: st.calibrating,
      recovery: st.recovery,
      suggestion: st.suggestion,
      changes,
      sessions,
    };
  }

  /** Obciążenie efektywne zwisów (do wykresów historii) */
  hangLoad(w: CompletedWorkout): number | null {
    return w.hangs[0] ? effectiveLoadKg(w.hangs[0]) : null;
  }
}

/** Domyślna instancja – czysta logika bez stanu, współdzielona przez store i widoki */
export const progressiveOverload = new ProgressiveOverloadService();

/* ---------------- fasada (zgodność z dotychczasowym API) ---------------- */

export function evaluateProgression(track: Track, history: HistoryEntry[], params: TrainingParams, ctx: ProgressionContext = {}): ProgressionDecision {
  return progressiveOverload.evaluate(track, history, params, ctx);
}

export function assessSession(w: CompletedWorkout): SessionAssessment {
  return progressiveOverload.assessSession(w);
}

export function assessTrack(track: Track, w: CompletedWorkout): SessionCheck {
  return progressiveOverload.check(track, w);
}

export function progressStep(track: Track, p: TrainingParams, good: CompletedWorkout[] = []): Change | null {
  return progressiveOverload.service(track).progress(p, good);
}

export function nextStepText(track: Track, p: TrainingParams): string {
  return progressiveOverload.nextStepText(track, p);
}
