import { Assessment } from '../../models/assessment';
import {
  AbilityKey, AbilityProfile, AbilityReport, ClimberIntake, CompletedWorkout, FingerProtocol, HangboardParams, PeProtocol, TrainingParams, UserProfile,
} from '../../models/models';
import { strengthResults } from '../assessment/scoring';
import { gradeIndex, shiftFont, shiftGrade, fontIndex, FONT_GRADES } from '../grades';
import { formatLoad, LIMITS, loadParts, sessionRpe } from '../progression';
import { HANG_START, roundDownToStep } from '../overload/hangboard-progression.service';
import { ABILITY_LABELS, ABILITY_PL, STATUS_LABELS, statusRank } from './abilities';
import { configureProtocol, PE_PROTOCOLS } from './protocols';

/**
 * Dobór treningu na podstawie profili zdolności – raport priorytetów i parametry planu.
 * Zasady:
 *  - bodziec dobierany do aktualnego ograniczenia, nie do jednego ogólnego poziomu,
 *  - 4 × 4 nie jest „lepsze” od 3 × 3 i nie jest obowiązkowym etapem,
 *  - liczba treningów w tygodniu się nie zmienia (3 jednostki),
 *  - Repeaters nigdy nie są dodawane automatycznie,
 *  - obciążenie zwisów liczone względem własnego maksimum i docelowego RPE, nie „im wyższy wynik, tym więcej kg”.
 */

const KEYS: AbilityKey[] = ['finger', 'powerEndurance', 'aerobic'];

/** Kolejność od największego ograniczenia do najmocniejszej strony (status, potem wynik w skali) */
export function rankAbilities(p: Record<AbilityKey, AbilityProfile>): AbilityKey[] {
  return [...KEYS].sort((a, b) => statusRank(p[a].status) - statusRank(p[b].status) || p[a].score - p[b].score);
}

export interface SelectionContext {
  intake: ClimberIntake;
  /** Liczba ostatnich sesji 3 × 3 (lub trudniejszych) ukończonych w całości przy RPE ≤ 7 i pompowaniu ≤ 7 */
  stableCircuitSessions: number;
  /** Przerwa w treningach ≥ 3 tygodnie */
  returningAfterBreak: boolean;
}

/** Sesje obwodów stabilnie ukończone przy niskim/umiarkowanym RPE i kontroli pompowania */
export function stableCircuits(ws: CompletedWorkout[]): number {
  return ws.filter((w) => {
    if (w.type !== 'C' || w.deload) return false;
    const pe = w.prescription.powerEndurance;
    if (pe.sets < 3) return false;
    const done = w.routes.filter((r) => r.completed).length;
    const rpe = sessionRpe(w);
    const pump = Math.max(0, ...w.routes.map((r) => r.pump ?? 0), ...w.sets.map((s) => s.pump ?? 0));
    return done >= pe.sets * pe.routesPerSet && rpe != null && rpe <= 7 && pump <= 7;
  }).length;
}

export interface ProtocolChoice {
  protocol: PeProtocol;
  reasons: string[];
}

/** Wybór protokołu wytrzymałości siłowej – do celu i ograniczenia, nie jako kolejny szczebel drabiny */
export function selectPeProtocol(p: Record<AbilityKey, AbilityProfile>, ctx: SelectionContext): ProtocolChoice {
  const [main] = rankAbilities(p);
  const pe = p.powerEndurance.status;
  const finger = p.finger.status;
  const style = ctx.intake.style;
  const lowTolerance = ctx.intake.routesPerSession != null && ctx.intake.routesPerSession < 6;

  if (ctx.returningAfterBreak) {
    return { protocol: 'rope_2x3', reasons: ['Powrót po przerwie w treningach – Rope 2 × 3 odbudowuje powtarzalność bez skoku objętości.'] };
  }
  if (pe === 'underdeveloped') {
    return { protocol: 'rope_2x3', reasons: [`Power Endurance: ${STATUS_LABELS[pe]} – najpierw podstawowa powtarzalność (Rope 2 × 3).`] };
  }
  if (lowTolerance) {
    return { protocol: 'rope_2x3', reasons: [`Typowa sesja to ok. ${ctx.intake.routesPerSession} dróg – niska tolerancja objętości, start od Rope 2 × 3.`] };
  }
  if (main === 'aerobic' && statusRank(pe) >= statusRank('established')) {
    return {
      protocol: statusRank(finger) >= statusRank('advanced') && statusRank(pe) >= statusRank('advanced') ? 'route_intervals' : 'rope_2x3',
      reasons: [
        'Główne ograniczenie: wytrzymałość tlenowa – nacisk na łatwe, ciągłe wspinanie w treningu B.',
        statusRank(pe) >= statusRank('advanced')
          ? 'Wytrzymałość siłowa na wysokim poziomie – Route Intervals utrzymują ją przy umiarkowanym zmęczeniu i wspierają próg tlenowy.'
          : 'Wytrzymałość siłowa w dawce podtrzymującej (Rope 2 × 3), żeby nie odbierać regeneracji pracy tlenowej.',
      ],
    };
  }
  // Strategia dla zaawansowanych: mocne palce + stabilne 3 × 3 przy niskim/umiarkowanym RPE i kontrolowanym pompowaniu
  const advancedReady = statusRank(finger) >= statusRank('advanced') && statusRank(pe) >= statusRank('established') && ctx.stableCircuitSessions >= 2;
  if (advancedReady) {
    const why = `Siła palców: ${STATUS_LABELS[finger]}, ${ctx.stableCircuitSessions} stabilne sesje 3 × 3 przy RPE ≤ 7 i kontrolowanym pompowaniu.`;
    if ((style === 'bouldery' || style === 'overhang') && ctx.intake.boulderGrade) {
      return { protocol: 'boulder_4x4', reasons: [why, 'Styl przewieszony / boulderowy – Boulder 4 × 4 daje bardziej wymagający bodziec na mocnych sekwencjach.'] };
    }
    return { protocol: 'linked_routes', reasons: [why, 'Kolejny bodziec: łączenie dróg bez długiego odpoczynku (trening pod dłuższe drogi i projekt) – zamiast automatycznego 4 × 4.'] };
  }
  const highVolume = ctx.intake.routesPerSession != null && ctx.intake.routesPerSession >= 12;
  if (main === 'powerEndurance' && highVolume && ctx.stableCircuitSessions >= 2 && statusRank(p.aerobic.status) >= statusRank('established')) {
    return {
      protocol: 'rope_4x4',
      reasons: ['Priorytet: wytrzymałość siłowa, wysoka tolerancja objętości i stabilne 3 × 3 – Rope 4 × 4 na odpowiednio niższej trudności.'],
    };
  }
  return {
    protocol: 'rope_3x3',
    reasons: [`Power Endurance: ${STATUS_LABELS[pe]} – Rope 3 × 3 rozwija wytrzymałość siłową i jakość przechwytów przy narastającym zmęczeniu.`],
  };
}

/** Tekst priorytetu treningowego */
/** Wszystkie trzy profile mają ten sam status – „ograniczenie” jest wtedy tylko względne */
export function isBalanced(p: Record<AbilityKey, AbilityProfile>): boolean {
  return new Set(KEYS.map((k) => p[k].status)).size === 1;
}

export function priorityText(p: Record<AbilityKey, AbilityProfile>): string {
  const [main] = rankAbilities(p);
  const fingerStrong = statusRank(p.finger.status) >= statusRank('advanced');
  const balanced = isBalanced(p)
    ? `Profile są wyrównane (wszystkie: ${STATUS_LABELS[p.finger.status]}) – akcent na obszar względnie najsłabszy: ${ABILITY_PL[main]}. `
    : '';
  switch (main) {
    case 'powerEndurance':
      return `${balanced}Priorytetem jest wytrzymałość siłowa.${fingerStrong ? ' Utrzymuj siłę palców, ale nie zwiększaj jej objętości bez potrzeby.' : ''}`;
    case 'finger':
      return `${balanced}Priorytetem jest progres siły palców.`;
    case 'aerobic':
      return `${balanced}Większy nacisk na łatwe, ciągłe wspinanie i regenerację przedramion.`;
  }
}

/* ---------------- Max Hangs ---------------- */

export interface FingerPrescription {
  hangboard: HangboardParams;
  reasons: string[];
}

/**
 * Ciężar orientacyjny sesji kalibracyjnej (zwis 7 s) jako ułamek maksimum 5 s (obciążenie całkowite).
 * Wynik testu to maksimum (RPE 10), nie ciężar treningowy – ciężar zatwierdza dopiero sesja kalibracyjna (cel RPE 7–8).
 */
export const HANG_INTENSITY = { start: 0.85, painHistory: 0.75 } as const;

export function prescribeFinger(
  p: Record<AbilityKey, AbilityProfile>, assessment: Assessment | null, prev: HangboardParams, recentWorkouts: CompletedWorkout[],
): FingerPrescription {
  const reasons: string[] = [];
  const [main] = rankAbilities(p);
  const protocol: FingerProtocol = prev.protocol === 'repeaters' ? 'repeaters' : 'max_hangs';
  const next: HangboardParams = { ...prev, protocol };
  if (protocol === 'repeaters') reasons.push('Repeaters wybrane ręcznie – zostają; obciążenie dobierasz w ustawieniach protokołu.');
  else reasons.push('Max Hangs – trening siły maksymalnej. Repeaters nie są dodawane automatycznie, nawet przy słabszej wytrzymałości.');

  const s = assessment?.strength;
  const res = s ? strengthResults(s).finger : null;
  const pain = recentWorkouts.flatMap((w) => w.hangs).filter((h) => h.pain).length;
  if (res && res.totalLoadKg != null && res.bodyMassKg != null && protocol === 'max_hangs') {
    const factor: number = pain ? HANG_INTENSITY.painHistory : HANG_INTENSITY.start;
    if (pain) reasons.push(`Historia: ${pain} sesji zwisów z bólem – obniżony ciężar startowy (${Math.round(factor * 100)}% maksimum).`);
    const load = roundDownToStep(res.totalLoadKg * factor - res.bodyMassKg);
    Object.assign(next, loadParts(load));
    next.hangSec = HANG_START.hangSec;
    next.restSec = HANG_START.restSec;
    next.sets = HANG_START.sets;
    next.calibration = 'pending';
    if (s!.maxFingerStrength.edgeDepthMm != null) {
      next.edgeSizeMm = s!.maxFingerStrength.edgeDepthMm;
      next.edge = s!.maxFingerStrength.edgeLabel || next.edge;
    }
    next.grip = 'half_crimp';
    const maxAdded = res.totalLoadKg - res.bodyMassKg;
    reasons.push(
      `Wynik Max Hang (${maxAdded >= 0 ? '+' : '−'}${Math.abs(Math.round(maxAdded * 100) / 100)} kg przy ${res.bodyMassKg} kg, 5 s, RPE 10) to maksimum, nie ciężar treningowy.`,
      `Sesja kalibracyjna: ${HANG_START.sets} × ${HANG_START.hangSec} s, przerwa ${HANG_START.restSec} s, half crimp, ciężar orientacyjny ${formatLoad(next)} (≈ ${Math.round(factor * 100)}% maksimum), cel RPE ${HANG_START.rpe}. Ciężar zostanie zatwierdzony po pierwszej sesji – za trudno: mniej lub odciążenie, bardzo łatwo: ostrożnie więcej.`,
      `Dalej +${String(LIMITS.hangLoadStepKg).replace('.', ',')} kg tylko po dwóch kolejnych udanych sesjach (wszystkie serie, pełny czas zwisu, RPE ≤ 8, prawidłowa technika, bez bólu).`,
      main === 'finger' ? 'Siła palców to główne ograniczenie – priorytet progresji ciężaru.' : `Siła palców: ${STATUS_LABELS[p.finger.status]} – progresja ciężaru tylko przy pełnej tolerancji obciążenia.`,
    );
  } else if (protocol === 'max_hangs') {
    reasons.push('Brak ważnego pomiaru Max Hang 5 s – zwisy startują od dotychczasowych parametrów.');
  }
  return { hangboard: next, reasons };
}

/* ---------------- Parametry planu ---------------- */

export interface PlanPrescription {
  params: TrainingParams;
  report: AbilityReport;
}

/** Trudność, którą użytkownik potrafi powtarzać – z potwierdzonego testu, wywiadu lub RP */
export function repeatableGrade(intake: ClimberIntake, testGrade: string | null): string {
  if (testGrade && gradeIndex(testGrade) >= 0) return testGrade;
  if (gradeIndex(intake.repeatableGrade) >= 0) return intake.repeatableGrade!;
  if (gradeIndex(intake.rpGrade) >= 0) return shiftGrade(intake.rpGrade!, -3);
  return '5c';
}

/** Przesunięcie trudności protokołu względem trudności powtarzalnej (stopnie skali) */
const PE_GRADE_OFFSET: Record<PeProtocol, number> = {
  rope_2x3: -1, rope_3x3: -1, rope_4x4: -2, linked_routes: -1, route_intervals: -2, boulder_4x4: 0,
};

function boulderGradeFor(intake: ClimberIntake, rep: string): string {
  if (fontIndex(intake.boulderGrade) >= 0) return shiftFont(intake.boulderGrade!, -4);
  const i = Math.max(0, Math.min(FONT_GRADES.length - 1, gradeIndex(rep) - 8));
  return FONT_GRADES[i];
}

export interface PrescribeInput {
  profiles: Record<AbilityKey, AbilityProfile>;
  intake: ClimberIntake;
  assessment: Assessment | null;
  /** Potwierdzona trudność testu dróg (benchmark) */
  testGrade: string | null;
  prev: TrainingParams;
  recentWorkouts: CompletedWorkout[];
  returningAfterBreak: boolean;
  ts: string;
}

export function prescribe(inp: PrescribeInput): PlanPrescription {
  const { profiles: p, intake } = inp;
  const ranked = rankAbilities(p);
  const [main, secondary] = ranked;
  const strongest = ranked[ranked.length - 1];
  const ctx: SelectionContext = { intake, stableCircuitSessions: stableCircuits(inp.recentWorkouts), returningAfterBreak: inp.returningAfterBreak };
  const choice = selectPeProtocol(p, ctx);
  const finger = prescribeFinger(p, inp.assessment, inp.prev.hangboard, inp.recentWorkouts);
  const rep = repeatableGrade(intake, inp.testGrade);
  const reasons: string[] = [];

  // Wytrzymałość siłowa
  const def = PE_PROTOCOLS[choice.protocol];
  const peGrade = def.font ? boulderGradeFor(intake, rep) : shiftGrade(rep, PE_GRADE_OFFSET[choice.protocol]);
  const pe = configureProtocol(choice.protocol, peGrade, def.font ? {} : { gradeCap: shiftGrade(rep, 1) });
  reasons.push(...choice.reasons);
  reasons.push(
    def.font
      ? `Trudność problemów: ${peGrade} (Font) – ok. 4 stopnie poniżej maksimum boulderowego${intake.boulderGrade ? ` (${intake.boulderGrade})` : ''}.`
      : `Trudność obwodu: ${peGrade} – względem trudności, którą powtarzasz (${rep}); górna granica w tym cyklu ${pe.gradeCap}.`,
  );

  // Wytrzymałość tlenowa (trening B, po zwisach)
  const aerobicPriority = main === 'aerobic';
  const tol = intake.routesPerSession;
  let routes = aerobicPriority ? 6 : statusRank(p.aerobic.status) >= statusRank('advanced') ? 5 : 4;
  if (tol != null) routes = Math.max(3, Math.min(routes, Math.max(4, tol - 2)));
  const aerobic = { ...inp.prev.aerobic, routes, grade: shiftGrade(rep, -3), restMin: aerobicPriority ? 2 : 3, gradeCap: shiftGrade(rep, -1) };
  reasons.push(
    `Drogi tlenowe: ${routes} × ${aerobic.grade}, przerwy ${aerobic.restMin} min, pompowanie maks. ${aerobic.targetMaxPump}/10${aerobicPriority ? ' – zwiększona objętość, bo to główne ograniczenie' : ''}.`,
  );

  // Trudne drogi (A) – wokół RP
  const rp = gradeIndex(intake.rpGrade) >= 0 ? intake.rpGrade! : shiftGrade(rep, 3);
  const hardRoutes = { ...inp.prev.hardRoutes, gradeFrom: shiftGrade(rp, -1), gradeTo: shiftGrade(rp, 1) };

  reasons.push(...finger.reasons);
  reasons.push('Liczba treningów w tygodniu bez zmian (3 jednostki) – zmienia się rodzaj i dawka bodźca, nie częstotliwość.');

  const report: AbilityReport = {
    generatedAt: inp.ts,
    sourceAssessmentId: inp.assessment?.id ?? null,
    profiles: p,
    strongest,
    mainLimitation: main,
    secondaryLimitation: secondary,
    priority: priorityText(p),
    recommendedProtocol: choice.protocol,
    fingerProtocol: finger.hangboard.protocol ?? 'max_hangs',
    reasons,
  };
  return { params: { hangboard: finger.hangboard, hardRoutes, aerobic, powerEndurance: pe }, report };
}

/** Krótkie podsumowanie raportu dla zdarzeń i list */
export function summarizeReport(r: AbilityReport): string {
  const s = (k: AbilityKey) => `${ABILITY_LABELS[k]}: ${STATUS_LABELS[r.profiles[k].status]}`;
  return `${s('finger')} · ${s('powerEndurance')} · ${s('aerobic')}. Najmocniejsza strona: ${ABILITY_PL[r.strongest]}; główne ograniczenie: ${ABILITY_PL[r.mainLimitation]}. ${r.priority} Protokół: ${PE_PROTOCOLS[r.recommendedProtocol].name}.`;
}

