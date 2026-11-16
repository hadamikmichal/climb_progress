import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlannedWorkout, TrainingType } from '../../core/models/models';
import { AppStore } from '../../core/data/store';
import { TEMPLATES, TYPE_SHORT } from '../../core/logic/templates';
import { Sheet } from '../../shared/sheet';
import { DatePlPipe } from '../../shared/pipes';

/** Zastąpienie jednostki alternatywną (np. zamiast C – lżejsza B) z walidacją regeneracji */
@Component({
  selector: 'app-replace-sheet',
  imports: [Sheet, FormsModule, DatePlPipe],
  template: `
    <app-sheet [title]="'Zastąp: ' + typeName()" (closed)="closed.emit()">
      <p class="muted">{{ workout().date | datePl }}. Parametry obciążenia zostają bez zmian – zmienia się tylko rodzaj sesji.</p>
      <div class="opts" role="radiogroup" aria-label="Alternatywna jednostka">
        @for (t of options(); track t) {
          <button type="button" class="opt" [class.on]="choice() === t" (click)="choice.set(t)">
            <span class="type-chip">{{ t }}</span>
            <span class="grow"><strong>{{ templates[t].name }}</strong><small>{{ templates[t].goal }}</small></span>
          </button>
        }
      </div>
      @if (violations().length) {
        <div class="note warn">@for (v of violations(); track v) { <p>{{ v }}</p> }</div>
      }
      <label class="field">Powód (opcjonalnie)<input [(ngModel)]="reason" placeholder="np. brak dostępu do ściany z liną" /></label>
      <button class="btn primary big block" type="button" [disabled]="!choice() || violations().length > 0 || busy()" (click)="apply()">Zastąp</button>
    </app-sheet>
  `,
  styles: `
    .opts { display: flex; flex-direction: column; gap: 6px; }
    .opt { display: flex; align-items: flex-start; gap: 12px; padding: 12px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-surface); color: var(--color-text-primary); text-align: left; font: inherit; cursor: pointer; }
    .opt.on { border-color: var(--color-text-primary); box-shadow: inset 3px 0 0 var(--color-primary); }
    .opt small { display: block; color: var(--color-text-secondary); }
  `,
})
export class ReplaceSheet {
  protected readonly store = inject(AppStore);
  readonly workout = input.required<PlannedWorkout>();
  readonly closed = output<void>();
  readonly done = output<void>();

  protected readonly templates = TEMPLATES;
  protected readonly choice = signal<TrainingType | null>(null);
  protected readonly busy = signal(false);
  protected reason = '';
  protected readonly typeName = computed(() => TYPE_SHORT[this.workout().type]);
  protected readonly options = computed(() => (['A', 'B', 'C'] as TrainingType[]).filter((t) => t !== this.workout().type));
  protected readonly violations = computed(() => (this.choice() ? this.store.replaceViolations(this.workout().id, this.choice()!) : []));

  protected async apply() {
    const t = this.choice();
    if (!t) return;
    this.busy.set(true);
    const v = await this.store.replacePlanned(this.workout().id, t, this.reason.trim());
    this.busy.set(false);
    if (!v.length) this.done.emit();
  }
}
