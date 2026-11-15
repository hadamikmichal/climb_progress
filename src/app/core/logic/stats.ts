import { CompletedWorkout, HangboardLog, ISODate, PlannedWorkout, ReadinessCheck } from '../models/models';
import { monthKey, startOfWeek } from './dates';
import { gradeIndex, GRADES } from './grades';
import { effectiveLoadKg, sessionMaxPump, sessionRpe } from './progression';
import { readinessScore } from './readiness';
import { GRIP_LABELS } from './templates';

const sortByDate = <T extends { date: ISODate }>(xs: T[]) => [...xs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    (m.get(k) ?? m.set(k, []).get(k)!).push(x);
  }
  return new Map([...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}

export interface WeekRoutes {
  weekStart: ISODate;
  completed: number;
  failed: number;
  hardest: string | null;
  hardestIndex: number | null;
}

/** Drogi (bez rozgrzewki) w ujęciu tygodniowym */
export function routesByWeek(ws: CompletedWorkout[]): WeekRoutes[] {
  const g = groupBy(ws, (w) => startOfWeek(w.date));
  return [...g.entries()].map(([weekStart, list]) => {
    const routes = list.flatMap((w) => w.routes);
    const done = routes.filter((r) => r.completed);
    let hi = -1;
    for (const r of done) hi = Math.max(hi, gradeIndex(r.grade));
    return {
      weekStart,
      completed: done.length,
      failed: routes.length - done.length,
      hardest: hi >= 0 ? GRADES[hi] : null,
      hardestIndex: hi >= 0 ? hi : null,
    };
  });
}

export interface SessionPoint {
  date: ISODate;
  type: string;
  rpe: number | null;
  pump: number | null;
}

export function sessionSeries(ws: CompletedWorkout[]): SessionPoint[] {
  return sortByDate(ws).map((w) => ({ date: w.date, type: w.type, rpe: sessionRpe(w), pump: sessionMaxPump(w) }));
}

export function hangKey(h: Pick<HangboardLog, 'holdType' | 'edge' | 'grip' | 'edgeSizeMm'>): string {
  return `${h.holdType}|${h.edge}|${h.edgeSizeMm ?? ''}|${h.grip}`;
}
export function hangKeyLabel(h: Pick<HangboardLog, 'edge' | 'grip' | 'edgeSizeMm'>): string {
  return `${h.edge}${h.edgeSizeMm ? ` (${h.edgeSizeMm} mm)` : ''} · ${GRIP_LABELS[h.grip]}`;
}

export interface HangSeries {
  key: string;
  label: string;
  points: { date: ISODate; load: number; hangSec: number; setsDone: number; rpe: number | null; pain: boolean }[];
  best: number;
  first: number;
  last: number;
}

/**
 * Historia zwisów pogrupowana po chwycie (krawądka + uchwyt).
 * Wyniki na różnych krawądkach NIE są ze sobą porównywane.
 */
export function hangSeries(hangs: HangboardLog[]): HangSeries[] {
  const g = groupBy(sortByDate(hangs), hangKey);
  return [...g.entries()].map(([key, list]) => {
    const points = list.map((h) => ({ date: h.date, load: effectiveLoadKg(h), hangSec: h.hangSec, setsDone: h.setsDone, rpe: h.rpe, pain: h.pain }));
    return {
      key,
      label: hangKeyLabel(list[0]),
      points,
      best: Math.max(...points.map((p) => p.load)),
      first: points[0].load,
      last: points[points.length - 1].load,
    };
  });
}

export function hangVolumeByWeek(hangs: HangboardLog[]): { weekStart: ISODate; sets: number; hangTimeSec: number }[] {
  const g = groupBy(hangs, (h) => startOfWeek(h.date));
  return [...g.entries()].map(([weekStart, list]) => ({
    weekStart,
    sets: list.reduce((n, h) => n + h.setsDone, 0),
    hangTimeSec: list.reduce((n, h) => n + h.setsDone * h.hangSec, 0),
  }));
}

/** Liczba w pełni ukończonych obwodów (serii bez odpadnięcia) w treningach C */
export function circuitsCompleted(ws: CompletedWorkout[]): { date: ISODate; completedSets: number; plannedSets: number }[] {
  return sortByDate(ws.filter((w) => w.type === 'C')).map((w) => {
    const pe = w.prescription.powerEndurance;
    let full = 0;
    for (let s = 1; s <= pe.sets; s++) {
      const rs = w.routes.filter((r) => r.setIndex === s);
      if (rs.length >= pe.routesPerSet && rs.every((r) => r.completed)) full++;
    }
    return { date: w.date, completedSets: full, plannedSets: pe.sets };
  });
}

export interface RegularityWeek {
  weekStart: ISODate;
  planned: number;
  done: number;
  partial: number;
  skipped: number;
  rate: number;
}

/** Regularność – liczona tylko dla jednostek, których termin już minął lub które zostały rozliczone */
export function regularityByWeek(planned: PlannedWorkout[], todayDate: ISODate): RegularityWeek[] {
  const settled = planned.filter((p) => p.status === 'done' || p.status === 'partial' || p.status === 'skipped' || p.date < todayDate);
  const g = groupBy(settled, (p) => startOfWeek(p.originalDate));
  return [...g.entries()].map(([weekStart, list]) => {
    const done = list.filter((p) => p.status === 'done').length;
    const partial = list.filter((p) => p.status === 'partial').length;
    const skipped = list.filter((p) => p.status === 'skipped').length;
    // Częściowe liczone jako połowa – nie nagradzamy samej obecności
    const rate = list.length ? Math.round(((done + partial * 0.5) / list.length) * 100) : 0;
    return { weekStart, planned: list.length, done, partial, skipped, rate };
  });
}

export function workoutsByMonth(ws: CompletedWorkout[]): { month: string; count: number }[] {
  const g = groupBy(ws, (w) => monthKey(w.date));
  return [...g.entries()].map(([month, list]) => ({ month, count: list.length }));
}

export function regularitySummary(planned: PlannedWorkout[], ws: CompletedWorkout[], todayDate: ISODate) {
  const weeks = regularityByWeek(planned, todayDate);
  const settled = weeks.reduce((n, w) => n + w.planned, 0);
  const done = weeks.reduce((n, w) => n + w.done, 0);
  const partial = weeks.reduce((n, w) => n + w.partial, 0);
  const skipped = weeks.reduce((n, w) => n + w.skipped, 0);
  const activeWeeks = new Set(ws.map((w) => startOfWeek(w.date))).size;
  const spanWeeks = Math.max(1, weeks.length, activeWeeks);
  return {
    rate: settled ? Math.round(((done + partial * 0.5) / settled) * 100) : null,
    done,
    partial,
    skipped,
    avgPerWeek: Math.round((ws.length / spanWeeks) * 10) / 10,
  };
}

export function readinessSeries(checks: ReadinessCheck[]) {
  return sortByDate(checks).map((c) => ({ date: c.date, score: readinessScore(c), fatigue: c.fatigue, sleep: c.sleep, wellbeing: c.wellbeing }));
}
