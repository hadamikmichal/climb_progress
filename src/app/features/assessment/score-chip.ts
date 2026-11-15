import { Component, input } from '@angular/core';

/** Punktacja 9c kategorii – „NOT TESTED” zamiast zera, gdy pomiaru nie wykonano */
@Component({
  selector: 'app-score-chip',
  template: `
    <div class="sc" [class.nt]="score() == null">
      <span class="lbl">{{ label() }}</span>
      <span class="val num">@if (score() != null) { {{ score() }}<small>/{{ max() }}</small> } @else { NOT TESTED }</span>
      @if (sub()) { <span class="sub">{{ sub() }}</span> }
    </div>
  `,
  styles: `
    .sc { display: flex; flex-direction: column; gap: 2px; padding: 12px; border-radius: var(--radius-sm); background: var(--surface-2); min-width: 0; }
    .lbl { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 700; }
    .val { font-size: 1.6rem; font-weight: 800; line-height: 1.1; }
    .val small { font-size: 0.9rem; color: var(--muted); font-weight: 600; }
    .nt .val { font-size: 0.95rem; color: var(--faint); letter-spacing: 0.06em; padding: 6px 0; }
    .sub { font-size: 0.78rem; color: var(--muted); }
  `,
})
export class ScoreChip {
  readonly label = input('');
  readonly score = input<number | null>(null);
  readonly max = input(10);
  readonly sub = input('');
}
