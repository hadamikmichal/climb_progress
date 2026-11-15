import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PlannedWorkout } from '../../core/models/models';
import { AppStore } from '../../core/data/store';
import { prescriptionFor } from '../../core/logic/plan';
import { plannedShortName, prescriptionLines } from '../../core/logic/describe';
import { isTest, SKIP_REASON_LABELS, STATUS_LABELS, TEMPLATES } from '../../core/logic/templates';
import { isPending, slotViolations } from '../../core/logic/scheduling';
import { sessionMaxPump, sessionRpe } from '../../core/logic/progression';
import { DatePlPipe } from '../../shared/pipes';
import { Icon } from '../../shared/icon';
import { MissedSheet } from './missed-sheet';
import { MoveSheet } from './move-sheet';
import { ReplaceSheet } from './replace-sheet';

/** Wiersz zaplanowanej sesji – wspólny dla Planu i fazy testu na ekranie Dziś */
@Component({
  selector: 'app-planned-card',
  imports: [RouterLink, DatePlPipe, Icon, MissedSheet, MoveSheet, ReplaceSheet],
  template: `
    @let p = workout();
    @let t = template();
    <article class="sess" [class.hero]="hero()" [class.alert]="overdue() || conflicts().length > 0" [class.done]="p.status === 'done'" [class.skipped]="p.status === 'skipped'">
      <button type="button" class="head" (click)="expanded.set(!expanded())" [attr.aria-expanded]="open()">
        <span class="type-chip" [class.T]="isTest()">{{ t.code }}</span>
        <span class="grow title">
          <span class="name">{{ name() }}</span>
          <span class="meta mono">~{{ t.durationMin }} min@if (deload()) { · deload }@if (t.heavy) { · ciężka }</span>
        </span>
        <span class="badge" [class]="overdue() ? 'skipped' : p.status">{{ overdue() ? 'Zaległa' : statusLabel() }}</span>
      </button>

      @for (v of conflicts(); track v) { <p class="conflict"><app-icon name="alert" /> {{ v }}</p> }

      @if (open()) {
        <div class="body">
          <p class="muted">{{ t.goal }}</p>
          <ol class="lines mono">@for (l of lines(); track l) { <li>{{ l }}</li> }</ol>
          @if (prev(); as pv) {
            <a class="prev" [routerLink]="['/history', pv.w.id]"><span class="eyebrow">Poprzednio · {{ pv.w.date | datePl }}</span><span class="mono">RPE {{ pv.rpe ?? '–' }} · pompa {{ pv.pump ?? '–' }}/10@if (pv.w.completion === 'partial') { · częściowo }</span></a>
          }
          @if (p.status === 'skipped') { <p class="note warn">Pominięta: {{ skipLabel() }}@if (p.skipNote) { – {{ p.skipNote }} }</p> }
          @if (p.moves.length) { <p class="faint small">Przełożona z {{ p.moves[0].from | datePl }}. {{ p.moves[p.moves.length - 1].reason }}</p> }
          @if (blocked()) { <p class="note info">Najpierw wykonaj Baseline Test.</p> }

          <div class="actions">
            @if (pending()) {
              <a class="btn primary" [class.big]="hero()" [class.disabled]="blocked()" [routerLink]="blocked() ? null : startLink()"><app-icon name="play" /> {{ isTest() ? (resumable() ? 'Wznów test' : 'Rozpocznij test') : 'Rozpocznij' }}</a>
              <button class="btn" type="button" (click)="sheet.set('move')"><app-icon name="move" /> Przełóż</button>
              <button class="btn" type="button" (click)="sheet.set('missed')"><app-icon name="missed" /> Pomiń</button>
              @if (!isTest()) {
                <a class="btn" [class.disabled]="blocked()" [routerLink]="blocked() ? null : startLink()" [queryParams]="{ partial: 1 }"><app-icon name="flag" /> Częściowo</a>
                <button class="btn" type="button" (click)="sheet.set('replace')"><app-icon name="swap" /> Zastąp</button>
              }
            } @else if (p.status === 'skipped') {
              <button class="btn" type="button" (click)="store.restorePlanned(p.id)"><app-icon name="reset" /> Przywróć</button>
            } @else if (p.completedWorkoutId) {
              <a class="btn" [routerLink]="resultLink()">Zobacz wynik <app-icon name="arrow-right" /></a>
            }
          </div>
        </div>
      }
    </article>
    @if (sheet() === 'missed') { <app-missed-sheet [workout]="p" (closed)="sheet.set(null)" (done)="sheet.set(null)" /> }
    @if (sheet() === 'move') { <app-move-sheet [workout]="p" (closed)="sheet.set(null)" (done)="sheet.set(null)" /> }
    @if (sheet() === 'replace') { <app-replace-sheet [workout]="p" (closed)="sheet.set(null)" (done)="sheet.set(null)" /> }
  `,
  styles: `
    .sess { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); overflow: hidden; }
    .sess.hero { border-color: var(--border-strong); }
    .sess.alert { border-color: var(--warn); box-shadow: inset 3px 0 0 var(--warn); }
    .sess.done .name { color: var(--muted); }
    .sess.skipped .name { text-decoration: line-through; color: var(--muted); }
    .head { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 64px; padding: 10px 14px; border: 0; background: none; color: inherit; text-align: left; font: inherit; cursor: pointer; }
    .title { display: flex; flex-direction: column; gap: 2px; }
    .name { font-family: var(--font-heading); font-weight: 700; text-transform: uppercase; letter-spacing: 0.01em; font-size: 0.95rem; }
    .meta { font-size: 0.75rem; color: var(--muted); }
    .conflict { display: flex; gap: 8px; align-items: flex-start; margin: 0 14px 10px; font-size: 0.82rem; color: var(--text); --icon: 16px; }
    .conflict app-icon { color: var(--warn); margin-top: 2px; }
    .body { display: flex; flex-direction: column; gap: 12px; padding: 0 14px 14px; animation: fade 160ms var(--ease); }
    .lines { margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--border); font-size: 0.82rem; }
    .lines li { padding: 8px 0; border-bottom: 1px solid var(--border); }
    .prev { display: flex; flex-direction: column; gap: 2px; padding: 8px 12px; border-left: 3px solid var(--border); text-decoration: none; font-size: 0.85rem; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; }
    .actions .btn { flex: 1 1 auto; --icon: 16px; }
    .actions .btn.primary { flex-basis: 100%; }
    .small { font-size: 0.8rem; }
  `,
})
export class PlannedCard {
  protected readonly store = inject(AppStore);
  readonly workout = input.required<PlannedWorkout>();
  readonly hero = input(false);

  protected readonly expanded = signal(false);
  protected readonly sheet = signal<'missed' | 'move' | 'replace' | null>(null);
  protected readonly open = computed(() => this.hero() || this.expanded());

  protected readonly template = computed(() => TEMPLATES[this.workout().type]);
  protected readonly name = computed(() => plannedShortName(this.workout()));
  protected readonly isTest = computed(() => isTest(this.workout().type));
  protected readonly pending = computed(() => isPending(this.workout().status));
  protected readonly overdue = computed(() => this.pending() && this.workout().date < this.store.today());
  protected readonly statusLabel = computed(() => STATUS_LABELS[this.workout().status]);
  protected readonly skipLabel = computed(() => (this.workout().skipReason ? SKIP_REASON_LABELS[this.workout().skipReason!] : ''));
  /** Konflikty z ciężkimi jednostkami / limitem dni z rzędu (tylko dla niezrealizowanych) */
  protected readonly conflicts = computed(() => {
    const p = this.workout();
    if (!this.pending()) return [];
    return slotViolations(this.store.cyclePlanned(), p.type, p.date, [p.id]).filter((v) => !v.includes('jest już zaplanowany'));
  });
  protected readonly resumable = computed(() => {
    const p = this.workout();
    if (!p.part || !isTest(p.type)) return false;
    const a = this.store.assessmentFor(p.cycleId, p.type);
    const s = p.part === 'strength' ? a?.strength : a?.climbing;
    return s?.status === 'in_progress';
  });
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
  /** Poprzednia sesja tego samego typu – kontekst przed startem */
  protected readonly prev = computed(() => {
    const p = this.workout();
    if (this.isTest()) return null;
    const w = this.store.completedSorted().find((x) => x.type === p.type && x.date < p.date && x.plannedWorkoutId !== p.id);
    return w ? { w, rpe: sessionRpe(w), pump: sessionMaxPump(w) } : null;
  });
  protected readonly startLink = computed(() => (this.isTest() ? [this.workout().part ? '/assessment/run' : '/test', this.workout().id] : ['/session', this.workout().id]));
  protected readonly resultLink = computed(() => (this.isTest() ? [this.workout().part ? '/assessment' : '/tests', this.workout().completedWorkoutId] : ['/history', this.workout().completedWorkoutId]));
}
