import { Component, input, output } from '@angular/core';

/** Arkusz dolny (mobile) / okno modalne (desktop) */
@Component({
  selector: 'app-sheet',
  template: `
    <div class="sheet-backdrop" (click)="closed.emit()">
      <div class="sheet" role="dialog" aria-modal="true" [attr.aria-label]="title()" (click)="$event.stopPropagation()">
        <div class="spread">
          <h2>{{ title() }}</h2>
          <button class="btn ghost sm" type="button" (click)="closed.emit()" aria-label="Zamknij">✕</button>
        </div>
        <ng-content />
      </div>
    </div>
  `,
})
export class Sheet {
  readonly title = input('');
  readonly closed = output<void>();
}
