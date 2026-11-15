import { Component, computed, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AppStore } from '../../core/data/store';
import { AscentStyle, CompletedWorkout, Exercise, GripPosition } from '../../core/models/models';
import { easyParams, prescriptionFor } from '../../core/logic/plan';
import { prescriptionLines } from '../../core/logic/describe';
import { assessSession, formatLoad, ProgressionDecision, SessionAssessment } from '../../core/logic/progression';
import { GRADES, shiftGrade } from '../../core/logic/grades';
import { now, uid } from '../../core/logic/ids';
import { ASCENT_LABELS, GRIP_LABELS, TEMPLATES, TYPE_SHORT, isTest } from '../../core/logic/templates';
import { formatClock, pauseTimer, resumeTimer, timerProgress, timerRemaining } from '../../core/logic/timer';
import { Scale } from '../../shared/scale';
import { YesNo } from '../../shared/yes-no';
import { Icon } from '../../shared/icon';
import { DatePlPipe } from '../../shared/pipes';
import { beep } from '../../shared/beep';
import { LeaveGuarded } from '../../shared/leave-guard';
import {
  advanceTimers, DraftRoute, draftToCompleted, elapsedMin, HARD_ROUTE_REST_SEC, missingParts, newDraft, RouteState, startHang, startRest, WorkoutDraft,
} from './session-draft';

type Phase = 'setup' | 'active' | 'summary' | 'result';

/**
 * Active Workout Mode – pełnoekranowy „player” treningu.
 * Jeden krok naraz, duży timer, jeden główny przycisk. Każda zmiana trafia od razu do szkicu w IndexedDB,
 * a timer jest odtwarzany ze znaczników czasu (odświeżenie / powrót do aplikacji nie przerywa sesji).
 */
@Component({
  selector: 'app-session',
  imports: [RouterLink, FormsModule, Scale, YesNo, Icon, DatePlPipe],
  templateUrl: './session.html',
  styleUrl: './session.scss',
})
export class SessionPage implements LeaveGuarded {
  protected readonly store = inject(AppStore);
  private readonly router = inject(Router);

  /** ID zaplanowanej jednostki (parametr trasy) */
  readonly id = input.required<string>();
  /** ?partial=1 – zapis treningu wykonanego częściowo */
  readonly partial = input<string | undefined>();

  protected readonly grades = GRADES;
  protected readonly gripLabels = GRIP_LABELS;
  protected readonly grips = Object.keys(GRIP_LABELS) as GripPosition[];
  protected readonly ascentLabels = ASCENT_LABELS;
  protected readonly ascents = Object.keys(ASCENT_LABELS) as AscentStyle[];
  protected readonly formatLoad = formatLoad;
  protected readonly clock = formatClock;
  protected readonly Math = Math;

  protected readonly phase = signal<Phase>('setup');
  protected readonly draft = signal<WorkoutDraft | null>(null);
  protected readonly editHang = signal(false);
  protected readonly menu = signal(false);
  protected readonly busy = signal(false);
  protected readonly saved = signal(false);
  protected readonly result = signal<{ workout: CompletedWorkout; assessment: SessionAssessment; decisions: ProgressionDecision[] } | null>(null);
  protected readonly nowMs = signal(Date.now());

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

  /* ---------- kroki ---------- */
  /** Kroki playera: ćwiczenia szablonu (priorytety techniczne pokazujemy w kroku dróg) */
  protected readonly steps = computed<Exercise[]>(() => this.template()?.exercises.filter((e) => e.kind !== 'technique') ?? []);
  protected readonly technique = computed(() => this.template()?.exercises.find((e) => e.kind === 'technique')?.checklist ?? []);
  protected readonly stepIndex = computed(() => Math.min(this.draft()?.step ?? 0, Math.max(0, this.steps().length - 1)));
  protected readonly step = computed(() => this.steps()[this.stepIndex()] ?? null);
  protected readonly isLastStep = computed(() => this.stepIndex() >= this.steps().length - 1);
  protected readonly stepDone = (e: Exercise) => {
    const d = this.draft();
    if (!d) return false;
    if (e.kind === 'hangboard') return !!d.hang && !d.hang.blocked && d.hang.setsDone >= d.hang.setsPlanned;
    if (e.kind === 'routes' || e.kind === 'circuit') return d.routes.length > 0 && d.routes.every((r) => r.state !== 'todo');
    if (e.kind === 'hard_routes') return d.routes.length > 0;
    return !!d.exercises.find((x) => x.exerciseId === e.id)?.done;
  };

  /* ---------- timer ---------- */
  protected readonly timer = computed(() => this.draft()?.timer ?? null);
  protected readonly remaining = computed(() => {
    const t = this.timer();
    return t ? timerRemaining(t, this.nowMs()) : 0;
  });
  protected readonly timerPct = computed(() => {
    const t = this.timer();
    return t ? Math.min(100, timerProgress(t, this.nowMs()) * 100) : 0;
  });

  /* ---------- drogi ---------- */
  protected readonly setRoutes = computed(() => {
    const d = this.draft();
    return d ? d.routes.filter((r) => r.setIndex === d.currentSet) : [];
  });
  protected readonly setFinished = computed(() => this.setRoutes().length > 0 && this.setRoutes().every((r) => r.state !== 'todo'));
  protected readonly hardAttempts = computed(() => this.draft()?.routes.filter((r) => r.setIndex === 0) ?? []);
  protected readonly routesDone = computed(() => this.draft()?.routes.filter((r) => r.state !== 'todo').length ?? 0);
  /** Bieżąca droga w kroku dróg (B) lub obwodu (C) – pierwsza niezaliczona */
  protected readonly currentRoute = computed<DraftRoute | null>(() => {
    const d = this.draft();
    if (!d) return null;
    const pool = d.type === 'C' ? this.setRoutes() : d.routes;
    return pool.find((r) => r.state === 'todo') ?? null;
  });
  protected readonly currentRouteNo = computed(() => {
    const d = this.draft();
    const r = this.currentRoute();
    if (!d) return 0;
    const pool = d.type === 'C' ? this.setRoutes() : d.routes;
    return r ? pool.indexOf(r) + 1 : pool.length;
  });
  /** Ostatnio zaliczona droga – szybka ocena pompowania w czasie przerwy */
  protected readonly lastRoute = computed<DraftRoute | null>(() => {
    const d = this.draft();
    if (!d) return null;
    const pool = (d.type === 'C' ? this.setRoutes() : d.routes).filter((r) => r.state !== 'todo');
    return pool.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))[0] ?? null;
  });
  protected readonly lastAttempt = computed(() => this.hardAttempts().at(-1) ?? null);

  protected newGrade = '';
  private wakeLock: { release(): Promise<void> } | null = null;

  constructor() {
    const tick = setInterval(() => this.nowMs.set(Date.now()), 250);
    const onUnload = (e: BeforeUnloadEvent) => {
      if (this.phase() === 'active' || this.phase() === 'summary') e.preventDefault();
    };
    const onVisible = () => {
      this.nowMs.set(Date.now());
      if (document.visibilityState === 'visible' && this.phase() === 'active') void this.lockScreen();
    };
    globalThis.addEventListener?.('beforeunload', onUnload);
    document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(tick);
      globalThis.removeEventListener?.('beforeunload', onUnload);
      document.removeEventListener('visibilitychange', onVisible);
      void this.wakeLock?.release().catch(() => undefined);
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
          this.draft.set({ step: 0, timer: null, ...existing.data });
          this.phase.set('active');
          void this.lockScreen();
        }
      });
    });
    // Przejścia faz timera: zwis → przerwa → gotowość (sygnał dźwiękowy + wibracja)
    effect(() => {
      const t = this.nowMs();
      untracked(() => {
        const d = this.draft();
        if (!d?.timer || this.phase() !== 'active') return;
        const before = d.timer.kind;
        const next = structuredClone(d);
        if (advanceTimers(next, t)) {
          const live = t - Date.parse(d.timer.startedAt) < (d.timer.durationSec + 3) * 1000;
          if (live) beep(before === 'work' ? 1 : 2);
          this.draft.set(next);
          this.save();
        }
      });
    });
  }

  /** Strażnik wyjścia: aktywny trening wymaga potwierdzenia (dane i tak są zapisane) */
  canLeave(): boolean {
    return this.phase() === 'setup' || this.phase() === 'result';
  }
  leaveMessage(): string {
    return 'Trening trwa. Wyniki są zapisane – możesz wrócić do niego z ekranu Dziś. Wyjść teraz?';
  }

  private async lockScreen() {
    try {
      const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
      if (wl && !this.wakeLock) this.wakeLock = await wl.request('screen');
    } catch { /* brak wsparcia */ }
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
    void this.lockScreen();
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
    this.saved.set(true);
  }

  private flush() {
    const d = this.draft();
    if (!d || this.phase() === 'result') return;
    void this.store.saveDraft({ id: d.plannedId, kind: 'workout', startedAt: d.startedAt, updatedAt: now(), data: d });
  }

  protected goStep(i: number) {
    this.patch((d) => (d.step = Math.max(0, Math.min(this.steps().length - 1, i))));
    this.menu.set(false);
    globalThis.scrollTo?.({ top: 0 });
  }

  protected next() {
    if (this.isLastStep()) this.toSummary();
    else this.goStep(this.stepIndex() + 1);
  }

  protected toggleCheck(exId: string, item: string, all: string[]) {
    this.patch((d) => {
      const e = d.exercises.find((x) => x.exerciseId === exId)!;
      e.checked = e.checked.includes(item) ? e.checked.filter((c) => c !== item) : [...e.checked, item];
      e.done = all.length > 0 && all.every((c) => e.checked.includes(c));
    });
  }

  protected completeWarmup(exId: string, items: string[] = []) {
    this.patch((d) => {
      const e = d.exercises.find((x) => x.exerciseId === exId)!;
      e.done = true;
      e.checked = [...items];
      d.step = Math.min(this.steps().length - 1, (d.step ?? 0) + 1);
    });
  }

  protected exLog(exId: string) {
    return this.draft()?.exercises.find((x) => x.exerciseId === exId) ?? null;
  }

  /* ---------------- timer ---------------- */

  protected startHangTimer() {
    this.patch((d) => startHang(d, now()));
  }

  protected togglePause() {
    this.patch((d) => {
      if (!d.timer) return;
      d.timer = d.timer.pausedAt ? resumeTimer(d.timer, now()) : pauseTimer(d.timer, now());
    });
  }

  protected skipTimer() {
    this.patch((d) => {
      // przerwanie zwisu nie zalicza serii – serię zaliczasz ręcznie, jeśli była pełna
      d.timer = null;
    });
  }

  protected restFor(sec: number, label: string) {
    this.patch((d) => startRest(d, label, sec, now()));
  }

  /* ---------------- zwisy ---------------- */

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
      if (k === 'pain' && v === true) {
        d.hang.notes = d.hang.notes || 'Ból/dyskomfort podczas zwisów';
        d.timer = null;
      }
    });
  }

  protected stopHangs() {
    this.patch((d) => {
      if (d.hang) d.hang.setsPlanned = Math.max(d.hang.setsDone, 0);
      d.timer = null;
    });
  }

  /* ---------------- drogi ---------------- */

  /** Zalicz bieżącą drogę i od razu uruchom przerwę wg planu */
  protected completeRoute(state: RouteState) {
    const r = this.currentRoute();
    const d = this.draft();
    if (!r || !d) return;
    this.patch((x) => {
      const route = x.routes.find((y) => y.id === r.id)!;
      route.state = state;
      route.timestamp = now();
      if (x.type === 'B') {
        const left = x.routes.some((y) => y.state === 'todo');
        if (left) startRest(x, 'Odpoczynek między drogami', x.params.aerobic.restMin * 60, now());
      }
      if (x.type === 'C') {
        const inSet = x.routes.filter((y) => y.setIndex === x.currentSet);
        const left = inSet.some((y) => y.state === 'todo');
        if (left) startRest(x, 'Odpoczynek między drogami', x.params.powerEndurance.restBetweenRoutesMin * 60, now());
      }
    });
  }

  protected setRouteState(id: string, s: RouteState) {
    this.patch((d) => {
      const r = d.routes.find((x) => x.id === id)!;
      r.state = r.state === s ? 'todo' : s;
      r.timestamp = now();
    });
  }

  protected routeField<K extends keyof DraftRoute>(id: string, k: K, v: DraftRoute[K]) {
    this.patch((d) => {
      const r = d.routes.find((x) => x.id === id)!;
      r[k] = v;
    });
  }

  protected bumpGrade(id: string, dir: 1 | -1) {
    const r = this.draft()?.routes.find((x) => x.id === id);
    if (r) this.routeField(id, 'grade', shiftGrade(r.grade, dir));
  }

  protected addAttempt(sent: boolean) {
    const d = this.draft();
    if (!d) return;
    const grade = this.newGrade || this.lastAttempt()?.grade || d.params.hardRoutes.gradeFrom;
    this.patch((x) => {
      x.routes.push({ id: uid(), setIndex: 0, grade, state: sent ? 'sent' : 'fell', pump: null, rpe: null, cruxSent: sent ? true : null, ascent: null, notes: '', timestamp: now() });
      startRest(x, 'Pełna przerwa między próbami', HARD_ROUTE_REST_SEC, now());
    });
  }

  protected shiftNewGrade(dir: 1 | -1) {
    const base = this.newGrade || this.lastAttempt()?.grade || this.draft()?.params.hardRoutes.gradeFrom || '6b';
    this.newGrade = shiftGrade(base, dir);
  }

  protected removeRoute(id: string) {
    if (!confirm('Usunąć tę próbę?')) return;
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

  /** Następna seria obwodu – z przerwą między seriami */
  protected nextSet() {
    const d = this.draft();
    if (!d) return;
    this.patch((x) => {
      x.currentSet = Math.min(x.sets.length, x.currentSet + 1);
      startRest(x, 'Przerwa między seriami', x.params.powerEndurance.restBetweenSetsMin * 60, now());
    });
  }

  /* ---------------- zakończenie ---------------- */

  protected toSummary() {
    this.patch((d) => {
      d.timer = null;
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
    this.menu.set(false);
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
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
    globalThis.scrollTo?.({ top: 0 });
  }

  protected async discard() {
    if (!confirm('Porzucić trening? Wszystkie zapisane w nim wyniki zostaną trwale usunięte.')) return;
    if (!confirm('Na pewno? Tej operacji nie można cofnąć.')) return;
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
