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
          <h1>Gotowość</h1>
          <p class="muted">30 sekund przed treningiem. Aplikacja nie diagnozuje – jedynie ogranicza obciążenie.</p>
        </div>
      </header>

      <section class="rd">
        <div class="grp"><span class="kicker">01 · Samopoczucie</span>
          <app-scale [min]="1" [max]="5" [value]="wellbeing()" (valueChange)="wellbeing.set($event)" low="bardzo złe" high="świetne" label="Samopoczucie" /></div>
        <div class="grp"><span class="kicker">02 · Zmęczenie</span>
          <app-scale [min]="1" [max]="5" [hotFrom]="4" [value]="fatigue()" (valueChange)="fatigue.set($event)" low="wypoczęty" high="bardzo zmęczony" label="Zmęczenie" /></div>
        <div class="grp"><span class="kicker">03 · Jakość snu</span>
          <app-scale [min]="1" [max]="5" [value]="sleep()" (valueChange)="sleep.set($event)" low="bardzo zła" high="bardzo dobra" label="Sen" /></div>
        <div class="qs">
          <span class="kicker">04 · Sygnały ryzyka</span>
          <div class="q"><span>Ból palców</span><app-yes-no [value]="fingerPain()" (valueChange)="fingerPain.set($event)" [warnOnYes]="true" label="Ból palców" /></div>
          <div class="q"><span>Ból łokci lub barków</span><app-yes-no [value]="elbowPain()" (valueChange)="elbowPain.set($event)" [warnOnYes]="true" label="Ból łokci lub barków" /></div>
          <div class="q"><span>Nietypowe zmęczenie / objawy choroby</span><app-yes-no [value]="unusual()" (valueChange)="unusual.set($event)" [warnOnYes]="true" label="Nietypowe zmęczenie" /></div>
        </div>
        <label class="field">Notatka (opcjonalnie)<input [(ngModel)]="notes" /></label>

        @if (preview(); as a) {
          <div class="verdict" [class.go]="a.level === 'go'" [class.easy]="a.level === 'easy'" [class.rest]="a.level === 'rest'">
            <span class="eyebrow">Wynik</span>
            <strong>{{ a.title }}</strong>
            @for (m of a.messages; track m) { <p>{{ m }}</p> }
          </div>
        }
        <div class="foot"><button class="btn primary xl block" type="button" [disabled]="!complete() || busy()" (click)="save()">Zapisz ocenę</button></div>
      </section>

      <section class="rd-hist">
        <header class="hist-head"><h2>Ostatnie oceny</h2><span class="eyebrow">14 dni</span></header>
        @for (r of history(); track r.c.id) {
          <div class="hrow">
            <span class="d num">{{ r.c.date | datePl }}</span>
            <div class="grow">
              <strong [class.warnv]="r.a.level !== 'go'">{{ r.a.title }}</strong>
              <small class="num">S {{ r.c.wellbeing }}/5 · Z {{ r.c.fatigue }}/5 · Sen {{ r.c.sleep }}/5@if (r.c.fingerPain) { · ból palców }@if (r.c.elbowShoulderPain) { · ból łokci/barków }@if (r.c.unusualFatigue) { · nietypowe zmęczenie }</small>
              @if (r.c.notes) { <small class="faint">{{ r.c.notes }}</small> }
            </div>
            <button class="btn ghost sm" type="button" (click)="store.deleteReadiness(r.c.id)" aria-label="Usuń ocenę">✕</button>
          </div>
        } @empty { <p class="empty">Brak ocen.</p> }
      </section>
    </div>
  `,
  styles: `
    .rd { display: flex; flex-direction: column; gap: var(--s5); }
    .grp { display: flex; flex-direction: column; gap: var(--s2); }
    .qs { display: flex; flex-direction: column; border-top: 1px solid var(--border); }
    .qs > .kicker { padding: var(--s3) 0 var(--s2); }
    .q { display: grid; grid-template-columns: minmax(0, 1fr) 176px; align-items: center; gap: var(--s3); min-height: 60px; padding: 6px 0; border-top: 1px solid var(--border); font-weight: 500; }
    .verdict { display: flex; flex-direction: column; gap: 4px; padding: var(--s4); border: 1px solid var(--border-strong); border-radius: var(--radius); font-size: 0.9rem; }
    .verdict strong { font: 800 1.4rem var(--font-heading); letter-spacing: -0.02em; }
    .verdict.go { box-shadow: inset 4px 0 0 var(--accent); }
    .verdict.easy, .verdict.rest { box-shadow: inset 4px 0 0 var(--warn); border-color: var(--warn); }
    .foot { position: sticky; bottom: calc(var(--nav-h) + env(safe-area-inset-bottom)); padding: var(--s3) 0; background: linear-gradient(to top, var(--bg) 70%, transparent); }
    @media (min-width: 1024px) { .foot { bottom: 0; } }
    .rd-hist { display: flex; flex-direction: column; }
    .hist-head { display: flex; align-items: baseline; justify-content: space-between; padding-top: var(--s2); border-top: 1px solid var(--border-strong); margin-bottom: var(--s2); }
    .hrow { display: flex; align-items: flex-start; gap: var(--s3); padding: 10px 0; border-bottom: 1px solid var(--border); }
    .hrow .d { width: 92px; flex: none; font-size: 0.8rem; color: var(--muted); padding-top: 2px; }
    .hrow .grow { display: flex; flex-direction: column; gap: 2px; }
    .warnv { color: var(--warn); }
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
