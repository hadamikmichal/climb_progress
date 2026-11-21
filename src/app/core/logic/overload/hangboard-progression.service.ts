import { Assessment } from '../../models/assessment';
import { CompletedWorkout, HangboardParams, ReadinessCheck, TrainingParams } from '../../models/models';
import { strengthResults } from '../assessment/scoring';
import {
  Change, changeLoad, describeTrack, effectiveLoadKg, formatLoad, HistoryEntry, LIMITS, loadParts, ProgressionDecision, setLoad, TRACK_NAMES,
} from '../progression';
import { cond, fromConditions, num, recoveryConditions } from './conditions';
import { CompletedEntry, FailureCause, ReduceReason, SessionCheck, SpecialInput, TrackProgressionService } from './types';

/**
 * Max Hangs – progresja ciężaru (Progressive Overload).
 *
 *  - Wynik testu Max Hang (5 s, RPE 10) to maksimum, nie ciężar treningowy.
 *  - Start: sesja kalibracyjna 4 × 7 s, przerwa 180 s, ciężar orientacyjny ≈ 85% maksimum (dla 70 kg i +21,25 kg → +7,5 kg),
 *    cel RPE 7–8. Ciężar jest zatwierdzany po sesji kalibracyjnej (za trudno → mniej / odciążenie, bardzo łatwo → ostrożnie więcej).
 *  - +1,25 kg tylko po DWÓCH kolejnych udanych sesjach: wszystkie serie, pełny czas każdego zwisu, RPE ≤ 8,
 *    prawidłowa technika, brak bólu palców (także następnego dnia), ciężar zgodny z planem.
 *  - Warunki niespełnione → utrzymanie ciężaru i analiza przyczyny. Ból → koniec ciężkich zwisów, brak progresji,
 *    regeneracja i ponowna ocena gotowości.
 *  - Po deloadzie wznowienie od ostatniego dobrze tolerowanego ciężaru – nigdy automatyczne „+kg za deload”.
 */

const NAME = TRACK_NAMES.hang;
const STEP = LIMITS.hangLoadStepKg;

/** Protokół startowy Max Hangs */
export const HANG_START = { sets: 4, hangSec: 7, restSec: 180, intensity: 0.85, rpe: '7–8' } as const;

/** Zaokrąglenie w dół do kroku talerzy (1,25 kg) */
export const roundDownToStep = (kg: number) => Math.floor((kg + 1e-9) / STEP) * STEP;

export interface MaxHangSnapshot {
  addedKg: number | null;
  totalKg: number | null;
  ratioPercent: number | null;
  holdSec: number | null;
  rpe: number | null;
  bodyMassKg: number | null;
  edgeMm: number | null;
  edgeLabel: string;
}

export interface MaxHangComparisonRow {
  label: string;
  unit: string;
  before: number | null;
  after: number | null;
  delta: number | null;
}

export interface MaxHangComparison {
  before: MaxHangSnapshot;
  after: MaxHangSnapshot;
  rows: MaxHangComparisonRow[];
  /** Różnice warunków testu (krawądka, chwyt, czas) – porównanie tylko orientacyjne */
  conditionIssues: string[];
}

export class HangboardProgressionService implements TrackProgressionService {
  readonly track = 'hang' as const;

  /* ---------------- start i kalibracja ---------------- */

  /**
   * Ciężar orientacyjny sesji kalibracyjnej z wyniku maksymalnego.
   * 85% obciążenia całkowitego maksimum, zaokrąglone w dół do 1,25 kg. 70 kg + 21,25 kg → +7,5 kg.
   */
  calibrationLoad(maxAddedKg: number, bodyMassKg: number): number {
    const total = bodyMassKg + maxAddedKg;
    return roundDownToStep(total * HANG_START.intensity - bodyMassKg);
  }

  /** Parametry sesji kalibracyjnej (4 × 7 s, 180 s, half crimp, ta sama krawądka co w teście) */
  calibrationParams(base: HangboardParams, maxAddedKg: number, bodyMassKg: number): HangboardParams {
    return {
      ...base,
      ...loadParts(this.calibrationLoad(maxAddedKg, bodyMassKg)),
      sets: HANG_START.sets, hangSec: HANG_START.hangSec, restSec: HANG_START.restSec, grip: 'half_crimp', calibration: 'pending',
    };
  }

  /* ---------------- ocena sesji ---------------- */

  check(w: CompletedWorkout): SessionCheck {
    const plan = w.prescription.hangboard;
    const h = w.hangs[0];
    if (!h) {
      return fromConditions([cond('logged', 'Zapisane zwisy', false, 'brak zapisanych zwisów')], []);
    }
    const rpe = h.rpe ?? w.rpe;
    const actual = effectiveLoadKg(h);
    const planned = effectiveLoadKg(plan);
    const times = h.holdTimes?.slice(0, h.setsDone) ?? null;
    const timeHeld = h.hangSec + 1e-9 >= plan.hangSec && (times ? times.length >= h.setsDone && times.every((t) => t + 0.25 >= plan.hangSec) : null);
    const technique = h.techniqueOk ?? (w.technique != null ? w.technique >= 3 : null);
    const pain = h.pain || !!w.followUp?.fingerPain;
    const short = times ? times.filter((t) => t + 0.25 < plan.hangSec).length : 0;

    const conditions = [
      cond('sets', 'Wszystkie serie', h.setsDone >= plan.sets, `${h.setsDone}/${plan.sets}`),
      cond('time', `Czas zwisu ${plan.hangSec} s w każdej serii`, h.hangSec < plan.hangSec ? false : timeHeld,
        h.hangSec < plan.hangSec ? `zwis skrócony do ${h.hangSec} s` : times ? (short ? `${short} ${short === 1 ? 'zwis krótszy' : 'zwisy krótsze'} (${times.map(num).join(' / ')} s)` : `${times.map(num).join(' / ')} s`) : 'czasy nie zapisane'),
      cond('rpe', `RPE ≤ ${LIMITS.hangRpeMax}`, rpe != null ? rpe <= LIMITS.hangRpeMax : false, rpe != null ? `RPE ${num(rpe)}` : 'nie podano RPE'),
      cond('load', 'Ciężar zgodny z planem', actual + 1e-9 >= planned, actual + 1e-9 >= planned ? formatLoad(h) : `${formatLoad(h)} zamiast ${formatLoad(plan)}`),
      cond('technique', 'Prawidłowa technika', technique ?? false, technique == null ? 'brak oceny techniki' : technique ? 'prawidłowa' : 'nieprawidłowa'),
      cond('pain', 'Brak bólu palców', !pain, pain ? (h.pain ? 'ból podczas zwisów' : 'ból następnego dnia') : 'brak'),
      ...recoveryConditions(w).filter((c) => c.key !== 'followUp' || !w.followUp?.fingerPain),
    ];
    const facts = [
      `zwisy ${h.setsDone}/${plan.sets}`,
      ...(rpe != null ? [`RPE zwisów ${num(rpe)}`] : []),
      `ciężar ${formatLoad(h)}${Math.abs(actual - planned) > 1e-9 ? ` (plan ${formatLoad(plan)})` : ''}`,
      ...(technique != null ? [`technika ${technique ? 'prawidłowa' : 'nieprawidłowa'}`] : []),
    ];
    const incomplete = h.setsDone < plan.sets || timeHeld === false;
    return fromConditions(conditions, facts, { pain, bad: incomplete && rpe != null && rpe >= LIMITS.badStrain });
  }

  cause(w: CompletedWorkout): FailureCause {
    const h = w.hangs[0];
    if (h?.pain || w.followUp?.fingerPain) return 'pain';
    if (h?.techniqueOk === false) return 'technique';
    return 'fatigue';
  }

  criteria(): string {
    return `wszystkie serie i pełny czas każdego zwisu, RPE ≤ ${LIMITS.hangRpeMax}, prawidłowa technika, bez bólu palców (także następnego dnia)`;
  }

  /* ---------------- zmiany ---------------- */

  progress(params: TrainingParams): Change | null {
    if (params.hangboard.sets < LIMITS.hangSets) {
      // powrót do docelowej objętości po wcześniejszym zmniejszeniu serii – ciężar bez zmian
      const n = structuredClone(params);
      n.hangboard.sets++;
      return { parameter: 'Serie zwisów', from: `${params.hangboard.sets}`, to: `${n.hangboard.sets}`, params: n };
    }
    return changeLoad(params, STEP);
  }

  reduce(params: TrainingParams, _cause: FailureCause, reason: ReduceReason): Change | null {
    // przerwa → 2 kroki (2,5 kg), dwie nieudane sesje z rzędu → 1 krok; serie bez zmian
    return changeLoad(params, reason === 'break' ? -2 * STEP : -STEP);
  }

  explainProgress(ch: Change, good: CompletedWorkout[]): string {
    const rpes = good.map((w) => w.hangs[0]?.rpe ?? w.rpe).filter((r): r is number => r != null);
    const rpeText = rpes.length ? `RPE ${rpes.map(num).join(' i ')}` : `RPE ≤ ${LIMITS.hangRpeMax}`;
    if (ch.parameter === 'Serie zwisów') {
      return `${NAME}: wracamy do ${ch.to} serii (${ch.from} → ${ch.to}), ponieważ dwa ostatnie treningi zostały wykonane poprawnie (${rpeText}). Ciężar bez zmian.`;
    }
    return `${NAME}: zwiększamy Max Hang o ${num(STEP)} kg (${ch.from} → ${ch.to}), ponieważ dwa ostatnie treningi zostały wykonane poprawnie – wszystkie serie, pełny czas zwisu, ${rpeText}, prawidłowa technika, bez bólu palców.`;
  }

  explainHold(w: CompletedWorkout, check: SessionCheck): string {
    const failed = check.conditions.filter((c) => c.met === false).map((c) => c.key);
    let why: string;
    if (failed.includes('sets') || failed.includes('time')) why = 'W ostatniej sesji nie udało się ukończyć wszystkich zwisów';
    else if (failed.includes('rpe')) why = `RPE w ostatniej sesji powyżej ${LIMITS.hangRpeMax}/10 – ciężar jest jeszcze zbyt wymagający`;
    else if (failed.includes('technique')) why = 'Technika w ostatniej sesji nie była prawidłowa (lub nie została oceniona)';
    else if (failed.includes('load')) why = 'Ostatnią sesję wykonano z mniejszym ciężarem niż planowany';
    else if (failed.includes('followUp') || failed.includes('feeling')) why = 'Słaba regeneracja po ostatniej sesji';
    else why = `Ostatnia sesja nie spełniła warunków (${check.issues.join(', ')})`;
    return `${NAME}: utrzymujemy obciążenie ${formatLoad(w.prescription.hangboard)}. ${why}. Nie zwiększamy ciężaru, dopóki dwie kolejne sesje nie zakończą się powodzeniem.`;
  }

  onBad(params: TrainingParams, w: CompletedWorkout, check: SessionCheck): { change: Change | null; reason: string } {
    const techBad = check.conditions.some((c) => c.key === 'technique' && c.met === false);
    if (techBad && params.hangboard.sets > LIMITS.hangSetsMin) {
      const n = structuredClone(params);
      n.hangboard.sets--;
      return {
        change: { parameter: 'Serie zwisów', from: `${params.hangboard.sets}`, to: `${n.hangboard.sets}`, params: n },
        reason: `${NAME}: zmniejszamy objętość. Wykryto podwyższone zmęczenie (${check.facts.join(', ')}) i pogorszenie jakości techniki – serie ${params.hangboard.sets} → ${n.hangboard.sets}, ciężar bez zmian.`,
      };
    }
    return { change: null, reason: `${this.explainHold(w, check)} Sesja na granicy możliwości (RPE ≥ ${LIMITS.badStrain}) – jeśli kolejna też się nie uda, wrócimy do ostatniego dobrze tolerowanego ciężaru.` };
  }

  /* ---------------- reguły specjalne: ból i kalibracja ---------------- */

  special(inp: SpecialInput): ProgressionDecision | null {
    const { last, check, params } = inp;
    if (check.pain) {
      const during = !!last.hangs[0]?.pain;
      return inp.hold(
        `${NAME}: zgłoszony ból palców ${during ? 'podczas zwisów' : 'następnego dnia po treningu'}. Kończymy ciężkie zwisy – brak progresji. ` +
          `Zalecana regeneracja (bez obciążania palców) i ponowna ocena gotowości przed kolejną sesją zwisów. ` +
          `Ciężar ${formatLoad(params.hangboard)} pozostaje zapisany; po powrocie seria udanych sesji liczy się od nowa.`,
        [last.id],
        ['ból palców – wymagana regeneracja i ocena gotowości'],
        { recovery: true },
      );
    }
    if (params.hangboard.calibration === 'pending' && last.prescription.hangboard.calibration === 'pending') {
      return this.calibrate(inp);
    }
    return null;
  }

  /** Zatwierdzenie ciężaru po sesji kalibracyjnej */
  private calibrate(inp: SpecialInput): ProgressionDecision {
    const { last: w, check, params } = inp;
    const h = w.hangs[0];
    if (!h) {
      return inp.hold(`${NAME} – kalibracja: brak zapisanych zwisów. Kalibrację powtarzamy w kolejnej sesji (${formatLoad(params.hangboard)}).`, [w.id]);
    }
    const planned = effectiveLoadKg(w.prescription.hangboard);
    const actual = effectiveLoadKg(h);
    const rpe = h.rpe ?? w.rpe;
    const met = (k: string) => check.conditions.find((c) => c.key === k)?.met;
    const allDone = met('sets') !== false && met('time') !== false;
    let target: number;
    let confirmed = false;
    let why: string;
    if (!allDone || (rpe != null && rpe >= 9)) {
      target = actual - 2 * STEP;
      why = `Za trudno (${!allDone ? 'nie wszystkie zwisy ukończone' : `RPE ${num(rpe)}`}) – zmniejszamy o ${num(2 * STEP)} kg${target < 0 ? ' (odciążenie)' : ''} i powtarzamy kalibrację`;
    } else if (met('technique') === false) {
      target = actual - STEP;
      why = `Technika nieprawidłowa lub nieoceniona – zmniejszamy o ${num(STEP)} kg i powtarzamy kalibrację`;
    } else if (rpe == null) {
      target = actual;
      why = 'Brak RPE – nie można zatwierdzić ciężaru, powtarzamy kalibrację';
    } else if (rpe <= 6) {
      target = actual + 2 * STEP;
      why = `Bardzo łatwo (RPE ${num(rpe)}) – ostrożnie zwiększamy o ${num(2 * STEP)} kg i powtarzamy kalibrację`;
    } else {
      target = actual;
      confirmed = true;
      why = `RPE ${num(rpe)} w docelowym zakresie ${HANG_START.rpe}, wszystkie serie i pełny czas zwisu – ciężar treningowy zatwierdzony`;
    }
    const ch = setLoad(params, target, 'Obciążenie zwisów (kalibracja)');
    ch.params.hangboard.calibration = confirmed ? 'confirmed' : 'pending';
    const action = target > planned + 1e-9 ? 'progress' : target < planned - 1e-9 ? 'reduce' : 'hold';
    const reason = `${NAME} – kalibracja: zaplanowano ${formatLoad(w.prescription.hangboard)}, wykonano ${formatLoad(h)} (${check.facts.join(', ')}). ${why}. ` +
      `Ciężar na kolejną sesję: ${formatLoad(ch.params.hangboard)}.${confirmed ? ' Od teraz progresja +1,25 kg po dwóch kolejnych udanych sesjach.' : ''}`;
    return inp.change(action, ch, reason, [w.id], confirmed ? { blockers: [] } : { blockers: ['kalibracja ciężaru w toku'] });
  }

  /* ---------------- deload i gotowość ---------------- */

  /**
   * Po deloadzie: wznowienie od ostatniego dobrze tolerowanego ciężaru (ostatnia udana sesja poza deloadem).
   * Zwraca zmianę tylko wtedy, gdy aktualny ciężar jest wyższy niż tolerowany.
   */
  afterDeload(history: HistoryEntry[], params: TrainingParams): { change: Change; reason: string; sourceIds: string[] } | null {
    if (params.hangboard.calibration === 'pending') return null;
    const lastOk = [...history].reverse().find((h): h is CompletedEntry => h.kind === 'completed' && !h.workout.deload && !!h.workout.hangs[0] && this.check(h.workout).successful);
    if (!lastOk) return null;
    const tolerated = effectiveLoadKg(lastOk.workout.hangs[0]);
    if (effectiveLoadKg(params.hangboard) <= tolerated + 1e-9) return null;
    const change = setLoad(params, tolerated);
    return {
      change,
      sourceIds: [lastOk.workout.id],
      reason: `${NAME}: po deloadzie wznawiamy od ostatniego dobrze tolerowanego obciążenia ${change.to} (udana sesja z ${lastOk.workout.date}), a nie od ${change.from}, którego jeszcze nie wykonano poprawnie. Deload nie zwiększa automatycznie ciężaru.`,
    };
  }

  /** Ostatnia sesja zwisów (poza deloadem) zakończona bólem palców */
  lastPainSession(history: HistoryEntry[]): CompletedWorkout | null {
    const last = [...history].reverse().find((h): h is CompletedEntry => h.kind === 'completed' && !h.workout.deload && h.workout.hangs.length > 0);
    return last && this.check(last.workout).pain ? last.workout : null;
  }

  /** Po bólu palców kolejne ciężkie zwisy wymagają oceny gotowości bez bólu (wykonanej po tej sesji) */
  requiresReadiness(history: HistoryEntry[], readiness: ReadinessCheck[]): boolean {
    const w = this.lastPainSession(history);
    if (!w) return false;
    const after = w.followUp?.fingerPain ? w.followUp.date : w.date;
    return !readiness.some((r) => r.date > after && !r.fingerPain && !r.elbowShoulderPain && !r.unusualFatigue);
  }

  /* ---------------- retest ---------------- */

  /** Najlepsza ważna próba Max Hang (5 s) z testu */
  maxHang(a: Assessment | null | undefined): MaxHangSnapshot | null {
    const s = a?.strength;
    if (!s) return null;
    const r = strengthResults(s).finger;
    const t = r.bestIndex != null ? s.maxFingerStrength.attempts[r.bestIndex] : null;
    if (!t) return null;
    return {
      addedKg: t.addedWeightKg - t.assistanceKg,
      totalKg: r.totalLoadKg,
      ratioPercent: r.bodyMassRatioPercent != null ? Math.round(r.bodyMassRatioPercent * 10) / 10 : null,
      holdSec: t.holdSeconds,
      rpe: t.rpe,
      bodyMassKg: r.bodyMassKg,
      edgeMm: s.maxFingerStrength.edgeDepthMm,
      edgeLabel: s.maxFingerStrength.edgeLabel,
    };
  }

  /** Porównanie Max Hang: Baseline vs Retest (ciężar dodatkowy, całkowity, % masy ciała, czas, RPE) */
  compareMaxHang(baseline: Assessment | null | undefined, retest: Assessment | null | undefined): MaxHangComparison | null {
    const a = this.maxHang(baseline);
    const b = this.maxHang(retest);
    if (!a || !b) return null;
    const row = (label: string, unit: string, x: number | null, y: number | null): MaxHangComparisonRow => ({
      label, unit, before: x, after: y, delta: x != null && y != null ? Math.round((y - x) * 100) / 100 : null,
    });
    const issues: string[] = [];
    if (a.edgeMm !== b.edgeMm) issues.push(`Inna krawądka (${a.edgeMm ?? '?'} mm vs ${b.edgeMm ?? '?'} mm).`);
    if ((a.holdSec ?? 0) < 5 || (b.holdSec ?? 0) < 5) issues.push('Czas utrzymania krótszy niż 5 s w jednym z testów.');
    return {
      before: a, after: b, conditionIssues: issues,
      rows: [
        row('Ciężar dodatkowy', 'kg', a.addedKg, b.addedKg),
        row('Ciężar całkowity', 'kg', a.totalKg, b.totalKg),
        row('Stosunek do masy ciała', '%', a.ratioPercent, b.ratioPercent),
        row('Czas utrzymania', 's', a.holdSec, b.holdSec),
        row('RPE', '', a.rpe, b.rpe),
      ],
    };
  }

  /** Krótki opis poziomu (do widoku) */
  describe(p: TrainingParams): string {
    return describeTrack('hang', p);
  }
}
