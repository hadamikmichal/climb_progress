import { AssessmentKind, AssessmentPart, AttemptStatus, ClimbingStyle, CoreExercise, DeadHangEndReason, TestStatus, WallStyle } from '../../models/assessment';

export const CORE_LABELS: Record<CoreExercise, string> = {
  bent_knee_l_sit: 'Bent Knee L-sit (poziom A)',
  full_l_sit: 'Full L-sit (poziom B)',
  front_lever: 'Front Lever (poziom C)',
};

export const WALL_LABELS: Record<WallStyle, string> = { vertical: 'Pion', overhang: 'Przewieszenie', roof: 'Dach', mixed: 'Mieszany' };
export const STYLE_LABELS: Record<ClimbingStyle, string> = { lead: 'Prowadzenie', top_rope: 'Wędka' };

export const DEAD_HANG_END_LABELS: Record<DeadHangEndReason, string> = {
  released: 'Puszczenie drążka',
  position_lost: 'Utrata prawidłowej pozycji',
  regrip: 'Poprawienie / przesunięcie chwytu',
  time_cap: 'Limit 6 minut',
  pain: 'Ból / dyskomfort',
  other: 'Inny powód',
};

export const TEST_STATUS_LABELS: Record<TestStatus, string> = {
  scheduled: 'Zaplanowany',
  in_progress: 'W trakcie',
  completed: 'Zakończony',
  invalid: 'Nieważny',
  postponed: 'Przełożony',
};

export const ATTEMPT_STATUS_LABELS: Record<AttemptStatus, string> = {
  success: 'Zmierzony',
  failed: 'Nieudany',
  invalid: 'Nieważny',
  not_tested: 'NOT TESTED',
};

export const KIND_LABELS: Record<AssessmentKind, string> = {
  BASELINE: 'Baseline Test v1.0',
  CONTROL: 'Test pośredni 3 × próba',
  FINAL: 'Retest – Baseline Test v1.0',
};

export const PART_LABELS: Record<AssessmentPart, string> = {
  strength: 'Dzień 1 – Strength Assessment',
  climbing: 'Dzień 2 – Climbing Performance',
};

/** Skala pompowania używana w teście dróg i krzywej regeneracji */
export const PUMP_SCALE: { range: string; text: string }[] = [
  { range: '0', text: 'brak pompowania' },
  { range: '1–2', text: 'minimalne napięcie' },
  { range: '3–4', text: 'lekkie pompowanie' },
  { range: '5–6', text: 'wyraźne pompowanie, ale ręce nadal sprawne' },
  { range: '7–8', text: 'mocne pompowanie, wyraźne ograniczenie ruchu' },
  { range: '9', text: 'prawie maksymalne napięcie' },
  { range: '10', text: 'skrajne pompowanie / brak możliwości dalszego skutecznego wspinania' },
];

export function pumpText(n: number | null | undefined): string {
  if (n == null) return '';
  if (n === 0) return PUMP_SCALE[0].text;
  if (n <= 2) return PUMP_SCALE[1].text;
  if (n <= 4) return PUMP_SCALE[2].text;
  if (n <= 6) return PUMP_SCALE[3].text;
  if (n <= 8) return PUMP_SCALE[4].text;
  if (n === 9) return PUMP_SCALE[5].text;
  return PUMP_SCALE[6].text;
}

export const STRENGTH_WARMUP = [
  '3–5 minut lekkiej aktywności',
  'Mobilizacja nadgarstków',
  'Mobilizacja barków',
  'Aktywacja łopatek',
  'Lekkie podciągania',
  'Stopniowe przygotowanie palców',
];

export const CLIMBING_WARMUP = [
  'Lekka mobilizacja',
  'Dwie łatwe drogi',
  'Jedna droga pośrednia',
  'Krótki odpoczynek',
  '5 minut odpoczynku przed pierwszą próbą testową',
];
