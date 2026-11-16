import { Component, computed, DestroyRef, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Assessment, ClimbingAssessment, ClimbingStyle, RECOVERY_POINTS, RecoveryPoint, RouteAttempt, TestRoute, WallStyle } from '../../core/models/assessment';
import { climbingPhase, climbingResults, formatSeconds, validAttempts } from '../../core/logic/assessment/climbing';
import { CLIMBING_WARMUP, PUMP_SCALE, STYLE_LABELS, WALL_LABELS, pumpText } from '../../core/logic/assessment/labels';
import { hoursBetween } from '../../core/logic/assessment/factory';
import { GRADES } from '../../core/logic/grades';
import { beep } from '../../shared/beep';
import { Scale } from '../../shared/scale';
import { YesNo } from '../../shared/yes-no';
import { LiveClock } from '../../shared/live-clock';
import { TestReadinessForm } from './readiness-form';
import { TestFigure } from './test-figure';
import { BaselineSteps, stepNumber } from './baseline-steps';

type Mutator = (a: Assessment) => void;
type Step = 'readiness' | 'warmup' | 'route' | 'test';

/** Dzień 2 – Climbing Performance: 4 próby (3 w teście pośrednim) na trudności z kalibracji / benchmarku + Recovery Curve */
@Component({
  selector: 'app-climbing-session',
  imports: [FormsModule, Scale, YesNo, LiveClock, TestReadinessForm, TestFigure, BaselineSteps],
  templateUrl: './climbing-session.html',
  styleUrl: './assessment.scss',
})
export class ClimbingSession {
  private readonly router = inject(Router);
  readonly assessment = input.required<Assessment>();
  /** Trasa z testu odniesienia (Baseline) – przy retestach ta sama droga */
  readonly referenceRoute = input<TestRoute | null>(null);
  /** Trudność wymagana przez kalibrację lub zablokowany benchmark */
  readonly targetGrade = input<string | null>(null);
  readonly calibrating = input(false);
  readonly benchmarkLocked = input(false);
  readonly update = output<Mutator>();
  readonly postpone = output<string>();

  protected readonly grades = GRADES;
  protected readonly warmup = CLIMBING_WARMUP;
  protected readonly wallLabels = WALL_LABELS;
  protected readonly wallKeys = Object.keys(WALL_LABELS) as WallStyle[];
  protected readonly styleLabels = STYLE_LABELS;
  protected readonly styleKeys = Object.keys(STYLE_LABELS) as ClimbingStyle[];
  protected readonly pumpScale = PUMP_SCALE;
  protected readonly pumpText = pumpText;
  protected readonly fmt = formatSeconds;
  protected readonly points = RECOVERY_POINTS;
  protected readonly Math = Math;

  protected readonly c = computed(() => this.assessment().climbing!);
  protected readonly phase = computed(() => climbingPhase(this.c()));
  protected readonly stats = computed(() => climbingResults(this.c()));
  protected readonly locked = computed(() => this.c().status === 'completed');
  protected readonly valid = computed(() => validAttempts(this.c().attempts));
  protected readonly current = computed<RouteAttempt | null>(() => this.c().attempts[this.c().attempts.length - 1] ?? null);
  protected readonly currentIndex = computed(() => this.c().attempts.length - 1);
  /** Numer kolejnej ważnej próby (1..N) */
  protected readonly nextNumber = computed(() => this.valid().length + 1);
  protected readonly hoursSinceStrength = computed(() => {
    const s = this.assessment().strength;
    return s?.completedAt ? hoursBetween(s.completedAt, this.c().readiness.testedAt) : null;
  });
  protected readonly isLastValid = computed(() => this.valid().length + 1 >= this.c().plannedAttempts);
  protected readonly routeOk = computed(() => !!this.c().route.name.trim());
  protected readonly routeDiffers = computed(() => {
    const ref = this.referenceRoute();
    const r = this.c().route;
    if (!ref) return false;
    return ref.routeId ? ref.routeId !== r.routeId : ref.name.trim().toLowerCase() !== r.name.trim().toLowerCase();
  });

  /** Krok przygotowania (przed właściwym testem) – lokalnie, bo wynika z danych */
  protected readonly manualStep = signal<Step | null>(null);
  protected readonly step = computed<Step>(() => {
    const m = this.manualStep();
    if (m) return m;
    const c = this.c();
    if (!c.readiness.confirmed) return 'readiness';
    if (c.attempts.length || c.status === 'completed') return 'test';
    if (c.warmupChecked.length < CLIMBING_WARMUP.length) return 'warmup';
    return this.routeOk() ? 'test' : 'route';
  });

  /** Krok wskaźnika: przygotowanie i próby = Climbing Test, regeneracja = Recovery Curve (w teście pośrednim warunki to krok 01) */
  protected readonly stepNo = computed(() => {
    const kind = this.assessment().kind;
    const st = this.step();
    const ph = this.phase();
    if (st === 'test' && (ph === 'recovery' || ph === 'done')) return stepNumber(kind, 'recovery');
    if (kind === 'CONTROL' && (st === 'readiness' || st === 'warmup')) return stepNumber(kind, 'readiness');
    return stepNumber(kind, 'climbing');
  });
  protected readonly stepTitle = computed(() => {
    const st = this.step();
    const ph = this.phase();
    if (st === 'readiness') return 'Readiness';
    if (st === 'warmup') return 'Rozgrzewka';
    if (st === 'route') return 'Droga testowa';
    if (ph === 'recovery') return 'Recovery Curve';
    if (ph === 'done') return 'Wynik sesji';
    return 'Climbing Test';
  });

  /** Pozostałe (jeszcze niewykonane) ważne próby – puste pola w liczniku */
  protected readonly pendingSlots = computed(() => {
    const c = this.c();
    if (c.stoppedByFatigue) return [];
    const cur = this.current();
    const used = this.valid().length + (cur && !cur.saved && cur.status !== 'invalid' ? 1 : 0);
    const shown = c.attempts.length;
    return Array.from({ length: Math.max(0, c.plannedAttempts - used) }, (_, i) => shown + i + 1);
  });

  /* ---- recovery: zegar i sygnały ---- */
  private readonly nowMs = signal(Date.now());
  protected readonly recElapsed = computed(() => {
    const s = this.c().recoveryStartedAt;
    return s ? Math.max(0, (this.nowMs() - Date.parse(s)) / 1000) : 0;
  });
  /** Pomiar, który należy teraz wpisać */
  protected readonly duePoint = computed<RecoveryPoint | null>(() => {
    const e = this.recElapsed();
    const pending = this.c().recoveryCurve.filter((m) => m.forearmPump == null && m.elapsedSeconds <= e + 2);
    return pending[0]?.elapsedSeconds ?? null;
  });
  protected readonly nextPoint = computed(() => this.points.find((t) => t > this.recElapsed()) ?? null);
  private beeped = new Set<string>();

  constructor() {
    const h = setInterval(() => this.nowMs.set(Date.now()), 250);
    inject(DestroyRef).onDestroy(() => clearInterval(h));
    // sygnał dźwiękowy w momentach pomiaru 1, 2, 3 min
    effect(() => {
      const e = this.recElapsed();
      const start = this.c().recoveryStartedAt;
      if (!start || this.phase() !== 'recovery') return;
      untracked(() => {
        for (const t of [60, 120, 180]) {
          const key = `${start}|${t}`;
          if (e >= t && e < t + 3 && !this.beeped.has(key)) {
            this.beeped.add(key);
            beep(2);
          }
        }
      });
    });
  }

  protected mutate(fn: (c: ClimbingAssessment) => void) {
    this.update.emit((a) => fn(a.climbing!));
  }

  /* ---------------- przygotowanie ---------------- */

  protected readinessChanged(patch: Partial<ClimbingAssessment['readiness']>) {
    this.mutate((c) => (c.readiness = { ...c.readiness, ...patch, confirmed: false }));
  }

  protected confirmReadiness() {
    this.mutate((c) => (c.readiness.confirmed = true));
    this.manualStep.set(null);
  }

  protected toggleWarmup(item: string) {
    // zostajemy na rozgrzewce do kliknięcia „Dalej” (bez automatycznego przeskoku po ostatnim punkcie)
    this.manualStep.set('warmup');
    this.mutate((c) => (c.warmupChecked = c.warmupChecked.includes(item) ? c.warmupChecked.filter((x) => x !== item) : [...c.warmupChecked, item]));
  }

  protected setRoute<K extends keyof TestRoute>(k: K, v: TestRoute[K]) {
    this.mutate((c) => {
      c.route = { ...c.route, [k]: v };
      const ref = this.referenceRoute();
      if (ref) {
        const r = c.route;
        c.routeChanged = ref.routeId ? ref.routeId !== r.routeId : ref.name.trim().toLowerCase() !== r.name.trim().toLowerCase();
      }
    });
  }

  /** Jawne oznaczenie zmiany protokołu względem benchmarku – z powodem podanym przez użytkownika */
  protected setProtocolReason(reason: string) {
    this.mutate((c) => {
      c.protocolChange = reason.trim() ? { reason: reason.trim(), fields: ['grade'] } : null;
    });
  }

  protected useReferenceRoute() {
    const ref = this.referenceRoute();
    if (!ref) return;
    this.mutate((c) => {
      c.route = { ...ref };
      c.routeChanged = false;
    });
  }

  protected goStep(s: Step | null) {
    this.manualStep.set(s);
    globalThis.scrollTo?.({ top: 0 });
  }

  /* ---------------- próby ---------------- */

  /** Timer startuje przy pierwszym ruchu z pozycji startowej */
  protected startAttempt() {
    const ts = new Date().toISOString();
    this.mutate((c) => {
      const rest = c.restStartedAt ? Math.round((Date.parse(ts) - Date.parse(c.restStartedAt)) / 1000) : null;
      c.attempts.push({
        index: c.attempts.length + 1, status: 'success', startedAt: ts, endedAt: null, ascentTimeSeconds: null, restBeforeSeconds: rest,
        completed: null, failReason: null, rpe: null, forearmPump: null, techniqueDegraded: null, problemMove: null, failurePoint: '', notes: '', saved: false,
      });
      c.restStartedAt = null;
    });
  }

  /** Stop po kontrolowanym osiągnięciu końcowego chwytu (bez opuszczania) albo przy odpadnięciu */
  protected stopAttempt(topped: boolean) {
    const ts = new Date().toISOString();
    this.mutate((c) => {
      const a = c.attempts[c.attempts.length - 1];
      if (!a?.startedAt || a.endedAt) return;
      a.endedAt = ts;
      a.ascentTimeSeconds = Math.round(((Date.parse(ts) - Date.parse(a.startedAt)) / 1000) * 10) / 10;
      a.completed = topped;
      if (!topped) a.status = 'failed';
      // ostatnia planowana droga → krzywa regeneracji startuje natychmiast
      if (topped && validAttempts(c.attempts).length + 1 >= c.plannedAttempts) c.recoveryStartedAt = ts;
    });
  }

  protected attemptSet<K extends keyof RouteAttempt>(k: K, v: RouteAttempt[K]) {
    this.mutate((c) => {
      const a = c.attempts[c.attempts.length - 1];
      if (!a) return;
      a[k] = v;
      if (k === 'completed') {
        a.status = v ? 'success' : a.failReason === 'non_effort' ? 'invalid' : 'failed';
        if (v) {
          a.failReason = null;
        }
      }
      if (k === 'failReason') {
        a.status = v === 'non_effort' ? 'invalid' : 'failed';
        if (v === 'fatigue') c.recoveryStartedAt = a.endedAt;
        else if (validAttempts(c.attempts).length + 1 < c.plannedAttempts) c.recoveryStartedAt = null;
      }
      if (k === 'ascentTimeSeconds' && a.endedAt == null) a.endedAt = new Date().toISOString();
    });
  }

  protected onGround() {
    this.mutate((c) => (c.restStartedAt = new Date().toISOString()));
  }

  protected readonly canSaveAttempt = computed(() => {
    const a = this.current();
    if (!a || a.saved) return false;
    if (a.completed == null || a.rpe == null || a.forearmPump == null) return false;
    if (a.completed === false && a.failReason == null) return false;
    return true;
  });

  protected saveAttempt() {
    this.mutate((c) => {
      const a = c.attempts[c.attempts.length - 1];
      if (!a) return;
      a.saved = true;
      if (a.completed === false && a.failReason === 'fatigue') {
        // narastające zmęczenie → koniec testu, bez wymuszania pozostałych prób
        c.stoppedByFatigue = true;
        c.recoveryStartedAt ??= a.endedAt;
      }
      const done = validAttempts(c.attempts).length >= c.plannedAttempts || c.stoppedByFatigue;
      if (done) {
        c.recoveryStartedAt ??= a.endedAt;
        const zero = c.recoveryCurve.find((m) => m.elapsedSeconds === 0);
        if (zero && zero.forearmPump == null) zero.forearmPump = a.forearmPump;
      } else if (a.status === 'invalid') {
        c.recoveryStartedAt = null;
      }
    });
    globalThis.scrollTo?.({ top: 0 });
  }

  protected editAttempt(i: number) {
    this.mutate((c) => {
      const a = c.attempts[i];
      if (!a) return;
      // edycja wyłącznie ostatniej próby – inne poprawia się po zakończeniu w raporcie
      if (i === c.attempts.length - 1) a.saved = false;
    });
  }

  protected removeLastAttempt() {
    if (!confirm('Usunąć ostatnią próbę (np. start przez pomyłkę)?')) return;
    this.mutate((c) => {
      c.attempts.pop();
      c.stoppedByFatigue = false;
      c.recoveryStartedAt = null;
    });
  }

  protected endEarly() {
    if (!confirm('Zakończyć test teraz? Pozostałe próby zostaną oznaczone jako niewykonane.')) return;
    this.mutate((c) => {
      c.stoppedByFatigue = true;
      const last = validAttempts(c.attempts).at(-1);
      c.recoveryStartedAt ??= last?.endedAt ?? new Date().toISOString();
    });
  }

  /* ---------------- krzywa regeneracji ---------------- */

  protected setRecovery(t: RecoveryPoint, v: number | null) {
    this.mutate((c) => {
      const m = c.recoveryCurve.find((x) => x.elapsedSeconds === t);
      if (m) m.forearmPump = v;
    });
  }

  protected restartRecovery() {
    if (!confirm('Uruchomić pomiar regeneracji od nowa? Wpisane wartości zostaną usunięte.')) return;
    this.mutate((c) => {
      c.recoveryStartedAt = new Date().toISOString();
      c.recoveryCurve = c.recoveryCurve.map((m) => ({ ...m, forearmPump: null }));
    });
  }

  /* ---------------- zakończenie ---------------- */

  protected setNotes(v: string) {
    this.mutate((c) => (c.notes = v));
  }

  protected finish() {
    this.mutate((c) => {
      c.status = 'completed';
      c.completedAt = new Date().toISOString();
    });
    void this.router.navigate(['/assessment', this.assessment().id]);
  }

  protected reopen() {
    this.mutate((c) => {
      c.status = 'in_progress';
      c.completedAt = null;
    });
  }

  protected num(v: unknown): number | null {
    return v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v);
  }
}
