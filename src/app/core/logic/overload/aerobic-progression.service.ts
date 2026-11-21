import { CompletedWorkout, TrainingParams } from '../../models/models';
import { gradeIndex, shiftGrade } from '../grades';
import { Change, LIMITS, sessionAvgPump, TRACK_NAMES } from '../progression';
import { cond, fromConditions, num, recoveryConditions } from './conditions';
import { FailureCause, ReduceReason, SessionCheck, TrackProgressionService } from './types';

/**
 * Wytrzymałość tlenowa (trening B, po zwisach).
 *
 *  - Start: 4 drogi 5b (ok. 13 m), 3 min odpoczynku, pompowanie maks. 4/10.
 *  - Progresja: najpierw liczba dróg 4 → 5 → 6, dopiero potem niewielki wzrost trudności (do górnej granicy z profilu).
 *  - Nigdy jednocześnie liczba dróg i trudność.
 *  - Przekroczone docelowe pompowanie → brak zwiększania obciążenia.
 */

const NAME = TRACK_NAMES.aerobic;

const maxOf = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === 'number');
  return v.length ? Math.max(...v) : null;
};

export class AerobicProgressionService implements TrackProgressionService {
  readonly track = 'aerobic' as const;

  targetPump(p: TrainingParams): number {
    return p.aerobic.targetMaxPump ?? LIMITS.goodMaxPumpB;
  }

  check(w: CompletedWorkout): SessionCheck {
    const plan = w.prescription.aerobic;
    const target = this.targetPump(w.prescription);
    const done = w.routes.filter((r) => r.completed).length;
    const maxPump = maxOf(w.routes.map((r) => r.pump)) ?? w.pump;
    const avg = sessionAvgPump(w);
    const rpe = maxOf(w.routes.map((r) => r.rpe)) ?? w.rpe;
    const degraded = w.routes.filter((r) => r.techniqueDegraded).length;
    const techOk = degraded === 0 && (w.technique == null || w.technique >= 3);

    const conditions = [
      cond('routes', 'Wszystkie drogi ukończone', done >= plan.routes, `${done}/${plan.routes}`),
      cond('pump', `Pompowanie maks. ≤ ${target}/10`, maxPump != null ? maxPump <= target : false, maxPump != null ? `${maxPump}/10` : 'nie podano pompowania'),
      cond('rpe', `RPE ≤ ${LIMITS.goodRpeB}`, rpe != null ? rpe <= LIMITS.goodRpeB : null, rpe != null ? `RPE ${num(rpe)}` : 'nie podano'),
      cond('technique', 'Technika bez rozpadu', techOk, degraded ? `rozpad na ${degraded} drogach` : w.technique != null ? `${w.technique}/5` : 'bez uwag'),
      ...recoveryConditions(w),
    ];
    const facts = [
      ...(rpe != null ? [`RPE dróg ${num(rpe)}`] : []),
      ...(maxPump != null ? [`maks. pompowanie ${maxPump}/10`] : []),
      `ukończone drogi ${done}/${plan.routes}`,
      ...(avg != null ? [`średnie pompowanie ${num(avg)}/10`] : []),
    ];
    const bad = (avg != null && avg >= 7) || (rpe != null && rpe >= LIMITS.badStrain) || (maxPump != null && maxPump >= target + 4);
    return fromConditions(conditions, facts, { bad });
  }

  cause(w: CompletedWorkout): FailureCause {
    const degraded = w.routes.filter((r) => r.techniqueDegraded).length;
    if ((w.technique != null && w.technique < 3) || (w.routes.length && degraded * 2 >= w.routes.length)) return 'technique';
    return 'fatigue';
  }

  criteria(p: TrainingParams): string {
    return `wszystkie drogi ukończone, pompowanie maks. ≤ ${this.targetPump(p)}/10, RPE ≤ ${LIMITS.goodRpeB}, technika bez rozpadu`;
  }

  progress(params: TrainingParams): Change | null {
    const n = structuredClone(params);
    const routesMax = Math.max(LIMITS.aerobicRoutesMax, params.aerobic.routes);
    if (params.aerobic.routes < routesMax) {
      n.aerobic.routes++;
      return { parameter: 'Liczba dróg tlenowych', from: `${params.aerobic.routes}`, to: `${n.aerobic.routes}`, params: n, why: 'najpierw objętość (liczba dróg), trudność bez zmian' };
    }
    const cap = gradeIndex(params.aerobic.gradeCap);
    if (cap < 0 || gradeIndex(params.aerobic.grade) < cap) {
      n.aerobic.grade = shiftGrade(params.aerobic.grade, 1);
      if (n.aerobic.grade !== params.aerobic.grade) {
        return {
          parameter: 'Trudność dróg tlenowych', from: params.aerobic.grade, to: n.aerobic.grade, params: n,
          why: `liczba dróg osiągnęła ${params.aerobic.routes} – teraz niewielki wzrost trudności przy tej samej liczbie dróg`,
        };
      }
    }
    return null;
  }

  reduce(params: TrainingParams, cause: FailureCause, _reason: ReduceReason): Change | null {
    const n = structuredClone(params);
    if (cause !== 'technique' && params.aerobic.routes > LIMITS.aerobicRoutesMin) {
      n.aerobic.routes--;
      return { parameter: 'Liczba dróg tlenowych', from: `${params.aerobic.routes}`, to: `${n.aerobic.routes}`, params: n };
    }
    if (gradeIndex(params.aerobic.grade) > gradeIndex(LIMITS.gradeMin)) {
      n.aerobic.grade = shiftGrade(params.aerobic.grade, -1);
      return { parameter: 'Trudność dróg tlenowych', from: params.aerobic.grade, to: n.aerobic.grade, params: n };
    }
    return null;
  }

  explainHold(w: CompletedWorkout, check: SessionCheck): string {
    const pump = check.conditions.find((c) => c.key === 'pump');
    const level = `${w.prescription.aerobic.routes} dróg ${w.prescription.aerobic.grade}`;
    if (pump?.met === false && pump.detail.includes('/10')) {
      return `${NAME}: utrzymujemy ${level}. Pompowanie ${pump.detail} przekroczyło docelowe ${this.targetPump(w.prescription)}/10 – nie zwiększamy obciążenia.`;
    }
    return `${NAME}: utrzymujemy ${level}. ${check.issues.join(', ')} (${check.facts.join(', ')}). Brak progresji.`;
  }
}
