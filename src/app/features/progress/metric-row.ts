import { Component, input } from '@angular/core';

export interface MetricItem {
  label: string;
  value: string;
  unit?: string;
  /** np. „+2 vs poprz. 6 tyg.” */
  change?: string | null;
  trend?: 'improved' | 'declined' | 'same' | 'na';
}

/** Rząd kluczowych wskaźników okresu – liczby tabelaryczne, porównanie z poprzednim okresem pod spodem */
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
    /* siatka z liniami rysowanymi cieniem (prawo + dół), krawędzie przycina kontener – działa dla dowolnej liczby pozycji */
    .metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 0; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
    .m { padding: 16px; min-width: 0; box-shadow: 1px 0 0 var(--border), 0 1px 0 var(--border); }
    dd { margin: 0; }
    .v { font: 600 1.75rem/1.15 var(--font-heading); letter-spacing: -0.03em; font-variant-numeric: tabular-nums; margin-top: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .u { font: 500 0.8125rem var(--font); color: var(--muted); letter-spacing: 0; margin-left: 3px; }
    .c { font-size: 0.75rem; color: var(--muted); margin-top: 4px; }
    .c.up { color: var(--accent-strong); font-weight: 600; }
    .c.down { color: var(--warn); font-weight: 600; }
    @media (min-width: 768px) {
      .metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .m { padding: 18px 20px; }
    }
  `,
})
export class MetricRow {
  readonly items = input.required<MetricItem[]>();
}
