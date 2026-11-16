import { Component, input, model } from '@angular/core';

@Component({
  selector: 'app-yes-no',
  template: `
    <div class="yn" role="radiogroup" [attr.aria-label]="label()">
      <button type="button" [class.on]="value() === true" [class.warn]="warnOnYes()" (click)="value.set(true)">{{ yes() }}</button>
      <button type="button" [class.on]="value() === false" (click)="value.set(false)">{{ no() }}</button>
    </div>
  `,
  styles: `
    .yn { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
    button { min-height: 48px; border-radius: 6px; border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-primary);
      font: 600 0.95rem var(--font-heading); cursor: pointer; transition: background 120ms var(--ease); }
    button.on { background: var(--color-selected-bg); color: var(--color-selected-fg); border-color: var(--color-selected-border); }
    button.on.warn { background: var(--color-warning); border-color: var(--color-warning); color: var(--color-on-accent); }
  `,
})
export class YesNo {
  readonly value = model<boolean | null>(null);
  readonly label = input('');
  readonly yes = input('Tak');
  readonly no = input('Nie');
  readonly warnOnYes = input(false);
}
