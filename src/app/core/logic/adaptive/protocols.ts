import { FingerProtocol, PeProtocol, PowerEnduranceParams } from '../../models/models';

/**
 * Katalog protokołów treningowych Adaptive Engine v2.
 *
 * Protokoły NIE są równoważne ani nie tworzą drabiny (4 × 4 nie jest obowiązkowym etapem po 3 × 3).
 * Każdy ma własne przeznaczenie, kształt wykonania i listę parametrów, które wolno zmieniać przy progresji
 * (zawsze tylko jeden naraz, w podanej kolejności).
 */

/** Parametr, który progresja może zmienić w danym protokole */
export type PeLever = 'grade' | 'routesPerSet' | 'sets' | 'restBetweenSets' | 'workSec' | 'rounds';

export interface PeProtocolDef {
  id: PeProtocol;
  name: string;
  /** Do czego służy – pokazywane użytkownikowi */
  purpose: string[];
  /** Nazwa jednostki w serii (drogi / problemy / interwał) */
  unit: { one: string; many: string };
  setLabel: string;
  /** Dźwignie progresji w kolejności (pierwsza dostępna jest używana) */
  progressLevers: PeLever[];
  /** Dźwignie redukcji objętości (kolejność) – trudność obsługiwana osobno */
  volumeLevers: PeLever[];
  /** Domyślny kształt */
  defaults: Omit<PowerEnduranceParams, 'grade'>;
  /** Limity bezpieczeństwa kształtu */
  limits: { setsMin: number; setsMax: number; unitsMin: number; unitsMax: number; restSetsMinMin: number; workSecMax?: number };
  /** Wyceny w skali Font zamiast francuskiej */
  font?: boolean;
}

export const PE_PROTOCOLS: Record<PeProtocol, PeProtocolDef> = {
  rope_2x3: {
    id: 'rope_2x3',
    name: 'Rope 2 × 3',
    purpose: ['budowanie podstawowej powtarzalności', 'powrót po przerwie', 'niska tolerancja objętości'],
    unit: { one: 'droga', many: 'drogi' },
    setLabel: 'seria',
    progressLevers: ['sets', 'grade'],
    volumeLevers: [],
    defaults: { sets: 2, routesPerSet: 3, restBetweenRoutesMin: 2, restBetweenSetsMin: 12, protocol: 'rope_2x3' },
    limits: { setsMin: 2, setsMax: 3, unitsMin: 3, unitsMax: 3, restSetsMinMin: 8 },
  },
  rope_3x3: {
    id: 'rope_3x3',
    name: 'Rope 3 × 3',
    purpose: ['rozwój wytrzymałości siłowej', 'utrzymanie jakości przechwytów przy narastającym zmęczeniu'],
    unit: { one: 'droga', many: 'drogi' },
    setLabel: 'seria',
    progressLevers: ['grade', 'restBetweenSets'],
    volumeLevers: ['sets'],
    defaults: { sets: 3, routesPerSet: 3, restBetweenRoutesMin: 2, restBetweenSetsMin: 12, protocol: 'rope_3x3' },
    limits: { setsMin: 2, setsMax: 3, unitsMin: 3, unitsMax: 3, restSetsMinMin: 8 },
  },
  rope_4x4: {
    id: 'rope_4x4',
    name: 'Rope 4 × 4',
    purpose: ['zaawansowany trening dużej objętości', 'dla osób, które dobrze tolerują wcześniejsze protokoły'],
    unit: { one: 'droga', many: 'drogi' },
    setLabel: 'seria',
    progressLevers: ['grade', 'restBetweenSets'],
    volumeLevers: ['routesPerSet', 'sets'],
    defaults: { sets: 4, routesPerSet: 4, restBetweenRoutesMin: 1, restBetweenSetsMin: 15, protocol: 'rope_4x4' },
    limits: { setsMin: 3, setsMax: 4, unitsMin: 3, unitsMax: 4, restSetsMinMin: 10 },
  },
  boulder_4x4: {
    id: 'boulder_4x4',
    name: 'Boulder 4 × 4',
    purpose: ['wytrzymałość siłowa na krótkich, mocnych sekwencjach', 'dla stylu przewieszonego i boulderowego'],
    unit: { one: 'problem', many: 'problemy' },
    setLabel: 'runda',
    progressLevers: ['grade', 'restBetweenSets'],
    volumeLevers: ['sets'],
    defaults: { sets: 4, routesPerSet: 4, restBetweenRoutesMin: 0, restBetweenSetsMin: 4, movesPerProblem: 8, protocol: 'boulder_4x4' },
    limits: { setsMin: 3, setsMax: 4, unitsMin: 4, unitsMax: 4, restSetsMinMin: 2 },
    font: true,
  },
  route_intervals: {
    id: 'route_intervals',
    name: 'Route Intervals',
    purpose: ['naprzemienne okresy wspinania i odpoczynku', 'rozwój progu wytrzymałościowego bez pełnego zmęczenia'],
    unit: { one: 'interwał', many: 'interwały' },
    setLabel: 'runda',
    progressLevers: ['rounds', 'workSec', 'grade'],
    volumeLevers: ['rounds'],
    defaults: { sets: 6, routesPerSet: 1, restBetweenRoutesMin: 0, restBetweenSetsMin: 2, workSec: 120, protocol: 'route_intervals' },
    limits: { setsMin: 4, setsMax: 10, unitsMin: 1, unitsMax: 1, restSetsMinMin: 1, workSecMax: 240 },
  },
  linked_routes: {
    id: 'linked_routes',
    name: 'Linked Routes',
    purpose: ['łączenie dróg bez długiego odpoczynku', 'trening pod długie drogi i konkretny projekt'],
    unit: { one: 'droga', many: 'drogi łączone' },
    setLabel: 'seria',
    progressLevers: ['grade', 'routesPerSet'],
    volumeLevers: ['sets'],
    defaults: { sets: 3, routesPerSet: 2, restBetweenRoutesMin: 0, restBetweenSetsMin: 10, protocol: 'linked_routes' },
    limits: { setsMin: 2, setsMax: 3, unitsMin: 2, unitsMax: 3, restSetsMinMin: 8 },
  },
};

export const FINGER_PROTOCOL_LABELS: Record<FingerProtocol, string> = {
  max_hangs: 'Max Hangs',
  repeaters: 'Repeaters',
};

/** Protokół zapisany w parametrach lub – dla danych sprzed v2 – wyprowadzony z kształtu */
export function protocolOf(pe: PowerEnduranceParams): PeProtocol {
  if (pe.protocol) return pe.protocol;
  if (pe.sets >= 4 && pe.routesPerSet >= 4) return 'rope_4x4';
  return pe.sets <= 2 ? 'rope_2x3' : 'rope_3x3';
}

/** Rope 2 × 3 przechodzi w 3 × 3 po dodaniu serii – protokół podąża za kształtem */
export function normalizeProtocol(pe: PowerEnduranceParams): PowerEnduranceParams {
  const p = protocolOf(pe);
  if (p === 'rope_2x3' && pe.sets >= 3) return { ...pe, protocol: 'rope_3x3' };
  if (p === 'rope_3x3' && pe.sets <= 2) return { ...pe, protocol: 'rope_2x3' };
  return { ...pe, protocol: p };
}

const rest = (min: number) => (min >= 1 ? `${Math.round(min * 10) / 10} min` : `${Math.round(min * 60)} s`);

/** Krótki opis jednostki: „3 × 3 na 6b, przerwy 2 / 12 min” */
export function describePe(pe: PowerEnduranceParams): string {
  const p = protocolOf(pe);
  const def = PE_PROTOCOLS[p];
  switch (p) {
    case 'route_intervals':
      return `${def.name}: ${pe.sets} × ${pe.workSec ?? 120} s wspinania na ${pe.grade}, odpoczynek ${rest(pe.restBetweenSetsMin)}`;
    case 'boulder_4x4':
      return `${def.name}: ${pe.sets} rundy × ${pe.routesPerSet} problemy ${pe.grade} (Font)${pe.movesPerProblem ? `, ok. ${pe.movesPerProblem} przechwytów` : ''}, przerwa ${rest(pe.restBetweenSetsMin)}`;
    case 'linked_routes':
      return `${def.name}: ${pe.sets} × ${pe.routesPerSet} drogi ${pe.grade} bez odpoczynku, przerwa między seriami ${rest(pe.restBetweenSetsMin)}`;
    default:
      return `${pe.sets} × ${pe.routesPerSet} na ${pe.grade}, przerwy ${rest(pe.restBetweenRoutesMin)} / ${rest(pe.restBetweenSetsMin)}`;
  }
}

/** Pełna konfiguracja protokołu z domyślnymi wartościami – do ręcznej zmiany w Profilu */
export function configureProtocol(id: PeProtocol, grade: string, base?: Partial<PowerEnduranceParams>): PowerEnduranceParams {
  const def = PE_PROTOCOLS[id];
  return { ...def.defaults, ...base, grade, protocol: id };
}
