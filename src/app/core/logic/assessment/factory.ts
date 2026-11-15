import {
  Assessment, AssessmentKind, ClimbingAssessment, PROTOCOL_VERSION, ROUTE_REST_SEC, SessionReadiness, StrengthAssessment, TestRoute,
} from '../../models/assessment';
import { ISODate, Timestamp } from '../../models/models';
import { emptyRecoveryCurve } from './climbing';

export const BASELINE_ROUTE_ATTEMPTS = 4;
export const CONTROL_ROUTE_ATTEMPTS = 3;
/** Minimalny / zalecany maksymalny odstęp między sesjami (godziny) */
export const MIN_SESSION_GAP_H = 48;
export const MAX_SESSION_GAP_H = 72;

export function emptyReadiness(ts: Timestamp, bodyMassKg: number | null): SessionReadiness {
  return {
    bodyMassKg, testedAt: ts, sleepHours: null, wellbeing: null, fatigue: null, fingerPain: null, elbowPain: null, shoulderPain: null,
    illness: null, recentHardTraining: null, painNotes: '', acknowledgedWarnings: false, confirmed: false,
  };
}

export function newAssessment(id: string, cycleId: string, kind: AssessmentKind, ts: Timestamp): Assessment {
  return {
    id, cycleId, kind, protocolVersion: PROTOCOL_VERSION, status: 'scheduled', createdAt: ts, updatedAt: ts, completedAt: null,
    strength: null, climbing: null, plannedIds: [], notes: '',
  };
}

/** Nowa sesja siłowa – warunki sprzętowe przejmujemy z poprzedniego testu (te same krawądka i drążek) */
export function newStrengthSession(date: ISODate, ts: Timestamp, bodyMassKg: number | null, prev: StrengthAssessment | null, edgeLabel: string, edgeDepthMm: number | null): StrengthAssessment {
  return {
    status: 'in_progress', date, startedAt: ts, completedAt: null, readiness: emptyReadiness(ts, bodyMassKg), warmupChecked: [], step: 'readiness',
    weightedPullUp: { status: 'success', attempts: [], skipReason: '', notes: '' },
    maxFingerStrength: {
      status: 'success', edgeDepthMm: prev?.maxFingerStrength.edgeDepthMm ?? edgeDepthMm, edgeLabel: prev?.maxFingerStrength.edgeLabel ?? edgeLabel,
      gripType: 'half_crimp', holdDurationTargetSec: 5, attempts: [], skipReason: '', notes: '',
    },
    coreStrength: { status: 'success', attempts: [], skipReason: '', notes: '' },
    deadHang: {
      status: 'success', holdSeconds: null, barDiameterMm: prev?.deadHang.barDiameterMm ?? null, gripType: 'pronated', endReason: null,
      timerStartedAt: null, skipReason: '', notes: '',
    },
    notes: '',
  };
}

export function emptyRoute(): TestRoute {
  return { routeId: '', name: '', location: '', frenchGrade: '6a', heightMeters: 13, wallStyle: 'vertical', climbingStyle: 'top_rope', imageUrl: '', knownAndSent: true };
}

export function newClimbingSession(date: ISODate, ts: Timestamp, bodyMassKg: number | null, plannedAttempts: number, prevRoute: TestRoute | null): ClimbingAssessment {
  return {
    status: 'in_progress', date, startedAt: ts, completedAt: null, readiness: emptyReadiness(ts, bodyMassKg), warmupChecked: [],
    route: prevRoute ? { ...prevRoute } : emptyRoute(), plannedAttempts, restSeconds: ROUTE_REST_SEC, attempts: [], restStartedAt: null,
    stoppedByFatigue: false, recoveryStartedAt: null, recoveryCurve: emptyRecoveryCurve(), routeChanged: false, notes: '',
  };
}

export interface ReadinessVerdict {
  /** Wszystkie wymagane pola wypełnione */
  complete: boolean;
  missing: string[];
  /** Ból / choroba – próby maksymalne zablokowane, zalecane przełożenie */
  blocked: boolean;
  blockers: string[];
  /** Ostrzeżenia – można kontynuować po świadomym potwierdzeniu (wynik mniej porównywalny) */
  warnings: string[];
}

/**
 * Ocena warunków początkowych sesji testowej.
 * @param hoursSinceStrength godziny od zakończenia dnia 1 (tylko dla sesji wspinaczkowej)
 */
export function evaluateTestReadiness(r: SessionReadiness, hoursSinceStrength: number | null = null): ReadinessVerdict {
  const missing: string[] = [];
  if (!(r.bodyMassKg && r.bodyMassKg > 0)) missing.push('masa ciała');
  if (r.wellbeing == null) missing.push('samopoczucie');
  if (r.fatigue == null) missing.push('zmęczenie');
  if (r.fingerPain == null || r.elbowPain == null || r.shoulderPain == null) missing.push('dolegliwości bólowe');
  if (r.illness == null) missing.push('choroba');
  if (r.recentHardTraining == null) missing.push('trening w ostatnich 48 h');

  const blockers: string[] = [];
  const pains = [r.fingerPain && 'palców', r.elbowPain && 'łokci', r.shoulderPain && 'barków'].filter(Boolean);
  if (pains.length) blockers.push(`Ból ${pains.join(', ')}: próby maksymalne są zablokowane. Przełóż test – wynik przy bólu nie jest miarodajny, a ryzyko urazu rośnie.`);
  if (r.illness) blockers.push('Choroba: nie wykonuj testu. Przełóż go na czas po ustąpieniu objawów.');

  const warnings: string[] = [];
  if (r.recentHardTraining) warnings.push('Intensywny trening w ostatnich 48 h – protokół wymaga min. 48 h bez ciężkiego wspinania i treningu palców. Zalecane przełożenie.');
  if (r.fatigue != null && r.fatigue >= 4) warnings.push(`Wysokie zmęczenie (${r.fatigue}/5) – wynik może być zaniżony.`);
  if (r.wellbeing != null && r.wellbeing <= 2) warnings.push(`Niskie samopoczucie (${r.wellbeing}/5) – wynik może być zaniżony.`);
  if (r.sleepHours != null && r.sleepHours < 6) warnings.push(`Krótki sen (${r.sleepHours} h) – wynik może być zaniżony.`);
  if (hoursSinceStrength != null && hoursSinceStrength < MIN_SESSION_GAP_H) {
    warnings.push(`Od dnia siłowego minęło ${Math.floor(hoursSinceStrength)} h – protokół wymaga min. ${MIN_SESSION_GAP_H} h odstępu.`);
  }
  return { complete: missing.length === 0, missing, blocked: blockers.length > 0, blockers, warnings };
}

/** Czy rozpoczęcie właściwej części testu jest dozwolone */
export function readinessAllowsStart(r: SessionReadiness, v: ReadinessVerdict): boolean {
  return v.complete && !v.blocked && (v.warnings.length === 0 || r.acknowledgedWarnings);
}

export function hoursBetween(a: Timestamp, b: Timestamp): number {
  return (Date.parse(b) - Date.parse(a)) / 3_600_000;
}

/** Status całego testu na podstawie sesji wymaganych przez dany rodzaj testu */
export function assessmentStatus(a: Assessment): Assessment['status'] {
  const parts = a.kind === 'CONTROL' ? [a.climbing] : [a.strength, a.climbing];
  if (parts.every((p) => p?.status === 'completed')) return 'completed';
  if (parts.some((p) => p?.status === 'in_progress' || p?.status === 'completed')) return 'in_progress';
  if (parts.some((p) => p?.status === 'postponed')) return 'postponed';
  return 'scheduled';
}
