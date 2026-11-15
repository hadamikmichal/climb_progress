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
  styles: `.wrap { position: relative; width: 100%; } :host { display: block; }`,
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
    // Styl „technical journal”: mono na osiach, minimalna siatka, widoczne punkty pomiarowe
    const text = cssVar('--muted') || '#777c74';
    Chart.defaults.color = text;
    Chart.defaults.borderColor = cssVar('--chart-grid') || 'rgba(24, 28, 25, 0.08)';
    Chart.defaults.font.family = cssVar('--font-mono') || 'monospace';
    Chart.defaults.font.size = 11;
    Chart.defaults.plugins.legend.labels.boxWidth = 10;
    Chart.defaults.plugins.legend.labels.boxHeight = 10;
    Chart.defaults.plugins.legend.align = 'start';
    Chart.defaults.plugins.tooltip.backgroundColor = cssVar('--tooltip-bg') || '#181c19';
    Chart.defaults.plugins.tooltip.titleColor = cssVar('--tooltip-ink') || '#f1f0e9';
    Chart.defaults.plugins.tooltip.bodyColor = cssVar('--tooltip-ink') || '#f1f0e9';
    Chart.defaults.plugins.tooltip.titleFont = { family: cssVar('--font-mono') || 'monospace', size: 11 };
    Chart.defaults.plugins.tooltip.bodyFont = { family: cssVar('--font-mono') || 'monospace', size: 12 };
    Chart.defaults.plugins.tooltip.cornerRadius = 4;
    Chart.defaults.elements.point.radius = 3.5;
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
