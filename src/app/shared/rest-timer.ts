import { beep } from './beep';
import { Component, computed, DestroyRef, inject, input, signal } from '@angular/core';

/** Prosty timer odpoczynku / zwisu. Wibracja i sygnał dźwiękowy na koniec. */
@Component({
  selector: 'app-rest-timer',
  template: `
    <div class="timer" [class.running]="running()" [class.finished]="finished()">
      <div class="spread">
        <span class="eyebrow">{{ label() }}</span>
        @if (running()) { <button class="btn ghost sm" type="button" (click)="stop()">Zatrzymaj</button> }
      </div>
      <div class="time num" aria-live="polite">{{ display() }}</div>
      @if (running()) {
        <div class="progress"><span [style.width.%]="pct()"></span></div>
        <div class="btn-row">
          <button class="btn sm" type="button" (click)="add(-15)">−15 s</button>
          <button class="btn sm" type="button" (click)="add(30)">+30 s</button>
        </div>
      } @else {
        <button class="btn primary big block" type="button" (click)="start()">{{ finished() ? 'Jeszcze raz' : startLabel() }}</button>
      }
    </div>
  `,
  styles: `
    .timer { display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface); }
    .time { font: 500 2.6rem/1.05 var(--font-mono); text-align: center; letter-spacing: -0.04em; font-variant-numeric: tabular-nums; }
    .running { border-color: var(--text); }
    .running .time { color: var(--accent-strong); }
    .finished .time { color: var(--accent-strong); }
  `,
})
export class RestTimer {
  readonly seconds = input(120);
  readonly label = input('Odpoczynek');
  readonly startLabel = input('Rozpocznij przerwę');

  protected readonly remaining = signal<number | null>(null);
  protected readonly total = signal(0);
  protected readonly finished = signal(false);
  protected readonly running = computed(() => this.remaining() != null);
  protected readonly display = computed(() => {
    const s = this.remaining() ?? this.seconds();
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });
  protected readonly pct = computed(() => (this.total() ? (100 * (this.total() - (this.remaining() ?? 0))) / this.total() : 0));

  private endAt = 0;
  private handle: ReturnType<typeof setInterval> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clear());
  }

  start() {
    this.finished.set(false);
    this.total.set(this.seconds());
    this.endAt = Date.now() + this.seconds() * 1000;
    this.tick();
    this.clear();
    this.handle = setInterval(() => this.tick(), 250);
  }

  add(sec: number) {
    this.endAt += sec * 1000;
    this.total.update((t) => Math.max(1, t + sec));
    this.tick();
  }

  stop() {
    this.clear();
    this.remaining.set(null);
  }

  private tick() {
    const left = Math.max(0, Math.ceil((this.endAt - Date.now()) / 1000));
    this.remaining.set(left);
    if (left === 0) {
      this.clear();
      this.remaining.set(null);
      this.finished.set(true);
      this.signalEnd();
    }
  }

  private clear() {
    if (this.handle) clearInterval(this.handle);
    this.handle = null;
  }

  private signalEnd() {
    beep();
  }
}
