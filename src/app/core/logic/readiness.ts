import { ISODate, ReadinessCheck } from '../models/models';

export type ReadinessLevel = 'go' | 'easy' | 'rest';

export interface ReadinessAssessment {
  level: ReadinessLevel;
  /** Czy można wykonywać ciężkie zwisy na chwytotablicy */
  allowHangboard: boolean;
  /** Czy można wykonywać ciężkie jednostki (A, C, testy) w pełnej wersji */
  allowHeavy: boolean;
  title: string;
  messages: string[];
}

/**
 * Przypadek D – ocena gotowości. Nie diagnozuje przyczyn, jedynie ogranicza obciążenie.
 */
export function evaluateReadiness(c: ReadinessCheck): ReadinessAssessment {
  const msgs: string[] = [];
  let level: ReadinessLevel = 'go';
  let allowHangboard = true;
  let allowHeavy = true;

  if (c.fingerPain) {
    level = 'rest';
    allowHangboard = false;
    allowHeavy = false;
    msgs.push('Ból palców: bez chwytotablicy i bez trudnych dróg. Odpoczynek albo bardzo łatwe, bezbolesne ruszanie się.');
  }
  if (c.elbowShoulderPain) {
    level = 'rest';
    allowHangboard = false;
    allowHeavy = false;
    msgs.push('Ból łokci lub barków: bez chwytotablicy i ciężkich jednostek. Zalecany odpoczynek.');
  }
  if (c.unusualFatigue) {
    level = 'rest';
    allowHangboard = false;
    allowHeavy = false;
    msgs.push('Nietypowe zmęczenie: odpuść dzisiejszą sesję. Nie nadrabiaj jej później.');
  }
  if (level !== 'rest' && (c.wellbeing <= 1 || c.fatigue >= 5 || c.sleep <= 1)) {
    level = 'rest';
    allowHangboard = false;
    allowHeavy = false;
    msgs.push('Bardzo niska gotowość (samopoczucie, zmęczenie lub sen): zalecany odpoczynek.');
  }
  if (level === 'go' && (c.wellbeing <= 2 || c.fatigue >= 4 || c.sleep <= 2)) {
    level = 'easy';
    allowHeavy = false;
    msgs.push('Obniżona gotowość: wykonaj lżejszą wersję treningu (mniej serii i dróg). Taka sesja nie liczy się do progresji.');
  }
  if (msgs.length && (c.fingerPain || c.elbowShoulderPain)) {
    msgs.push('Jeśli ból utrzymuje się lub narasta, skonsultuj się z fizjoterapeutą lub lekarzem.');
  }
  if (level === 'go') msgs.push('Gotowość w normie – trening zgodnie z planem.');

  const title = level === 'go' ? 'Gotowy do treningu' : level === 'easy' ? 'Trenuj lżej' : 'Zalecany odpoczynek';
  return { level, allowHangboard, allowHeavy, title, messages: msgs };
}

/** Najnowsza ocena gotowości z danego dnia */
export function readinessFor(checks: ReadinessCheck[], date: ISODate): ReadinessCheck | null {
  const same = checks.filter((c) => c.date === date).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return same[0] ?? null;
}

/** Wskaźnik gotowości 0–100 do wykresów (samopoczucie, sen, odwrócone zmęczenie) */
export function readinessScore(c: ReadinessCheck): number {
  const raw = (c.wellbeing - 1) + (c.sleep - 1) + (5 - c.fatigue);
  let s = Math.round((raw / 12) * 100);
  if (c.fingerPain || c.elbowShoulderPain || c.unusualFatigue) s = Math.min(s, 30);
  return s;
}
