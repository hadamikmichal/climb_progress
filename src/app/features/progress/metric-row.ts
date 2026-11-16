import { Component, input } from '@angular/core';

export interface MetricItem {
  label: string;
  value: string;
  unit?: string;
  /** np. „+2 vs poprz. 6 tyg.” */
  change?: string | null;
  trend?: 'improved' | 'declined' | 'same' | 'na';
}

/** Rząd kluczowych wskaźników okresu – liczby w mono, porównanie z poprzednim okresem pod spodem */
@Component({
  selector: 'app-metric-row',
  template: `
    <dl class="metrics">
      @for (m of items(); track m.label) {
        <div class="m">
          <dt class="eyebrow">{{ m.label }}</dt>
          <dd class="v mono">{{ m.value }}@if (m.unit && m.value !== '–') { <span class="u">{{ m.unit }}</span> }</dd>
          @if (m.change) {
            <dd class="c mono" [class.up]="m.trend === 'improved'" [class.down]="m.trend === 'declined'">{{ m.change }}</dd>
          }
        </div>
      }
    </dl>
  `,
  styles: `
    .metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 0; border-top: 1px solid var(--color-border-strong); }
    .m { padding: 12px 12px 14px 0; border-bottom: 1px solid var(--color-border); min-width: 0; }
    .m:nth-child(2n) { padding-left: 12px; border-left: 1px solid var(--color-border); }
    dd { margin: 0; }
    .v { font-size: 1.75rem; font-weight: 500; letter-spacing: -0.04em; line-height: 1.15; margin-top: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .u { font-size: 0.8rem; color: var(--color-text-secondary); letter-spacing: 0; margin-left: 3px; }
    .c { font-size: 0.72rem; color: var(--color-text-secondary); margin-top: 2px; }
    .c.up { color: var(--color-primary-strong); }
    .c.down { color: var(--color-warning); }
    @media (min-width: 768px) {
      .metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .m, .m:nth-child(2n) { padding: 14px 16px 16px; border-left: 1px solid var(--color-border); }
      .m:first-child { padding-left: 0; border-left: 0; }
    }
  `,
})
export class MetricRow {
  readonly items = input.required<MetricItem[]>();
}
