import { Component, computed, DestroyRef, effect, inject, input, output, signal, untracked } from '@angular/core';
import { beep } from './beep';

/**
 * Zegar liczony od zapisanego znacznika czasu (ISO). Stan żyje w danych, nie w komponencie,
 * więc odświeżenie strony nie przerywa pomiaru.
 *  - mode 'up': stoper od `start`
 *  - mode 'down': odliczanie `seconds` od `start` (sygnał i zdarzenie `finished` po dojściu do zera)
 */
@Component({
  selector: 'app-live-clock',
  template: `<span class="clock num" [class.over]="over()">{{ text() }}</span>`,
  styles: `
    :host { display: block; text-align: center; }
    .clock { font-size: var(--clock-size, 3.2rem); font-weight: 800; letter-spacing: 0.01em; line-height: 1.05; }
    .over { color: var(--ok); }
  `,
})
export class LiveClock {
  readonly start = input.required<string | null>();
  readonly mode = input<'up' | 'down'>('up');
  readonly seconds = input(0);
  readonly decimals = input(false);
  readonly cap = input<number | null>(null);
  readonly finished = output<void>();

  private readonly nowMs = signal(Date.now());
  private fired: string | null = null;

  protected readonly elapsed = computed(() => {
    const s = this.start();
    if (!s) return 0;
    const e = Math.max(0, (this.nowMs() - Date.parse(s)) / 1000);
    const cap = this.cap();
    return cap != null ? Math.min(cap, e) : e;
  });
  protected readonly value = computed(() => (this.mode() === 'up' ? this.elapsed() : Math.max(0, this.seconds() - this.elapsed())));
  protected readonly over = computed(() => this.mode() === 'down' && !!this.start() && this.value() === 0);
  protected readonly text = computed(() => {
    const v = this.value();
    const shown = this.mode() === 'down' ? Math.ceil(v) : v;
    const m = Math.floor(shown / 60);
    const s = shown - m * 60;
    const ss = this.decimals() ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
    return `${m}:${ss}`;
  });

  constructor() {
    const h = setInterval(() => this.nowMs.set(Date.now()), 100);
    inject(DestroyRef).onDestroy(() => clearInterval(h));
    effect(() => {
      const over = this.over();
      const start = this.start();
      untracked(() => {
        if (over && start && this.fired !== start) {
          this.fired = start;
          // nie sygnalizujemy końca, jeśli odliczanie skończyło się dawno temu (np. po powrocie do aplikacji)
          if (this.elapsed() - this.seconds() < 3) beep(2);
          this.finished.emit();
        }
      });
    });
  }
}
