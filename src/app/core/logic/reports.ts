import { AdaptationEvent, CompletedWorkout, ISODate, PlannedWorkout, TestResult, TrainingCycle, WeeklyReport } from '../models/models';
import { addDays } from './dates';
import { uid } from './ids';
import { isDeloadWeek } from './plan';
import { describeLevel, effectiveLoadKg, formatLoad, sessionAvgPump } from './progression';
import { TYPE_SHORT } from './templates';

/* -------------------- testy -------------------- */

export interface TestSummary {
  completed: number;
  total: number;
  maxPump: number | null;
  avgPump: number | null;
  avgRpe: number | null;
  pumpPerRoute: (number | null)[];
  rpePerRoute: (number | null)[];
  techniqueDegradedFrom: number | null;
  reserve: number | null;
  cruxRate: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? round1(v.reduce((a, b) => a + b, 0) / v.length) : null;
};
const max = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? Math.max(...v) : null;
};

export const RESERVE_LABELS: Record<number, string> = {
  1: 'brak rezerwy – na limicie',
  2: 'mała rezerwa',
  3: 'umiarkowana rezerwa',
  4: 'wyraźna rezerwa',
  5: 'duża rezerwa',
};

export function summarizeTest(t: TestResult): TestSummary {
  const routes = [...t.routes].sort((a, b) => a.order - b.order);
  const degraded = routes.find((r) => r.techniqueDegraded);
  const crux = 'crux' in t ? t.crux : null;
  return {
    completed: routes.filter((r) => r.completed).length,
    total: routes.length,
    maxPump: max(routes.map((r) => r.pump)),
    avgPump: avg(routes.map((r) => r.pump)),
    avgRpe: avg(routes.map((r) => r.rpe)),
    pumpPerRoute: routes.map((r) => r.pump),
    rpePerRoute: routes.map((r) => r.rpe),
    techniqueDegradedFrom: degraded ? degraded.order : null,
    reserve: t.reserve,
    cruxRate: crux && crux.attempts > 0 ? round1((crux.sent / crux.attempts) * 100) : null,
  };
}

export interface ComparisonRow {
  label: string;
  before: string;
  after: string;
  /** better / worse / same / n/a – kierunek oceniany z perspektywy wspinacza */
  trend: 'better' | 'worse' | 'same' | 'na';
}

function cmp(label: string, a: number | null, b: number | null, lowerIsBetter: boolean, fmt = (n: number) => `${n}`): ComparisonRow {
  if (a == null || b == null) return { label, before: a == null ? '–' : fmt(a), after: b == null ? '–' : fmt(b), trend: 'na' };
  const trend = a === b ? 'same' : (b < a) === lowerIsBetter ? 'better' : 'worse';
  return { label, before: fmt(a), after: fmt(b), trend };
}

/** Bezpośrednie porównanie dwóch testów (np. początkowy vs kontrolny/końcowy) */
export function compareTests(before: TestResult, after: TestResult): { rows: ComparisonRow[]; lines: string[] } {
  const a = summarizeTest(before);
  const b = summarizeTest(after);
  const rows: ComparisonRow[] = [
    cmp('Ukończone drogi (z 3)', a.completed, b.completed, false),
    cmp('Maks. pompowanie', a.maxPump, b.maxPump, true, (n) => `${n}/10`),
    cmp('Średnie RPE', a.avgRpe, b.avgRpe, true),
    ...[0, 1, 2].map((i) => cmp(`Pompowanie po drodze ${i + 1}`, a.pumpPerRoute[i] ?? null, b.pumpPerRoute[i] ?? null, true, (n) => `${n}/10`)),
    cmp('Rezerwa siłowa', a.reserve, b.reserve, false, (n) => `${n}/5`),
  ];
  if (a.cruxRate != null || b.cruxRate != null) rows.push(cmp('Skuteczność cruxa', a.cruxRate, b.cruxRate, false, (n) => `${n}%`));

  const ha = 'hangboard' in before ? before.hangboard : null;
  const hb = 'hangboard' in after ? after.hangboard : null;
  if (ha && hb) {
    if (ha.edge === hb.edge && ha.grip === hb.grip && ha.hangSec === hb.hangSec) {
      rows.push(cmp('Zwis kontrolny – obciążenie', effectiveLoadKg(ha), effectiveLoadKg(hb), false, (n) => formatLoad({ addedKg: Math.max(0, n), assistKg: Math.max(0, -n) })));
      rows.push(cmp('Zwis kontrolny – RPE', ha.rpe, hb.rpe, true));
    } else {
      rows.push({ label: 'Zwis kontrolny', before: ha.edge, after: hb.edge, trend: 'na' });
    }
  }

  const lines: string[] = [];
  if (b.completed > a.completed) lines.push(`Ukończonych dróg więcej: ${a.completed} → ${b.completed} z 3.`);
  else if (b.completed < a.completed) lines.push(`Ukończonych dróg mniej: ${a.completed} → ${b.completed} z 3.`);
  else lines.push(`Ukończone drogi bez zmian: ${b.completed} z 3.`);
  const lastA = a.pumpPerRoute[2] ?? null;
  const lastB = b.pumpPerRoute[2] ?? null;
  if (lastA != null && lastB != null) {
    lines.push(
      lastB < lastA
        ? `Po trzeciej drodze przedramiona są mniej zmęczone: pompowanie ${lastA}/10 → ${lastB}/10.`
        : lastB > lastA
          ? `Po trzeciej drodze pompowanie wyższe niż poprzednio: ${lastA}/10 → ${lastB}/10.`
          : `Pompowanie po trzeciej drodze bez zmian (${lastB}/10).`,
    );
  }
  if (a.avgRpe != null && b.avgRpe != null) {
    lines.push(b.avgRpe < a.avgRpe ? `Średnie RPE spadło: ${a.avgRpe} → ${b.avgRpe}.` : b.avgRpe > a.avgRpe ? `Średnie RPE wzrosło: ${a.avgRpe} → ${b.avgRpe}.` : `Średnie RPE bez zmian (${b.avgRpe}).`);
  }
  if (b.cruxRate != null && a.cruxRate != null) lines.push(`Skuteczność na cruxie: ${a.cruxRate}% → ${b.cruxRate}%.`);
  if (ha && hb && ha.edge === hb.edge && ha.grip === hb.grip) {
    const d = effectiveLoadKg(hb) - effectiveLoadKg(ha);
    lines.push(d > 0 ? `Siła na chwytotablicy wzrosła: ${formatLoad(ha)} → ${formatLoad(hb)} na tej samej krawądce.` : d < 0 ? `Obciążenie zwisu kontrolnego niższe: ${formatLoad(ha)} → ${formatLoad(hb)}.` : `Obciążenie zwisu kontrolnego bez zmian (${formatLoad(hb)}); porównaj RPE.`);
  }
  return { rows, lines };
}

/* -------------------- raport tygodniowy -------------------- */

export interface WeekInput {
  cycle: TrainingCycle;
  week: number;
  weekStart: ISODate;
  planned: PlannedWorkout[];
  completed: CompletedWorkout[];
  events: AdaptationEvent[];
  ts: string;
}

function inWeek(date: ISODate, start: ISODate) {
  return date >= start && date <= addDays(start, 6);
}

function aerobicStats(ws: CompletedWorkout[]) {
  const b = ws.filter((w) => w.type === 'B');
  const routes = b.reduce((n, w) => n + w.routes.filter((r) => r.completed).length, 0);
  const pumps = b.map(sessionAvgPump).filter((p): p is number => p != null);
  return { sessions: b.length, routes, avgPump: pumps.length ? round1(pumps.reduce((a, c) => a + c, 0) / pumps.length) : null };
}

function hangboardKeyLoad(ws: CompletedWorkout[]) {
  const map = new Map<string, number>();
  for (const w of ws) for (const h of w.hangs) {
    const key = `${h.edge}|${h.grip}|${h.hangSec}`;
    map.set(key, Math.max(map.get(key) ?? -Infinity, effectiveLoadKg(h)));
  }
  return map;
}

/**
 * Generuje raport tygodnia wyłącznie na podstawie zapisanych danych.
 */
export function generateWeeklyReport(input: WeekInput): WeeklyReport {
  const { cycle, week, weekStart, ts } = input;
  const prevStart = addDays(weekStart, -7);
  const planned = input.planned.filter((p) => p.cycleId === cycle.id && inWeek(p.date, weekStart));
  const skippedThisWeek = input.planned.filter((p) => p.cycleId === cycle.id && p.status === 'skipped' && inWeek(p.originalDate, weekStart) && !inWeek(p.date, weekStart));
  const allPlanned = [...planned, ...skippedThisWeek];
  const done = allPlanned.filter((p) => p.status === 'done').length;
  const partial = allPlanned.filter((p) => p.status === 'partial').length;
  const skipped = allPlanned.filter((p) => p.status === 'skipped').length;
  const total = allPlanned.length;

  const thisWeek = input.completed.filter((w) => w.cycleId === cycle.id && inWeek(w.date, weekStart));
  const prevWeek = input.completed.filter((w) => w.cycleId === cycle.id && inWeek(w.date, prevStart));
  const aer = aerobicStats(thisWeek);
  const aerPrev = aerobicStats(prevWeek);

  const lines: string[] = [];
  const doneText = partial ? `${done} z ${total} zaplanowanych jednostek wykonanych w całości, ${partial} częściowo` : `${done} z ${total} zaplanowanych jednostek wykonanych`;
  lines.push(`W tym tygodniu: ${doneText}${skipped ? `, ${skipped} pominięte` : ''}.`);

  if (aer.sessions) {
    let l = `Trening wytrzymałościowy: ukończono ${aer.routes} ${aer.routes === 1 ? 'drogę' : aer.routes < 5 ? 'drogi' : 'dróg'}`;
    if (aer.avgPump != null) l += `, średnie pompowanie ${aer.avgPump}/10`;
    l += '.';
    if (aer.avgPump != null && aerPrev.avgPump != null) {
      l += ` W poprzednim tygodniu było to ${aerPrev.avgPump}/10${aer.avgPump < aerPrev.avgPump ? ' – poprawa' : aer.avgPump > aerPrev.avgPump ? ' – pompowanie wzrosło' : ''}.`;
    }
    lines.push(l);
  }

  const c = thisWeek.filter((w) => w.type === 'C');
  for (const w of c) {
    const totalRoutes = w.prescription.powerEndurance.sets * w.prescription.powerEndurance.routesPerSet;
    const doneR = w.routes.filter((r) => r.completed).length;
    lines.push(`Obwody (${describeLevel('C', w.prescription)}): ukończono ${doneR}/${totalRoutes} dróg${w.rpe != null ? `, RPE ${w.rpe}` : ''}.`);
  }

  let hangboardChange: string | null = null;
  const hNow = hangboardKeyLoad(thisWeek);
  const hPrev = hangboardKeyLoad(input.completed.filter((w) => w.cycleId === cycle.id && w.date < weekStart));
  if (hNow.size) {
    const parts: string[] = [];
    for (const [key, load] of hNow) {
      const [edge] = key.split('|');
      const before = hPrev.get(key);
      const f = (n: number) => formatLoad({ addedKg: Math.max(0, n), assistKg: Math.max(0, -n) });
      if (before == null) parts.push(`${edge}: pierwszy zapis (${f(load)})`);
      else if (load > before) parts.push(`${edge}: wzrost ${f(before)} → ${f(load)}`);
      else if (load < before) parts.push(`${edge}: obciążenie niższe niż wcześniej (${f(before)} → ${f(load)})`);
      else parts.push(`${edge}: bez zmian (${f(load)})`);
    }
    hangboardChange = parts.join('; ');
    lines.push(`Siła palców – ${hangboardChange}.`);
  }

  const hard = thisWeek.flatMap((w) => (w.type === 'A' ? w.routes : []));
  if (hard.length) {
    const sent = hard.filter((r) => r.completed).length;
    lines.push(`Trudne drogi: ${sent}/${hard.length} prób zakończonych sukcesem.`);
  }

  const painReported = thisWeek.some((w) => w.hangs.some((h) => h.pain));
  if (painReported) lines.push('Zgłoszono ból lub dyskomfort podczas zwisów – obserwuj go w ocenie gotowości.');

  // Propozycja na kolejny tydzień – na podstawie decyzji modułu adaptacji
  const nextWeek: string[] = [];
  const weekEnd = addDays(weekStart, 6);
  const evs = input.events.filter((e) => e.cycleId === cycle.id && e.timestamp.slice(0, 10) >= weekStart && e.timestamp.slice(0, 10) <= addDays(weekEnd, 1));
  const progress = evs.filter((e) => e.kind === 'progress');
  const reduce = evs.filter((e) => e.kind === 'reduce');
  if (week + 1 > cycle.weeks) {
    nextWeek.push('Cykl zakończony – wykonaj test końcowy w możliwie identycznych warunkach jak test początkowy.');
  } else if (isDeloadWeek(cycle, week + 1)) {
    nextWeek.push(`Tydzień ${week + 1} to deload: mniejsza objętość (mniej serii i dróg), bez progresji. Na początku treningu B – test kontrolny.`);
  }
  for (const e of progress) nextWeek.push(`${TYPE_SHORT[e.workoutType!]}: ${e.parameter} ${e.from} → ${e.to}.`);
  for (const e of reduce) nextWeek.push(`${TYPE_SHORT[e.workoutType!]}: zmniejszamy ${e.parameter?.toLowerCase()} ${e.from} → ${e.to}.`);
  const untouched = (['A', 'B', 'C'] as const).filter((t) => !progress.some((e) => e.workoutType === t) && !reduce.some((e) => e.workoutType === t));
  if (untouched.length && week + 1 <= cycle.weeks) {
    nextWeek.push(`Utrzymujemy obecny poziom: ${untouched.map((t) => `${TYPE_SHORT[t]} (${describeLevel(t, cycle.params)})`).join(', ')}.`);
  }
  if (skipped >= 2) nextWeek.push('Opuszczono kilka jednostek – nie nadrabiamy ich, kontynuujemy plan bez zwiększania obciążenia.');

  return {
    id: uid(),
    cycleId: cycle.id,
    week,
    weekStart,
    generatedAt: ts,
    planned: total,
    done,
    partial,
    skipped,
    aerobicRoutes: aer.routes,
    avgPump: aer.avgPump,
    prevAvgPump: aerPrev.avgPump,
    hangboardChange,
    lines,
    nextWeek,
  };
}
