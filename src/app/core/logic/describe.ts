import { AssessmentPart } from '../models/assessment';
import { TrainingParams, WorkoutType } from '../models/models';
import { formatLoad } from './progression';
import { GRIP_LABELS, HOLD_LABELS } from './templates';

/** Czytelny opis zaplanowanych parametrów danej jednostki */
export function prescriptionLines(type: WorkoutType, p: TrainingParams, part?: AssessmentPart): string[] {
  if (part === 'strength') {
    return ['Weighted Pull-up 1RM · Max Finger Strength 20 mm / 5 s', 'Core: L-sit / Front Lever · Dead Hang (maks. 6 min)', 'Masa ciała i ocena gotowości przed startem'];
  }
  if (part === 'climbing') {
    const n = type === 'CONTROL' ? 3 : 4;
    return [`${n} × 6a na tej samej drodze, przerwy dokładnie 3:00`, 'Czas każdej drogi, RPE, pompowanie po każdej próbie', 'Recovery Curve: pompowanie po 0, 1, 2 i 3 min'];
  }
  switch (type) {
    case 'A':
      return [`Trudne drogi ${p.hardRoutes.gradeFrom}–${p.hardRoutes.gradeTo}, maks. ${p.hardRoutes.maxAttempts} prób`];
    case 'B': {
      const h = p.hangboard;
      return [
        `Max Hangs: ${h.sets} × ${h.hangSec} s, przerwa ${Math.round(h.restSec / 60)} min`,
        `${GRIP_LABELS[h.grip]} · ${HOLD_LABELS[h.holdType]}: ${h.edge}${h.edgeSizeMm ? ` (${h.edgeSizeMm} mm)` : ''} · ${formatLoad(h)}`,
        `Potem ${p.aerobic.routes} dróg ${p.aerobic.grade} (~13 m), przerwy ${p.aerobic.restMin} min`,
        `Pompowanie maks. ${p.aerobic.targetMaxPump}/10`,
      ];
    }
    case 'C': {
      const pe = p.powerEndurance;
      return [
        `Obwody ${pe.sets} × ${pe.routesPerSet} na ${pe.grade}`,
        `Przerwa między drogami ${pe.restBetweenRoutesMin} min, między seriami ${pe.restBetweenSetsMin} min`,
      ];
    }
    case 'BASELINE':
    case 'FINAL':
      return ['3 drogi 6a, przerwy dokładnie 3 min', 'Po każdej: ukończenie, RPE, pompowanie, technika'];
    case 'CONTROL':
      return ['3 drogi 6a, przerwy 3 min', 'Opcjonalnie: crux i 1 zwis kontrolny', 'Potem lżejszy trening B'];
  }
}

/** Krótka nazwa jednostki do list tygodnia (wersaliki nadaje CSS) */
export const SHORT_NAMES: Record<WorkoutType, string> = {
  A: 'Trudne drogi',
  B: 'Max Hangs + tlenowa',
  C: 'Wytrzymałość siłowa',
  BASELINE: 'Baseline Test',
  CONTROL: 'Test pośredni 3 × 6a',
  FINAL: 'Retest',
};

export function plannedShortName(p: { type: WorkoutType; part?: AssessmentPart }): string {
  if (p.part && p.type !== 'CONTROL') return `${SHORT_NAMES[p.type]} · ${p.part === 'strength' ? 'dzień 1 siła' : 'dzień 2 drogi'}`;
  return SHORT_NAMES[p.type];
}
