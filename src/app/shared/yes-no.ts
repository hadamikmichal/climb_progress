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
    button { min-height: 48px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text);
      font: 600 0.95rem var(--font-heading); cursor: pointer; transition: background 120ms var(--ease); }
    button.on { background: var(--select-bg); color: var(--select-ink); border-color: var(--select-bg); }
    button.on.warn { background: var(--warn); border-color: var(--warn); color: #181c19; }
  `,
})
export class YesNo {
  readonly value = model<boolean | null>(null);
  readonly label = input('');
  readonly yes = input('Tak');
  readonly no = input('Nie');
  readonly warnOnYes = input(false);
}
