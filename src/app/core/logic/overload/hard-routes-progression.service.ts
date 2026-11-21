import { CompletedWorkout, RouteLog, TrainingParams } from '../../models/models';
import { gradeIndex, shiftGrade } from '../grades';
import { Change, TRACK_NAMES } from '../progression';
import { cond, fromConditions, recoveryConditions } from './conditions';
import { FailureCause, ReduceReason, SessionCheck, TrackProgressionService } from './types';

/**
 * Trudne drogi i cruxy (trening A).
 *
 *  - Start: zakres 6b–6c, maks. 6 prób.
 *  - Każda próba jest zapisywana i oceniana: czyste przejście / przejście z rozpadem techniki / crux bez przejścia / bez cruxa.
 *  - Poprawa konkretnych sekwencji: porównanie prób tego samego projektu (nazwa drogi, a bez nazwy – wycena) między sesjami.
 *  - Trudność projektów rośnie dopiero po czystych przejściach na górnej granicy zakresu w dwóch kolejnych sesjach.
 *  - Liczba prób NIGDY nie rośnie automatycznie. Brak automatycznego zmniejszania – trening A służy jakości, nie objętości.
 */

const NAME = TRACK_NAMES.hard;

export type AttemptQuality = 'clean' | 'rough' | 'crux' | 'fail';
export const ATTEMPT_QUALITY_LABELS: Record<AttemptQuality, string> = {
  clean: 'czyste przejście',
  rough: 'przejście z rozpadem techniki',
  crux: 'crux bez przejścia',
  fail: 'bez cruxa',
};

export function attemptQuality(r: RouteLog): AttemptQuality {
  if (r.completed) return r.techniqueDegraded ? 'rough' : 'clean';
  return r.cruxSent ? 'crux' : 'fail';
}

const projectKey = (r: RouteLog) => (r.project?.trim() ? r.project.trim().toLowerCase() : `#${r.grade}`);
const projectLabel = (r: RouteLog) => (r.project?.trim() ? `${r.grade} „${r.project.trim()}”` : r.grade);

export interface ProjectProgress {
  key: string;
  label: string;
  attempts: number;
  sends: number;
  cruxes: number;
  /** Porównanie z poprzednią sesją na tym projekcie */
  previous: { attempts: number; sends: number; cruxes: number; date: string } | null;
  note: string;
}

export class HardRoutesProgressionService implements TrackProgressionService {
  readonly track = 'hard' as const;

  check(w: CompletedWorkout): SessionCheck {
    const plan = w.prescription.hardRoutes;
    const n = w.routes.length;
    const top = gradeIndex(plan.gradeTo);
    const clean = w.routes.filter((r) => attemptQuality(r) === 'clean' && gradeIndex(r.grade) >= top).length;
    const sends = w.routes.filter((r) => r.completed).length;
    const cruxes = w.routes.filter((r) => r.completed || r.cruxSent).length;
    const degraded = w.routes.filter((r) => r.techniqueDegraded).length;
    const conditions = [
      cond('attempts', `Zapisane próby, maks. ${plan.maxAttempts}`, n > 0 && n <= plan.maxAttempts, n ? `${n}/${plan.maxAttempts}` : 'brak prób'),
      cond('quality', `Czyste przejście na ${plan.gradeTo} lub trudniej`, clean > 0, clean ? `${clean}×` : sends ? 'przejścia tylko niżej lub z rozpadem techniki' : 'brak przejść'),
      cond('technique', 'Technika zachowana', (w.technique == null || w.technique >= 3) && degraded * 2 < Math.max(1, n),
        degraded ? `rozpad w ${degraded}/${n} próbach` : w.technique != null ? `${w.technique}/5` : 'bez uwag'),
      ...recoveryConditions(w),
    ];
    const facts = [`próby ${n}/${plan.maxAttempts}`, `przejścia ${sends}/${n}`, `crux ${cruxes}/${n}`, `czyste na ${plan.gradeTo}+: ${clean}`];
    return fromConditions(conditions, facts);
  }

  cause(w: CompletedWorkout): FailureCause {
    return w.routes.some((r) => r.techniqueDegraded) ? 'technique' : 'volume';
  }

  criteria(p: TrainingParams): string {
    return `czyste przejście na ${p.hardRoutes.gradeTo} lub trudniej, maks. ${p.hardRoutes.maxAttempts} prób, zachowana technika; liczba prób bez zmian`;
  }

  progress(params: TrainingParams): Change | null {
    const h = params.hardRoutes;
    const from = shiftGrade(h.gradeFrom, 1);
    const to = shiftGrade(h.gradeTo, 1);
    if (to === h.gradeTo) return null;
    const n = structuredClone(params);
    n.hardRoutes.gradeFrom = from;
    n.hardRoutes.gradeTo = to;
    return {
      parameter: 'Zakres trudności projektów', from: `${h.gradeFrom}–${h.gradeTo}`, to: `${from}–${to}`, params: n,
      why: `jakość przejść potwierdzona w dwóch kolejnych sesjach; liczba prób bez zmian (${h.maxAttempts})`,
    };
  }

  /** Trening A nie jest automatycznie zmniejszany – utrzymujemy zakres i analizujemy próby */
  reduce(_p: TrainingParams, _c: FailureCause, _r: ReduceReason): Change | null {
    return null;
  }

  explainHold(w: CompletedWorkout, check: SessionCheck): string {
    const h = w.prescription.hardRoutes;
    return `${NAME}: utrzymujemy zakres ${h.gradeFrom}–${h.gradeTo}. ${check.issues.join(', ')} (${check.facts.join(', ')}). ` +
      `Trudność projektów rośnie dopiero po czystych przejściach na ${h.gradeTo} w dwóch kolejnych sesjach. Liczba prób nie jest zwiększana automatycznie.`;
  }

  explainProgress(ch: Change): string {
    return `${NAME}: podnosimy zakres projektów ${ch.from} → ${ch.to}, ponieważ ${ch.why}.`;
  }

  /** Poprawa konkretnych projektów / sekwencji: ostatnia sesja vs poprzednia sesja na tym samym projekcie */
  projects(sessions: CompletedWorkout[]): ProjectProgress[] {
    const done = sessions.filter((w) => w.routes.length);
    const last = done[done.length - 1];
    if (!last) return [];
    const stats = (rs: RouteLog[]) => ({ attempts: rs.length, sends: rs.filter((r) => r.completed).length, cruxes: rs.filter((r) => r.completed || r.cruxSent).length });
    const keys = [...new Set(last.routes.map(projectKey))];
    return keys.map((key) => {
      const rs = last.routes.filter((r) => projectKey(r) === key);
      const cur = stats(rs);
      const prevW = [...done.slice(0, -1)].reverse().find((w) => w.routes.some((r) => projectKey(r) === key));
      const previous = prevW ? { ...stats(prevW.routes.filter((r) => projectKey(r) === key)), date: prevW.date } : null;
      let note: string;
      if (!previous) note = cur.sends ? 'pierwsza sesja – przejście' : 'pierwsza sesja na projekcie';
      else if (cur.sends && !previous.sends) note = 'pierwsze przejście – sekwencje opanowane';
      else if (cur.cruxes / cur.attempts > previous.cruxes / previous.attempts) note = `crux ${cur.cruxes}/${cur.attempts} (poprzednio ${previous.cruxes}/${previous.attempts}) – poprawa sekwencji kluczowej`;
      else if (cur.cruxes / cur.attempts < previous.cruxes / previous.attempts) note = `crux ${cur.cruxes}/${cur.attempts} (poprzednio ${previous.cruxes}/${previous.attempts}) – słabiej niż ostatnio`;
      else note = `crux ${cur.cruxes}/${cur.attempts} – bez zmian`;
      return { key, label: projectLabel(rs[0]), ...cur, previous, note };
    });
  }

  analyze(sessions: CompletedWorkout[]): string[] {
    const ps = this.projects(sessions).filter((p) => p.previous || p.sends);
    return ps.length ? [`Projekty: ${ps.map((p) => `${p.label} – ${p.note}`).join('; ')}.`] : [];
  }
}
