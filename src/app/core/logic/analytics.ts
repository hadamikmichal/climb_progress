import { AscentStyle, CompletedWorkout, ISODate, RouteLog } from '../models/models';
import { addDays, startOfWeek } from './dates';
import { gradeIndex, GRADES } from './grades';
import { effectiveLoadKg, sessionAvgPump, sessionMaxPump, sessionRpe } from './progression';
import { hangKey, hangKeyLabel } from './stats';

/**
 * Analityka widoku Progres – czyste funkcje liczone wyłącznie z zapisanych treningów.
 * Zakres dat i porównanie z poprzednim okresem o tej samej długości.
 */

export type RangeKey = '6w' | '12w' | 'all';
export const RANGE_LABELS: Record<RangeKey, string> = { '6w': '6 tyg.', '12w': '12 tyg.', all: 'Całość' };

export interface DateRange {
  from: ISODate | null;
  to: ISODate;
  /** Poprzedni okres tej samej długości (brak dla „całość”) */
  prevFrom: ISODate | null;
  prevTo: ISODate | null;
}

export function rangeBounds(today: ISODate, key: RangeKey): DateRange {
  if (key === 'all') return { from: null, to: today, prevFrom: null, prevTo: null };
  const days = key === '6w' ? 42 : 84;
  const from = addDays(today, -(days - 1));
  return { from, to: today, prevFrom: addDays(from, -days), prevTo: addDays(from, -1) };
}

export function inRange<T extends { date: ISODate }>(xs: T[], from: ISODate | null, to: ISODate | null): T[] {
  return xs.filter((x) => (from == null || x.date >= from) && (to == null || x.date <= to));
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** Trudne próby = drogi z treningu A (bez serii obwodu) */
export const hardAttempts = (ws: CompletedWorkout[]): (RouteLog & { date: ISODate })[] =>
  ws.filter((w) => w.type === 'A').flatMap((w) => w.routes.filter((r) => r.setIndex === 0).map((r) => ({ ...r, date: w.date })));

export interface PeriodSummary {
  sessions: number;
  routesDone: number;
  routesTotal: number;
  /** Objętość wspinania w metrach (ukończone i nieukończone drogi) */
  meters: number;
  /** % ukończonych dróg */
  sendRate: number | null;
  hardestIndex: number | null;
  hardAttempts: number;
  hardSends: number;
  hardSendRate: number | null;
  avgRpe: number | null;
  /** średnie pompowanie w treningach tlenowych (B) */
  avgPumpB: number | null;
  /** maks. pompowanie w obwodach (C) – średnia z sesji */
  avgMaxPumpC: number | null;
  hangSets: number;
  /** najlepsze obciążenie efektywne na najczęściej używanym chwycie */
  bestHang: { key: string; label: string; load: number } | null;
  painSessions: number;
}

export function periodSummary(ws: CompletedWorkout[]): PeriodSummary {
  const routes = ws.flatMap((w) => w.routes);
  const done = routes.filter((r) => r.completed);
  let hi = -1;
  for (const r of done) hi = Math.max(hi, gradeIndex(r.grade));
  const hard = hardAttempts(ws);
  const hardSends = hard.filter((r) => r.completed).length;
  const rpes = ws.map(sessionRpe).filter((x): x is number => x != null);
  const pumpsB = ws.filter((w) => w.type === 'B').map(sessionAvgPump).filter((x): x is number => x != null);
  const pumpsC = ws.filter((w) => w.type === 'C').map(sessionMaxPump).filter((x): x is number => x != null);
  const hangs = ws.flatMap((w) => w.hangs);
  const counts = new Map<string, number>();
  for (const h of hangs) counts.set(hangKey(h), (counts.get(hangKey(h)) ?? 0) + 1);
  const topKey = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const top = hangs.filter((h) => hangKey(h) === topKey && h.setsDone > 0);
  return {
    sessions: ws.length,
    routesDone: done.length,
    routesTotal: routes.length,
    meters: routes.reduce((n, r) => n + (r.lengthM || 0), 0),
    sendRate: routes.length ? Math.round((done.length / routes.length) * 100) : null,
    hardestIndex: hi >= 0 ? hi : null,
    hardAttempts: hard.length,
    hardSends,
    hardSendRate: hard.length ? Math.round((hardSends / hard.length) * 100) : null,
    avgRpe: avg(rpes),
    avgPumpB: avg(pumpsB),
    avgMaxPumpC: avg(pumpsC),
    hangSets: hangs.reduce((n, h) => n + h.setsDone, 0),
    bestHang: top.length ? { key: topKey!, label: hangKeyLabel(top[0]), load: Math.max(...top.map(effectiveLoadKg)) } : null,
    painSessions: ws.filter((w) => w.hangs.some((h) => h.pain)).length,
  };
}

export interface Delta {
  value: number | null;
  prev: number | null;
  change: number | null;
  /** improved / declined / same – kierunek z perspektywy wspinacza */
  trend: 'improved' | 'declined' | 'same' | 'na';
}

/** Porównanie z poprzednim okresem; lowerIsBetter dla RPE i pompowania */
export function delta(value: number | null, prev: number | null, lowerIsBetter = false): Delta {
  if (value == null || prev == null) return { value, prev, change: null, trend: 'na' };
  const change = round1(value - prev);
  return { value, prev, change, trend: change === 0 ? 'same' : (change < 0) === lowerIsBetter ? 'improved' : 'declined' };
}

export interface WeeklyHard {
  weekStart: ISODate;
  attempts: number;
  sends: number;
  rate: number;
}

/** Skuteczność prób trudnych dróg w tygodniach */
export function hardAttemptsByWeek(ws: CompletedWorkout[]): WeeklyHard[] {
  const m = new Map<ISODate, { attempts: number; sends: number }>();
  for (const r of hardAttempts(ws)) {
    const k = startOfWeek(r.date);
    const e = m.get(k) ?? { attempts: 0, sends: 0 };
    e.attempts++;
    if (r.completed) e.sends++;
    m.set(k, e);
  }
  return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([weekStart, e]) => ({ weekStart, ...e, rate: Math.round((e.sends / e.attempts) * 100) }));
}

export interface AscentBreakdown {
  onsight: number;
  flash: number;
  redpoint: number;
  /** ukończone trudne drogi bez podanego stylu */
  unknown: number;
  total: number;
}

export function ascentBreakdown(ws: CompletedWorkout[]): AscentBreakdown {
  const out: AscentBreakdown = { onsight: 0, flash: 0, redpoint: 0, unknown: 0, total: 0 };
  for (const r of hardAttempts(ws)) {
    if (!r.completed) continue;
    out.total++;
    const s = r.ascent as AscentStyle | null | undefined;
    if (s === 'onsight' || s === 'flash' || s === 'redpoint') out[s]++;
    else out.unknown++;
  }
  return out;
}

export interface GradeProject {
  grade: string;
  attempts: number;
  sends: number;
  firstAttempt: ISODate;
  firstSend: ISODate | null;
  /** liczba prób do pierwszego przejścia (włącznie) */
  attemptsToFirstSend: number | null;
  lastAttempt: ISODate;
}

/**
 * „Projekty” – trudne próby z treningu A pogrupowane po wycenie (nie zapisujemy nazw dróg,
 * więc wycena jest najlepszym dostępnym przybliżeniem projektu). Od najtrudniejszej.
 */
export function gradeProjects(ws: CompletedWorkout[]): GradeProject[] {
  const list = hardAttempts(ws).sort((a, b) => (a.date === b.date ? (a.timestamp < b.timestamp ? -1 : 1) : a.date < b.date ? -1 : 1));
  const m = new Map<string, GradeProject>();
  for (const r of list) {
    let p = m.get(r.grade);
    if (!p) {
      p = { grade: r.grade, attempts: 0, sends: 0, firstAttempt: r.date, firstSend: null, attemptsToFirstSend: null, lastAttempt: r.date };
      m.set(r.grade, p);
    }
    p.attempts++;
    p.lastAttempt = r.date;
    if (r.completed) {
      p.sends++;
      if (!p.firstSend) {
        p.firstSend = r.date;
        p.attemptsToFirstSend = p.attempts;
      }
    }
  }
  return [...m.values()].sort((a, b) => gradeIndex(b.grade) - gradeIndex(a.grade));
}

/** Sesje z RPE w czasie (B i C – obciążenie wytrzymałościowe) */
export function rpeSeries(ws: CompletedWorkout[]): { date: ISODate; type: string; rpe: number }[] {
  return ws
    .filter((w) => w.type !== 'A')
    .map((w) => ({ date: w.date, type: w.type as string, rpe: sessionRpe(w) }))
    .filter((x): x is { date: ISODate; type: string; rpe: number } => x.rpe != null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Powtarzalność w treningu B: odsetek ukończonych zaplanowanych dróg w sesji */
export function aerobicRepeatability(ws: CompletedWorkout[]): { date: ISODate; done: number; planned: number; avgPump: number | null }[] {
  return ws
    .filter((w) => w.type === 'B')
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((w) => ({ date: w.date, done: w.routes.filter((r) => r.completed).length, planned: w.prescription.aerobic.routes, avgPump: sessionAvgPump(w) }));
}

export const gradeLabel = (i: number | null) => (i == null ? null : GRADES[i] ?? null);
