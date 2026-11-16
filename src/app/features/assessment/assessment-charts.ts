import { resolvedTheme } from '../../shared/theme';
import type { ChartConfiguration } from 'chart.js';
import { Assessment } from '../../core/models/assessment';
import { climbingResults } from '../../core/logic/assessment/climbing';
import { strengthResults } from '../../core/logic/assessment/scoring';
import { CORE_LABELS, KIND_LABELS } from '../../core/logic/assessment/labels';

const css = (n: string, f: string) => (typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(n).trim() : '') || f;

export function palette() {
  resolvedTheme(); // zależność: zmiana motywu przelicza wykresy
  return {
    // ograniczona paleta: Forest = bieżący wynik, kamień/granit = odniesienie i cele, Scree = ryzyko, Lime = rekord
    accent: css('--chart-1', '#426b50'), ok: css('--chart-4', '#222923'), bad: css('--chart-3', '#c77b4c'), warn: css('--chart-3', '#c77b4c'),
    info: css('--chart-2', '#747d75'), faint: css('--chart-faint', '#c9ccc2'), muted: css('--chart-2', '#747d75'), record: css('--chart-record', '#d7ef76'),
  };
}

const dm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
const short = (a: Assessment) => `${a.kind === 'BASELINE' ? 'Baseline' : a.kind === 'FINAL' ? 'Retest' : 'Pośredni'} ${dm((a.strength ?? a.climbing)!.date)}`;
const withStrength = (xs: Assessment[]) => xs.filter((a) => a.strength && a.strength.status === 'completed');
const withClimbing = (xs: Assessment[]) => xs.filter((a) => a.climbing && a.climbing.status === 'completed');

/* ---------- 1–4: trendy siłowe w kolejnych testach ---------- */

/** 1. Max Finger Strength – obciążenie całkowite (słupki) i masa ciała z dnia testu (linia); różnica = ciężar dodatkowy */
export function fingerTrendChart(xs: Assessment[]): ChartConfiguration | null {
  const rows = withStrength(xs).map((a) => ({ a, r: strengthResults(a.strength!).finger })).filter((x) => x.r.totalLoadKg != null);
  if (!rows.length) return null;
  const c = palette();
  const added = (r: (typeof rows)[number]['r']) => (r.addedWeightKg ?? 0) - (r.assistanceKg ?? 0);
  return {
    type: 'bar',
    data: {
      labels: rows.map((x) => short(x.a)),
      datasets: [
        { type: 'line', label: 'Masa ciała (kg)', data: rows.map((x) => x.r.bodyMassKg), borderColor: c.info, backgroundColor: c.info, borderDash: [4, 4], pointRadius: 3, order: 0 },
        { type: 'bar', label: 'Obciążenie całkowite (kg)', data: rows.map((x) => x.r.totalLoadKg), backgroundColor: c.accent, order: 1 },
      ],
    },
    options: {
      plugins: {
        legend: { labels: { usePointStyle: true } },
        tooltip: { callbacks: { afterBody: (items) => { const r = rows[items[0].dataIndex].r; const a = added(r); return `dodatkowe: ${a >= 0 ? '+' : '−'}${Math.abs(a)} kg · ${Math.round((r.bodyMassRatioPercent ?? 0) * 10) / 10}% m.c.`; } } },
      },
      scales: { y: { beginAtZero: false, suggestedMin: Math.min(...rows.map((x) => x.r.bodyMassKg ?? 0)) - 10, ticks: { callback: (v) => `${v} kg` } }, x: { grid: { display: false } } },
    },
  } as ChartConfiguration;
}

/** 2. Weighted Pull-up – obciążenie dodatkowe */
export function pullUpTrendChart(xs: Assessment[]): ChartConfiguration | null {
  const rows = withStrength(xs).map((a) => ({ a, r: strengthResults(a.strength!).pullUp })).filter((x) => x.r.addedWeightKg != null);
  if (!rows.length) return null;
  const c = palette();
  return {
    type: 'bar',
    data: { labels: rows.map((x) => short(x.a)), datasets: [{ label: 'Dodatkowe obciążenie (kg)', data: rows.map((x) => x.r.addedWeightKg), backgroundColor: c.accent }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  };
}

/** 3. Core – czas utrzymania (z wariantem w podpisie) */
export function coreTrendChart(xs: Assessment[]): ChartConfiguration | null {
  const rows = withStrength(xs).map((a) => ({ a, r: strengthResults(a.strength!).core })).filter((x) => x.r.holdSeconds != null);
  if (!rows.length) return null;
  const c = palette();
  return {
    type: 'bar',
    data: {
      labels: rows.map((x) => `${short(x.a)} · ${CORE_LABELS[x.r.exercise!].split(' (')[0]}`),
      datasets: [{ label: 'Czas utrzymania (s)', data: rows.map((x) => x.r.holdSeconds), backgroundColor: c.accent }],
    },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  };
}

/** 4. Dead Hang – czas */
export function deadHangTrendChart(xs: Assessment[]): ChartConfiguration | null {
  const rows = withStrength(xs).map((a) => ({ a, r: strengthResults(a.strength!).deadHang })).filter((x) => x.r.holdSeconds != null);
  if (!rows.length) return null;
  const c = palette();
  return {
    type: 'bar',
    data: { labels: rows.map((x) => short(x.a)), datasets: [{ label: 'Czas (s)', data: rows.map((x) => x.r.holdSeconds), backgroundColor: c.accent }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, suggestedMax: 360 } } },
  };
}

/* ---------- 5–7: dzień 2 (pojedynczy test lub nałożenie kilku) ---------- */

const seriesColors = () => {
  const c = palette();
  // starsze testy jaśniej (kamień → granit → grafit), bieżący w Forest; Scree zarezerwowany dla ryzyka
  return [c.faint, c.info, c.ok, c.accent];
};

/** 5. Route Timing – czasy przejść kolejnych prób */
export function routeTimingChart(xs: Assessment[]): ChartConfiguration | null {
  const rows = withClimbing(xs).slice(-4);
  if (!rows.length) return null;
  const n = Math.max(...rows.map((a) => a.climbing!.plannedAttempts));
  const cols = seriesColors().slice(-rows.length);
  return {
    type: 'bar',
    data: {
      labels: Array.from({ length: n }, (_, i) => `Droga ${i + 1}`),
      datasets: rows.map((a, i) => {
        const t = climbingResults(a.climbing!).time;
        return { label: short(a), data: Array.from({ length: n }, (_, k) => t.times[k] ?? null), backgroundColor: cols[i] };
      }),
    },
    options: { plugins: { legend: { display: rows.length > 1 } }, scales: { y: { beginAtZero: true, title: { display: true, text: 's' } } } },
  };
}

/** 6. Forearm Pump – pompowanie po każdej próbie */
export function pumpByAttemptChart(xs: Assessment[]): ChartConfiguration | null {
  const rows = withClimbing(xs).slice(-4);
  if (!rows.length) return null;
  const n = Math.max(...rows.map((a) => a.climbing!.plannedAttempts));
  const cols = seriesColors().slice(-rows.length);
  return {
    type: 'line',
    data: {
      labels: Array.from({ length: n }, (_, i) => `Droga ${i + 1}`),
      datasets: rows.map((a, i) => {
        const t = climbingResults(a.climbing!).time;
        return { label: short(a), data: Array.from({ length: n }, (_, k) => t.pump[k] ?? null), borderColor: cols[i], backgroundColor: cols[i], tension: 0.2, borderWidth: i === rows.length - 1 ? 3 : 2 };
      }),
    },
    options: { plugins: { legend: { display: rows.length > 1 } }, scales: { y: { min: 0, max: 10 } } },
  };
}

/** 7. Recovery Curve – 0, 60, 120, 180 s */
export function recoveryCurveChart(xs: Assessment[]): ChartConfiguration | null {
  const rows = withClimbing(xs).slice(-4);
  if (!rows.length) return null;
  const cols = seriesColors().slice(-rows.length);
  return {
    type: 'line',
    data: {
      labels: ['0 min', '1 min', '2 min', '3 min'],
      datasets: rows.map((a, i) => ({
        label: short(a), data: climbingResults(a.climbing!).recovery.points.map((p) => p.pump), borderColor: cols[i], backgroundColor: cols[i], tension: 0.25, borderWidth: i === rows.length - 1 ? 3 : 2,
      })),
    },
    options: { plugins: { legend: { display: rows.length > 1 } }, scales: { y: { min: 0, max: 10, title: { display: true, text: 'pompowanie /10' } } } },
  };
}

/** 8. Baseline vs Retest – punktacja 9c w kategoriach + ukończone drogi */
export function baselineVsRetestChart(a: Assessment, b: Assessment): ChartConfiguration | null {
  const c = palette();
  const labels: string[] = [];
  const va: (number | null)[] = [];
  const vb: (number | null)[] = [];
  if (a.strength && b.strength) {
    const x = strengthResults(a.strength);
    const y = strengthResults(b.strength);
    labels.push('Palce', 'Przyciąganie', 'Core', 'Dead Hang');
    va.push(x.finger.score, x.pullUp.score, x.core.score, x.deadHang.score);
    vb.push(y.finger.score, y.pullUp.score, y.core.score, y.deadHang.score);
  }
  if (a.climbing && b.climbing) {
    const n = Math.min(a.climbing.plannedAttempts, b.climbing.plannedAttempts);
    labels.push(`Drogi (z ${n})`, 'Pompa po ost.', 'Pompa 3 min');
    const x = climbingResults(a.climbing, n);
    const y = climbingResults(b.climbing, n);
    const rx = climbingResults(a.climbing).recovery;
    const ry = climbingResults(b.climbing).recovery;
    va.push(x.time.completedRoutes, x.recovery.pumpAfterLastRoute, rx.points[3].pump);
    vb.push(y.time.completedRoutes, y.recovery.pumpAfterLastRoute, ry.points[3].pump);
  }
  if (!labels.length) return null;
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: `${KIND_LABELS[a.kind]}`, data: va, backgroundColor: c.faint },
        { label: `${KIND_LABELS[b.kind]}`, data: vb, backgroundColor: c.accent },
      ],
    },
    options: { scales: { y: { min: 0, max: 10 } } },
  };
}
