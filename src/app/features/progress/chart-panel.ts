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
    .panel { margin: 0; display: flex; flex-direction: column; gap: 12px; padding: 16px 0 20px; border-top: 1px solid var(--color-border-strong); min-width: 0; }
    h3 { font-size: 1.05rem; }
    .hint { font-size: 0.85rem; color: var(--color-text-secondary); margin-top: 4px; }
    .answer { font-size: 0.78rem; color: var(--color-text-primary); padding-left: 10px; border-left: 2px solid var(--color-primary); }
    .empty-state { font-size: 0.875rem; color: var(--color-text-secondary); padding: 20px 16px; border: 1px dashed var(--color-border); border-radius: var(--radius-field); text-align: center; }
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
