import { Component, input } from '@angular/core';

export type FigureKind = 'pullup' | 'finger' | 'core' | 'deadhang' | 'route' | 'recovery';

const LABELS: Record<FigureKind, string> = {
  pullup: 'FIG. 02 · PULL-UP',
  finger: 'FIG. 03 · MAX HANG',
  core: 'FIG. 04 · L-SIT',
  deadhang: 'FIG. 05 · DEAD HANG',
  route: 'FIG. 06 · 4 × 6A',
  recovery: 'FIG. 07 · RECOVERY',
};

/**
 * Schematy pozycji testowych w stylu rysunku technicznego: cienkie linie w kolorze tekstu,
 * podpisy mono, jeden element w Signal Lime wskazujący to, co jest mierzone.
 */
@Component({
  selector: 'app-test-figure',
  template: `
    <figure class="fig">
      <figcaption class="lbl">{{ labels[kind()] }}</figcaption>
      <svg viewBox="0 0 160 110" role="img" [attr.aria-label]="caption() || labels[kind()]" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
        @switch (kind()) {
          @case ('pullup') {
            <line x1="20" y1="14" x2="140" y2="14" stroke-width="3" />
            <circle cx="80" cy="24" r="7" />
            <path d="M62 14 L66 34 L80 32 L94 34 L98 14" />
            <path d="M80 31 L80 64 M80 64 L73 98 M80 64 L87 98" />
            <rect x="71" y="72" width="18" height="10" rx="1.5" class="acc" />
            <path d="M104 14 v12" stroke-dasharray="2 3" />
            <text x="108" y="24">broda ↑</text>
            <text x="96" y="80">+kg</text>
          }
          @case ('finger') {
            <rect x="24" y="10" width="112" height="14" rx="2" />
            <path d="M58 24 h14 M88 24 h14" stroke-width="4" class="acc-stroke" />
            <path d="M65 26 L67 44 M95 26 L93 44" />
            <circle cx="80" cy="52" r="7" />
            <path d="M67 44 L80 46 L93 44 M80 59 L80 88 M80 88 L74 104 M80 88 L86 104" />
            <rect x="72" y="66" width="16" height="9" rx="1.5" />
            <text x="106" y="46">20 mm</text>
            <text x="106" y="58">half crimp</text>
            <text x="106" y="70">5 s</text>
          }
          @case ('core') {
            <path d="M30 100 v-36 M130 100 v-36" stroke-width="3" />
            <path d="M22 64 h16 M122 64 h16" stroke-width="3" />
            <circle cx="58" cy="30" r="7" />
            <path d="M38 64 L54 46 M122 64 L106 46" />
            <path d="M58 37 L63 66" />
            <path d="M63 66 L118 66" stroke-width="3" class="acc-stroke" />
            <text x="70" y="86">90° · nogi poziomo</text>
          }
          @case ('deadhang') {
            <line x1="20" y1="14" x2="140" y2="14" stroke-width="3" />
            <path d="M66 14 L70 32 M94 14 L90 32" />
            <circle cx="80" cy="38" r="7" />
            <path d="M70 32 L80 46 L90 32 M80 45 L80 78 M80 78 L74 104 M80 78 L86 104" />
            <circle cx="122" cy="44" r="12" />
            <path d="M122 44 L122 36" class="acc-stroke" stroke-width="2.5" />
            <text x="108" y="72">max 6:00</text>
          }
          @case ('route') {
            <path d="M44 104 L44 8 L116 8" stroke-dasharray="3 4" />
            <path d="M116 8 L116 104" stroke-width="3" />
            @for (y of [24, 42, 60, 78, 96]; track y) { <circle [attr.cx]="108 - (y % 3) * 4" [attr.cy]="y" r="3" fill="currentColor" stroke="none" /> }
            <circle cx="108" cy="12" r="4" class="acc" stroke="none" />
            <text x="52" y="40">~13 m</text>
            <text x="52" y="54">6a × 4</text>
            <text x="52" y="68">rest 3:00</text>
          }
          @case ('recovery') {
            <path d="M18 100 H150 M18 100 V8" />
            <path d="M22 18 C60 30 70 60 92 70 S130 88 146 92" class="acc-stroke" stroke-width="2" />
            @for (p of points; track p[0]) { <circle [attr.cx]="p[0]" [attr.cy]="p[1]" r="3" fill="currentColor" stroke="none" /> }
            <text x="15" y="108">0</text>
            <text x="58" y="108">1</text>
            <text x="100" y="108">2</text>
            <text x="140" y="108">3 min</text>
          }
        }
      </svg>
      @if (caption()) { <p class="cap">{{ caption() }}</p> }
    </figure>
  `,
  styles: `
    :host { display: block; color: var(--text); }
    .fig { margin: 0; padding: 10px 12px 8px; border: 1px solid var(--border); border-radius: var(--radius); display: flex; flex-direction: column; gap: 4px; }
    .lbl { font-family: var(--font-num); font-size: 0.62rem; letter-spacing: 0.1em; color: var(--muted); }
    svg { width: 100%; max-width: 240px; height: auto; display: block; margin: 0 auto; }
    svg text { font-family: var(--font-num); font-size: 7.5px; letter-spacing: 0.04em; fill: var(--muted); stroke: none; }
    .acc { fill: var(--accent); stroke: var(--accent-strong); }
    .acc-stroke { stroke: var(--accent-strong); }
    .cap { font-family: var(--font-num); font-size: 0.72rem; color: var(--muted); }
  `,
})
export class TestFigure {
  readonly kind = input.required<FigureKind>();
  readonly caption = input('');
  protected readonly labels = LABELS;
  protected readonly points = [[22, 18], [64, 46], [106, 76], [146, 92]];
}
