import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlannedWorkout, SkipReason } from '../../core/models/models';
import { AppStore } from '../../core/data/store';
import { MissedDecision } from '../../core/logic/scheduling';
import { SKIP_REASON_LABELS, TYPE_SHORT } from '../../core/logic/templates';
import { Sheet } from '../../shared/sheet';
import { DatePlPipe } from '../../shared/pipes';

/** Przypadek B – pytanie o powód i decyzja: przełożenie lub pominięcie */
@Component({
  selector: 'app-missed-sheet',
  imports: [Sheet, FormsModule, DatePlPipe],
  template: `
    <app-sheet [title]="'Nie wykonam: ' + typeName()" (closed)="closed.emit()">
      <p class="muted">{{ typeName() }} · {{ workout().date | datePl }}. Dlaczego trening się nie odbędzie?</p>
      <div class="stack-sm">
        @for (r of reasons; track r) {
          <button type="button" class="btn big block" [class.primary]="reason() === r" (click)="pick(r)">{{ labels[r] }}</button>
        }
      </div>
      @if (decision(); as d) {
        <div class="note" [class.info]="d.action === 'reschedule'" [class.warn]="d.action === 'skip'">
          <p>{{ d.explanation }}</p>
          @if (d.action === 'skip') {
            <ul class="advice">@for (a of d.advice; track a) { <li>{{ a }}</li> }</ul>
          }
        </div>
        <label class="field">Notatka (opcjonalnie)
          <input [(ngModel)]="note" placeholder="np. wyjazd służbowy" />
        </label>
        <div class="btn-row">
          @if (d.action === 'reschedule') {
            <button class="btn primary big" type="button" (click)="apply(d)" [disabled]="busy()">Przełóż na {{ d.date | datePl }}</button>
            <button class="btn big" type="button" (click)="forceSkip()" [disabled]="busy()">Oznacz jako pominięty</button>
          } @else {
            <button class="btn primary big" type="button" (click)="apply(d)" [disabled]="busy()">Oznacz jako pominięty</button>
          }
        </div>
      }
    </app-sheet>
  `,
  styles: `.advice { margin: 8px 0 0; padding-left: 18px; color: var(--muted); font-size: 0.88rem; }`,
})
export class MissedSheet {
  private readonly store = inject(AppStore);
  readonly workout = input.required<PlannedWorkout>();
  readonly closed = output<void>();
  readonly done = output<void>();

  protected readonly reasons: SkipReason[] = ['time', 'fatigue', 'pain', 'illness', 'other'];
  protected readonly labels = SKIP_REASON_LABELS;
  protected readonly reason = signal<SkipReason | null>(null);
  protected readonly decision = signal<MissedDecision | null>(null);
  protected readonly busy = signal(false);
  protected note = '';

  protected typeName() {
    return TYPE_SHORT[this.workout().type];
  }

  protected pick(r: SkipReason) {
    this.reason.set(r);
    this.decision.set(this.store.previewMissed(this.workout().id, r));
  }

  protected async apply(d: MissedDecision) {
    this.busy.set(true);
    await this.store.applyMissed(this.workout().id, this.reason()!, d, this.note);
    this.busy.set(false);
    this.done.emit();
  }

  protected forceSkip() {
    return this.apply({ action: 'skip', reason: this.reason()!, explanation: `${this.typeName()} pominięty z wyboru użytkownika (${SKIP_REASON_LABELS[this.reason()!].toLowerCase()}). Nie nadrabiamy tej jednostki.`, advice: ['Kolejny trening odbędzie się na dotychczasowym poziomie.'] });
  }
}
