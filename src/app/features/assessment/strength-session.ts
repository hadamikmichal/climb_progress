import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Assessment, CoreExercise, DeadHangEndReason, StrengthAssessment, StrengthStep } from '../../core/models/assessment';
import { strengthResults, coreTrialPoints, DEAD_HANG_MAX_SEC, FINGER_HOLD_SEC } from '../../core/logic/assessment/scoring';
import { CORE_LABELS, DEAD_HANG_END_LABELS, STRENGTH_WARMUP } from '../../core/logic/assessment/labels';
import { formatSeconds } from '../../core/logic/assessment/climbing';
import { Scale } from '../../shared/scale';
import { YesNo } from '../../shared/yes-no';
import { RestTimer } from '../../shared/rest-timer';
import { LiveClock } from '../../shared/live-clock';
import { NumberStepper } from '../../shared/number-stepper';
import { TestReadinessForm } from './readiness-form';
import { TestFigure } from './test-figure';
import { ScoreChip } from './score-chip';

type Mutator = (a: Assessment) => void;
interface PullForm { added: number; reps: number; successful: boolean | null; technique: boolean | null; rpe: number | null; notes: string }
interface FingerForm { added: number; assist: number; hold: number | null; successful: boolean | null; valid: boolean | null; rpe: number | null; notes: string }
interface CoreForm { exercise: CoreExercise; hold: number | null; valid: boolean | null }

const STEPS: { key: StrengthStep; label: string }[] = [
  { key: 'readiness', label: 'Start' },
  { key: 'warmup', label: 'Rozgrzewka' },
  { key: 'pullup', label: 'Pull-up' },
  { key: 'finger', label: 'Palce' },
  { key: 'core', label: 'Core' },
  { key: 'deadhang', label: 'Dead Hang' },
  { key: 'summary', label: 'Wynik' },
];

const SKIP_REASONS = ['Brak doświadczenia z tym ćwiczeniem', 'Brak sprzętu', 'Ból / dyskomfort', 'Inny powód'];

/** Dzień 1 – Strength Assessment (Test Mode) */
@Component({
  selector: 'app-strength-session',
  imports: [FormsModule, Scale, YesNo, RestTimer, LiveClock, NumberStepper, TestReadinessForm, TestFigure, ScoreChip],
  templateUrl: './strength-session.html',
  styleUrl: './assessment.scss',
})
export class StrengthSession {
  private readonly router = inject(Router);
  readonly assessment = input.required<Assessment>();
  readonly update = output<Mutator>();
  readonly postpone = output<string>();

  protected readonly steps = STEPS;
  protected readonly warmup = STRENGTH_WARMUP;
  protected readonly skipReasons = SKIP_REASONS;
  protected readonly coreLabels = CORE_LABELS;
  protected readonly coreKeys = Object.keys(CORE_LABELS) as CoreExercise[];
  protected readonly endLabels = DEAD_HANG_END_LABELS;
  protected readonly endKeys = Object.keys(DEAD_HANG_END_LABELS) as DeadHangEndReason[];
  protected readonly fmt = formatSeconds;
  protected readonly coreTrialPointsOf = coreTrialPoints;
  protected readonly fingerHoldSec = FINGER_HOLD_SEC;
  protected readonly deadHangMax = DEAD_HANG_MAX_SEC;
  protected readonly round1 = (n: number | null) => (n == null ? '–' : (Math.round(n * 10) / 10).toString());

  protected readonly s = computed(() => this.assessment().strength!);
  protected readonly results = computed(() => strengthResults(this.s()));
  protected readonly stepIndex = computed(() => STEPS.findIndex((x) => x.key === this.s().step));
  protected readonly bm = computed(() => this.s().readiness.bodyMassKg ?? 0);
  protected readonly locked = computed(() => this.s().status === 'completed');

  /* ---- formularze bieżącej próby (zatwierdzone próby trafiają od razu do bazy) ---- */
  protected readonly pull = signal<PullForm>({ added: 0, reps: 1, successful: null, technique: null, rpe: null, notes: '' });
  protected readonly finger = signal<FingerForm>({ added: 0, assist: 0, hold: null, successful: null, valid: null, rpe: null, notes: '' });
  protected readonly fingerStart = signal<string | null>(null);
  protected readonly core = signal<CoreForm>({ exercise: 'bent_knee_l_sit', hold: null, valid: null });
  protected readonly coreStart = signal<string | null>(null);
  protected readonly skipFor = signal<'pullup' | 'finger' | 'core' | 'deadhang' | null>(null);
  protected skipReason = SKIP_REASONS[0];

  protected readonly pullHeavy = computed(() => this.s().weightedPullUp.attempts.filter((t) => t.addedWeightKg > 0 || (t.rpe ?? 0) >= 8).length);
  protected readonly fingerHeavy = computed(() => this.s().maxFingerStrength.attempts.filter((t) => (t.rpe ?? 0) >= 8 || t.addedWeightKg > 0).length);
  protected readonly corePreview = computed(() => (this.core().hold != null ? coreTrialPoints({ exercise: this.core().exercise, holdSeconds: this.core().hold! }) : null));

  protected mutate(fn: (s: StrengthAssessment) => void) {
    this.update.emit((a) => fn(a.strength!));
  }

  protected go(step: StrengthStep) {
    this.mutate((s) => (s.step = step));
    globalThis.scrollTo?.({ top: 0 });
  }

  protected next() {
    const i = this.stepIndex();
    if (i < STEPS.length - 1) this.go(STEPS[i + 1].key);
  }

  protected canOpen(i: number): boolean {
    return i === 0 || this.s().readiness.confirmed;
  }

  /* ---------------- warunki i rozgrzewka ---------------- */

  protected readinessChanged(patch: Partial<StrengthAssessment['readiness']>) {
    this.mutate((s) => (s.readiness = { ...s.readiness, ...patch, confirmed: false }));
  }

  protected confirmReadiness() {
    this.mutate((s) => {
      s.readiness.confirmed = true;
      s.step = 'warmup';
    });
  }

  protected toggleWarmup(item: string) {
    this.mutate((s) => (s.warmupChecked = s.warmupChecked.includes(item) ? s.warmupChecked.filter((x) => x !== item) : [...s.warmupChecked, item]));
  }

  /* ---------------- pominięcie (NOT TESTED) ---------------- */

  protected confirmSkip() {
    const what = this.skipFor();
    const reason = this.skipReason;
    this.mutate((s) => {
      const r = what === 'pullup' ? s.weightedPullUp : what === 'finger' ? s.maxFingerStrength : what === 'core' ? s.coreStrength : s.deadHang;
      r.status = 'not_tested';
      r.skipReason = reason;
    });
    this.skipFor.set(null);
  }

  protected unskip(what: 'pullup' | 'finger' | 'core' | 'deadhang') {
    this.mutate((s) => {
      const r = what === 'pullup' ? s.weightedPullUp : what === 'finger' ? s.maxFingerStrength : what === 'core' ? s.coreStrength : s.deadHang;
      r.status = 'success';
      r.skipReason = '';
    });
  }

  /* ---------------- Weighted Pull-up ---------------- */

  protected pullSet<K extends keyof PullForm>(k: K, v: PullForm[K]) {
    this.pull.update((f) => ({ ...f, [k]: v }));
  }

  protected savePull() {
    const f = this.pull();
    if (f.successful == null || f.technique == null) return;
    this.mutate((s) => s.weightedPullUp.attempts.push({
      addedWeightKg: f.added, reps: f.successful ? Math.max(1, f.reps) : 0, successful: f.successful!, techniqueValid: f.technique!, rpe: f.rpe, notes: f.notes,
    }));
    this.pull.set({ added: f.successful && f.technique ? f.added + 2.5 : f.added, reps: 1, successful: null, technique: null, rpe: null, notes: '' });
  }

  /* ---------------- Max Finger Strength ---------------- */

  protected fingerSet<K extends keyof FingerForm>(k: K, v: FingerForm[K]) {
    this.finger.update((f) => ({ ...f, [k]: v }));
  }

  protected startFingerHang() {
    this.fingerStart.set(new Date().toISOString());
    this.fingerSet('hold', null);
  }

  protected stopFingerHang() {
    const st = this.fingerStart();
    if (!st) return;
    const sec = Math.round(((Date.now() - Date.parse(st)) / 1000) * 10) / 10;
    this.fingerStart.set(null);
    this.finger.update((f) => ({ ...f, hold: sec, successful: f.successful ?? sec >= FINGER_HOLD_SEC }));
  }

  protected saveFinger() {
    const f = this.finger();
    if (f.hold == null || f.successful == null || f.valid == null) return;
    this.mutate((s) => s.maxFingerStrength.attempts.push({
      addedWeightKg: f.added, assistanceKg: f.assist, holdSeconds: f.hold!, successful: f.successful!, technicallyValid: f.valid!, rpe: f.rpe, notes: f.notes,
    }));
    const ok = f.successful && f.valid && f.hold >= FINGER_HOLD_SEC;
    this.finger.set({
      added: ok ? (f.assist > 0 ? f.added : f.added + 2.5) : f.added, assist: ok && f.assist > 0 ? Math.max(0, f.assist - 2.5) : f.assist,
      hold: null, successful: null, valid: null, rpe: null, notes: '',
    });
  }

  protected setEdge(k: 'edgeDepthMm' | 'edgeLabel', v: unknown) {
    this.mutate((s) => {
      if (k === 'edgeDepthMm') s.maxFingerStrength.edgeDepthMm = v === '' || v == null ? null : Number(v);
      else s.maxFingerStrength.edgeLabel = String(v ?? '');
    });
  }

  /* ---------------- Core ---------------- */

  protected coreSet<K extends keyof CoreForm>(k: K, v: CoreForm[K]) {
    this.core.update((f) => ({ ...f, [k]: v }));
  }

  protected startCore() {
    this.coreStart.set(new Date().toISOString());
    this.coreSet('hold', null);
  }

  protected stopCore() {
    const st = this.coreStart();
    if (!st) return;
    this.coreStart.set(null);
    this.coreSet('hold', Math.round(((Date.now() - Date.parse(st)) / 1000) * 10) / 10);
  }

  protected saveCore() {
    const f = this.core();
    if (f.hold == null || f.valid == null) return;
    this.mutate((s) => s.coreStrength.attempts.push({ exercise: f.exercise, holdSeconds: f.hold!, technicallyValid: f.valid!, notes: '' }));
    this.core.set({ exercise: f.exercise, hold: null, valid: null });
  }

  protected removeAttempt(what: 'pullup' | 'finger' | 'core', i: number) {
    if (!confirm('Usunąć tę próbę?')) return;
    this.mutate((s) => {
      if (what === 'pullup') s.weightedPullUp.attempts.splice(i, 1);
      else if (what === 'finger') s.maxFingerStrength.attempts.splice(i, 1);
      else s.coreStrength.attempts.splice(i, 1);
    });
  }

  /* ---------------- Dead Hang (stoper zapisany w bazie) ---------------- */

  protected startDeadHang() {
    this.mutate((s) => {
      s.deadHang.timerStartedAt = new Date().toISOString();
      s.deadHang.holdSeconds = null;
      s.deadHang.endReason = null;
    });
  }

  protected stopDeadHang(capped = false) {
    this.mutate((s) => {
      const st = s.deadHang.timerStartedAt;
      if (!st) return;
      const sec = Math.min(DEAD_HANG_MAX_SEC, Math.round(((Date.now() - Date.parse(st)) / 1000) * 10) / 10);
      s.deadHang.holdSeconds = sec;
      s.deadHang.timerStartedAt = null;
      if (capped || sec >= DEAD_HANG_MAX_SEC) s.deadHang.endReason = 'time_cap';
    });
  }

  protected setDeadHang<K extends 'holdSeconds' | 'barDiameterMm' | 'endReason' | 'notes'>(k: K, v: StrengthAssessment['deadHang'][K]) {
    this.mutate((s) => (s.deadHang[k] = v));
  }

  protected num(v: unknown): number | null {
    return v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v);
  }

  /* ---------------- zakończenie ---------------- */

  protected setNotes(v: string) {
    this.mutate((s) => (s.notes = v));
  }

  protected finish() {
    this.mutate((s) => {
      s.status = 'completed';
      s.completedAt = new Date().toISOString();
    });
    void this.router.navigate(['/assessment', this.assessment().id]);
  }

  protected reopen() {
    this.mutate((s) => {
      s.status = 'in_progress';
      s.completedAt = null;
    });
  }
}
