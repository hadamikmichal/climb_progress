import { Component, input } from '@angular/core';

export type FigureKind = 'pullup' | 'finger' | 'core' | 'deadhang' | 'route' | 'recovery';

/** Schematyczne grafiki poglądowe pozycji testowych (linie w kolorze tekstu – działają w obu motywach) */
@Component({
  selector: 'app-test-figure',
  template: `
    <svg viewBox="0 0 160 110" role="img" [attr.aria-label]="caption()" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      @switch (kind()) {
        @case ('pullup') {
          <line x1="20" y1="12" x2="140" y2="12" stroke-width="5" />
          <circle cx="80" cy="22" r="8" />
          <path d="M62 12 L66 34 L80 32 L94 34 L98 12" />
          <path d="M80 30 L80 66 M80 66 L72 98 M80 66 L88 98" />
          <path d="M70 76 h20 v10 h-20 z" stroke-width="2" />
          <text x="102" y="84" font-size="10" fill="currentColor" stroke="none">+kg</text>
          <path d="M40 18 l0 14 M120 18 l0 14" stroke-dasharray="3 4" stroke-width="2" />
          <text x="104" y="30" font-size="9" fill="currentColor" stroke="none">broda nad drążkiem</text>
        }
        @case ('finger') {
          <rect x="24" y="8" width="112" height="16" rx="3" />
          <path d="M60 24 h12 M88 24 h12" stroke-width="5" />
          <path d="M66 26 L68 44 M94 26 L92 44" />
          <circle cx="80" cy="52" r="8" />
          <path d="M68 44 L80 46 L92 44 M80 60 L80 90 M80 90 L74 106 M80 90 L86 106" />
          <path d="M72 70 h16 v9 h-16 z" stroke-width="2" />
          <text x="102" y="48" font-size="9" fill="currentColor" stroke="none">half crimp</text>
          <text x="102" y="60" font-size="9" fill="currentColor" stroke="none">łokcie proste</text>
          <text x="102" y="72" font-size="9" fill="currentColor" stroke="none">5 s</text>
        }
        @case ('core') {
          <path d="M30 98 v-34 M130 98 v-34" stroke-width="5" />
          <path d="M22 64 h16 M122 64 h16" stroke-width="5" />
          <circle cx="58" cy="30" r="8" />
          <path d="M38 64 L54 46 M122 64 L106 46" />
          <path d="M58 38 L64 66 L118 66" />
          <path d="M64 66 L118 66" stroke-dasharray="0" />
          <text x="72" y="86" font-size="9" fill="currentColor" stroke="none">nogi poziomo (L-sit)</text>
        }
        @case ('deadhang') {
          <line x1="20" y1="12" x2="140" y2="12" stroke-width="5" />
          <circle cx="80" cy="34" r="8" />
          <path d="M66 12 L70 30 M94 12 L90 30 M80 42 L80 76 M80 76 L74 104 M80 76 L86 104 M70 30 L80 44 L90 30" />
          <text x="100" y="48" font-size="9" fill="currentColor" stroke="none">nachwyt, oburącz</text>
          <text x="100" y="60" font-size="9" fill="currentColor" stroke="none">maks. 6:00</text>
        }
        @case ('route') {
          <path d="M40 104 L40 6" stroke-width="2" stroke-dasharray="4 4" />
          <path d="M40 6 L120 6" stroke-width="2" />
          <path d="M120 6 L120 104" stroke-width="5" />
          @for (y of [16, 34, 52, 70, 88]; track y) { <circle [attr.cx]="112 - (y % 3) * 4" [attr.cy]="y" r="3.5" fill="currentColor" /> }
          <text x="50" y="40" font-size="10" fill="currentColor" stroke="none">~13 m</text>
          <text x="50" y="56" font-size="10" fill="currentColor" stroke="none">4 × 6a</text>
          <text x="50" y="72" font-size="10" fill="currentColor" stroke="none">przerwa 3:00</text>
        }
        @case ('recovery') {
          <path d="M18 100 H150 M18 100 V8" stroke-width="2" />
          <path d="M22 18 C60 30 70 60 92 70 S130 88 146 92" />
          @for (x of [22, 64, 106, 146]; track x) { <circle [attr.cx]="x" [attr.cy]="x === 22 ? 18 : x === 64 ? 46 : x === 106 ? 76 : 92" r="4" fill="currentColor" /> }
          <text x="14" y="108" font-size="8" fill="currentColor" stroke="none">0</text>
          <text x="58" y="108" font-size="8" fill="currentColor" stroke="none">1 min</text>
          <text x="100" y="108" font-size="8" fill="currentColor" stroke="none">2 min</text>
          <text x="134" y="108" font-size="8" fill="currentColor" stroke="none">3 min</text>
        }
      }
    </svg>
    @if (caption()) { <p class="cap">{{ caption() }}</p> }
  `,
  styles: `
    :host { display: block; color: var(--muted); }
    svg { width: 100%; max-width: 260px; height: auto; display: block; margin: 0 auto; }
    .cap { text-align: center; font-size: 0.78rem; color: var(--faint); margin-top: 4px; }
  `,
})
export class TestFigure {
  readonly kind = input.required<FigureKind>();
  readonly caption = input('');
}
