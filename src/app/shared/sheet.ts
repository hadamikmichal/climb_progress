import { Component, input, output } from '@angular/core';
import { Icon } from './icon';

/** Arkusz dolny (mobile) / okno modalne (desktop) */
@Component({
  selector: 'app-sheet',
  imports: [Icon],
  template: `
    <div class="sheet-backdrop" (click)="closed.emit()">
      <div class="sheet" role="dialog" aria-modal="true" [attr.aria-label]="title()" (click)="$event.stopPropagation()">
        <div class="spread">
          <h2>{{ title() }}</h2>
          <button class="btn ghost" type="button" (click)="closed.emit()" aria-label="Zamknij" style="min-width:48px;min-height:48px;padding:0"><app-icon name="x" /></button>
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
