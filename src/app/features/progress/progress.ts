import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import type { ChartConfiguration } from 'chart.js';
import { AppStore } from '../../core/data/store';
import { GRADES } from '../../core/logic/grades';
import { formatMonth } from '../../core/logic/dates';
import { formatLoad, sessionAvgPump } from '../../core/logic/progression';
import { summarizeTest } from '../../core/logic/reports';
import {
  circuitsCompleted, hangSeries, hangVolumeByWeek, readinessSeries, regularityByWeek, regularitySummary, routesByWeek, sessionSeries,
} from '../../core/logic/stats';
import { TYPE_SHORT } from '../../core/logic/templates';
import { ChartView } from '../../shared/chart';
import { coreTrendChart, deadHangTrendChart, fingerTrendChart, pullUpTrendChart, pumpByAttemptChart, recoveryCurveChart, routeTimingChart } from '../assessment/assessment-charts';
import { strengthResults } from '../../core/logic/assessment/scoring';
import { climbingResults, formatSeconds } from '../../core/logic/assessment/climbing';
import { KIND_LABELS, TEST_STATUS_LABELS } from '../../core/logic/assessment/labels';
import { DatePlPipe } from '../../shared/pipes';

type Tab = 'baseline' | 'climb' | 'endurance' | 'fingers' | 'regularity' | 'reports';

const css = (n: string, f: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || f;
const dm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
const kg = (n: number) => formatLoad({ addedKg: Math.max(0, n), assistKg: Math.max(0, -n) });

@Component({
  selector: 'app-progress',
  imports: [RouterLink, FormsModule, ChartView, DatePlPipe],
  templateUrl: './progress.html',
  styles: `
    .tabs { display: flex; gap: 6px; overflow-x: auto; position: sticky; top: 0; z-index: 4; background: var(--bg); padding: 6px 0; }
    .tabs button { min-height: 42px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--muted); font: inherit; font-weight: 600; white-space: nowrap; cursor: pointer; }
    .tabs button.on { color: var(--accent-ink); background: var(--accent); border-color: var(--accent); }
  `,
})
export class ProgressPage {
  protected readonly store = inject(AppStore);
  protected readonly tab = signal<Tab>('baseline');
  protected readonly tabs: { key: Tab; label: string }[] = [
    { key: 'baseline', label: 'Baseline Test' }, { key: 'climb', label: 'Wspinanie' }, { key: 'endurance', label: 'Wytrzymałość' }, { key: 'fingers', label: 'Siła palców' },
    { key: 'regularity', label: 'Regularność' }, { key: 'reports', label: 'Raporty' },
  ];
  protected readonly fmtKg = kg;
  protected readonly emptyChart = { type: 'bar', data: { labels: [], datasets: [] } } as ChartConfiguration;
  protected readonly typeShort = TYPE_SHORT;

  private readonly c = {
    accent: css('--accent', '#d6f54a'), ok: css('--ok', '#5fd08a'), bad: css('--bad', '#f07a7a'), warn: css('--warn', '#f2b84b'),
    info: css('--info', '#7cb4f5'), faint: css('--faint', '#6b747d'), muted: css('--muted', '#9aa3ac'),
  };

  constructor() {
    if (inject(ActivatedRoute).snapshot.fragment === 'reports') this.tab.set('reports');
  }

  protected readonly workouts = computed(() => [...this.store.completed()].sort((a, b) => (a.date < b.date ? -1 : 1)));
  protected readonly hasData = computed(() => this.workouts().length > 0);

  /* ---------------- Baseline Test v1.0 ---------------- */

  protected readonly kindLabels = KIND_LABELS;
  protected readonly testStatus = TEST_STATUS_LABELS;
  protected readonly fmtSec = formatSeconds;
  /** Testy z danymi (także w trakcie) – chronologicznie wg pierwszej sesji */
  protected readonly assessments = computed(() =>
    [...this.store.assessments()].sort((a, b) => ((a.strength ?? a.climbing)?.date ?? '') < ((b.strength ?? b.climbing)?.date ?? '') ? -1 : 1),
  );
  protected readonly assessmentRows = computed(() => this.assessments().map((a) => ({
    a, s: a.strength ? strengthResults(a.strength) : null, c: a.climbing ? climbingResults(a.climbing) : null,
    cycle: this.store.cycles().find((c) => c.id === a.cycleId)?.name ?? '',
  })));
  protected readonly fingerChart = computed(() => fingerTrendChart(this.assessments()));
  protected readonly pullChart = computed(() => pullUpTrendChart(this.assessments()));
  protected readonly coreChart = computed(() => coreTrendChart(this.assessments()));
  protected readonly deadHangChart = computed(() => deadHangTrendChart(this.assessments()));
  protected readonly timingChart = computed(() => routeTimingChart(this.assessments()));
  protected readonly pumpChart = computed(() => pumpByAttemptChart(this.assessments()));
  protected readonly recoveryCurve = computed(() => recoveryCurveChart(this.assessments()));

  /* ---------------- wspinanie ---------------- */

  protected readonly weeks = computed(() => routesByWeek(this.workouts()));

  protected readonly hardestChart = computed<ChartConfiguration | null>(() => {
    const ws = this.weeks().filter((w) => w.hardestIndex != null);
    if (!ws.length) return null;
    const idx = ws.map((w) => w.hardestIndex!);
    return {
      type: 'line',
      data: { labels: ws.map((w) => dm(w.weekStart)), datasets: [{ label: 'Najtrudniejsza ukończona', data: idx, borderColor: this.c.accent, backgroundColor: this.c.accent, tension: 0.2, stepped: false }] },
      options: {
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => GRADES[ctx.parsed.y as number] ?? '' } } },
        scales: { y: { min: Math.max(0, Math.min(...idx) - 2), max: Math.min(GRADES.length - 1, Math.max(...idx) + 2), ticks: { stepSize: 1, callback: (v) => GRADES[Number(v)] ?? '' } } },
      },
    };
  });

  protected readonly routesWeekChart = computed<ChartConfiguration | null>(() => {
    const ws = this.weeks();
    if (!ws.length) return null;
    return {
      type: 'bar',
      data: {
        labels: ws.map((w) => dm(w.weekStart)),
        datasets: [
          { label: 'Ukończone', data: ws.map((w) => w.completed), backgroundColor: this.c.ok, stack: 's', borderRadius: 4 },
          { label: 'Nieukończone', data: ws.map((w) => w.failed), backgroundColor: this.c.bad, stack: 's', borderRadius: 4 },
        ],
      },
      options: { scales: { y: { beginAtZero: true, stacked: true, ticks: { precision: 0 } }, x: { stacked: true, grid: { display: false } } } },
    };
  });

  protected readonly shareChart = computed<ChartConfiguration | null>(() => {
    const done = this.weeks().reduce((n, w) => n + w.completed, 0);
    const failed = this.weeks().reduce((n, w) => n + w.failed, 0);
    if (!done && !failed) return null;
    return {
      type: 'doughnut',
      data: { labels: ['Ukończone', 'Nieukończone'], datasets: [{ data: [done, failed], backgroundColor: [this.c.ok, this.c.bad], borderWidth: 0 }] },
      options: { cutout: '65%', plugins: { legend: { position: 'bottom' } } },
    };
  });
  protected readonly shareText = computed(() => {
    const done = this.weeks().reduce((n, w) => n + w.completed, 0);
    const all = done + this.weeks().reduce((n, w) => n + w.failed, 0);
    return all ? `${done} z ${all} dróg ukończonych (${Math.round((done / all) * 100)}%)` : '';
  });

  protected readonly rpePumpChart = computed<ChartConfiguration | null>(() => {
    const s = sessionSeries(this.workouts());
    if (!s.length) return null;
    return {
      type: 'line',
      data: {
        labels: s.map((p) => `${dm(p.date)} ${p.type}`),
        datasets: [
          { label: 'RPE', data: s.map((p) => p.rpe), borderColor: this.c.warn, backgroundColor: this.c.warn, tension: 0.2, spanGaps: true },
          { label: 'Pompowanie (maks.)', data: s.map((p) => p.pump), borderColor: this.c.info, backgroundColor: this.c.info, tension: 0.2, spanGaps: true },
        ],
      },
      options: { scales: { y: { min: 0, max: 10 } } },
    };
  });

  /* ---------------- wytrzymałość ---------------- */

  protected readonly tests = computed(() => [...this.store.tests()].sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? -1 : 1) : a.date < b.date ? -1 : 1)));
  protected readonly testRows = computed(() => this.tests().map((t) => ({ t, s: summarizeTest(t), cycle: this.store.cycles().find((c) => c.id === t.cycleId)?.name ?? '' })));

  protected readonly testChart = computed<ChartConfiguration | null>(() => {
    const rows = this.testRows();
    if (!rows.length) return null;
    return {
      type: 'bar',
      data: {
        labels: rows.map((r) => `${TYPE_SHORT[r.t.kind].replace('Test ', '')} ${dm(r.t.date)}`),
        datasets: [
          { label: 'Ukończone (z 3)', data: rows.map((r) => r.s.completed), backgroundColor: this.c.ok, borderRadius: 4 },
          { label: 'Maks. pompowanie', data: rows.map((r) => r.s.maxPump), backgroundColor: this.c.info, borderRadius: 4 },
          { label: 'Średnie RPE', data: rows.map((r) => r.s.avgRpe), backgroundColor: this.c.warn, borderRadius: 4 },
        ],
      },
      options: { scales: { y: { min: 0, max: 10 } } },
    };
  });

  protected readonly testPumpChart = computed<ChartConfiguration | null>(() => {
    const rows = this.testRows().slice(-5);
    if (!rows.length) return null;
    const palette = [this.c.faint, this.c.muted, this.c.info, this.c.warn, this.c.accent].slice(-rows.length);
    return {
      type: 'line',
      data: {
        labels: ['Droga 1', 'Droga 2', 'Droga 3'],
        datasets: rows.map((r, i) => ({
          label: `${TYPE_SHORT[r.t.kind]} ${dm(r.t.date)}`, data: r.s.pumpPerRoute, borderColor: palette[i], backgroundColor: palette[i], tension: 0.2,
          borderWidth: i === rows.length - 1 ? 3 : 2,
        })),
      },
      options: { scales: { y: { min: 0, max: 10 } } },
    };
  });

  protected readonly recoveryChart = computed<ChartConfiguration | null>(() => {
    const r = readinessSeries(this.store.readiness());
    const b = this.workouts().filter((w) => w.type === 'B').map((w) => ({ date: w.date, pump: sessionAvgPump(w) }));
    if (!r.length && !b.length) return null;
    const dates = [...new Set([...r.map((x) => x.date), ...b.map((x) => x.date)])].sort();
    return {
      type: 'line',
      data: {
        labels: dates.map(dm),
        datasets: [
          { label: 'Gotowość (0–100)', data: dates.map((d) => r.filter((x) => x.date === d).at(-1)?.score ?? null), borderColor: this.c.ok, backgroundColor: this.c.ok, yAxisID: 'y', spanGaps: true, tension: 0.2 },
          { label: 'Śr. pompowanie w treningu B', data: dates.map((d) => b.find((x) => x.date === d)?.pump ?? null), borderColor: this.c.info, backgroundColor: this.c.info, yAxisID: 'y1', spanGaps: true, tension: 0.2 },
        ],
      },
      options: { scales: { y: { min: 0, max: 100, position: 'left' }, y1: { min: 0, max: 10, position: 'right', grid: { drawOnChartArea: false } } } },
    };
  });

  protected readonly circuits = computed(() => circuitsCompleted(this.workouts()));
  protected readonly circuitChart = computed<ChartConfiguration | null>(() => {
    const cs = this.circuits();
    if (!cs.length) return null;
    return {
      type: 'bar',
      data: {
        labels: cs.map((c) => dm(c.date)),
        datasets: [
          { label: 'Ukończone obwody', data: cs.map((c) => c.completedSets), backgroundColor: this.c.accent, borderRadius: 4 },
          { label: 'Zaplanowane', data: cs.map((c) => c.plannedSets), backgroundColor: this.c.faint, borderRadius: 4 },
        ],
      },
      options: { scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
    };
  });

  /* ---------------- siła palców (Beastmaker 2000) ---------------- */

  protected readonly hangs = computed(() => this.workouts().flatMap((w) => w.hangs));
  protected readonly grips = computed(() => hangSeries(this.hangs()));
  protected readonly gripKey = signal('');
  protected readonly grip = computed(() => this.grips().find((g) => g.key === this.gripKey()) ?? this.grips()[this.grips().length - 1] ?? null);

  protected readonly loadChart = computed<ChartConfiguration | null>(() => {
    const g = this.grip();
    if (!g) return null;
    return {
      type: 'line',
      data: {
        labels: g.points.map((p) => dm(p.date)),
        datasets: [
          { label: 'Obciążenie efektywne (kg)', data: g.points.map((p) => p.load), borderColor: this.c.accent, backgroundColor: this.c.accent, tension: 0.2, yAxisID: 'y',
            pointBackgroundColor: g.points.map((p) => (p.pain ? this.c.bad : this.c.accent)) },
          { label: 'Czas zwisu (s)', data: g.points.map((p) => p.hangSec), borderColor: this.c.info, backgroundColor: this.c.info, borderDash: [4, 4], tension: 0, yAxisID: 'y1' },
        ],
      },
      options: {
        plugins: { tooltip: { callbacks: { label: (ctx) => (ctx.datasetIndex === 0 ? kg(ctx.parsed.y as number) : `${ctx.parsed.y} s`) } } },
        scales: { y: { position: 'left', ticks: { callback: (v) => `${v} kg` } }, y1: { position: 'right', min: 0, max: 15, grid: { drawOnChartArea: false } } },
      },
    };
  });

  protected readonly volumeChart = computed<ChartConfiguration | null>(() => {
    const v = hangVolumeByWeek(this.hangs());
    if (!v.length) return null;
    return {
      type: 'bar',
      data: {
        labels: v.map((x) => dm(x.weekStart)),
        datasets: [
          { type: 'bar', label: 'Łączna liczba serii', data: v.map((x) => x.sets), backgroundColor: this.c.accent, borderRadius: 4, yAxisID: 'y' },
          { type: 'line', label: 'Łączny czas zwisów (s)', data: v.map((x) => x.hangTimeSec), borderColor: this.c.info, backgroundColor: this.c.info, yAxisID: 'y1' },
        ],
      },
      options: { scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } } } },
    } as ChartConfiguration;
  });

  protected readonly recentHangs = computed(() => [...this.hangs()].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12));

  /* ---------------- regularność ---------------- */

  protected readonly regularity = computed(() => regularitySummary(this.store.planned(), this.workouts(), this.store.today()));
  protected readonly regularityChart = computed<ChartConfiguration | null>(() => {
    const ws = regularityByWeek(this.store.planned(), this.store.today());
    if (!ws.length) return null;
    return {
      type: 'bar',
      data: {
        labels: ws.map((w) => dm(w.weekStart)),
        datasets: [
          { label: 'Wykonane', data: ws.map((w) => w.done), backgroundColor: this.c.ok, stack: 's' },
          { label: 'Częściowo', data: ws.map((w) => w.partial), backgroundColor: this.c.warn, stack: 's' },
          { label: 'Pominięte', data: ws.map((w) => w.skipped), backgroundColor: this.c.bad, stack: 's' },
        ],
      },
      options: { scales: { y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }, x: { stacked: true, grid: { display: false } } } },
    };
  });
  protected readonly monthChart = computed<ChartConfiguration | null>(() => {
    const ws = this.workouts();
    if (!ws.length) return null;
    const m = new Map<string, number>();
    for (const w of ws) m.set(w.date.slice(0, 7), (m.get(w.date.slice(0, 7)) ?? 0) + 1);
    const keys = [...m.keys()].sort();
    return {
      type: 'bar',
      data: { labels: keys.map(formatMonth), datasets: [{ label: 'Treningi', data: keys.map((k) => m.get(k)!), backgroundColor: this.c.accent, borderRadius: 6 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
    };
  });
  protected readonly quality = computed(() => {
    const ws = this.workouts();
    const full = ws.filter((w) => w.completion === 'full').length;
    const light = ws.filter((w) => w.deload).length;
    const pain = ws.filter((w) => w.hangs.some((h) => h.pain)).length;
    return { full, partial: ws.length - full, light, pain };
  });

  /* ---------------- raporty ---------------- */

  protected readonly reports = computed(() => {
    const cycles = new Map(this.store.cycles().map((c) => [c.id, c.name]));
    return [...this.store.reports()].sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1)).map((r) => ({ r, cycle: cycles.get(r.cycleId) ?? '' }));
  });

  protected regenerate() {
    void this.store.ensureWeeklyReports(true);
  }
}
