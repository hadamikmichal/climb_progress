import { TrainingParams, UserProfile, WorkoutTemplate, WorkoutType, GripPosition, HoldType, SkipReason, WorkoutStatus } from '../models/models';

export const GRIP_LABELS: Record<GripPosition, string> = {
  half_crimp: 'Half crimp',
  open_hand: 'Open hand',
  full_crimp: 'Full crimp',
  three_finger_drag: '3 palce (drag)',
};

export const ASCENT_LABELS: Record<import('../models/models').AscentStyle, string> = {
  onsight: 'OS',
  flash: 'Flash',
  redpoint: 'RP',
};

export const HOLD_LABELS: Record<HoldType, string> = {
  edge: 'Krawądka',
  pocket: 'Dziurka',
  sloper: 'Oblak',
  jug: 'Klama',
};

export const STATUS_LABELS: Record<WorkoutStatus, string> = {
  planned: 'Zaplanowany',
  done: 'Wykonany',
  partial: 'Częściowo wykonany',
  skipped: 'Pominięty',
  moved: 'Przełożony',
};

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  time: 'Brak czasu',
  fatigue: 'Zmęczenie',
  pain: 'Ból lub uraz',
  illness: 'Choroba',
  other: 'Inny powód',
  no_slot: 'Brak bezpiecznego terminu',
};

export const TYPE_SHORT: Record<WorkoutType, string> = {
  A: 'Trening A',
  B: 'Trening B',
  C: 'Trening C',
  BASELINE: 'Test początkowy',
  CONTROL: 'Test kontrolny',
  FINAL: 'Test końcowy',
};

export const TEMPLATES: Record<WorkoutType, WorkoutTemplate> = {
  A: {
    type: 'A',
    code: 'A',
    name: 'Trudne drogi i cruxy',
    goal: 'Siła na trudnych przechwytach – próby dróg i sekwencji przy świeżych palcach.',
    durationMin: 75,
    intensity: 'wysoka',
    heavy: true,
    exercises: [
      {
        id: 'a-warmup',
        kind: 'warmup',
        name: 'Rozgrzewka',
        description: '10–15 min ogólnej rozgrzewki, łatwe wspinanie, stopniowe przygotowanie palców i barków.',
        durationMin: 15,
        checklist: ['Rozgrzewka ogólna 10–15 min', 'Mobilizacja barków i nadgarstków', 'Łatwe wspinanie (2–3 drogi)', 'Stopniowo trudniejsze chwyty'],
      },
      {
        id: 'a-hard',
        kind: 'hard_routes',
        name: 'Trudne drogi i cruxy',
        description: 'Drogi 6b–6c, próby trudnych sekwencji, pełne przerwy między próbami. Kończ, zanim palce będą całkowicie zmęczone.',
        durationMin: 60,
      },
    ],
    safetyNotes: [
      'Nie wspinaj się przez ból palców, ścięgien lub stawów.',
      'Pełne przerwy między próbami – jakość ruchu ważniejsza niż liczba prób.',
    ],
  },
  B: {
    type: 'B',
    code: 'B',
    name: 'Max Hangs + wytrzymałość tlenowa',
    goal: 'Siła palców na chwytotablicy (na świeżo), a potem dłuższe wspinanie bez pompowania dla regeneracji przedramion.',
    durationMin: 100,
    intensity: 'umiarkowana',
    heavy: true,
    exercises: [
      {
        id: 'b-warmup',
        kind: 'warmup',
        name: 'Rozgrzewka',
        description: 'Ogólna rozgrzewka, łatwa droga i progresywne zwisy rozgrzewkowe przed Max Hangs.',
        durationMin: 15,
        checklist: ['Rozgrzewka ogólna', 'Mobilizacja barków i nadgarstków', 'Łatwa droga rozgrzewkowa', 'Progresywne zwisy rozgrzewkowe'],
      },
      {
        id: 'b-hang',
        kind: 'hangboard',
        name: 'Max Hangs – Beastmaker 2000',
        description: 'Zwisy submaksymalne ok. RPE 8/10, na początku sesji, przy świeżych palcach. Bez zwisów do upadku. Przerwa 3 min.',
        durationMin: 25,
      },
      {
        id: 'b-routes',
        kind: 'routes',
        name: 'Drogi tlenowe',
        description: 'Po zwisach, min. 5 min przerwy. Pompowanie maks. 3–4/10. Przerwy 2–3 min.',
        durationMin: 55,
      },
      {
        id: 'b-tech',
        kind: 'technique',
        name: 'Priorytety techniczne',
        description: 'Skup się na nich na każdej drodze.',
        durationMin: 0,
        checklist: [
          'Rozluźnianie chwytu',
          'Proste ręce',
          'Ciężar na nogach',
          'Spokojny oddech',
          'Wykorzystanie odpoczynków',
          'Ekonomiczne poruszanie się',
        ],
      },
    ],
    safetyNotes: [
      'Nie wykonuj ciężkich zwisów przy bólu palców, ścięgien lub stawów.',
      'Zwis kończ z zapasem – nigdy do upadku.',
      'Jeśli pompowanie na drogach przekracza 5/10 – wydłuż przerwę lub obniż trudność.',
    ],
  },
  C: {
    type: 'C',
    code: 'C',
    name: 'Wytrzymałość siłowa',
    goal: 'Więcej trudnych przechwytów przy narastającym zmęczeniu – obwody na linie.',
    durationMin: 90,
    intensity: 'wysoka',
    heavy: true,
    exercises: [
      {
        id: 'c-warmup',
        kind: 'warmup',
        name: 'Rozgrzewka',
        description: 'Ogólna rozgrzewka i 2 łatwe drogi.',
        durationMin: 15,
        checklist: ['Rozgrzewka ogólna', '2 łatwe drogi', 'Przygotowanie palców'],
      },
      {
        id: 'c-circuit',
        kind: 'circuit',
        name: 'Obwody na linie',
        description: 'Serie po 3 drogi, krótkie przerwy między drogami, długie między seriami.',
        durationMin: 70,
      },
    ],
    safetyNotes: ['Odpadnięcie lub skrajne pompowanie = brak progresji, nie powód do walki przez ból.'],
  },
  BASELINE: {
    type: 'BASELINE',
    code: 'T0',
    name: 'Baseline Test v1.0',
    goal: 'Obiektywny punkt odniesienia: siła palców, przyciągania i core, wytrzymałość chwytu, powtarzalność 4 × 6a, czasy przejść i regeneracja przedramion.',
    durationMin: 75,
    intensity: 'wysoka',
    heavy: true,
    exercises: [
      { id: 't-strength', kind: 'test_extra', name: 'Dzień 1 – Strength Assessment', description: 'Weighted Pull-up 1RM, Max Finger Strength 20 mm / 5 s, Core (L-sit / Front Lever), Dead Hang.', durationMin: 75 },
      { id: 't-routes', kind: 'test_routes', name: 'Dzień 2 – Climbing Performance', description: '4 × 6a na tej samej drodze, przerwy dokładnie 3:00, czas każdej drogi, pompowanie, Recovery Curve.', durationMin: 60 },
    ],
    safetyNotes: ['Min. 48 h bez ciężkiego wspinania i treningu palców przed każdą sesją.', 'Przy bólu palców, łokci lub barków – przełóż test.'],
  },
  CONTROL: {
    type: 'CONTROL',
    code: 'TK',
    name: 'Test pośredni 3 × 6a',
    goal: 'Kontrola po 3 tygodniach: 3 × 6a na tej samej drodze, stałe 3 min przerwy, czasy, RPE, pompowanie, Recovery Curve. Bez maksymalnych testów 9c.',
    durationMin: 45,
    intensity: 'wysoka',
    heavy: true,
    exercises: [
      { id: 't-routes', kind: 'test_routes', name: '3 × 6a + Recovery Curve', description: 'Ta sama droga co w Baseline Test, przerwy dokładnie 3:00.', durationMin: 45 },
    ],
    safetyNotes: ['Test nie zastępuje treningu – wykonaj go jako krótki blok przed sesją (deload).'],
  },
  FINAL: {
    type: 'FINAL',
    code: 'TF',
    name: 'Retest – Baseline Test v1.0',
    goal: 'Powtórzenie całego Baseline Test w identycznych warunkach: ta sama krawądka, chwyt, drążek, wariant core, droga, odpoczynek i kolejność testów.',
    durationMin: 75,
    intensity: 'wysoka',
    heavy: true,
    exercises: [
      { id: 't-strength', kind: 'test_extra', name: 'Dzień 1 – Strength Assessment', description: 'Te same testy i sprzęt co w Baseline Test.', durationMin: 75 },
      { id: 't-routes', kind: 'test_routes', name: 'Dzień 2 – Climbing Performance', description: '4 × 6a na tej samej drodze + Recovery Curve.', durationMin: 60 },
    ],
    safetyNotes: ['Min. 48 h bez ciężkiego wspinania i treningu palców przed każdą sesją.'],
  },
};

export function isHeavy(type: WorkoutType): boolean {
  return TEMPLATES[type].heavy;
}

export function isTest(type: WorkoutType): type is 'BASELINE' | 'CONTROL' | 'FINAL' {
  return type === 'BASELINE' || type === 'CONTROL' || type === 'FINAL';
}

export function defaultProfile(ts: string): UserProfile {
  return {
    id: 'me',
    name: '',
    heightCm: 190,
    weightKg: 71,
    grade: '6b+',
    targetGrade: '6c+',
    routeLengthM: 13,
    trainingDays: { A: 1, B: 3, C: 6 },
    hangboard: {
      board: 'Beastmaker 2000',
      holdType: 'edge',
      edge: 'Krawądka (do ustawienia)',
      edgeSizeMm: null,
      grip: 'half_crimp',
    },
    createdAt: ts,
    updatedAt: ts,
  };
}

export function initialParams(profile: UserProfile): TrainingParams {
  return {
    hangboard: {
      holdType: profile.hangboard.holdType,
      edge: profile.hangboard.edge,
      edgeSizeMm: profile.hangboard.edgeSizeMm,
      grip: profile.hangboard.grip,
      hangSec: 10,
      sets: 3,
      restSec: 180,
      addedKg: 0,
      assistKg: 0,
    },
    hardRoutes: { gradeFrom: '6b', gradeTo: '6c', maxAttempts: 6 },
    aerobic: { routes: 4, grade: '5b', restMin: 3, targetMaxPump: 4 },
    powerEndurance: { sets: 2, routesPerSet: 3, grade: '5c+', restBetweenRoutesMin: 2, restBetweenSetsMin: 12 },
  };
}
