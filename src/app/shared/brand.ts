import { Component, input } from '@angular/core';

/**
 * Znak ClimbProgress: droga wspinaczkowa jako sekwencja chwytów połączonych linią,
 * wznosząca się od lewego dołu do prawego górnego rogu; ostatni chwyt („top”) w Chalk Lime.
 * Ta sama geometria co public/favicon.svg – czytelna od 16 px do ikony PWA.
 */
@Component({
  selector: 'app-brand-mark',
  template: `
    <svg viewBox="0 0 32 32" [attr.width]="size()" [attr.height]="size()" role="img" aria-label="ClimbProgress">
      <rect x=".5" y=".5" width="31" height="31" rx="7.5" fill="#222923" [attr.stroke]="'var(--brand-outline, transparent)'" />
      <path d="M8 24.5 L16.5 20 L12 12.5 L23.5 8" fill="none" stroke="#FFFFFF" stroke-opacity=".5" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="8" cy="24.5" r="2.2" fill="#FFFFFF" />
      <circle cx="16.5" cy="20" r="2.2" fill="#FFFFFF" />
      <circle cx="12" cy="12.5" r="2.2" fill="#FFFFFF" />
      <circle cx="23.5" cy="8" r="3.1" fill="#D7EF76" />
    </svg>
  `,
  styles: `:host { display: inline-flex; flex: none; }`,
})
export class BrandMark {
  readonly size = input(28);
}
