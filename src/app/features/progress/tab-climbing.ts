import { Component, computed, input } from '@angular/core';
import { CompletedWorkout } from '../../core/models/models';
import { ascentBreakdown, delta, gradeLabel, gradeProjects, periodSummary } from '../../core/logic/analytics';
import { ChartPanel } from './chart-panel';
import { MetricItem, MetricRow } from './metric-row';
import { dm, hardestChart, hardRateChart } from './progress-charts';
import { changeText } from './progress-format';

/** Progres › Wspinanie: najtrudniejsze przejścia, skuteczność prób, OS/Flash/RP, projekty */
@Component({
  selector: 'app-tab-climbing',
  imports: [ChartPanel, MetricRow],
  template: `
    <app-metric-row [items]="metrics()" />

    @if (!cur().length) {
      <p class="empty-block">Brak treningów w wybranym zakresie. Trudne drogi zapisujesz w treningu A.</p>
    } @else {
      <app-chart-panel question="Czy rośnie najtrudniejsza ukończona droga?" hint="Najwyższa ukończona wycena w każdym tygodniu (wszystkie treningi, bez rozgrzewki)."
        [config]="hardest()" [answer]="hardestAnswer()" emptyText="Brak ukończonych dróg w wybranym zakresie." />

      <app-chart-panel question="Jaka część trudnych prób kończy się przejściem?" hint="Próby z treningu A (trudne drogi i cruxy) w tygodniach."
        [config]="rate()" emptyText="Brak trudnych prób (trening A) w wybranym zakresie." />

      <section class="section">
        <div class="section-head"><h3>Jak przechodzisz trudne drogi?</h3><span class="eyebrow">{{ ascents().total }} przejść</span></div>
        @if (ascents().total) {
          <ul class="bars">
            @for (b of ascentBars(); track b.key) {
              <li><span class="lbl">{{ b.label }}</span><span class="track"><span class="fill" [class.faint]="b.key === 'unknown'" [style.width.%]="b.pct"></span></span><span class="n">{{ b.n }}</span></li>
            }
          </ul>
          @if (ascents().unknown === ascents().total) {
            <p class="faint small">Styl przejścia (OS / Flash / RP) nie był jeszcze zapisywany – zaznaczaj go przy ukończonej trudnej drodze w treningu A.</p>
          }
        } @else {
          <p class="empty">Brak ukończonych trudnych dróg w wybranym zakresie.</p>
        }
      </section>

      <section class="section">
        <div class="section-head"><h3>Projekty wg wyceny</h3><span class="eyebrow">trening A</span></div>
        @if (projects().length) {
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Wycena</th><th class="num">Próby</th><th class="num">Przejścia</th><th>Pierwsze przejście</th><th class="num">Ost. próba</th></tr></thead>
              <tbody>
                @for (p of projects(); track p.grade) {
                  <tr>
                    <td class="mono"><strong>{{ p.grade }}</strong></td>
                    <td class="num">{{ p.attempts }}</td>
                    <td class="num">{{ p.sends }}</td>
                    <td>@if (p.firstSend) { <span class="mono">{{ dm(p.firstSend) }}</span> <small class="faint">· {{ p.attemptsToFirstSend }}. próba</small> } @else { <span class="faint">w projekcie</span> }</td>
                    <td class="num">{{ dm(p.lastAttempt) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="faint small">Aplikacja nie zapisuje nazw dróg – projekty są grupowane po wycenie.</p>
        } @else {
          <p class="empty">Brak trudnych prób w wybranym zakresie.</p>
        }
      </section>
    }
  `,
  styleUrl: './progress-tabs.scss',
})
export class TabClimbing {
  readonly cur = input.required<CompletedWorkout[]>();
  readonly prev = input<CompletedWorkout[] | null>(null);
  readonly rangeLabel = input('');

  protected readonly dm = dm;
  protected readonly hardest = computed(() => hardestChart(this.cur()));
  protected readonly rate = computed(() => hardRateChart(this.cur()));
  protected readonly ascents = computed(() => ascentBreakdown(this.cur()));
  protected readonly projects = computed(() => gradeProjects(this.cur()));
  protected readonly ascentBars = computed(() => {
    const a = this.ascents();
    const max = Math.max(1, a.onsight, a.flash, a.redpoint, a.unknown);
    return [
      { key: 'onsight', label: 'OS', n: a.onsight },
      { key: 'flash', label: 'Flash', n: a.flash },
      { key: 'redpoint', label: 'RP', n: a.redpoint },
      { key: 'unknown', label: 'B/d', n: a.unknown },
    ].map((b) => ({ ...b, pct: (b.n / max) * 100 }));
  });

  protected readonly hardestAnswer = computed(() => {
    const s = periodSummary(this.cur());
    const p = this.prev() ? periodSummary(this.prev()!) : null;
    const g = gradeLabel(s.hardestIndex);
    if (!g) return null;
    if (p?.hardestIndex == null) return `Najtrudniej w zakresie: ${g}.`;
    const d = s.hardestIndex! - p.hardestIndex;
    return d > 0 ? `${g} – o ${d} ${d === 1 ? 'stopień' : 'stopnie'} wyżej niż w poprzednim okresie (${gradeLabel(p.hardestIndex)}).`
      : d < 0 ? `${g} – niżej niż w poprzednim okresie (${gradeLabel(p.hardestIndex)}).` : `${g} – tak samo jak w poprzednim okresie.`;
  });

  protected readonly metrics = computed<MetricItem[]>(() => {
    const s = periodSummary(this.cur());
    const p = this.prev() ? periodSummary(this.prev()!) : null;
    const hi = delta(s.hardestIndex, p ? p.hardestIndex : null);
    const rate = delta(s.hardSendRate, p ? p.hardSendRate : null);
    const att = delta(s.hardAttempts, p ? p.hardAttempts : null);
    const a = this.ascents();
    const r = this.rangeLabel();
    return [
      { label: 'Najtrudniejsza', value: gradeLabel(s.hardestIndex) ?? '–', change: hi.change != null ? changeText(hi, hi.change === 1 || hi.change === -1 ? 'stopień' : 'st.', r) : changeText(hi, '', r), trend: hi.trend },
      { label: 'Skuteczność prób', value: s.hardSendRate != null ? String(s.hardSendRate) : '–', unit: '%', change: changeText(rate, 'pp', r), trend: rate.trend },
      { label: 'Trudne próby', value: String(s.hardAttempts), change: changeText(att, '', r), trend: att.trend },
      { label: 'OS · Flash · RP', value: `${a.onsight}·${a.flash}·${a.redpoint}` },
    ];
  });
}
