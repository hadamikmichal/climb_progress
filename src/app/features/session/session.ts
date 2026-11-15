import { Component, computed, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppStore } from '../../core/data/store';
import { CompletedWorkout, GripPosition } from '../../core/models/models';
import { easyParams, prescriptionFor } from '../../core/logic/plan';
import { prescriptionLines } from '../../core/logic/describe';
import { assessSession, formatLoad, ProgressionDecision, SessionAssessment } from '../../core/logic/progression';
import { GRADES } from '../../core/logic/grades';
import { now, uid } from '../../core/logic/ids';
import { GRIP_LABELS, TEMPLATES, TYPE_SHORT, isTest } from '../../core/logic/templates';
import { Scale } from '../../shared/scale';
import { YesNo } from '../../shared/yes-no';
import { RestTimer } from '../../shared/rest-timer';
import { DatePlPipe } from '../../shared/pipes';
import { DraftRoute, draftToCompleted, elapsedMin, missingParts, newDraft, RouteState, WorkoutDraft } from './session-draft';

type Phase = 'setup' | 'active' | 'summary' | 'result';

@Component({
  selector: 'app-session',
  imports: [RouterLink, NgTemplateOutlet, FormsModule, Scale, YesNo, RestTimer, DatePlPipe],
  templateUrl: './session.html',
  styleUrl: './session.scss',
})
export class SessionPage {
  protected readonly store = inject(AppStore);
  private readonly router = inject(Router);

  /** ID zaplanowanej jednostki (parametr trasy) */
  readonly id = input.required<string>();
  /** ?partial=1 – zapis treningu wykonanego częściowo */
  readonly partial = input<string | undefined>();

  protected readonly grades = GRADES;
  protected readonly gripLabels = GRIP_LABELS;
  protected readonly grips = Object.keys(GRIP_LABELS) as GripPosition[];
  protected readonly formatLoad = formatLoad;

  protected readonly phase = signal<Phase>('setup');
  protected readonly draft = signal<WorkoutDraft | null>(null);
  protected readonly editHang = signal(false);
  protected readonly openRoute = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly result = signal<{ workout: CompletedWorkout; assessment: SessionAssessment; decisions: ProgressionDecision[] } | null>(null);
  private readonly nowMs = signal(Date.now());

  protected readonly planned = computed(() => this.store.getPlanned(this.id()));
  protected readonly cycle = computed(() => {
    const p = this.planned();
    return p ? this.store.cycles().find((c) => c.id === p.cycleId) ?? null : null;
  });
  protected readonly template = computed(() => {
    const p = this.planned();
    return p ? TEMPLATES[p.type] : null;
  });
  protected readonly typeName = computed(() => (this.planned() ? TYPE_SHORT[this.planned()!.type] : ''));
  protected readonly presc = computed(() => {
    const c = this.cycle();
    const p = this.planned();
    return c && p ? prescriptionFor(c, p.week) : null;
  });
  protected readonly prescLines = computed(() => {
    const p = this.planned();
    const pr = this.presc();
    return p && pr ? prescriptionLines(p.type, pr.params) : [];
  });
  protected readonly assessment = this.store.todayAssessment;
  protected readonly elapsed = computed(() => (this.draft() ? elapsedMin(this.draft()!.startedAt, this.nowMs()) : 0));
  protected readonly missing = computed(() => (this.draft() ? missingParts(this.draft()!) : []));

  protected readonly setRoutes = computed(() => {
    const d = this.draft();
    return d ? d.routes.filter((r) => r.setIndex === d.currentSet) : [];
  });
  protected readonly setFinished = computed(() => this.setRoutes().length > 0 && this.setRoutes().every((r) => r.state !== 'todo'));
  protected readonly hardAttempts = computed(() => this.draft()?.routes.filter((r) => r.setIndex === 0) ?? []);
  protected readonly routesDone = computed(() => this.draft()?.routes.filter((r) => r.state !== 'todo').length ?? 0);

  protected newGrade = '';


  constructor() {
    const tick = setInterval(() => this.nowMs.set(Date.now()), 30_000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(tick);
      this.flush();
    });
    // Wczytanie szkicu (po odświeżeniu strony trening jest kontynuowany)
    effect(() => {
      const id = this.id();
      untracked(() => {
        if (this.draft()) return;
        const p = this.store.getPlanned(id);
        if (!p) return;
        if (isTest(p.type)) {
          void this.router.navigate([p.part ? '/assessment/run' : '/test', id], { replaceUrl: true });
          return;
        }
        const existing = this.store.getDraft<WorkoutDraft>(id);
        if (existing?.kind === 'workout') {
          this.draft.set(existing.data);
          this.phase.set('active');
        }
      });
    });
  }

  /* ---------------- start ---------------- */

  protected start(light: boolean) {
    const p = this.planned();
    const pr = this.presc();
    if (!p || !pr) return;
    const a = this.assessment();
    const params = light ? easyParams(pr.params) : pr.params;
    const hangBlocked = !!a && !a.allowHangboard;
    const d = newDraft(p, params, pr.deload, light, now(), hangBlocked);
    if (this.partial()) d.forcePartial = true;
    this.draft.set(d);
    this.phase.set('active');
    this.save();
  }

  /* ---------------- edycja szkicu ---------------- */

  protected patch(fn: (d: WorkoutDraft) => void) {
    const cur = this.draft();
    if (!cur) return;
    const next = structuredClone(cur);
    fn(next);
    this.draft.set(next);
    this.save();
  }

  /** Zapis natychmiast po każdej zmianie – zamknięcie karty lub telefonu nie gubi danych */
  private save() {
    this.flush();
  }

  private flush() {
    const d = this.draft();
    if (!d || this.phase() === 'result') return;
    void this.store.saveDraft({ id: d.plannedId, kind: 'workout', startedAt: d.startedAt, updatedAt: now(), data: d });
  }

  protected toggleCheck(exId: string, item: string, all: string[]) {
    this.patch((d) => {
      const e = d.exercises.find((x) => x.exerciseId === exId)!;
      e.checked = e.checked.includes(item) ? e.checked.filter((c) => c !== item) : [...e.checked, item];
      e.done = all.length > 0 && all.every((c) => e.checked.includes(c));
    });
  }

  protected markDone(exId: string, items: string[] = []) {
    this.patch((d) => {
      const e = d.exercises.find((x) => x.exerciseId === exId)!;
      e.done = !e.done;
      e.checked = e.done ? [...items] : [];
    });
  }

  protected exLog(exId: string) {
    return this.draft()?.exercises.find((x) => x.exerciseId === exId) ?? null;
  }

  /* zwisy */
  protected setHangSets(n: number) {
    this.patch((d) => {
      if (!d.hang) return;
      d.hang.setsDone = d.hang.setsDone === n ? n - 1 : n;
    });
  }

  protected hangField<K extends keyof NonNullable<WorkoutDraft['hang']>>(k: K, v: NonNullable<WorkoutDraft['hang']>[K]) {
    this.patch((d) => {
      if (!d.hang) return;
      d.hang[k] = v;
      if (k === 'pain' && v === true) d.hang.notes = d.hang.notes || 'Ból/dyskomfort podczas zwisów';
    });
  }

  protected stopHangs() {
    this.patch((d) => {
      if (d.hang) d.hang.setsPlanned = Math.max(d.hang.setsDone, 0);
    });
  }

  /* drogi */
  protected setRouteState(id: string, s: RouteState) {
    this.patch((d) => {
      const r = d.routes.find((x) => x.id === id)!;
      r.state = r.state === s ? 'todo' : s;
      r.timestamp = now();
    });
    this.openRoute.set(this.draft()!.routes.find((x) => x.id === id)!.state === 'todo' ? null : id);
  }

  protected routeField<K extends keyof DraftRoute>(id: string, k: K, v: DraftRoute[K]) {
    this.patch((d) => {
      const r = d.routes.find((x) => x.id === id)!;
      r[k] = v;
    });
  }

  protected addAttempt(sent: boolean) {
    const d = this.draft();
    if (!d) return;
    const grade = this.newGrade || d.params.hardRoutes.gradeFrom;
    this.patch((x) => {
      x.routes.push({ id: uid(), setIndex: 0, grade, state: sent ? 'sent' : 'fell', pump: null, rpe: null, cruxSent: sent ? true : null, notes: '', timestamp: now() });
    });
  }

  protected removeRoute(id: string) {
    this.patch((d) => {
      d.routes = d.routes.filter((r) => r.id !== id);
    });
  }

  protected addExtraRoute() {
    this.patch((d) => {
      const last = d.routes[d.routes.length - 1];
      d.routes.push({ id: uid(), setIndex: d.type === 'C' ? d.currentSet : 0, grade: last?.grade ?? d.params.aerobic.grade, state: 'todo', pump: null, rpe: null, cruxSent: null, notes: '', timestamp: now() });
    });
  }

  protected setLog(i: number) {
    return this.draft()?.sets.find((s) => s.setIndex === i) ?? null;
  }

  protected setField(i: number, k: 'rpe' | 'pump' | 'notes', v: number | string | null) {
    this.patch((d) => {
      const s = d.sets.find((x) => x.setIndex === i)!;
      (s as unknown as Record<string, unknown>)[k] = v;
    });
  }

  protected goSet(n: number) {
    this.patch((d) => (d.currentSet = n));
  }

  /* ---------------- zakończenie ---------------- */

  protected toSummary() {
    this.patch((d) => {
      if (d.durationMin == null) d.durationMin = Math.max(1, this.elapsed());
      if (d.type === 'C' && d.rpe == null) {
        const r = d.sets.map((s) => s.rpe).filter((x): x is number => x != null);
        if (r.length) d.rpe = Math.max(...r);
      }
      if (d.type === 'C' && d.pump == null) {
        const p = d.sets.map((s) => s.pump).filter((x): x is number => x != null);
        if (p.length) d.pump = Math.max(...p);
      }
    });
    this.phase.set('summary');
    globalThis.scrollTo?.({ top: 0 });
  }

  protected async finish() {
    const d = this.draft();
    const p = this.planned();
    const c = this.cycle();
    if (!d || !p || !c) return;
    this.busy.set(true);
    const ts = now();
    // Data faktycznego wykonania (można ją poprawić w Historii)
    const date = this.store.today();
    const w = draftToCompleted(d, p, c, ts, date);
    const decisions = await this.store.completeWorkout(w);
    this.result.set({ workout: w, assessment: assessSession(w), decisions });
    this.phase.set('result');
    this.busy.set(false);
    globalThis.scrollTo?.({ top: 0 });
  }

  protected async discard() {
    if (!confirm('Porzucić rozpoczęty trening? Zapisane w nim dane zostaną usunięte.')) return;
    await this.store.deleteDraft(this.id());
    this.draft.set(null);
    this.phase.set('setup');
    void this.router.navigate(['/plan']);
  }

  protected setVal<K extends 'rpe' | 'pump' | 'technique' | 'feelingAfter' | 'durationMin' | 'notes' | 'forcePartial'>(k: K, v: WorkoutDraft[K]) {
    this.patch((d) => {
      d[k] = v;
    });
  }

  protected readonly isProgress = (d: ProgressionDecision) => d.action === 'progress';

  protected range(n: number): number[] {
    return Array.from({ length: Math.max(0, n) }, (_, i) => i);
  }
}
