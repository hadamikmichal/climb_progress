import { Component, input } from '@angular/core';

/**
 * Znak ClimbProgress: sekwencja czterech chwytów ułożona w literę C, połączona linią drogi,
 * zakończona chwytem „top” w Signal Lime. Czytelny od 16 px (favicon) do ikony PWA.
 */
@Component({
  selector: 'app-brand-mark',
  template: `
    <svg viewBox="0 0 32 32" [attr.width]="size()" [attr.height]="size()" role="img" aria-label="ClimbProgress">
      <rect width="32" height="32" rx="7" fill="#181C19" />
      <path d="M22.5 8.8 L13.2 9.6 L9.4 16.4 L13.6 23.2 L22.6 23.4" fill="none" stroke="#F1F0E9" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity=".55" />
      <circle cx="13.2" cy="9.6" r="2.3" fill="#F1F0E9" />
      <circle cx="9.4" cy="16.4" r="2.3" fill="#F1F0E9" />
      <circle cx="13.6" cy="23.2" r="2.3" fill="#F1F0E9" />
      <circle cx="22.6" cy="23.4" r="2.3" fill="#F1F0E9" />
      <circle cx="22.5" cy="8.8" r="3.1" fill="#D7FF3F" />
    </svg>
  `,
  styles: `:host { display: inline-flex; flex: none; }`,
})
export class BrandMark {
  readonly size = input(28);
}
