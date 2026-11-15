import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AppStore } from '../../core/data/store';
import { addDays, diffDays, startOfWeek, WEEKDAY_NAMES, weekdayOf } from '../../core/logic/dates';
import { cycleWeek, isDeloadWeek, stageLabel } from '../../core/logic/plan';
import { prescriptionLines } from '../../core/logic/describe';
import { PlannedCard } from './planned-card';
import { DatePlPipe } from '../../shared/pipes';
import { Icon } from '../../shared/icon';
import { isPending, slotViolations } from '../../core/logic/scheduling';
import { isHeavy, TEMPLATES } from '../../core/logic/templates';
import { WEEKDAY_SHORT } from '../../core/logic/dates';

@Component({
  selector: 'app-plan',
  imports: [PlannedCard, DatePlPipe, RouterLink, Icon],
  template: `
    <div class="page">
      @let c = store.cycle();
      <header class="page-head">
        <div>
          <span class="eyebrow">Plan treningowy@if (c) { · {{ c.name }} }</span>
          <h1>{{ title() }}</h1>
          @if (c) { <span class="eyebrow">{{ stage() }} · {{ weekStart() | datePl }} – {{ weekEnd() | datePl }}</span> }
        </div>
        <div class="weeknav">
          <button class="btn" type="button" (click)="shift(-1)" aria-label="Poprzedni tydzień"><app-icon name="chevron-left" /></button>
          <button class="btn" type="button" (click)="offset.set(0)" [disabled]="offset() === 0">Dziś</button>
          <button class="btn" type="button" (click)="shift(1)" aria-label="Następny tydzień"><app-icon name="chevron-right" /></button>
        </div>
      </header>

      @if (!c) {
        <p class="empty">Brak aktywnego cyklu. <a routerLink="/">Rozpocznij cykl</a> od Baseline Test.</p>
      } @else {
        @if (deload()) {
          <div class="note warn">Tydzień deload: mniej serii zwisów, dróg i obwodów. Sesje deload nie wpływają na progresję.</div>
        }
        @if (conflictCount()) {
          <div class="note warn"><strong>{{ conflictCount() }} {{ conflictCount() === 1 ? 'konflikt' : 'konflikty' }} w tym tygodniu.</strong> Ciężkie jednostki dzień po dniu lub zbyt wiele dni z rzędu – przełóż lub zastąp oznaczoną sesję.</div>
        }

        <ol class="days">
          @for (d of days(); track d.date) {
            <li class="day" [class.today]="d.date === store.today()" [class.rest]="!d.items.length">
              <div class="day-label">
                <span class="mono dn">{{ d.short }}</span>
                <span class="mono dd">{{ d.dm }}</span>
              </div>
              <div class="day-body">
                @for (p of d.items; track p.id) {
                  <app-planned-card [workout]="p" />
                } @empty {
                  <div class="recovery"><span class="eyebrow">Regeneracja</span></div>
                }
              </div>
            </li>
          }
        </ol>

        <section class="section">
          <div class="section-head"><span class="eyebrow">Aktualny poziom obciążenia</span><a class="eyebrow link" routerLink="/profile">Zmień →</a></div>
          <div class="levels">
            @for (l of levelRows(); track l.code) {
              <div class="level"><span class="type-chip">{{ l.code }}</span><div class="grow"><strong>{{ l.name }}</strong>@for (x of l.lines; track x) { <span class="mono small">{{ x }}</span> }</div></div>
            }
          </div>
          <p class="faint small">Parametry zmienia moduł adaptacji (po dwóch dobrych sesjach – jeden parametr naraz) albo Ty w Profilu.</p>
        </section>

        <section class="section">
          <div class="section-head"><span class="eyebrow">Historia zmian planu</span></div>
          @for (e of events(); track e.id) {
            <p class="event" [class.warn]="e.kind === 'reduce' || e.kind === 'skip' || e.kind === 'readiness'"><span class="mono faint">{{ e.timestamp | datePl }}</span> {{ e.reason }}</p>
          } @empty { <p class="empty">Brak zmian.</p> }
          @if (store.eventsSorted().length > limit()) {
            <button class="btn ghost" type="button" (click)="limit.set(limit() + 20)">Pokaż starsze</button>
          }
        </section>
      }
    </div>
  `,
  styles: `
    .weeknav { display: flex; gap: 6px; --icon: 18px; }
    .weeknav .btn { min-width: 48px; min-height: 48px; padding: 0 12px; }
    .days { list-style: none; margin: 0; padding: 0; }
    .day { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border); }
    .day-label { display: flex; flex-direction: column; gap: 2px; padding-top: 6px; }
    .dn { text-transform: uppercase; font-weight: 600; font-size: 0.85rem; }
    .dd { font-size: 0.75rem; color: var(--muted); }
    .day.today .dn { background: var(--accent); color: var(--accent-ink); padding: 1px 6px; border-radius: 4px; align-self: flex-start; }
    .day-body { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .recovery {
      min-height: 44px; display: flex; align-items: center; padding: 0 12px; border-radius: 6px;
      background: repeating-linear-gradient(-45deg, transparent 0 6px, var(--surface-2) 6px 7px);
    }
    .levels { display: grid; gap: 12px; }
    @media (min-width: 768px) { .levels { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    .level { display: flex; gap: 12px; align-items: flex-start; }
    .level .grow { display: flex; flex-direction: column; gap: 2px; }
    .event { font-size: 0.88rem; padding: 8px 0; border-bottom: 1px solid var(--border); }
    .event.warn { box-shadow: inset 3px 0 0 var(--warn); padding-left: 10px; }
    .link { text-decoration: none; color: var(--text); }
    .small { font-size: 0.8rem; }
  `,
})
export class PlanPage {
  protected readonly store = inject(AppStore);
  protected readonly offset = signal(0);
  protected readonly limit = signal(10);

  protected readonly weekStart = computed(() => addDays(startOfWeek(this.store.today()), this.offset() * 7));
  protected readonly weekEnd = computed(() => addDays(this.weekStart(), 6));
  protected readonly cycleWeekNo = computed(() => {
    const c = this.store.cycle();
    return c ? cycleWeek(c, this.weekStart()) : 0;
  });
  protected readonly title = computed(() => {
    const c = this.store.cycle();
    const w = this.cycleWeekNo();
    if (!c || !c.planStart) return 'Ten tydzień';
    if (w === 0) return 'Przed cyklem';
    if (w > c.weeks) return 'Po cyklu';
    return `Tydzień ${w} z ${c.weeks}`;
  });
  protected readonly stage = computed(() => {
    const c = this.store.cycle();
    return c ? stageLabel(c, this.cycleWeekNo()) : '';
  });
  protected readonly deload = computed(() => {
    const c = this.store.cycle();
    return !!c && isDeloadWeek(c, this.cycleWeekNo());
  });
  protected readonly days = computed(() => {
    const items = this.store.cyclePlanned();
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(this.weekStart(), i);
      const prev = addDays(date, -1);
      const afterHeavy = items.some((p) => p.date === prev && p.status !== 'skipped' && isHeavy(p.type));
      return {
        date, name: WEEKDAY_NAMES[weekdayOf(date)], short: WEEKDAY_SHORT[weekdayOf(date)], dm: `${date.slice(8, 10)}.${date.slice(5, 7)}`,
        items: items.filter((p) => p.date === date), afterHeavy,
      };
    });
  });
  protected readonly levelRows = computed(() => {
    const c = this.store.cycle();
    if (!c) return [];
    return (['A', 'B', 'C'] as const).map((t) => ({ code: t, name: TEMPLATES[t].name, lines: prescriptionLines(t, c.params) }));
  });
  /** Liczba niezrealizowanych sesji tygodnia z konfliktem regeneracyjnym */
  protected readonly conflictCount = computed(() => {
    const all = this.store.cyclePlanned();
    return this.days().flatMap((d) => d.items)
      .filter((p) => isPending(p.status) && slotViolations(all, p.type, p.date, [p.id]).some((v) => !v.includes('jest już zaplanowany'))).length;
  });
  protected readonly events = computed(() => this.store.eventsSorted().slice(0, this.limit()));

  constructor() {
    // Gdy cykl zaczyna się w przyszłości – pokaż tydzień najbliższej jednostki
    const next = this.store.nextWorkout();
    const thisWeek = startOfWeek(this.store.today());
    if (next && next.date > addDays(thisWeek, 6)) {
      this.offset.set(Math.round(diffDays(thisWeek, startOfWeek(next.date)) / 7));
    }
  }

  protected shift(n: number) {
    this.offset.update((o) => o + n);
  }
}
