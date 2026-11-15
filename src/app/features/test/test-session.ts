import { Component, computed, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AppStore } from '../../core/data/store';
import { CruxCheck, GripPosition, HangboardCheck, TestResult, TestRouteLog } from '../../core/models/models';
import { GRADES } from '../../core/logic/grades';
import { now, uid } from '../../core/logic/ids';
import { GRIP_LABELS, TEMPLATES, TYPE_SHORT, isTest } from '../../core/logic/templates';
import { RESERVE_LABELS } from '../../core/logic/reports';
import { Scale } from '../../shared/scale';
import { YesNo } from '../../shared/yes-no';
import { RestTimer } from '../../shared/rest-timer';

interface TestDraft {
  plannedId: string;
  startedAt: string;
  warmupDone: boolean;
  step: number; // 0..2 drogi, 3 = pomiar dodatkowy / podsumowanie
  routes: (Omit<TestRouteLog, 'completed' | 'techniqueDegraded'> & { completed: boolean | null; techniqueDegraded: boolean | null })[];
  withCrux: boolean;
  crux: CruxCheck;
  withHang: boolean;
  hang: HangboardCheck;
  reserve: number | null;
  notes: string;
}

/** Test powtarzalności 3 × 6a (początkowy, kontrolny, końcowy) */
@Component({
  selector: 'app-test-session',
  imports: [RouterLink, FormsModule, Scale, YesNo, RestTimer],
  templateUrl: './test-session.html',
  styles: `
    .seg { display: flex; gap: 6px; }
    .seg button { flex: 1; min-height: 48px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface-2); color: var(--muted); font: inherit; font-weight: 700; cursor: pointer; }
    .seg button.on { color: var(--text); border-color: var(--accent); background: var(--surface-3); }
    .seg button.done { color: var(--ok); }
    ol { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 4px; }
    .stepper { display: grid; grid-template-columns: 56px 1fr 56px; align-items: center; gap: 8px; text-align: center; }
    .stepper .num { font-size: 1.6rem; font-weight: 800; }
    .caps { text-transform: uppercase; }
  `,
})
export class TestSessionPage {
  protected readonly store = inject(AppStore);
  private readonly router = inject(Router);
  readonly id = input.required<string>();

  protected readonly grades = GRADES;
  protected readonly grips = Object.keys(GRIP_LABELS) as GripPosition[];
  protected readonly gripLabels = GRIP_LABELS;
  protected readonly reserveLabels = RESERVE_LABELS;

  protected readonly draft = signal<TestDraft | null>(null);
  protected readonly busy = signal(false);

  protected readonly planned = computed(() => this.store.getPlanned(this.id()));
  protected readonly template = computed(() => (this.planned() ? TEMPLATES[this.planned()!.type] : null));
  protected readonly typeName = computed(() => (this.planned() ? TYPE_SHORT[this.planned()!.type] : ''));
  protected readonly kind = computed(() => this.planned()?.type);
  protected readonly baseline = computed(() => {
    const p = this.planned();
    return p ? this.store.tests().find((t) => t.cycleId === p.cycleId && t.kind === 'BASELINE') ?? null : null;
  });
  protected readonly baselineGrades = computed(() => this.baseline()?.routes.map((r) => r.grade).join(', ') ?? '');
  protected readonly canSave = computed(() => {
    const d = this.draft();
    return !!d && d.routes.every((r) => r.completed != null);
  });


  constructor() {
    inject(DestroyRef).onDestroy(() => this.flush());
    effect(() => {
      const id = this.id();
      untracked(() => {
        if (this.draft()) return;
        const p = this.store.getPlanned(id);
        if (!p) return;
        if (!isTest(p.type)) {
          void this.router.navigate(['/session', id], { replaceUrl: true });
          return;
        }
        const ex = this.store.getDraft<TestDraft>(id);
        if (ex?.kind === 'test') this.draft.set(ex.data);
      });
    });
  }

  protected start() {
    const p = this.planned();
    if (!p) return;
    const c = this.store.cycles().find((x) => x.id === p.cycleId);
    const prevTests = this.store.testsFor(p.cycleId);
    const base = this.baseline();
    const lastHang = [...prevTests].reverse().find((t) => t.kind !== 'BASELINE' && 'hangboard' in t && t.hangboard)?.hangboard ?? null;
    const h = c?.params.hangboard;
    const d: TestDraft = {
      plannedId: p.id,
      startedAt: now(),
      warmupDone: false,
      step: 0,
      routes: [0, 1, 2].map((i) => ({
        order: i + 1, grade: base?.routes[i]?.grade ?? '6a', completed: null, rpe: null, pump: null, techniqueDegraded: null, notes: '',
      })),
      withCrux: p.type !== 'BASELINE',
      crux: { attempts: 0, sent: 0 },
      withHang: p.type !== 'BASELINE',
      hang: lastHang
        ? { ...lastHang, rpe: null }
        : { edge: h?.edge ?? 'Krawądka', grip: h?.grip ?? 'half_crimp', hangSec: h?.hangSec ?? 10, addedKg: h?.addedKg ?? 0, assistKg: h?.assistKg ?? 0, rpe: null },
      reserve: null,
      notes: '',
    };
    this.draft.set(d);
    this.save();
  }

  protected patch(fn: (d: TestDraft) => void) {
    const cur = this.draft();
    if (!cur) return;
    const n = structuredClone(cur);
    fn(n);
    this.draft.set(n);
    this.save();
  }

  protected route(i: number, k: string, v: unknown) {
    this.patch((d) => ((d.routes[i] as unknown as Record<string, unknown>)[k] = v));
  }

  protected set<K extends keyof TestDraft>(k: K, v: TestDraft[K]) {
    this.patch((d) => (d[k] = v));
  }

  protected crux(k: keyof CruxCheck, delta: number) {
    this.patch((d) => {
      d.crux[k] = Math.max(0, d.crux[k] + delta);
      if (d.crux.sent > d.crux.attempts) d.crux.attempts = d.crux.sent;
    });
  }

  protected hang<K extends keyof HangboardCheck>(k: K, v: HangboardCheck[K]) {
    this.patch((d) => (d.hang[k] = v));
  }

  /** Zapis natychmiast po każdej zmianie – zamknięcie karty lub telefonu nie gubi danych */
  private save() {
    this.flush();
  }

  private flush() {
    const d = this.draft();
    if (!d || this.busy()) return;
    void this.store.saveDraft({ id: d.plannedId, kind: 'test', startedAt: d.startedAt, updatedAt: now(), data: d });
  }

  protected async finish() {
    const d = this.draft();
    const p = this.planned();
    if (!d || !p || !isTest(p.type)) return;
    this.busy.set(true);
    const ts = now();
    const routes: TestRouteLog[] = d.routes.map((r) => ({ ...r, completed: !!r.completed, techniqueDegraded: !!r.techniqueDegraded }));
    const crux = d.withCrux && d.crux.attempts > 0 ? d.crux : null;
    const hangboard = d.withHang ? d.hang : null;
    const base = { id: uid(), cycleId: p.cycleId, plannedWorkoutId: p.id, date: this.store.today(), createdAt: ts, updatedAt: ts, routes, reserve: d.reserve, notes: d.notes };
    const t: TestResult = p.type === 'CONTROL'
      ? { ...base, kind: 'CONTROL', afterWeek: Math.max(1, p.week - 1), crux, hangboard }
      : { ...base, kind: p.type, crux, hangboard };
    await this.store.saveTest(t);
    void this.router.navigate(['/tests', t.id], { replaceUrl: true });
  }

  protected async discard() {
    if (!confirm('Porzucić rozpoczęty test? Wpisane wyniki zostaną usunięte.')) return;
    await this.store.deleteDraft(this.id());
    this.draft.set(null);
  }
}
