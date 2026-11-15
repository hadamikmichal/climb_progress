import { Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AppStore } from '../../core/data/store';
import { ReadinessCheck } from '../../core/models/models';
import { evaluateReadiness, ReadinessAssessment } from '../../core/logic/readiness';
import { now, uid } from '../../core/logic/ids';
import { Scale } from '../../shared/scale';
import { YesNo } from '../../shared/yes-no';
import { DatePlPipe } from '../../shared/pipes';

/** Przypadek D – codzienna ocena gotowości */
@Component({
  selector: 'app-readiness',
  imports: [FormsModule, Scale, YesNo, DatePlPipe],
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <div class="eyebrow">{{ store.today() | datePl }}</div>
          <h1>Ocena gotowości</h1>
          <p class="muted">Wypełnij codziennie lub przed treningiem. Aplikacja nie diagnozuje – jedynie ogranicza obciążenie.</p>
        </div>
      </header>

      <section class="card">
        <label class="field">Samopoczucie</label>
        <app-scale [min]="1" [max]="5" [value]="wellbeing()" (valueChange)="wellbeing.set($event)" low="bardzo złe" high="świetne" />
        <label class="field">Zmęczenie</label>
        <app-scale [min]="1" [max]="5" [hotFrom]="4" [value]="fatigue()" (valueChange)="fatigue.set($event)" low="wypoczęty" high="bardzo zmęczony" />
        <label class="field">Jakość snu</label>
        <app-scale [min]="1" [max]="5" [value]="sleep()" (valueChange)="sleep.set($event)" low="bardzo zła" high="bardzo dobra" />
        <label class="field">Ból palców?</label>
        <app-yes-no [value]="fingerPain()" (valueChange)="fingerPain.set($event)" [warnOnYes]="true" />
        <label class="field">Ból łokci lub barków?</label>
        <app-yes-no [value]="elbowPain()" (valueChange)="elbowPain.set($event)" [warnOnYes]="true" />
        <label class="field">Nietypowe zmęczenie / objawy choroby?</label>
        <app-yes-no [value]="unusual()" (valueChange)="unusual.set($event)" [warnOnYes]="true" />
        <label class="field">Notatka (opcjonalnie)<input [(ngModel)]="notes" /></label>

        @if (preview(); as a) {
          <div class="note" [class.ok]="a.level === 'go'" [class.warn]="a.level === 'easy'" [class.bad]="a.level === 'rest'">
            <strong>{{ a.title }}</strong>
            @for (m of a.messages; track m) { <p>{{ m }}</p> }
          </div>
        }
        <button class="btn primary xl block" type="button" [disabled]="!complete() || busy()" (click)="save()">Zapisz ocenę</button>
      </section>

      <section class="card">
        <h3>Ostatnie oceny</h3>
        @for (r of history(); track r.c.id) {
          <div class="list-item">
            <div class="grow">
              <strong>{{ r.c.date | datePl }}</strong> – {{ r.a.title }}
              <small>samopoczucie {{ r.c.wellbeing }}/5 · zmęczenie {{ r.c.fatigue }}/5 · sen {{ r.c.sleep }}/5
                @if (r.c.fingerPain) { · ból palców } @if (r.c.elbowShoulderPain) { · ból łokci/barków } @if (r.c.unusualFatigue) { · nietypowe zmęczenie }</small>
              @if (r.c.notes) { <small class="faint">{{ r.c.notes }}</small> }
            </div>
            <button class="btn ghost sm" type="button" (click)="store.deleteReadiness(r.c.id)" aria-label="Usuń">✕</button>
          </div>
        } @empty { <p class="empty">Brak ocen.</p> }
      </section>
    </div>
  `,
})
export class ReadinessPage {
  protected readonly store = inject(AppStore);
  private readonly router = inject(Router);
  /** ?back=/session/... – powrót po zapisaniu */
  readonly back = input<string | undefined>();

  protected readonly wellbeing = signal<number | null>(null);
  protected readonly fatigue = signal<number | null>(null);
  protected readonly sleep = signal<number | null>(null);
  protected readonly fingerPain = signal<boolean | null>(false);
  protected readonly elbowPain = signal<boolean | null>(false);
  protected readonly unusual = signal<boolean | null>(false);
  protected readonly busy = signal(false);
  protected notes = '';

  protected readonly complete = computed(() => this.wellbeing() != null && this.fatigue() != null && this.sleep() != null);
  protected readonly draft = computed<ReadinessCheck | null>(() => this.complete()
    ? {
      id: uid(), date: this.store.today(), timestamp: now(), wellbeing: this.wellbeing()!, fatigue: this.fatigue()!, sleep: this.sleep()!,
      fingerPain: !!this.fingerPain(), elbowShoulderPain: !!this.elbowPain(), unusualFatigue: !!this.unusual(), notes: this.notes,
    }
    : null);
  protected readonly preview = computed<ReadinessAssessment | null>(() => (this.draft() ? evaluateReadiness(this.draft()!) : null));
  protected readonly history = computed(() =>
    [...this.store.readiness()].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)).slice(0, 14).map((c) => ({ c, a: evaluateReadiness(c) })),
  );

  constructor() {
    const t = this.store.todayReadiness();
    if (t) {
      this.wellbeing.set(t.wellbeing);
      this.fatigue.set(t.fatigue);
      this.sleep.set(t.sleep);
      this.fingerPain.set(t.fingerPain);
      this.elbowPain.set(t.elbowShoulderPain);
      this.unusual.set(t.unusualFatigue);
      this.notes = t.notes;
    }
  }

  protected async save() {
    const d = this.draft();
    if (!d) return;
    this.busy.set(true);
    await this.store.saveReadiness({ ...d, notes: this.notes, timestamp: now() });
    this.busy.set(false);
    const b = this.back();
    void this.router.navigateByUrl(b && b.startsWith('/') ? b : '/');
  }
}
