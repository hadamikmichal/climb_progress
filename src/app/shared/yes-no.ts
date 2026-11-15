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
    .yn { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    button { min-height: 46px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text); font: inherit; font-weight: 700; cursor: pointer; }
    button.on { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
    button.on.warn { background: var(--bad); border-color: var(--bad); color: #fff; }
  `,
})
export class YesNo {
  readonly value = model<boolean | null>(null);
  readonly label = input('');
  readonly yes = input('Tak');
  readonly no = input('Nie');
  readonly warnOnYes = input(false);
}
