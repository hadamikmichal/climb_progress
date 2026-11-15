import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AppStore } from '../../core/data/store';
import { addDays, diffDays, startOfWeek, WEEKDAY_NAMES, weekdayOf } from '../../core/logic/dates';
import { cycleWeek, isDeloadWeek, stageLabel } from '../../core/logic/plan';
import { prescriptionLines } from '../../core/logic/describe';
import { PlannedCard } from './planned-card';
import { DatePlPipe } from '../../shared/pipes';

@Component({
  selector: 'app-plan',
  imports: [PlannedCard, DatePlPipe, RouterLink],
  template: `
    <div class="page">
      @let c = store.cycle();
      <header class="page-head">
        <div>
          <div class="eyebrow">Plan treningowy@if (c) { · {{ c.name }} }</div>
          <h1>{{ title() }}</h1>
          @if (c) { <p class="muted">{{ stage() }} · {{ weekStart() | datePl }} – {{ weekEnd() | datePl }}</p> }
        </div>
        <div class="row">
          <button class="btn" type="button" (click)="shift(-1)" aria-label="Poprzedni tydzień">‹</button>
          <button class="btn" type="button" (click)="offset.set(0)">Dziś</button>
          <button class="btn" type="button" (click)="shift(1)" aria-label="Następny tydzień">›</button>
        </div>
      </header>

      @if (!c) {
        <div class="card"><p>Brak aktywnego cyklu. <a routerLink="/">Rozpocznij cykl</a> od testu początkowego.</p></div>
      } @else {
        @if (deload()) {
          <div class="note warn">Tydzień deload: mniejsza objętość (mniej serii zwisów, dróg i obwodów). Sesje deload nie wpływają na progresję.</div>
        }
        <div class="stack">
          @for (d of days(); track d.date) {
            <section class="day" [class.today]="d.date === store.today()">
              <div class="day-head">
                <strong>{{ d.name }}</strong>
                <span class="muted">{{ d.date | datePl }}</span>
                @if (d.date === store.today()) { <span class="badge accent plain">dziś</span> }
              </div>
              @for (p of d.items; track p.id) {
                <app-planned-card [workout]="p" />
              } @empty {
                <p class="rest">Odpoczynek</p>
              }
            </section>
          }
        </div>

        <section class="card">
          <h3>Aktualny poziom obciążenia</h3>
          <div class="grid-md-3">
            <div class="stack-sm"><strong>A – trudne drogi</strong>@for (l of levels().A; track l) { <small>{{ l }}</small> }</div>
            <div class="stack-sm"><strong>B – Max Hangs + tlenowa</strong>@for (l of levels().B; track l) { <small>{{ l }}</small> }</div>
            <div class="stack-sm"><strong>C – wytrzymałość siłowa</strong>@for (l of levels().C; track l) { <small>{{ l }}</small> }</div>
          </div>
          <p class="faint">Parametry zmienia moduł adaptacji (po dwóch dobrych sesjach – jeden parametr naraz) lub Ty w Profilu.</p>
        </section>

        <section class="card">
          <h3>Historia zmian planu</h3>
          @for (e of events(); track e.id) {
            <div class="note" [class.ok]="e.kind === 'progress'" [class.warn]="e.kind === 'reduce' || e.kind === 'readiness'" [class.info]="e.kind === 'reschedule'" [class.bad]="e.kind === 'skip'">
              <small class="faint">{{ e.timestamp | datePl }}</small>
              <p>{{ e.reason }}</p>
            </div>
          } @empty { <p class="empty">Brak zmian.</p> }
          @if (store.eventsSorted().length > limit()) {
            <button class="btn ghost" type="button" (click)="limit.set(limit() + 20)">Pokaż starsze</button>
          }
        </section>
      }
    </div>
  `,
  styles: `
    .day { display: flex; flex-direction: column; gap: 8px; }
    .day-head { display: flex; align-items: baseline; gap: 10px; padding: 0 4px; }
    .day.today .day-head strong { color: var(--accent); }
    .rest { color: var(--faint); font-size: 0.88rem; padding: 10px 14px; border: 1px dashed var(--border); border-radius: var(--radius); }
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
      return { date, name: WEEKDAY_NAMES[weekdayOf(date)], items: items.filter((p) => p.date === date) };
    });
  });
  protected readonly levels = computed(() => {
    const c = this.store.cycle();
    if (!c) return { A: [] as string[], B: [] as string[], C: [] as string[] };
    return { A: prescriptionLines('A', c.params), B: prescriptionLines('B', c.params), C: prescriptionLines('C', c.params) };
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
