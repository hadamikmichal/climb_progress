import { AdaptationEvent, TrainingCycle, TrainingType } from '../../models/models';
import { describeTrack, nextStepText, TRACK_NAMES, TRACKS } from '../progression';
import { ABILITY_PL, STATUS_LABELS } from './abilities';
import { FINGER_PROTOCOL_LABELS, PE_PROTOCOLS, protocolOf } from './protocols';
import { isBalanced } from './prescription';

/**
 * Wyjaśnienie jednostki dla użytkownika – zawsze widoczne przed treningiem:
 * dlaczego ten trening, aktualna trudność, cel sesji, co poprawić, aby przejść dalej,
 * i dlaczego obciążenie nie zostało zwiększone.
 */
export interface SessionExplanation {
  why: string[];
  level: string[];
  goal: string[];
  nextStep: string[];
  notIncreased: string[];
}

/** Ostatnie decyzje progresji dla danego typu treningu (jedna partia = jeden zapis treningu) */
export function lastDecisions(events: AdaptationEvent[], cycleId: string, type: TrainingType): AdaptationEvent[] {
  const ev = events
    .filter((e) => e.cycleId === cycleId && e.workoutType === type && (e.kind === 'progress' || e.kind === 'hold' || e.kind === 'reduce'))
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  if (!ev.length) return [];
  const ts = ev[0].timestamp;
  return ev.filter((e) => e.timestamp === ts);
}

export function explainSession(type: TrainingType, cycle: TrainingCycle, events: AdaptationEvent[]): SessionExplanation {
  const p = cycle.params;
  const ab = cycle.abilities;
  const why: string[] = [];
  const goal: string[] = [];

  if (type === 'C') {
    const def = PE_PROTOCOLS[protocolOf(p.powerEndurance)];
    why.push(`${def.name} – ${def.purpose.join(', ')}.`);
    if (ab) {
      why.push(ab.recommendedProtocol === def.id
        ? `Dobrany po Baseline Test: wytrzymałość siłowa ${STATUS_LABELS[ab.profiles.powerEndurance.status]}, ${isBalanced(ab.profiles) ? 'obszar względnie najsłabszy' : 'główne ograniczenie'}: ${ABILITY_PL[ab.mainLimitation]}.`
        : `Protokół zmieniony względem rekomendacji (${PE_PROTOCOLS[ab.recommendedProtocol].name}) – ręcznie lub przez progresję.`);
    }
    goal.push('Utrzymać jakość przechwytów przy narastającym zmęczeniu – bez walki przez ból i bez rozpadu techniki.');
  } else if (type === 'B') {
    const fp = p.hangboard.protocol ?? 'max_hangs';
    why.push(`${FINGER_PROTOCOL_LABELS[fp]} na świeżo, potem łatwe ciągłe wspinanie dla regeneracji przedramion.`);
    if (ab) {
      why.push(ab.mainLimitation === 'finger'
        ? 'Siła palców to główne ograniczenie – zwisy w dawce rozwojowej.'
        : `Siła palców: ${STATUS_LABELS[ab.profiles.finger.status]} – zwisy w dawce podtrzymującej, bez zwiększania objętości bez potrzeby.`);
      if (ab.mainLimitation === 'aerobic') why.push('Wytrzymałość tlenowa to główne ograniczenie – większa objętość łatwych dróg.');
    }
    goal.push(`Zwisy z zapasem (RPE ok. 8), drogi tlenowe z pompowaniem maks. ${p.aerobic.targetMaxPump}/10.`);
  } else {
    why.push(`Trudne drogi i cruxy wokół Twojego poziomu (${p.hardRoutes.gradeFrom}–${p.hardRoutes.gradeTo}) – siła na trudnych przechwytach przy świeżych palcach.`);
    goal.push('Jakość ruchu w trudnych sekwencjach, pełne przerwy, koniec przed całkowitym zmęczeniem palców.');
  }
  if (ab) goal.push(`Priorytet cyklu: ${ab.priority}`);

  const tracks = TRACKS[type];
  const level = type === 'A'
    ? [`trudne drogi ${p.hardRoutes.gradeFrom}–${p.hardRoutes.gradeTo}, maks. ${p.hardRoutes.maxAttempts} prób`]
    : tracks.map((t) => `${TRACK_NAMES[t]}: ${describeTrack(t, p)}`);
  const nextStep = type === 'A' ? ['Trening A nie ma automatycznej progresji – trudność wyznaczają Twoje projekty i retest.'] : tracks.map((t) => nextStepText(t, p));
  const notIncreased = lastDecisions(events, cycle.id, type).filter((e) => e.kind !== 'progress').map((e) => e.reason);

  return { why, level, goal, nextStep, notIncreased };
}
