import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CompletedWorkout } from '../../core/models/models';
import { Assessment } from '../../core/models/assessment';
import { delta, periodSummary } from '../../core/logic/analytics';
import { climbingResults } from '../../core/logic/assessment/climbing';
import { KIND_LABELS } from '../../core/logic/assessment/labels';
import { pumpByAttemptChart, recoveryCurveChart } from '../assessment/assessment-charts';
import { DatePlPipe } from '../../shared/pipes';
import { ChartPanel } from './chart-panel';
import { MetricItem, MetricRow } from './metric-row';
import { aerobicPumpChart } from './progress-charts';
import { changeText } from './progress-format';

/** Progres › Regeneracja: pompowanie na treningu, krzywa regeneracji i jej trend między testami */
@Component({
  selector: 'app-tab-recovery',
  imports: [RouterLink, DatePlPipe, ChartPanel, MetricRow],
  template: `
    <app-metric-row [items]="metrics()" />

    <app-chart-panel question="Czy przedramiona mniej się pompują na treningu tlenowym?" [hint]="'Średnie pompowanie po drogach w treningu B. Cel: maks. ' + target() + '/10 – punkty powyżej celu oznaczone pomarańczowo.'"
      [config]="pumpChart()" [answer]="pumpAnswer()" emptyText="Brak ocen pompowania w treningach B w wybranym zakresie." />

    <app-chart-panel question="Jak szybko wraca komfort po wysiłku?" hint="Recovery Curve po ostatniej drodze testu: pompowanie po 0, 1, 2 i 3 minutach. Standaryzowana ocena subiektywna."
      [config]="curveChart()" emptyText="Brak krzywej regeneracji – pojawi się po dniu 2 Baseline Test." />

    @if (rows().length) {
      <section class="section">
        <div class="section-head"><h3>Czy regeneracja poprawia się między testami?</h3></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Test</th><th class="num">0′</th><th class="num">1′</th><th class="num">2′</th><th class="num">3′</th><th class="num">−50%</th></tr></thead>
            <tbody>
              @for (r of rows(); track r.a.id) {
                <tr>
                  <td><a [routerLink]="['/assessment', r.a.id]">{{ kinds[r.a.kind] }}</a><br /><small class="faint mono">{{ r.a.climbing!.date | datePl }}</small></td>
                  @for (p of r.rec.points; track p.elapsedSeconds) { <td class="num">{{ p.pump ?? '–' }}</td> }
                  <td class="num" [class.trend-worse]="r.rec.halfRecovery === 'not_reached'">{{ r.rec.halfRecovery === 'reached' ? r.rec.halfRecoverySeconds! / 60 + ' min' : r.rec.halfRecovery === 'not_reached' ? '> 3 min' : '–' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (trendText()) { <p class="note info">{{ trendText() }}</p> }
      </section>
    }

    <app-chart-panel question="Czy pompowanie narasta wolniej z drogi na drogę?" hint="Pompowanie po każdej próbie testu dróg – niższa i bardziej płaska linia oznacza lepszą tolerancję zmęczenia."
      [config]="attemptChart()" emptyText="Brak testu dróg z oceną pompowania." />
  `,
  styleUrl: './progress-tabs.scss',
})
export class TabRecovery {
  readonly cur = input.required<CompletedWorkout[]>();
  readonly prev = input<CompletedWorkout[] | null>(null);
  readonly assessments = input.required<Assessment[]>();
  readonly target = input(4);
  readonly rangeLabel = input('');

  protected readonly kinds = KIND_LABELS;
  protected readonly pumpChart = computed(() => aerobicPumpChart(this.cur(), this.target()));
  protected readonly curveChart = computed(() => recoveryCurveChart(this.assessments()));
  protected readonly attemptChart = computed(() => pumpByAttemptChart(this.assessments()));

  protected readonly rows = computed(() =>
    this.assessments().filter((a) => a.climbing?.status === 'completed').map((a) => ({ a, rec: climbingResults(a.climbing!).recovery })),
  );

  protected readonly pumpAnswer = computed(() => {
    const s = periodSummary(this.cur());
    if (s.avgPumpB == null) return null;
    return s.avgPumpB <= this.target()
      ? `Średnio ${s.avgPumpB}/10 – w strefie tlenowej (cel ≤ ${this.target()}).`
      : `Średnio ${s.avgPumpB}/10 – powyżej celu ${this.target()}. Wydłuż przerwy albo obniż trudność dróg B.`;
  });

  /** Porównanie pierwszego i ostatniego testu – każdy punkt krzywej osobno */
  protected readonly trendText = computed(() => {
    const r = this.rows();
    if (r.length < 2) return null;
    const a = r[0].rec.points;
    const b = r[r.length - 1].rec.points;
    const parts = a.map((p, i) => (p.pump != null && b[i].pump != null ? b[i].pump! - p.pump : null));
    if (parts.every((x) => x == null)) return null;
    const better = parts.filter((x) => x != null && x < 0).length;
    const worse = parts.filter((x) => x != null && x > 0).length;
    return `Od pierwszego do ostatniego testu: pompowanie niższe w ${better} z 4 punktów krzywej${worse ? `, wyższe w ${worse}` : ''}.`;
  });

  protected readonly metrics = computed<MetricItem[]>(() => {
    const s = periodSummary(this.cur());
    const p = this.prev() ? periodSummary(this.prev()!) : null;
    const b = delta(s.avgPumpB, p ? p.avgPumpB : null, true);
    const c = delta(s.avgMaxPumpC, p ? p.avgMaxPumpC : null, true);
    const last = this.rows().at(-1)?.rec;
    const r = this.rangeLabel();
    return [
      { label: 'Pompowanie – B', value: s.avgPumpB != null ? String(s.avgPumpB) : '–', unit: '/10', change: changeText(b, '', r), trend: b.trend },
      { label: 'Maks. pompa – C', value: s.avgMaxPumpC != null ? String(s.avgMaxPumpC) : '–', unit: '/10', change: changeText(c, '', r), trend: c.trend },
      { label: 'Pompa 3′ (ost. test)', value: last?.points[3].pump != null ? String(last.points[3].pump) : '–', unit: '/10' },
      { label: 'Spadek o 50%', value: last ? (last.halfRecovery === 'reached' ? `${last.halfRecoverySeconds! / 60}` : last.halfRecovery === 'not_reached' ? '> 3' : '–') : '–', unit: 'min' },
    ];
  });
}
