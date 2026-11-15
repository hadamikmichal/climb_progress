import { afterNextRender, Component, DestroyRef, effect, ElementRef, inject, input, viewChild } from '@angular/core';
import type { Chart, ChartConfiguration } from 'chart.js';

let chartLib: Promise<typeof import('chart.js/auto')> | null = null;
const loadChart = () => (chartLib ??= import('chart.js/auto'));

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Wrapper Chart.js – ładowany leniwie, kolory pobierane z motywu */
@Component({
  selector: 'app-chart',
  template: `
    <div class="wrap" [style.height.px]="height()">
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
      if (this.rendered) void this.draw();
    });
    inject(DestroyRef).onDestroy(() => this.chart?.destroy());
  }

  private async draw() {
    const cfg = this.config();
    const { Chart } = await loadChart();
    const text = cssVar('--muted') || '#9aa3ac';
    const grid = cssVar('--border') || '#2b3137';
    Chart.defaults.color = text;
    Chart.defaults.borderColor = grid;
    Chart.defaults.font.family = cssVar('--font') || 'system-ui';
    Chart.defaults.plugins.legend.labels.boxWidth = 12;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.animation = false;
    this.chart?.destroy();
    this.chart = new Chart(this.canvas().nativeElement, { ...cfg, options: { ...(cfg.options ?? {}) } } as ChartConfiguration);
  }
}
