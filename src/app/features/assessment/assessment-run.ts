import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AppStore } from '../../core/data/store';
import { Assessment } from '../../core/models/assessment';
import { KIND_LABELS, PART_LABELS, TEST_STATUS_LABELS } from '../../core/logic/assessment/labels';
import { TEMPLATES } from '../../core/logic/templates';
import { DatePlPipe } from '../../shared/pipes';
import { StrengthSession } from './strength-session';
import { ClimbingSession } from './climbing-session';

/**
 * Test Mode – aktywna sesja Baseline Test v1.0 (dzień 1 lub 2) dla zaplanowanej jednostki.
 * Każda zatwierdzona zmiana trafia od razu do IndexedDB (kolejka zapisów), więc test można
 * przerwać, odświeżyć stronę lub zamknąć telefon i wrócić do niego później.
 */
@Component({
  selector: 'app-assessment-run',
  imports: [RouterLink, DatePlPipe, StrengthSession, ClimbingSession],
  template: `
    @let p = planned();
    <div class="page">
      @if (!p || !p.part) {
        <div class="card"><h2>Nie znaleziono sesji testu</h2><a class="btn" routerLink="/plan">Wróć do planu</a></div>
      } @else {
        <header class="page-head">
          <div>
            <div class="eyebrow">{{ kindLabel() }} · {{ p.date | datePl }}</div>
            <h1>{{ partLabel() }}</h1>
          </div>
          <a class="btn sm" routerLink="/">Przerwij</a>
        </header>
        @if (local(); as a) {
          @if (saveError()) { <div class="note bad">{{ saveError() }}</div> }
          @if (p.part === 'strength' && a.strength) {
            <app-strength-session [assessment]="a" (update)="apply($event)" (postpone)="postpone($event)" />
          } @else if (p.part === 'climbing' && a.climbing) {
            <app-climbing-session [assessment]="a" [referenceRoute]="referenceRoute()" (update)="apply($event)" (postpone)="postpone($event)" />
          }
          <p class="faint center small">Status sesji: {{ statusLabel() }} · zapis automatyczny</p>
          @if (partStatus() !== 'completed') {
            <button class="btn ghost block" type="button" (click)="discard()">Porzuć tę sesję (usuń jej dane)</button>
          }
        } @else {
          <section class="card hero">
            <p class="muted">{{ template().goal }}</p>
            @if (partStatus() === 'postponed') { <div class="note warn">Sesja była przełożona. Rozpoczęcie utworzy ją od nowa.</div> }
            <ul class="presc">
              @if (p.part === 'strength') {
                <li>Weighted Pull-up 1RM · Max Finger Strength 20 mm / 5 s · Core · Dead Hang</li>
                <li>ok. 60–75 min, każdy pomiar ma protokół, jednostkę i punktację 9c</li>
              } @else {
                <li>{{ p.type === 'CONTROL' ? 3 : 4 }} × 6a na tej samej drodze, przerwy dokładnie 3:00</li>
                <li>Czas każdej drogi, RPE, pompowanie · Recovery Curve 0–3 min</li>
              }
              <li>Wyniki zapisują się automatycznie – test można przerwać i wznowić.</li>
            </ul>
            <button class="btn primary xl" type="button" (click)="begin()" [disabled]="busy()">Rozpocznij sesję</button>
          </section>
        }
      }
    </div>
  `,
  styles: `.presc { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 2px; } .center { text-align: center; } .small { font-size: 0.8rem; }`,
})
export class AssessmentRunPage {
  protected readonly store = inject(AppStore);
  private readonly router = inject(Router);
  /** Id zaplanowanej jednostki */
  readonly id = input.required<string>();

  protected readonly busy = signal(false);
  protected readonly saveError = signal<string | null>(null);
  /** Lokalna kopia robocza – zmiany nakładane synchronicznie, zapisy kolejkowane */
  protected readonly local = signal<Assessment | null>(null);
  private queue: Promise<void> = Promise.resolve();

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
