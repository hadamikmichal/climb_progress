import { Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CompletedWorkout } from '../../core/models/models';
import { Assessment } from '../../core/models/assessment';
import { hangKey, hangSeries } from '../../core/logic/stats';
import { delta, periodSummary } from '../../core/logic/analytics';
import { formatLoad } from '../../core/logic/progression';
import { GRIP_LABELS } from '../../core/logic/templates';
import { strengthResults } from '../../core/logic/assessment/scoring';
import { fingerTrendChart } from '../assessment/assessment-charts';
import { ChartPanel } from './chart-panel';
import { MetricItem, MetricRow } from './metric-row';
import { dm, hangLoadChart, hangVolumeChart } from './progress-charts';
import { changeText } from './progress-format';

const kg = (n: number) => formatLoad({ addedKg: Math.max(0, n), assistKg: Math.max(0, -n) });
const r1 = (n: number | null) => (n == null ? '–' : String(Math.round(n * 10) / 10));

/** Progres › Siła palców: Max Hangs z treningu B + Max Finger Strength z testów */
@Component({
  selector: 'app-tab-fingers',
  imports: [RouterLink, ChartPanel, MetricRow],
  template: `
    <app-metric-row [items]="metrics()" />

    @if (!grips().length && !tests().length) {
      <p class="empty-block">Brak pomiarów siły palców. Pojawią się po pierwszym treningu B (Max Hangs) albo po dniu 1 Baseline Test.</p>
    } @else {
      <app-chart-panel question="Czy rośnie obciążenie na tej samej krawądce?" hint="Max Hangs z treningu B. Każda krawądka i chwyt osobno – wyniki z różnych krawądek nie są porównywane."
        [config]="loadChart()" [answer]="loadAnswer()" emptyText="Brak zwisów w wybranym zakresie.">
        @if (grips().length > 1) {
          <div class="chips" role="radiogroup" aria-label="Krawądka i chwyt">
            @for (g of grips(); track g.key) {
              <button type="button" role="radio" [attr.aria-checked]="selKey() === g.key" [class.on]="selKey() === g.key" (click)="gripKey.set(g.key)">{{ g.label }}</button>
            }
          </div>
        }
      </app-chart-panel>

      <app-chart-panel question="Ile pracy wykonały palce?" hint="Serie zwisów w kolejnych tygodniach – progres obciążenia ma sens tylko przy regularnej objętości."
        [config]="volumeChart()" [height]="160" emptyText="Brak zwisów w wybranym zakresie." />

      <app-chart-panel question="Jak zmienia się Max Hang 5 s w testach?" hint="Baseline Test i retesty – obciążenie całkowite (masa ciała z dnia testu + ciężar) i dodatkowe."
        [config]="testChart()" emptyText="Brak zmierzonego Max Hang – wykonaj dzień 1 Baseline Test.">
        @if (tests().length) {
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Test</th><th class="num">Dodatk.</th><th class="num">Całk.</th><th class="num">% m.c.</th><th class="num">9c</th></tr></thead>
              <tbody>
                @for (t of tests(); track t.a.id) {
                  <tr>
                    <td><a class="mono nowrap" [routerLink]="['/assessment', t.a.id]">{{ dm(t.a.strength!.date) }}</a><br /><small class="muted">{{ t.a.strength!.maxFingerStrength.edgeDepthMm ?? '?' }} mm · half crimp</small></td>
                    <td class="num">{{ t.r.finger.addedWeightKg != null ? (t.r.finger.assistanceKg ? '−' + t.r.finger.assistanceKg : '+' + t.r.finger.addedWeightKg) + ' kg' : '–' }}</td>
                    <td class="num">{{ t.r.finger.totalLoadKg != null ? r1(t.r.finger.totalLoadKg) + ' kg' : '–' }}</td>
                    <td class="num">{{ t.r.finger.bodyMassRatioPercent != null ? r1(t.r.finger.bodyMassRatioPercent) + '%' : '–' }}</td>
                    <td class="num">{{ t.r.finger.score != null ? t.r.finger.score + '/10' : 'NT' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </app-chart-panel>

      @if (grips().length) {
        <section class="section">
          <div class="section-head"><h3>Krawądki i chwyty</h3><span class="eyebrow">{{ grips().length }}</span></div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Krawądka · chwyt</th><th class="num">Sesje</th><th class="num">Start</th><th class="num">Ost.</th><th class="num">Max</th></tr></thead>
              <tbody>
                @for (g of grips(); track g.key) {
                  <tr>
                    <td>{{ g.edge }}<br /><small class="muted">{{ g.gripLabel }}</small></td><td class="num">{{ g.points.length }}</td><td class="num">{{ kg(g.first) }}</td>
                    <td class="num" [class.trend-better]="g.last > g.first" [class.trend-worse]="g.last < g.first">{{ kg(g.last) }}</td>
                    <td class="num">{{ kg(g.best) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (painCount()) { <p class="note warn">Ból zgłoszony w {{ painCount() }} {{ painCount() === 1 ? 'sesji' : 'sesjach' }} – punkty oznaczone na wykresie pomarańczowo.</p> }
        </section>
      }
    }
  `,
  styleUrl: './progress-tabs.scss',
})
export class TabFingers {
  readonly cur = input.required<CompletedWorkout[]>();
  readonly prev = input<CompletedWorkout[] | null>(null);
  readonly assessments = input.required<Assessment[]>();
  readonly rangeLabel = input('');

  protected readonly kg = kg;
  protected readonly dm = dm;
  protected readonly r1 = r1;
  protected readonly gripKey = signal('');

  protected readonly grips = computed(() => hangSeries(this.cur().flatMap((w) => w.hangs)).map((g) => {
    const h = this.cur().flatMap((w) => w.hangs).find((x) => hangKey(x) === g.key)!;
    return { ...g, edge: `${h.edge}${h.edgeSizeMm ? ` · ${h.edgeSizeMm} mm` : ''}`, gripLabel: GRIP_LABELS[h.grip] };
  }));
  protected readonly grip = computed(() => this.grips().find((g) => g.key === this.gripKey()) ?? [...this.grips()].sort((a, b) => b.points.length - a.points.length)[0] ?? null);
  protected readonly selKey = computed(() => (this.grip() as { key: string } | null)?.key ?? null);
  protected readonly loadChart = computed(() => hangLoadChart(this.grip()));
  protected readonly loadAnswer = computed(() => {
    const g = this.grip();
    if (!g || g.points.length < 2) return g ? `Jeden zapis: ${kg(g.first)}. Trend pojawi się po kolejnej sesji.` : null;
    const d = Math.round((g.last - g.first) * 10) / 10;
    return d > 0 ? `Wzrost o ${d} kg w ${g.points.length} sesjach (${kg(g.first)} → ${kg(g.last)}).`
      : d < 0 ? `Spadek o ${-d} kg (${kg(g.first)} → ${kg(g.last)}) – sprawdź regenerację i ból.`
        : `Bez zmian (${kg(g.last)}) w ${g.points.length} sesjach.`;
  });
  protected readonly volumeChart = computed(() => hangVolumeChart(this.cur()));
  protected readonly painCount = computed(() => this.cur().filter((w) => w.hangs.some((h) => h.pain)).length);

  protected readonly tests = computed(() =>
    this.assessments().filter((a) => a.strength?.status === 'completed').map((a) => ({ a, r: strengthResults(a.strength!) })),
  );
  protected readonly testChart = computed(() => fingerTrendChart(this.assessments()));

  protected readonly metrics = computed<MetricItem[]>(() => {
    const s = periodSummary(this.cur());
    const p = this.prev() ? periodSummary(this.prev()!) : null;
    const sameGrip = p?.bestHang && s.bestHang && p.bestHang.key === s.bestHang.key;
    const best = delta(s.bestHang?.load ?? null, sameGrip ? p!.bestHang!.load : null);
    const sets = delta(s.hangSets, p ? p.hangSets : null);
    const pain = delta(s.painSessions, p ? p.painSessions : null, true);
    const lastTest = this.tests().at(-1);
    return [
      { label: 'Najlepszy Max Hang', value: s.bestHang ? kg(s.bestHang.load) : '–', change: changeText(best, 'kg', this.rangeLabel()), trend: best.trend },
      { label: 'Serie zwisów', value: String(s.hangSets), change: changeText(sets, '', this.rangeLabel()), trend: sets.trend },
      { label: 'Sesje z bólem', value: String(s.painSessions), change: changeText(pain, '', this.rangeLabel()), trend: pain.trend },
      { label: 'Finger 9c (ost. test)', value: lastTest?.r.finger.score != null ? `${lastTest.r.finger.score}` : '–', unit: '/10' },
    ];
  });
}
