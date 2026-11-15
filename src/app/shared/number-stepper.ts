import { Component, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';

/** Duże pole liczbowe z przyciskami −/+ (obsługa jedną ręką, bez klawiatury) */
@Component({
  selector: 'app-stepper',
  imports: [FormsModule],
  template: `
    <div class="stp">
      <button class="btn big" type="button" (click)="bump(-step())" [attr.aria-label]="'Zmniejsz o ' + step()">−{{ step() }}</button>
      <input type="number" inputmode="decimal" [step]="step()" [ngModel]="value()" (ngModelChange)="set($event)" [attr.aria-label]="label()" />
      <button class="btn big" type="button" (click)="bump(step())" [attr.aria-label]="'Zwiększ o ' + step()">+{{ step() }}</button>
    </div>
    @if (unit()) { <div class="unit">{{ unit() }}</div> }
  `,
  styles: `
    .stp { display: grid; grid-template-columns: 76px 1fr 76px; gap: 6px; align-items: stretch; }
    input { text-align: center; font: 500 1.5rem var(--font-mono); min-height: 56px; letter-spacing: -0.03em; }
    .stp .btn { font-family: var(--font-mono); font-weight: 500; padding: 0; }
    .unit { text-align: center; font: 0.72rem var(--font-mono); color: var(--muted); margin-top: 4px; letter-spacing: 0.02em; }
  `,
})
export class NumberStepper {
  readonly value = model<number | null>(0);
  readonly step = input(1);
  readonly min = input<number | null>(null);
  readonly unit = input('');
  readonly label = input('');

  protected bump(d: number) {
    const v = Math.round(((this.value() ?? 0) + d) * 100) / 100;
    this.value.set(this.min() != null ? Math.max(this.min()!, v) : v);
  }

  protected set(v: unknown) {
    if (v === '' || v == null) return this.value.set(null);
    const n = Number(v);
    if (Number.isFinite(n)) this.value.set(this.min() != null ? Math.max(this.min()!, n) : n);
  }
}
