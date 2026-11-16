import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CompletedWorkout, TestResult } from '../../core/models/models';
import { Assessment } from '../../core/models/assessment';
import { delta, periodSummary } from '../../core/logic/analytics';
import { summarizeTest } from '../../core/logic/reports';
import { climbingResults, formatSeconds } from '../../core/logic/assessment/climbing';
import { KIND_LABELS } from '../../core/logic/assessment/labels';
import { TYPE_SHORT } from '../../core/logic/templates';
import { routeTimingChart } from '../assessment/assessment-charts';
import { DatePlPipe } from '../../shared/pipes';
import { ChartPanel } from './chart-panel';
import { MetricItem, MetricRow } from './metric-row';
import { repeatabilityChart, routesVolumeChart, rpeChart } from './progress-charts';
import { changeText } from './progress-format';

interface TestRow {
  id: string;
  link: (string | null)[];
  date: string;
  label: string;
  completed: number;
  total: number;
  avgTime: number | null;
  timeChange: number | null;
  avgRpe: number | null;
}

/** Progres › Wytrzymałość: objętość, powtarzalność, testy dróg (trudność z kalibracji), czasy przejść, RPE */
@Component({
  selector: 'app-tab-endurance',
  imports: [RouterLink, DatePlPipe, ChartPanel, MetricRow],
  template: `
    <app-metric-row [items]="metrics()" />

    @if (!cur().length && !testRows().length) {
      <p class="empty-block">Brak treningów w wybranym zakresie. Wykresy wytrzymałości pojawią się po pierwszych treningach B i C.</p>
    } @else {
      <app-chart-panel question="Czy wspinasz więcej?" hint="Drogi w tygodniach – ukończone i nieukończone (bez rozgrzewki)."
        [config]="volumeChart()" [answer]="volumeAnswer()" [height]="180" emptyText="Brak dróg w wybranym zakresie." />

      <app-chart-panel question="Czy kończysz to, co zaplanowane?" hint="Powtarzalność: odsetek ukończonych dróg tlenowych (B) i pełnych obwodów bez odpadnięcia (C)."
        [config]="repeatChart()" emptyText="Brak treningów B lub C w wybranym zakresie." />

      <app-chart-panel question="Czy tempo trzyma się przy kolejnych przejściach?" hint="Test dróg na tej samej drodze testowej – czas każdego powtórzenia. Krótszy i stabilny czas przy narastającym zmęczeniu = lepsza wytrzymałość."
        [config]="timingChart()" emptyText="Brak testu dróg z pomiarem czasu – wykonaj dzień 2 Baseline Test." />

      @if (testRows().length) {
        <section class="section">
          <div class="section-head"><h3>Testy powtarzalności</h3><span class="eyebrow">{{ testRows().length }}</span></div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Test</th><th class="num">Ukończone</th><th class="num">Śr. czas</th><th class="num">Zmiana 1.→ost.</th><th class="num">Śr. RPE</th></tr></thead>
              <tbody>
                @for (t of testRows(); track t.id) {
                  <tr>
                    <td><a [routerLink]="t.link">{{ t.label }}</a><br /><small class="faint mono">{{ t.date | datePl }}</small></td>
                    <td class="num">{{ t.completed }}/{{ t.total }}</td>
                    <td class="num">{{ fmt(t.avgTime) }}</td>
                    <td class="num" [class.trend-worse]="(t.timeChange ?? 0) >= 10">{{ t.timeChange != null ? (t.timeChange > 0 ? '+' : '') + t.timeChange + '%' : '–' }}</td>
                    <td class="num">{{ t.avgRpe ?? '–' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="faint small">Testy sprzed v1.0 (3 × 6a) nie mają pomiaru czasu.</p>
        </section>
      }

      <app-chart-panel question="Jak ciężkie były sesje wytrzymałościowe?" hint="RPE całej sesji. Rosnące RPE przy tej samej objętości to sygnał do odpoczynku, nie do progresji."
        [config]="rpeChart()" [height]="180" emptyText="Brak ocen RPE w wybranym zakresie." />
    }
  `,
  styleUrl: './progress-tabs.scss',
})
export class TabEndurance {
  readonly cur = input.required<CompletedWorkout[]>();
  readonly prev = input<CompletedWorkout[] | null>(null);
  readonly assessments = input.required<Assessment[]>();
  readonly legacyTests = input<TestResult[]>([]);
  readonly rangeLabel = input('');

  protected readonly fmt = formatSeconds;
  protected readonly volumeChart = computed(() => routesVolumeChart(this.cur()));
  protected readonly repeatChart = computed(() => repeatabilityChart(this.cur()));
  protected readonly timingChart = computed(() => routeTimingChart(this.assessments()));
  protected readonly rpeChart = computed(() => rpeChart(this.cur()));

  protected readonly volumeAnswer = computed(() => {
    const s = periodSummary(this.cur());
    if (!s.routesTotal) return null;
    return `${s.routesDone} z ${s.routesTotal} dróg ukończonych (${s.sendRate}%) · ok. ${s.meters} m wspinania.`;
  });

  protected readonly testRows = computed<TestRow[]>(() => {
    const legacy: TestRow[] = this.legacyTests().map((t) => {
      const s = summarizeTest(t);
      return { id: t.id, link: ['/tests', t.id], date: t.date, label: `${TYPE_SHORT[t.kind]} 3 × 6a`, completed: s.completed, total: s.total, avgTime: null, timeChange: null, avgRpe: s.avgRpe };
    });
    const v1: TestRow[] = this.assessments().filter((a) => a.climbing?.status === 'completed').map((a) => {
      const r = climbingResults(a.climbing!);
      return {
        id: a.id, link: ['/assessment', a.id], date: a.climbing!.date, label: KIND_LABELS[a.kind], completed: r.time.completedRoutes, total: a.climbing!.plannedAttempts,
        avgTime: r.time.averageTimeSeconds, timeChange: r.time.timeChangePercent, avgRpe: r.time.averageRpe,
      };
    });
    return [...legacy, ...v1].sort((a, b) => (a.date < b.date ? -1 : 1));
  });

  protected readonly metrics = computed<MetricItem[]>(() => {
    const s = periodSummary(this.cur());
    const p = this.prev() ? periodSummary(this.prev()!) : null;
    const routes = delta(s.routesDone, p ? p.routesDone : null);
    const meters = delta(s.meters, p ? p.meters : null);
    const rate = delta(s.sendRate, p ? p.sendRate : null);
    const rpe = delta(s.avgRpe, p ? p.avgRpe : null, true);
    const r = this.rangeLabel();
    return [
      { label: 'Ukończone drogi', value: String(s.routesDone), change: changeText(routes, '', r), trend: routes.trend },
      { label: 'Objętość', value: String(s.meters), unit: 'm', change: changeText(meters, 'm', r), trend: meters.trend },
      { label: 'Skuteczność', value: s.sendRate != null ? String(s.sendRate) : '–', unit: '%', change: changeText(rate, 'pp', r), trend: rate.trend },
      { label: 'Średnie RPE', value: s.avgRpe != null ? String(s.avgRpe) : '–', change: changeText(rpe, '', r), trend: rpe.trend },
    ];
  });
}
