import { Component, computed, input, model } from '@angular/core';

/** Duże przyciski skali (RPE 1–10, pompowanie 0–10, oceny 1–5) – obsługa jedną ręką */
@Component({
  selector: 'app-scale',
  template: `
    <div class="scale" role="radiogroup" [attr.aria-label]="label()">
      @for (n of values(); track n) {
        <button type="button" role="radio" [attr.aria-checked]="value() === n" [class.on]="value() === n"
          [class.hot]="hotFrom() != null && n >= hotFrom()!" (click)="value.set(value() === n ? null : n)">{{ n }}</button>
      }
    </div>
    @if (low() || high()) {
      <div class="ends"><span>{{ low() }}</span><span>{{ high() }}</span></div>
    }
  `,
  styles: `
    .scale { display: grid; grid-template-columns: repeat(auto-fit, minmax(38px, 1fr)); gap: 5px; }
    button { min-height: 46px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface-2);
      color: var(--text); font: inherit; font-weight: 700; cursor: pointer; font-variant-numeric: tabular-nums; padding: 0; }
    button.hot { color: var(--warn); }
    button.on { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
    .ends { display: flex; justify-content: space-between; font-size: 0.72rem; color: var(--faint); margin-top: 4px; }
  `,
})
export class Scale {
  readonly value = model<number | null>(null);
  readonly min = input(0);
  readonly max = input(10);
  readonly label = input('');
  readonly low = input('');
  readonly high = input('');
  readonly hotFrom = input<number | null>(null);
  protected readonly values = computed(() => Array.from({ length: this.max() - this.min() + 1 }, (_, i) => this.min() + i));
}
