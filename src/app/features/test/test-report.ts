import { Component, computed, inject, input } from '@angular/core';
import { resolvedTheme } from '../../shared/theme';
import { Router, RouterLink } from '@angular/router';
import type { ChartConfiguration } from 'chart.js';
import { AppStore } from '../../core/data/store';
import { TestResult } from '../../core/models/models';
import { compareTests, RESERVE_LABELS, summarizeTest } from '../../core/logic/reports';
import { formatLoad } from '../../core/logic/progression';
import { GRIP_LABELS, TYPE_SHORT } from '../../core/logic/templates';
import { isPending } from '../../core/logic/scheduling';
import { ChartView } from '../../shared/chart';
import { DatePlPipe } from '../../shared/pipes';

const css = (n: string, f: string) => (typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(n).trim() : '') || f;

/** Raport testu 3 × 6a + bezpośrednie porównanie z testem początkowym i poprzednim */
@Component({
  selector: 'app-test-report',
  imports: [RouterLink, ChartView, DatePlPipe],
  template: `
    <div class="page">
      @if (test(); as t) {
        @let s = summary()!;
        <header class="page-head">
          <div>
            <div class="eyebrow">{{ t.date | datePl }} · {{ cycleName() }}</div>
            <h1>Raport: {{ title() }}</h1>
          </div>
          <a class="btn sm" routerLink="/history">Historia</a>
        </header>

        <section class="card hero">
          <div class="grid-2 grid-md-3">
            <div class="stat"><span class="value">{{ s.completed }}/{{ s.total }}</span><span class="label">ukończone drogi</span></div>
            <div class="stat"><span class="value">{{ s.maxPump ?? '–' }}<small>/10</small></span><span class="label">maks. pompowanie</span></div>
            <div class="stat"><span class="value">{{ s.avgRpe ?? '–' }}</span><span class="label">średnie RPE</span></div>
            <div class="stat"><span class="value">{{ s.reserve ?? '–' }}<small>/5</small></span><span class="label">rezerwa siłowa{{ s.reserve ? ': ' + reserveLabels[s.reserve] : '' }}</span></div>
            @if (s.techniqueDegradedFrom) {
              <div class="stat"><span class="value">{{ s.techniqueDegradedFrom }}.</span><span class="label">droga, na której technika zaczęła się pogarszać</span></div>
            }
            @if (s.cruxRate != null) {
              <div class="stat"><span class="value">{{ s.cruxRate }}%</span><span class="label">skuteczność na cruxie</span></div>
            }
          </div>
          <p class="faint">To nie jest ranking ani punktacja – to zapis aktualnej zdolności do powtarzania dróg 6a.</p>
        </section>

        <section class="card">
          <h3>Drogi</h3>
          <table class="table">
            <thead><tr><th>#</th><th>Wycena</th><th>Ukończona</th><th class="num">RPE</th><th class="num">Pompa</th><th>Technika</th></tr></thead>
            <tbody>
              @for (r of t.routes; track r.order) {
                <tr>
                  <td>{{ r.order }}</td><td>{{ r.grade }}</td><td>{{ r.completed ? 'tak' : 'nie' }}</td>
                  <td class="num">{{ r.rpe ?? '–' }}</td><td class="num">{{ r.pump ?? '–' }}</td><td>{{ r.techniqueDegraded ? 'pogorszenie' : 'ok' }}</td>
                </tr>
                @if (r.notes) { <tr><td></td><td colspan="5" class="faint">{{ r.notes }}</td></tr> }
              }
            </tbody>
          </table>
          @if (hang(); as h) {
            <p class="muted">Zwis kontrolny: {{ h.edge }} · {{ gripLabels[h.grip] }} · {{ h.hangSec }} s · {{ fmtLoad(h) }}@if (h.rpe) { · RPE {{ h.rpe }} }</p>
          }
          @if (t.notes) { <p><strong>Notatki:</strong> {{ t.notes }}</p> }
        </section>

        @if (pumpChart(); as cfg) {
          <section class="card">
            <h3>Pompowanie po każdej z trzech dróg</h3>
            <app-chart [config]="cfg" [height]="200" label="Pompowanie po drogach testu" />
          </section>
        }

        @for (cmp of comparisons(); track cmp.label) {
          <section class="card">
            <h3>Porównanie: {{ cmp.label }}</h3>
            <table class="table">
              <thead><tr><th></th><th class="num">{{ cmp.beforeLabel }}</th><th class="num">Teraz</th></tr></thead>
              <tbody>
                @for (row of cmp.rows; track row.label) {
                  <tr>
                    <td>{{ row.label }}</td><td class="num">{{ row.before }}</td>
                    <td class="num" [class.trend-better]="row.trend === 'better'" [class.trend-worse]="row.trend === 'worse'">{{ row.after }}</td>
                  </tr>
                }
              </tbody>
            </table>
            <div class="note accent">@for (l of cmp.lines; track $index) { <p>{{ l }}</p> }</div>
          </section>
        }

        <div class="btn-row">
          @if (t.kind === 'BASELINE' && store.cycle()?.status === 'baseline') {
            <a class="btn primary big" routerLink="/">Wygeneruj plan 6-tygodniowy</a>
          }
          @if (followUp(); as f) {
            <a class="btn primary big" [routerLink]="['/session', f.id]">Teraz trening B</a>
          }
          <a class="btn big" routerLink="/progress">Progres</a>
          <button class="btn ghost" type="button" (click)="remove(t)">Usuń test</button>
        </div>
      } @else {
        <div class="card"><h2>Nie znaleziono testu</h2><a class="btn" routerLink="/history">Historia</a></div>
      }
    </div>
  `,
})
export class TestReportPage {
  protected readonly store = inject(AppStore);
  private readonly router = inject(Router);
  readonly id = input.required<string>();
  protected readonly reserveLabels = RESERVE_LABELS;
  protected readonly gripLabels = GRIP_LABELS;
  protected readonly fmtLoad = formatLoad;

  protected readonly test = computed(() => this.store.tests().find((t) => t.id === this.id()) ?? null);
  protected readonly summary = computed(() => (this.test() ? summarizeTest(this.test()!) : null));
  protected readonly title = computed(() => (this.test() ? TYPE_SHORT[this.test()!.kind] : ''));
  protected readonly cycleName = computed(() => this.store.cycles().find((c) => c.id === this.test()?.cycleId)?.name ?? '');
  protected readonly hang = computed(() => {
    const t = this.test();
    return t && 'hangboard' in t ? t.hangboard ?? null : null;
  });

  /** Testy cyklu w kolejności – oraz test końcowy poprzedniego cyklu jako punkt odniesienia */
  private readonly series = computed(() => {
    const t = this.test();
    return t ? this.store.testsFor(t.cycleId).filter((x) => x.date < t.date || (x.date === t.date && x.createdAt < t.createdAt)) : [];
  });

  protected readonly comparisons = computed(() => {
    const t = this.test();
    if (!t) return [];
    const before = this.series();
    const out: { label: string; beforeLabel: string; rows: ReturnType<typeof compareTests>['rows']; lines: string[] }[] = [];
    const baseline = before.find((x) => x.kind === 'BASELINE');
    const prev = before[before.length - 1];
    if (baseline) out.push({ label: `test początkowy (${baseline.date})`, beforeLabel: 'Początkowy', ...compareTests(baseline, t) });
    if (prev && prev !== baseline) out.push({ label: `${TYPE_SHORT[prev.kind].toLowerCase()} (${prev.date})`, beforeLabel: 'Poprzedni', ...compareTests(prev, t) });
    if (!baseline && t.kind === 'BASELINE') {
      // Nowy cykl – porównanie z testem końcowym poprzedniego cyklu
      const prevFinal = this.store.tests().filter((x) => x.kind === 'FINAL' && x.cycleId !== t.cycleId && x.date <= t.date).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      if (prevFinal) out.push({ label: `test końcowy poprzedniego cyklu (${prevFinal.date})`, beforeLabel: 'Poprz. cykl', ...compareTests(prevFinal, t) });
    }
    return out;
  });

  protected readonly pumpChart = computed<ChartConfiguration | null>(() => {
    const t = this.test();
    if (!t) return null;
    const list: TestResult[] = [...this.series(), t];
    resolvedTheme();
    // najstarszy → bieżący test: neutral, odniesienie, Glacier, Moss
    const palette = [css('--color-chart-neutral', 'rgba(125, 141, 135, 0.42)'), css('--color-chart-reference', '#7d8d87'), css('--color-chart-secondary', '#79c7c0'), css('--color-chart-primary', '#a8d66d')];
    return {
      type: 'line',
      data: {
        labels: ['Droga 1', 'Droga 2', 'Droga 3'],
        datasets: list.slice(-4).map((x, i, arr) => ({
          label: `${TYPE_SHORT[x.kind]} ${x.date.slice(5)}`,
          data: [0, 1, 2].map((k) => x.routes.find((r) => r.order === k + 1)?.pump ?? null),
          borderColor: palette[palette.length - arr.length + i],
          backgroundColor: palette[palette.length - arr.length + i],
          borderWidth: x === t ? 3 : 2,
          tension: 0.2,
        })),
      },
      options: { scales: { y: { min: 0, max: 10, ticks: { stepSize: 2 } } } },
    };
  });

  /** Po teście kontrolnym – zaplanowany na ten sam dzień trening B */
  protected readonly followUp = computed(() => {
    const t = this.test();
    if (!t || t.kind !== 'CONTROL') return null;
    return this.store.cyclePlanned().find((p) => p.type === 'B' && isPending(p.status) && p.date >= t.date && p.date <= this.store.today()) ?? null;
  });

  protected async remove(t: TestResult) {
    if (!confirm('Usunąć ten test? Tej operacji nie można cofnąć.')) return;
    await this.store.deleteTest(t.id);
    void this.router.navigate(['/history']);
  }
}
