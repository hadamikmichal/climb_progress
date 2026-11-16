import { Component, input } from '@angular/core';

/**
 * Znak ClimbProgress: droga wspinaczkowa – trzy chwyty połączone linią, prowadzące w górę
 * do chwytu „top” w Moss. Tło Fjord, detale Snow. Ten sam rysunek co favicon.svg – czytelny od 16 px.
 */
@Component({
  selector: 'app-brand-mark',
  template: `
    <svg viewBox="0 0 32 32" [attr.width]="size()" [attr.height]="size()" role="img" aria-label="ClimbProgress">
      <rect class="bg" width="32" height="32" rx="7" />
      <path class="route" d="M8.5 24 L15 18.5 L12.5 12 L22.5 7.5" />
      <circle class="hold" cx="8.5" cy="24" r="2.6" />
      <circle class="hold" cx="15" cy="18.5" r="2.6" />
      <circle class="hold" cx="12.5" cy="12" r="2.6" />
      <circle class="top" cx="22.5" cy="7.5" r="3.6" />
    </svg>
  `,
  styles: `
    :host { display: inline-flex; flex: none; }
    .bg { fill: var(--palette-fjord); stroke: var(--color-border); stroke-width: 1; }
    .route { fill: none; stroke: var(--palette-snow); stroke-opacity: 0.55; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .hold { fill: var(--palette-snow); }
    .top { fill: var(--palette-moss); }
  `,
})
export class BrandMark {
  readonly size = input(28);
}
