import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlannedWorkout } from '../../core/models/models';
import { AppStore } from '../../core/data/store';
import { TYPE_SHORT } from '../../core/logic/templates';
import { Sheet } from '../../shared/sheet';
import { DatePlPipe } from '../../shared/pipes';

/** Ręczna zmiana daty z walidacją regeneracji */
@Component({
  selector: 'app-move-sheet',
  imports: [Sheet, FormsModule, DatePlPipe],
  template: `
    <app-sheet [title]="'Zmień datę: ' + typeName()" (closed)="closed.emit()">
      <p class="muted">Obecnie: {{ workout().date | datePl }}. Aplikacja nie pozwoli zaplanować dwóch ciężkich jednostek dzień po dniu.</p>
      <label class="field">Nowa data
        <input type="date" [ngModel]="date()" (ngModelChange)="date.set($event)" [min]="store.today()" />
      </label>
      @if (violations().length) {
        <div class="note bad">@for (v of violations(); track v) { <p>{{ v }}</p> }</div>
      } @else if (date() && date() !== workout().date) {
        <div class="note ok">Termin bezpieczny. Obciążenie treningu pozostaje bez zmian.</div>
      }
      <label class="field">Powód (opcjonalnie)
        <input [(ngModel)]="reason" placeholder="np. zmiana grafiku" />
      </label>
      <button class="btn primary big block" type="button" [disabled]="!canMove() || busy()" (click)="move()">Przełóż</button>
    </app-sheet>
  `,
})
export class MoveSheet {
  protected readonly store = inject(AppStore);
  readonly workout = input.required<PlannedWorkout>();
  readonly closed = output<void>();
  readonly done = output<void>();

  protected readonly date = signal('');
  protected readonly busy = signal(false);
  protected reason = '';

  protected readonly violations = computed(() => {
    const d = this.date();
    return d && d !== this.workout().date ? this.store.moveViolations(this.workout().id, d) : [];
  });
  protected readonly canMove = computed(() => !!this.date() && this.date() !== this.workout().date && this.violations().length === 0);

  protected typeName() {
    return TYPE_SHORT[this.workout().type];
  }

  protected async move() {
    this.busy.set(true);
    await this.store.movePlanned(this.workout().id, this.date(), this.reason ? `Powód: ${this.reason}.` : 'Ręczna zmiana terminu.');
    this.busy.set(false);
    this.done.emit();
  }
}
