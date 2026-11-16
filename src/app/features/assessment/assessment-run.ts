import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AppStore } from '../../core/data/store';
import { LeaveGuarded } from '../../shared/leave-guard';
import { Assessment } from '../../core/models/assessment';
import { KIND_LABELS, PART_LABELS, TEST_STATUS_LABELS } from '../../core/logic/assessment/labels';
import { TEMPLATES } from '../../core/logic/templates';
import { DatePlPipe } from '../../shared/pipes';
import { StrengthSession } from './strength-session';
import { ClimbingSession } from './climbing-session';
import { BaselineSteps, stepNumber } from './baseline-steps';
import { Icon } from '../../shared/icon';

/**
 * Test Mode – aktywna sesja Baseline Test v1.0 (dzień 1 lub 2) dla zaplanowanej jednostki.
 * Każda zatwierdzona zmiana trafia od razu do IndexedDB (kolejka zapisów), więc test można
 * przerwać, odświeżyć stronę lub zamknąć telefon i wrócić do niego później.
 */
@Component({
  selector: 'app-assessment-run',
  imports: [RouterLink, DatePlPipe, StrengthSession, ClimbingSession, Icon, BaselineSteps],
  template: `
    @let p = planned();
    <div class="page run">
      @if (!p || !p.part) {
        <div class="card"><h2>Nie znaleziono sesji testu</h2><a class="btn" routerLink="/plan">Wróć do planu</a></div>
      } @else {
        <header class="run-bar">
          <a class="icon-btn" routerLink="/" aria-label="Przerwij – wyniki są zapisane"><app-icon name="x" /></a>
          <div class="grow">
            <div class="eyebrow">{{ kindLabel() }}</div>
            <div class="run-title">{{ partLabel() }}</div>
          </div>
          <span class="eyebrow saved" [class.err]="!!saveError()">{{ saveError() ? 'błąd zapisu' : local() ? 'zapis auto' : (p.date | datePl) }}</span>
        </header>
        @if (local(); as a) {
          @if (saveError()) { <div class="note bad">{{ saveError() }}</div> }
          @if (p.part === 'strength' && a.strength) {
            <app-strength-session [assessment]="a" (update)="apply($event)" (postpone)="postpone($event)" />
          } @else if (p.part === 'climbing' && a.climbing) {
            <app-climbing-session [assessment]="a" [referenceRoute]="referenceRoute()" (update)="apply($event)" (postpone)="postpone($event)" />
          }
          @if (partStatus() !== 'completed') {
            <button class="btn ghost block discard" type="button" (click)="discard()">Porzuć tę sesję (usuń jej dane)</button>
          }
        } @else {
          <app-baseline-steps [kind]="kind()" [current]="introStep()" />
          <section class="intro">
            <h1 class="intro-title">{{ partLabel() }}</h1>
            <p class="muted">{{ template().goal }}</p>
            @if (partStatus() === 'postponed') { <p class="note warn">Sesja była przełożona. Rozpoczęcie utworzy ją od nowa.</p> }
            <ul class="facts">
              @if (p.part === 'strength') {
                <li><span class="num">02</span>Weighted Pull-up 1RM</li>
                <li><span class="num">03</span>Max Hang · 20 mm / 5 s</li>
                <li><span class="num">04</span>Core · L-sit / Front Lever</li>
                <li><span class="num">05</span>Dead Hang · maks. 6:00</li>
                <li><span class="num">⏱</span>ok. 60–75 min</li>
              } @else {
                <li><span class="num">{{ p.type === 'CONTROL' ? '×3' : '×4' }}</span>6a na tej samej drodze · przerwy 3:00</li>
                <li><span class="num">⏱</span>Czas, RPE i pompowanie po każdej próbie</li>
                <li><span class="num">↘</span>Recovery Curve · 0, 1, 2, 3 min</li>
              }
              <li><span class="num">✓</span>Autozapis – test można przerwać i wznowić</li>
            </ul>
          </section>
          <div class="step-foot">
            <button class="btn primary xl" type="button" (click)="begin()" [disabled]="busy()">Rozpocznij sesję</button>
          </div>
        }
      }
    </div>
  `,
  styles: `
    .run { max-width: 640px; padding-top: 0; gap: var(--s5); }
    .run-bar { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: var(--s2); padding: calc(var(--s2) + env(safe-area-inset-top)) 0 var(--s2); background: var(--color-background); border-bottom: 1px solid var(--color-border); }
    .run-title { font-family: var(--font-heading); font-weight: 700; font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .icon-btn { display: inline-grid; place-items: center; width: 48px; height: 48px; border-radius: 8px; color: var(--color-text-primary); --icon: 22px; flex: none; }
    .icon-btn:hover { background: var(--color-surface); }
    .saved { white-space: nowrap; }
    .saved.err { color: var(--color-warning); }
    .intro { display: flex; flex-direction: column; gap: var(--s4); }
    .intro-title { font-size: clamp(2.2rem, 9vw, 3rem); line-height: 0.95; letter-spacing: -0.035em; }
    .facts { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--color-border); }
    .facts li { display: flex; gap: var(--s3); padding: 12px 0; border-bottom: 1px solid var(--color-border); font-weight: 500; }
    .facts .num { color: var(--color-primary-strong); min-width: 28px; }
    .step-foot { position: sticky; bottom: 0; padding: var(--s3) 0 calc(var(--s3) + env(safe-area-inset-bottom)); background: linear-gradient(to top, var(--color-background) 70%, transparent); }
    .discard { margin-top: var(--s5); }
  `,
})
export class AssessmentRunPage implements LeaveGuarded {
  protected readonly store = inject(AppStore);
  private readonly router = inject(Router);
  /** Id zaplanowanej jednostki */
  readonly id = input.required<string>();

  protected readonly busy = signal(false);
  protected readonly saveError = signal<string | null>(null);
  /** Lokalna kopia robocza – zmiany nakładane synchronicznie, zapisy kolejkowane */
  protected readonly local = signal<Assessment | null>(null);
  private queue: Promise<void> = Promise.resolve();

  /** Strażnik wyjścia: sesja testu w trakcie wymaga potwierdzenia (wyniki i tak są zapisane) */
  canLeave(): boolean {
    return !this.local() || this.partStatus() === 'completed' || this.partStatus() === 'postponed';
  }
  leaveMessage(): string {
    return 'Test trwa. Wyniki są zapisane – możesz go wznowić z ekranu Dziś. Wyjść teraz?';
  }

  protected readonly planned = computed(() => this.store.getPlanned(this.id()));
  protected readonly template = computed(() => TEMPLATES[this.planned()?.type ?? 'BASELINE']);
  protected readonly kindLabel = computed(() => {
    const t = this.planned()?.type;
    return t === 'BASELINE' || t === 'CONTROL' || t === 'FINAL' ? KIND_LABELS[t] : '';
  });
  protected readonly partLabel = computed(() => {
    const p = this.planned();
    if (!p?.part) return '';
    return p.type === 'CONTROL' ? 'Test pośredni 3 × 6a' : PART_LABELS[p.part];
  });
  protected readonly kind = computed(() => {
    const t = this.planned()?.type;
    return t === 'CONTROL' || t === 'FINAL' ? t : 'BASELINE';
  });
  protected readonly introStep = computed(() => {
    const p = this.planned();
    if (p?.part === 'strength' || p?.type === 'CONTROL') return 1;
    return stepNumber(this.kind(), 'climbing');
  });
  protected readonly stored = computed(() => {
    const p = this.planned();
    if (!p || (p.type !== 'BASELINE' && p.type !== 'CONTROL' && p.type !== 'FINAL')) return null;
    return this.store.assessmentFor(p.cycleId, p.type);
  });
  protected readonly partStatus = computed(() => {
    const p = this.planned();
    const a = this.local() ?? this.stored();
    const s = p?.part === 'strength' ? a?.strength : a?.climbing;
    return s?.status ?? null;
  });
  protected readonly statusLabel = computed(() => (this.partStatus() ? TEST_STATUS_LABELS[this.partStatus()!] : '–'));
  protected readonly referenceRoute = computed(() => {
    const p = this.planned();
    if (!p) return null;
    const own = p.type !== 'BASELINE' ? this.store.assessmentFor(p.cycleId, 'BASELINE')?.climbing?.route : null;
    if (own) return own;
    const prev = this.store.completedAssessments().filter((a) => a.cycleId !== p.cycleId && a.climbing).at(-1);
    return prev?.climbing?.route ?? null;
  });

  constructor() {
    // Wznowienie: jeśli sesja tej jednostki jest już rozpoczęta, od razu otwieramy Test Mode
    effect(() => {
      const a = this.stored();
      const p = this.planned();
      untracked(() => {
        if (this.local() || !a || !p?.part) return;
        const s = p.part === 'strength' ? a.strength : a.climbing;
        if (s && s.status !== 'postponed') this.local.set(structuredClone(a));
      });
    });
  }

  protected async begin() {
    this.busy.set(true);
    try {
      const a = await this.store.beginAssessmentPart(this.id());
      this.local.set(structuredClone(a));
    } catch (e) {
      this.saveError.set(e instanceof Error ? e.message : 'Nie udało się rozpocząć sesji.');
    } finally {
      this.busy.set(false);
    }
  }

  protected apply(fn: (a: Assessment) => void) {
    const cur = this.local();
    if (!cur) return;
    const next = structuredClone(cur);
    fn(next);
    this.local.set(next);
    this.queue = this.queue
      .then(() => this.store.saveAssessment(next))
      .then(() => this.saveError.set(null))
      .catch((e) => {
        console.error(e);
        this.saveError.set('Nie udało się zapisać zmian w bazie. Nie zamykaj aplikacji i spróbuj ponownie.');
      });
  }

  protected async postpone(reason: string) {
    const a = this.local();
    const p = this.planned();
    if (!a || !p?.part) return;
    await this.queue;
    await this.store.postponeAssessmentPart(a.id, p.part, reason);
    this.local.set(null);
    void this.router.navigate(['/plan']);
  }

  protected async discard() {
    const a = this.local();
    const p = this.planned();
    if (!a || !p?.part) return;
    if (!confirm('Porzucić tę sesję? Zapisane w niej wyniki zostaną usunięte.')) return;
    await this.queue;
    await this.store.discardAssessmentPart(a.id, p.part);
    this.local.set(null);
  }
}
