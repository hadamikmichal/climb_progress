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
    .sc { display: flex; flex-direction: column; gap: 4px; padding: 10px 0 12px; border-top: 1px solid var(--border-strong); min-width: 0; }
    .lbl { font-family: var(--font-num); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
    .val { font-family: var(--font-num); font-size: 2rem; font-weight: 500; letter-spacing: -0.04em; line-height: 1; }
    .val small { font-size: 0.85rem; color: var(--muted); letter-spacing: 0; margin-left: 2px; }
    .nt .val { font-size: 0.75rem; color: var(--faint); letter-spacing: 0.1em; padding: 8px 0; }
    .sub { font-family: var(--font-num); font-size: 0.72rem; color: var(--muted); }
  `,
})
export class ScoreChip {
  readonly label = input('');
  readonly score = input<number | null>(null);
  readonly max = input(10);
  readonly sub = input('');
}
