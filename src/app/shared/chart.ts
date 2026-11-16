import { afterNextRender, Component, DestroyRef, effect, ElementRef, inject, input, viewChild } from '@angular/core';
import type { Chart, ChartConfiguration } from 'chart.js';
import { resolvedTheme } from './theme';

let chartLib: Promise<typeof import('chart.js/auto')> | null = null;
const loadChart = () => (chartLib ??= import('chart.js/auto'));

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Wrapper Chart.js – ładowany leniwie, kolory pobierane z motywu */
@Component({
  selector: 'app-chart',
  template: `
    <div class="wrap" [style.height.px]="empty() ? 0 : height()" [style.visibility]="empty() ? 'hidden' : null">
      <canvas #canvas [attr.aria-label]="label()" role="img"></canvas>
    </div>
    @if (empty()) { <p class="empty">{{ emptyText() }}</p> }
  `,
  styles: `
    :host { display: block; }
    .wrap { position: relative; width: 100%; }
    .empty {
      margin: 0; padding: var(--s5) var(--s4); text-align: center;
      font: 500 0.75rem/1.5 var(--font-mono); letter-spacing: 0.02em; color: var(--color-text-secondary);
      border: 1px dashed var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface-subtle);
    }
  `,
})
export class ChartView {
  readonly config = input.required<ChartConfiguration>();
  readonly height = input(220);
  readonly label = input('Wykres');
  readonly empty = input(false);
  readonly emptyText = input('Brak danych – pojawią się po zapisaniu treningów.');

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart: Chart | null = null;
  private rendered = false;

  constructor() {
    afterNextRender(() => {
      this.rendered = true;
      void this.draw();
    });
    effect(() => {
      this.config();
      resolvedTheme(); // po zmianie motywu przerysuj z nowymi kolorami osi i siatki
      if (this.rendered) void this.draw();
    });
    inject(DestroyRef).onDestroy(() => this.chart?.destroy());
  }

  private async draw() {
    const cfg = this.config();
    const { Chart } = await loadChart();
    // Styl Nordic Alpine: mono na osiach, wyciszona siatka, czytelne tooltipy na Rock
    const mono = cssVar('--font-mono') || 'monospace';
    Chart.defaults.color = cssVar('--color-text-secondary') || '#aab6b0';
    Chart.defaults.borderColor = cssVar('--color-chart-grid') || 'rgba(240, 243, 237, 0.06)';
    Chart.defaults.font.family = mono;
    Chart.defaults.font.size = 11;
    Chart.defaults.plugins.legend.labels.boxWidth = 10;
    Chart.defaults.plugins.legend.labels.boxHeight = 10;
    Chart.defaults.plugins.legend.labels.padding = 14;
    Chart.defaults.plugins.legend.labels.color = cssVar('--color-text-secondary') || '#aab6b0';
    Chart.defaults.plugins.legend.align = 'start';
    Chart.defaults.plugins.tooltip.backgroundColor = cssVar('--color-tooltip-bg') || '#263638';
    Chart.defaults.plugins.tooltip.borderColor = cssVar('--color-tooltip-border') || '#596965';
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.titleColor = cssVar('--color-text-secondary') || '#aab6b0';
    Chart.defaults.plugins.tooltip.bodyColor = cssVar('--color-tooltip-fg') || '#f0f3ed';
    Chart.defaults.plugins.tooltip.footerColor = cssVar('--color-text-secondary') || '#aab6b0';
    Chart.defaults.plugins.tooltip.titleFont = { family: mono, size: 11, weight: 500 };
    Chart.defaults.plugins.tooltip.bodyFont = { family: mono, size: 12, weight: 500 };
    Chart.defaults.plugins.tooltip.footerFont = { family: mono, size: 11, weight: 400 };
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 6;
    Chart.defaults.plugins.tooltip.boxPadding = 4;
    Chart.defaults.plugins.tooltip.usePointStyle = true;
    Chart.defaults.elements.point.radius = 3;
    Chart.defaults.elements.point.hoverRadius = 5;
    Chart.defaults.elements.point.borderWidth = 0;
    Chart.defaults.elements.line.borderWidth = 2;
    Chart.defaults.elements.bar.borderRadius = 2;
    Chart.defaults.scale.grid.drawTicks = false;
    (Chart.defaults.scale as unknown as { border: { display: boolean } }).border.display = false;
    Chart.defaults.scale.ticks.padding = 6;
    Chart.defaults.maintainAspectRatio = false;
    const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    Chart.defaults.animation = reduce ? false : { duration: 250 };
    this.chart?.destroy();
    this.chart = new Chart(this.canvas().nativeElement, { ...cfg, options: { ...(cfg.options ?? {}) } } as ChartConfiguration);
  }
}
