import { Component, computed, input, output } from '@angular/core';
import { AssessmentKind } from '../../core/models/assessment';

export interface StepDef {
  key: string;
  label: string;
}

/** Pełny Baseline Test / Retest – 8 kroków w dwóch sesjach */
export const BASELINE_STEPS: StepDef[] = [
  { key: 'readiness', label: 'Readiness' },
  { key: 'pullup', label: 'Weighted Pull-up' },
  { key: 'finger', label: 'Max Hang' },
  { key: 'core', label: 'Core' },
  { key: 'deadhang', label: 'Dead Hang' },
  { key: 'climbing', label: 'Climbing Test' },
  { key: 'recovery', label: 'Recovery Curve' },
  { key: 'report', label: 'Report' },
];

/** Test pośredni 3 × 6a – bez maksymalnych testów 9c */
export const CONTROL_STEPS: StepDef[] = [
  { key: 'readiness', label: 'Readiness' },
  { key: 'climbing', label: 'Climbing Test' },
  { key: 'recovery', label: 'Recovery Curve' },
  { key: 'report', label: 'Report' },
];

export function stepsFor(kind: AssessmentKind): StepDef[] {
  return kind === 'CONTROL' ? CONTROL_STEPS : BASELINE_STEPS;
}

/** Numer kroku (1-based) dla klucza w danym rodzaju testu */
export function stepNumber(kind: AssessmentKind, key: string): number {
  return stepsFor(kind).findIndex((s) => s.key === key) + 1;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Poziomy wskaźnik postępu Baseline Test: „KROK 03 / 08 · MAX HANG” + segmenty.
 * Segmenty z `selectable` można dotknąć, by wrócić do kroku tej samej sesji.
 */
@Component({
  selector: 'app-baseline-steps',
  template: `
    <div class="bs">
      <div class="bs-label">
        <span class="kicker num">Krok {{ pad(current()) }} / {{ pad(steps().length) }}</span>
        <span class="eyebrow">{{ steps()[current() - 1]?.label }}</span>
      </div>
      <ol class="bs-bar" [attr.aria-label]="'Postęp testu: krok ' + current() + ' z ' + steps().length">
        @for (s of steps(); track s.key; let i = $index) {
          <li>
            <button type="button" [class.done]="i + 1 < current() || doneUntil() >= i + 1" [class.on]="i + 1 === current()"
              [disabled]="!selectable().includes(s.key)" (click)="select.emit(s.key)"
              [attr.aria-current]="i + 1 === current() ? 'step' : null" [attr.aria-label]="pad(i + 1) + ' ' + s.label">
              <span class="seg"></span><span class="n num">{{ pad(i + 1) }}</span>
            </button>
          </li>
        }
      </ol>
    </div>
  `,
  styles: `
    .bs { display: flex; flex-direction: column; gap: 10px; }
    .bs-label { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .bs-bar { list-style: none; margin: 0; padding: 0; display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 3px; }
    .bs-bar button {
      width: 100%; min-height: 32px; padding: 0; border: 0; background: transparent; color: var(--faint); cursor: pointer;
      display: flex; flex-direction: column; align-items: stretch; gap: 6px; font: inherit;
    }
    .bs-bar button:disabled { cursor: default; }
    .seg { display: block; height: 4px; border-radius: 1px; background: var(--surface-3); transition: background 300ms var(--ease); }
    .n { font-size: 0.66rem; letter-spacing: 0.04em; text-align: left; }
    .done .seg { background: var(--muted); }
    .done { color: var(--muted); }
    .on .seg { background: var(--accent-strong); }
    .on { color: var(--text); }
  `,
})
export class BaselineSteps {
  readonly kind = input<AssessmentKind>('BASELINE');
  /** Bieżący krok (1-based) */
  readonly current = input.required<number>();
  /** Kroki z tej samej sesji, do których można wrócić */
  readonly selectable = input<string[]>([]);
  /** Wszystkie kroki ≤ tej liczby oznaczone jako wykonane (np. raport = 8) */
  readonly doneUntil = input(0);
  readonly select = output<string>();

  protected readonly steps = computed(() => stepsFor(this.kind()));
  protected readonly pad = pad;
}
