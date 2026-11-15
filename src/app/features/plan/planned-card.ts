import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PlannedWorkout } from '../../core/models/models';
import { AppStore } from '../../core/data/store';
import { prescriptionFor } from '../../core/logic/plan';
import { prescriptionLines } from '../../core/logic/describe';
import { isTest, SKIP_REASON_LABELS, STATUS_LABELS, TEMPLATES, TYPE_SHORT } from '../../core/logic/templates';
import { PART_LABELS } from '../../core/logic/assessment/labels';
import { isPending } from '../../core/logic/scheduling';
import { DatePlPipe } from '../../shared/pipes';
import { MissedSheet } from './missed-sheet';
import { MoveSheet } from './move-sheet';

/** Karta zaplanowanej jednostki – wspólna dla Dashboardu i Planu */
@Component({
  selector: 'app-planned-card',
  imports: [RouterLink, DatePlPipe, MissedSheet, MoveSheet],
  template: `
    @let p = workout();
    @let t = template();
    <article class="card" [class.hero]="hero()" [class.alert]="overdue()">
      <div class="row">
        <span class="type-chip" [class]="chipClass()">{{ t.code }}</span>
        <div class="grow">
          <div class="eyebrow">{{ p.date | datePl: 'relative' }} · {{ typeName() }}@if (deload()) { · deload }</div>
          <h2>{{ title() }}</h2>
        </div>
        <span class="badge" [class]="overdue() ? 'skipped' : p.status">{{ overdue() ? 'Zaległy' : statusLabel() }}</span>
      </div>
      @if (hero() || expanded()) {
        <p class="muted">{{ t.goal }}</p>
        <ul class="presc">@for (l of lines(); track l) { <li>{{ l }}</li> }</ul>
        <div class="row wrap">
          <span class="tag">~{{ t.durationMin }} min</span>
          <span class="tag">Intensywność: {{ t.intensity }}</span>
          @if (t.heavy) { <span class="tag">Ciężka jednostka</span> }
        </div>
        @if (!isTest() && hero()) {
          <div class="stack-sm">
            @for (e of t.exercises; track e.id) {
              <div class="ex"><strong>{{ e.name }}</strong> <span class="muted">– {{ e.description }}</span></div>
            }
          </div>
        }
      }
      @if (p.status === 'skipped') {
        <p class="note bad">Pominięty: {{ skipLabel() }}@if (p.skipNote) { – {{ p.skipNote }} }</p>
      }
      @if (p.moves.length) {
        <p class="faint small">Przełożony z {{ p.moves[0].from | datePl }}. {{ p.moves[p.moves.length - 1].reason }}</p>
      }
      @if (blocked()) {
        <p class="note info">Najpierw wykonaj test początkowy.</p>
      }
      <div class="btn-row">
        @if (pending()) {
          <a class="btn primary" [class.xl]="hero()" [class.disabled]="blocked()" [routerLink]="blocked() ? null : startLink()">
            {{ isTest() ? (resumable() ? 'Wznów test' : 'Rozpocznij test') : 'Rozpocznij trening' }}
          </a>
          @if (!isTest() && !hero()) {
            <a class="btn" [routerLink]="blocked() ? null : startLink()" [queryParams]="{ partial: 1 }">Częściowo wykonany</a>
          }
          <button class="btn" type="button" (click)="sheet.set('move')">Zmień datę</button>
          <button class="btn" type="button" (click)="sheet.set('missed')">Nie wykonam</button>
        } @else if (p.status === 'skipped') {
          <button class="btn" type="button" (click)="store.restorePlanned(p.id)">Przywróć</button>
        } @else if (p.completedWorkoutId) {
          <a class="btn" [routerLink]="resultLink()">Zobacz wynik</a>
        }
        @if (!hero()) {
          <button class="btn ghost" type="button" (click)="expanded.set(!expanded())">{{ expanded() ? 'Mniej' : 'Szczegóły' }}</button>
        }
      </div>
    </article>
    @if (sheet() === 'missed') { <app-missed-sheet [workout]="p" (closed)="sheet.set(null)" (done)="sheet.set(null)" /> }
    @if (sheet() === 'move') { <app-move-sheet [workout]="p" (closed)="sheet.set(null)" (done)="sheet.set(null)" /> }
  `,
  styles: `
    .presc { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 2px; }
    .ex { font-size: 0.9rem; }
    .small { font-size: 0.8rem; }
    a.disabled { opacity: 0.4; pointer-events: none; }
  `,
})
export class PlannedCard {
  protected readonly store = inject(AppStore);
  readonly workout = input.required<PlannedWorkout>();
  readonly hero = input(false);

  protected readonly expanded = signal(false);
  protected readonly sheet = signal<'missed' | 'move' | null>(null);

  protected readonly template = computed(() => TEMPLATES[this.workout().type]);
  protected readonly title = computed(() => {
    const p = this.workout();
    if (!p.part || p.type === 'CONTROL') return this.template().name;
    return `${this.template().name} · ${PART_LABELS[p.part]}`;
  });
  /** Sesja testu już rozpoczęta (dane zapisane) – przycisk „Wznów” */
  protected readonly resumable = computed(() => {
    const p = this.workout();
    if (!p.part || !isTest(p.type)) return false;
    const a = this.store.assessmentFor(p.cycleId, p.type);
    const s = p.part === 'strength' ? a?.strength : a?.climbing;
    return s?.status === 'in_progress';
  });
  protected readonly typeName = computed(() => TYPE_SHORT[this.workout().type]);
  protected readonly isTest = computed(() => isTest(this.workout().type));
  protected readonly pending = computed(() => isPending(this.workout().status));
  protected readonly overdue = computed(() => this.pending() && this.workout().date < this.store.today());
  protected readonly statusLabel = computed(() => STATUS_LABELS[this.workout().status]);
  protected readonly skipLabel = computed(() => (this.workout().skipReason ? SKIP_REASON_LABELS[this.workout().skipReason!] : ''));
  protected readonly chipClass = computed(() => `type-chip ${this.isTest() ? 'T' : this.workout().type}`);
  protected readonly blocked = computed(() => {
    const c = this.store.cycle();
    return !!c && c.status === 'baseline' && this.workout().type !== 'BASELINE';
  });
  protected readonly deload = computed(() => {
    const c = this.store.cycle();
    return !!c && !this.isTest() && prescriptionFor(c, this.workout().week).deload;
  });
  protected readonly lines = computed(() => {
    const c = this.store.cycles().find((x) => x.id === this.workout().cycleId);
    return c ? prescriptionLines(this.workout().type, prescriptionFor(c, this.workout().week).params, this.workout().part) : [];
  });
  protected readonly startLink = computed(() => (this.isTest() ? [this.workout().part ? '/assessment/run' : '/test', this.workout().id] : ['/session', this.workout().id]));
  protected readonly resultLink = computed(() => (this.isTest() ? [this.workout().part ? '/assessment' : '/tests', this.workout().completedWorkoutId] : ['/history', this.workout().completedWorkoutId]));
}
