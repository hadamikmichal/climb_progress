import type { ChartConfiguration } from 'chart.js';
import { CompletedWorkout } from '../../core/models/models';
import { GRADES } from '../../core/logic/grades';
import { formatLoad } from '../../core/logic/progression';
import { HangSeries, hangVolumeByWeek, routesByWeek, circuitsCompleted } from '../../core/logic/stats';
import { aerobicRepeatability, hardAttemptsByWeek, rpeSeries } from '../../core/logic/analytics';
import { palette } from '../assessment/assessment-charts';

/** Budowniczowie konfiguracji wykresów Progresu – prezentacja, bez logiki domenowej */

export const dm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
const kg = (n: number) => formatLoad({ addedKg: Math.max(0, n), assistKg: Math.max(0, -n) });
const noLegend = { legend: { display: false } };
/** legenda wykresów liniowych: krótka linia zamiast kwadratu (czytelne serie przerywane) */
const lineLegend = { legend: { labels: { usePointStyle: true, pointStyle: 'line' as const } } };

/** Czy rośnie obciążenie na tej samej krawądce? */
export function hangLoadChart(g: HangSeries | null): ChartConfiguration | null {
  if (!g?.points.length) return null;
  const c = palette();
  return {
    type: 'line',
    data: {
      labels: g.points.map((p) => dm(p.date)),
      datasets: [{
        label: 'Obciążenie efektywne (kg)', data: g.points.map((p) => p.load), borderColor: c.accent, backgroundColor: c.accent, tension: 0,
        pointBackgroundColor: g.points.map((p) => (p.pain ? c.warn : c.accent)), pointRadius: g.points.map((p) => (p.pain ? 5 : 3.5)),
      }],
    },
    options: {
      plugins: { ...noLegend, tooltip: { callbacks: { label: (ctx) => `${kg(ctx.parsed.y as number)} · ${g.points[ctx.dataIndex].setsDone} serii × ${g.points[ctx.dataIndex].hangSec} s${g.points[ctx.dataIndex].pain ? ' · ból' : ''}` } } },
      scales: { y: { ticks: { callback: (v) => `${Number(v) > 0 ? '+' : ''}${v} kg` } }, x: { grid: { display: false } } },
    },
  };
}

/** Ile pracy wykonały palce? */
export function hangVolumeChart(ws: CompletedWorkout[]): ChartConfiguration | null {
  const v = hangVolumeByWeek(ws.flatMap((w) => w.hangs));
  if (!v.length) return null;
  const c = palette();
  return {
    type: 'bar',
    data: { labels: v.map((x) => dm(x.weekStart)), datasets: [{ label: 'Serie zwisów', data: v.map((x) => x.sets), backgroundColor: c.accent }] },
    options: { plugins: noLegend, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } } },
  };
}

/** Czy wspinasz więcej? (objętość tygodniowa) */
export function routesVolumeChart(ws: CompletedWorkout[]): ChartConfiguration | null {
  const w = routesByWeek(ws);
  if (!w.length) return null;
  const c = palette();
  return {
    type: 'bar',
    data: {
      labels: w.map((x) => dm(x.weekStart)),
      datasets: [
        { label: 'Ukończone', data: w.map((x) => x.completed), backgroundColor: c.accent, stack: 's' },
        { label: 'Nieukończone', data: w.map((x) => x.failed), backgroundColor: c.faint, stack: 's' },
      ],
    },
    options: { scales: { y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }, x: { stacked: true, grid: { display: false } } } },
  };
}

/** Czy kończysz zaplanowane drogi tlenowe? */
export function repeatabilityChart(ws: CompletedWorkout[]): ChartConfiguration | null {
  const r = aerobicRepeatability(ws);
  const circ = circuitsCompleted(ws);
  if (!r.length && !circ.length) return null;
  const c = palette();
  const dates = [...new Set([...r.map((x) => x.date), ...circ.map((x) => x.date)])].sort();
  const pct = (d: number, p: number) => (p ? Math.round((d / p) * 100) : null);
  return {
    type: 'line',
    data: {
      labels: dates.map(dm),
      datasets: [
        { label: 'Trening B – ukończone drogi (%)', data: dates.map((d) => { const x = r.find((y) => y.date === d); return x ? pct(x.done, x.planned) : null; }), borderColor: c.accent, backgroundColor: c.accent, spanGaps: true, tension: 0 },
        { label: 'Trening C – pełne obwody (%)', data: dates.map((d) => { const x = circ.find((y) => y.date === d); return x ? pct(x.completedSets, x.plannedSets) : null; }), borderColor: c.info, backgroundColor: c.info, borderDash: [4, 4], spanGaps: true, tension: 0 },
      ],
    },
    options: { plugins: lineLegend, scales: { y: { min: 0, max: 100, ticks: { callback: (v) => `${v}%` } }, x: { grid: { display: false } } } },
  };
}

/** Jak ciężkie były sesje wytrzymałościowe? */
export function rpeChart(ws: CompletedWorkout[]): ChartConfiguration | null {
  const s = rpeSeries(ws);
  if (!s.length) return null;
  const c = palette();
  const b = s.filter((x) => x.type === 'B');
  const cc = s.filter((x) => x.type === 'C');
  const dates = [...new Set(s.map((x) => x.date))];
  return {
    type: 'line',
    data: {
      labels: dates.map(dm),
      datasets: [
        { label: 'B – Max Hangs + tlenowa', data: dates.map((d) => b.find((x) => x.date === d)?.rpe ?? null), borderColor: c.accent, backgroundColor: c.accent, spanGaps: true, tension: 0 },
        { label: 'C – obwody', data: dates.map((d) => cc.find((x) => x.date === d)?.rpe ?? null), borderColor: c.info, backgroundColor: c.info, borderDash: [4, 4], spanGaps: true, tension: 0 },
      ],
    },
    options: { plugins: lineLegend, scales: { y: { min: 1, max: 10 }, x: { grid: { display: false } } } },
  };
}

/** Czy przedramiona mniej się pompują na treningu tlenowym? (linia celu 4/10) */
export function aerobicPumpChart(ws: CompletedWorkout[], target: number): ChartConfiguration | null {
  const r = aerobicRepeatability(ws).filter((x) => x.avgPump != null);
  if (!r.length) return null;
  const c = palette();
  return {
    type: 'line',
    data: {
      labels: r.map((x) => dm(x.date)),
      datasets: [
        { label: 'Śr. pompowanie po drogach', data: r.map((x) => x.avgPump), borderColor: c.accent, backgroundColor: r.map((x) => (x.avgPump! > target ? c.warn : c.accent)), pointBackgroundColor: r.map((x) => (x.avgPump! > target ? c.warn : c.accent)), tension: 0 },
        { label: `Cel: maks. ${target}/10`, data: r.map(() => target), borderColor: c.muted, borderDash: [3, 4], pointRadius: 0, borderWidth: 1.5 },
      ],
    },
    options: { plugins: lineLegend, scales: { y: { min: 0, max: 10 }, x: { grid: { display: false } } } },
  };
}

/** Czy rośnie najtrudniejsza ukończona droga? Punkty = najlepsza w tygodniu, linia = najlepsza dotąd */
export function hardestChart(ws: CompletedWorkout[]): ChartConfiguration | null {
  const w = routesByWeek(ws).filter((x) => x.hardestIndex != null);
  if (!w.length) return null;
  const c = palette();
  const idx = w.map((x) => x.hardestIndex!);
  let best = -1;
  const running = idx.map((i) => (best = Math.max(best, i)));
  return {
    type: 'line',
    data: {
      labels: w.map((x) => dm(x.weekStart)),
      datasets: [
        { label: 'Najlepsza dotąd', data: running, borderColor: c.record, backgroundColor: c.record, stepped: 'before', pointRadius: 0 },
        { label: 'Najtrudniejsza w tygodniu', data: idx, borderColor: c.accent, backgroundColor: c.accent, showLine: false, pointRadius: 4 },
      ],
    },
    options: {
      plugins: { legend: { labels: { usePointStyle: true } }, tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${GRADES[ctx.parsed.y as number] ?? ''}` } } },
      scales: {
        y: { min: Math.max(0, Math.min(...idx) - 1), max: Math.min(GRADES.length - 1, Math.max(...idx) + 1), ticks: { stepSize: 1, callback: (v) => GRADES[Number(v)] ?? '' } },
        x: { grid: { display: false } },
      },
    },
  };
}

/** Jaka część trudnych prób kończy się przejściem? */
export function hardRateChart(ws: CompletedWorkout[]): ChartConfiguration | null {
  const w = hardAttemptsByWeek(ws);
  if (!w.length) return null;
  const c = palette();
  return {
    type: 'bar',
    data: {
      labels: w.map((x) => dm(x.weekStart)),
      datasets: [
        { label: 'Przejścia', data: w.map((x) => x.sends), backgroundColor: c.accent, stack: 's' },
        { label: 'Nieudane próby', data: w.map((x) => x.attempts - x.sends), backgroundColor: c.faint, stack: 's' },
      ],
    },
    options: {
      plugins: { tooltip: { callbacks: { footer: (items) => `skuteczność ${w[items[0].dataIndex].rate}%` } } },
      scales: { y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }, x: { stacked: true, grid: { display: false } } },
    },
  };
}
