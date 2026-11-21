import { CompletedWorkout, TrainingParams } from '../../models/models';
import { PE_PROTOCOLS, PeLever, protocolOf } from '../adaptive/protocols';
import { Change, LIMITS, peLever, sessionMaxPump, sessionRpe, TRACK_NAMES } from '../progression';
import { cond, fromConditions, num, recoveryConditions } from './conditions';
import { FailureCause, ReduceReason, SessionCheck, TrackProgressionService } from './types';

/**
 * Wytrzymałość siłowa (trening C).
 *
 *  - Start: 2 serie × 3 drogi 5c+, 2 min między drogami, 12 min między seriami.
 *  - Progresja indywidualna – kolejny krok wynika z tego, JAK wyglądały udane sesje:
 *      sesje wyraźnie lekkie (RPE ≤ 6, pompowanie ≤ 6) przy bardzo dobrej technice → trudność (np. 2 × 3 na 6a),
 *      zmęczenie pod kontrolą, ale bez dużej rezerwy → objętość (3 × 3 na 5c+).
 *    Dalej: 3 × 3 na 6a, 3 × 3 na trudniejszych drogach (do górnej granicy z profilu), skrócenie przerwy.
 *  - 4 × 4 i zaawansowane obwody tylko jako PROPOZYCJA przy górnej granicy, gdy wyniki to uzasadniają – nigdy automatycznie,
 *    i nie jako obowiązkowy ostatni etap.
 *  - Warunki: wszystkie drogi ukończone, akceptowalne RPE, kontrolowane pompowanie, zachowana technika, regeneracja.
 */

const NAME = TRACK_NAMES.pe;

const easySession = (w: CompletedWorkout) =>
  (sessionRpe(w) ?? 10) <= 6 && (sessionMaxPump(w) ?? 10) <= 6 && (w.technique ?? 0) >= 4;

export class PowerEnduranceProgressionService implements TrackProgressionService {
  readonly track = 'pe' as const;

  check(w: CompletedWorkout): SessionCheck {
    const plan = w.prescription.powerEndurance;
    const unit = PE_PROTOCOLS[protocolOf(plan)].unit.many;
    const total = plan.sets * plan.routesPerSet;
    const done = w.routes.filter((r) => r.completed).length;
    const rpe = sessionRpe(w);
    const maxPump = sessionMaxPump(w);
    const conditions = [
      cond('routes', `Wszystkie ${unit} ukończone`, done >= total && w.completion !== 'partial', `${done}/${total}${w.completion === 'partial' ? ', trening częściowy' : ''}`),
      cond('rpe', `RPE ≤ ${LIMITS.goodRpeC}`, rpe != null ? rpe <= LIMITS.goodRpeC : null, rpe != null ? `RPE ${num(rpe)}` : 'nie podano'),
      cond('pump', `Kontrolowane pompowanie (≤ ${LIMITS.goodMaxPumpC}/10)`, maxPump != null ? maxPump <= LIMITS.goodMaxPumpC : null, maxPump != null ? `${maxPump}/10` : 'nie podano'),
      cond('technique', 'Technika ≥ 3/5', w.technique != null ? w.technique >= 3 : null, w.technique != null ? `${w.technique}/5` : 'nie oceniono'),
      ...recoveryConditions(w),
    ];
    const facts = [
      ...(rpe != null ? [`RPE ${num(rpe)}`] : []),
      ...(maxPump != null ? [`maks. pompowanie ${maxPump}/10`] : []),
      `ukończone ${unit} ${done}/${total}`,
      ...(w.technique != null ? [`technika ${w.technique}/5`] : []),
    ];
    const bad = done < total && ((rpe != null && rpe >= LIMITS.badStrain) || (maxPump != null && maxPump >= LIMITS.badStrain));
    return fromConditions(conditions, facts, { bad });
  }

  cause(w: CompletedWorkout): FailureCause {
    const degraded = w.routes.filter((r) => r.techniqueDegraded).length;
    if ((w.technique != null && w.technique < 3) || (w.routes.length && degraded * 2 >= w.routes.length)) return 'technique';
    const rpe = sessionRpe(w);
    const pump = sessionMaxPump(w);
    if ((rpe != null && rpe >= LIMITS.badStrain) || (pump != null && pump >= LIMITS.badStrain) || (w.feelingAfter != null && w.feelingAfter <= 2)) return 'fatigue';
    return 'volume';
  }

  criteria(p: TrainingParams): string {
    const proto = protocolOf(p.powerEndurance);
    const base = `wszystkie ${PE_PROTOCOLS[proto].unit.many} ukończone, RPE ≤ ${LIMITS.goodRpeC}, pompowanie ≤ ${LIMITS.goodMaxPumpC}/10, technika ≥ 3/5, samopoczucie ≥ 3/5`;
    return proto === 'rope_2x3' ? `${base}; kierunek (więcej serii albo trudniejsze drogi) zależy od tego, jak lekkie były obie sesje` : base;
  }

  /** Kolejność dźwigni dla danej historii udanych sesji – indywidualna ścieżka */
  levers(params: TrainingParams, good: CompletedWorkout[]): { order: PeLever[]; why: Partial<Record<PeLever, string>> } {
    const proto = protocolOf(params.powerEndurance);
    const def = PE_PROTOCOLS[proto];
    if (proto === 'rope_2x3') {
      const easy = good.length >= 2 && good.every(easySession);
      return easy
        ? {
          order: ['grade', 'sets'],
          why: {
            grade: 'obie sesje wyraźnie lekkie (RPE ≤ 6, pompowanie ≤ 6) przy bardzo dobrej technice – rezerwa intensywności, więc trudniejsze drogi przy tej samej objętości',
            sets: 'trudność osiągnęła górną granicę z profilu – zwiększamy objętość',
          },
        }
        : {
          order: ['sets', 'grade'],
          why: {
            sets: 'zmęczenie pod kontrolą, ale bez dużej rezerwy – najpierw więcej objętości (kolejna seria) na tej samej trudności',
            grade: 'liczba serii osiągnęła limit protokołu – teraz trudność',
          },
        };
    }
    return {
      order: def.progressLevers,
      why: {
        grade: 'stabilne sesje na obecnej objętości – trudniejsze drogi',
        restBetweenSets: 'trudność osiągnęła górną granicę z profilu – skracamy przerwę między seriami',
        rounds: 'więcej rund przy tej samej trudności',
        workSec: 'dłuższy czas wspinania w interwale',
        routesPerSet: 'więcej dróg w serii',
        sets: 'kolejna seria',
      },
    };
  }

  progress(params: TrainingParams, good: CompletedWorkout[]): Change | null {
    const { order, why } = this.levers(params, good);
    for (const lever of order) {
      const ch = peLever(params, lever, 1);
      if (ch) return { ...ch, why: why[lever] };
    }
    return null;
  }

  reduce(params: TrainingParams, cause: FailureCause, _reason: ReduceReason): Change | null {
    const def = PE_PROTOCOLS[protocolOf(params.powerEndurance)];
    // technika / odpadnięcia → trudność; zmęczenie i objętość → objętość (gdy protokół na to pozwala)
    const order: PeLever[] = cause === 'technique' ? ['grade', ...def.volumeLevers] : [...def.volumeLevers, 'grade'];
    for (const lever of order) {
      const ch = peLever(params, lever, -1);
      if (ch) return ch;
    }
    return null;
  }

  ceiling(params: TrainingParams): string | undefined {
    const proto = protocolOf(params.powerEndurance);
    if (proto === 'rope_4x4' || proto === 'boulder_4x4') return undefined;
    return 'Wyniki pozwalają rozważyć zaawansowane obwody (np. Linked Routes) lub 4 × 4 – to propozycja do ręcznego zatwierdzenia w Profilu, nie obowiązkowy etap.';
  }

  explainHold(w: CompletedWorkout, check: SessionCheck): string {
    return `${NAME}: utrzymujemy obecny poziom. ${check.issues.join(', ')} (${check.facts.join(', ')}). Brak progresji.`;
  }
}
