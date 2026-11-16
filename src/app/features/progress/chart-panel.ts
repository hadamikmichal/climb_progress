import { Component, input } from '@angular/core';
import type { ChartConfiguration } from 'chart.js';
import { ChartView } from '../../shared/chart';

const EMPTY = { type: 'bar', data: { labels: [], datasets: [] } } as ChartConfiguration;

/**
 * Wykres jako odpowiedź na pytanie treningowe: pytanie (nagłówek) → wykres → jednozdaniowa odpowiedź z danych.
 * Bez danych pokazuje empty state zamiast pustego/fikcyjnego wykresu.
 */
@Component({
  selector: 'app-chart-panel',
  imports: [ChartView],
  template: `
    <figure class="panel">
      <figcaption>
        <h3>{{ question() }}</h3>
        @if (hint()) { <p class="hint">{{ hint() }}</p> }
      </figcaption>
      @if (config(); as cfg) {
        <app-chart [config]="cfg" [height]="height()" [label]="question()" />
        @if (answer()) { <p class="answer mono">{{ answer() }}</p> }
      } @else {
        <p class="empty-state">{{ emptyText() }}</p>
      }
      <ng-content />
    </figure>
  `,
  styles: `
    .panel { margin: 0; display: flex; flex-direction: column; gap: 14px; padding: 20px 0 24px; border-top: 1px solid var(--border); min-width: 0; }
    h3 { font-size: 1.0625rem; }
    .hint { font-size: 0.8125rem; color: var(--muted); margin-top: 4px; max-width: 70ch; }
    .answer { font-size: 0.875rem; font-weight: 500; color: var(--text); padding: 10px 12px; background: var(--bg); border-left: 2px solid var(--accent); border-radius: 0 6px 6px 0; }
    .empty-state { font-size: 0.875rem; color: var(--muted); padding: 28px 16px; background: var(--surface-2); border-radius: var(--radius-field); text-align: center; }
  `,
})
export class ChartPanel {
  readonly question = input.required<string>();
  readonly hint = input('');
  readonly answer = input<string | null>(null);
  readonly config = input<ChartConfiguration | null>(null);
  readonly height = input(220);
  readonly emptyText = input('Za mało danych w wybranym zakresie.');
  protected readonly empty = EMPTY;
}
