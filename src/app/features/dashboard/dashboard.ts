import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AppStore } from '../../core/data/store';
import { PlannedWorkout, Weekday } from '../../core/models/models';
import { addDays, diffDays, formatDate, startOfWeek, WEEKDAY_SHORT, weekdayOf } from '../../core/logic/dates';
import { prescriptionFor, suggestPlanStart, isDeloadWeek } from '../../core/logic/plan';
import { testGradeOf, prescriptionLines, plannedShortName } from '../../core/logic/describe';
import { isPending } from '../../core/logic/scheduling';
import { summarizeTest } from '../../core/logic/reports';
import { effectiveLoadKg, formatLoad, sessionMaxPump, sessionRpe } from '../../core/logic/progression';
import { isTest, STATUS_LABELS, TEMPLATES } from '../../core/logic/templates';
import { strengthResults } from '../../core/logic/assessment/scoring';
import { climbingResults, formatSeconds } from '../../core/logic/assessment/climbing';
import { generateConclusions } from '../../core/logic/assessment/conclusions';
import { KIND_LABELS } from '../../core/logic/assessment/labels';
import { DatePlPipe } from '../../shared/pipes';
import { Icon } from '../../shared/icon';
import { MissedSheet } from '../plan/missed-sheet';
import { MoveSheet } from '../plan/move-sheet';
import { PlannedCard } from '../plan/planned-card';
import { AbilityReportView } from '../assessment/ability-report';
import { candidateTest, resolveIntake, TEST_LEVELS } from '../../core/logic/adaptive/calibration';

/** Nagłówek redakcyjny dla etapu cyklu – jedna myśl, nie statystyka */
const HEADLINES: Record<string, [string, string]> = {
  none: ['Train with intent.', 'Climb with reserve.'],
  baseline: ['Najpierw pomiar.', 'Potem plan.'],
  block1: ['Buduj bazę.', 'Zostaw siłę na crux.'],
  block2: ['Podnieś poprzeczkę.', 'Kontroluj zmęczenie.'],
  deload: ['Lżej w tym tygodniu.', 'Regeneracja to trening.'],
  final: ['Czas na retest.', 'Te same warunki.'],
  done: ['Cykl zamknięty.', 'Sprawdź, co się zmieniło.'],
};

/** Dziś – odpowiedź na pytanie „co dalej?” */
@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, FormsModule, DatePlPipe, Icon, MissedSheet, MoveSheet, PlannedCard, AbilityReportView],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  protected readonly store = inject(AppStore);
  /** Wczorajsza sesja (poza deloadem) bez samopoczucia następnego dnia */
  protected readonly followUpDue = computed(() => {
    const y = addDays(this.store.today(), -1);
    return this.store.completedSorted().find((w) => w.date === y && !w.deload && !w.followUp) ?? null;
  });
  protected readonly templates = TEMPLATES;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly shortName = plannedShortName;
  protected readonly fmtSec = formatSeconds;
  protected readonly kindLabels = KIND_LABELS;

  protected baselineDate = this.store.today();
  protected planStart = '';
  protected readonly busy = signal(false);
  protected readonly sheet = signal<{ kind: 'move' | 'missed'; p: PlannedWorkout } | null>(null);

  protected readonly cycle = this.store.cycle;

  /* ---------------- nagłówek ---------------- */

  protected readonly headline = computed(() => {
    const c = this.cycle();
    if (!c) return this.store.lastCycle() ? HEADLINES['done'] : HEADLINES['none'];
    if (c.status === 'baseline') return HEADLINES['baseline'];
    const w = this.store.currentWeek();
    if (w > c.weeks) return HEADLINES['final'];
    if (w >= 1 && isDeloadWeek(c, w)) return HEADLINES['deload'];
    const firstDeload = Math.min(...c.deloadWeeks, c.weeks + 1);
    return w >= 1 && w > firstDeload ? HEADLINES['block2'] : HEADLINES['block1'];
  });
  protected readonly weekText = computed(() => {
    const c = this.cycle();
    const w = this.store.currentWeek();
    if (!c?.planStart || w < 1 || w > c.weeks) return null;
    return { w: String(w).padStart(2, '0'), of: String(c.weeks).padStart(2, '0') };
  });

  /* ---------------- faza testu początkowego ---------------- */

  protected readonly baseline = computed(() => {
    const c = this.cycle();
    return c ? this.store.assessmentFor(c.id, 'BASELINE') : null;
  });
  /** Test w starym formacie (3 × 6a) – cykle sprzed v1.0 */
  protected readonly legacyBaseline = computed(() => {
    const c = this.cycle();
    return c ? this.store.tests().find((t) => t.cycleId === c.id && t.kind === 'BASELINE') ?? null : null;
  });
  protected readonly baselineDone = computed(() => this.baseline()?.status === 'completed' || !!this.legacyBaseline());
  protected readonly baselineSummary = computed(() => {
    const a = this.baseline();
    if (!a) return null;
    return {
      s: a.strength ? strengthResults(a.strength) : null,
      c: a.climbing ? climbingResults(a.climbing) : null,
      planned: a.climbing?.plannedAttempts ?? 4,
      focus: generateConclusions(a).focus.slice(0, 3),
    };
  });
  protected readonly legacySummary = computed(() => (this.legacyBaseline() ? summarizeTest(this.legacyBaseline()!) : null));
  protected readonly suggestedStart = computed(() => {
    const end = this.baseline()?.climbing?.date ?? this.legacyBaseline()?.date;
    const p = this.store.profile().trainingDays;
    return end ? suggestPlanStart(end > this.store.today() ? end : this.store.today(), Math.min(p.A, p.B, p.C) as Weekday) : '';
  });
  protected readonly levels = TEST_LEVELS;
  /** Kandydacka trudność testu dróg dla nowego cyklu – z wywiadu w Profilu */
  protected readonly startCandidate = computed(() => {
    const bm = this.store.cycles().map((c) => c.benchmark).find((b) => !!b);
    const cand = candidateTest(resolveIntake(this.store.profile()));
    return bm ? { ...cand, grade: bm.grade, level: bm.level } : cand;
  });
  /** Podgląd doboru planu po Baseline Test – te same funkcje, które zastosuje „Generuj plan” */
  protected readonly planPreview = computed(() => {
    const c = this.cycle();
    if (!c || c.status !== 'baseline' || !this.baselineDone()) return null;
    this.store.completed();
    return this.store.prescriptionFor(c);
  });
  protected readonly baselineItems = computed(() => this.store.cyclePlanned().filter((p) => p.type === 'BASELINE'));

  /* ---------------- następna sesja ---------------- */

  protected readonly next = this.store.nextWorkout;
  protected readonly nextInfo = computed(() => {
    const p = this.next();
    const c = this.cycle();
    if (!p || !c) return null;
    const t = TEMPLATES[p.type];
    const pr = prescriptionFor(c, p.week);
    const parts = t.exercises.filter((e) => e.kind !== 'technique').length;
    const prev = isTest(p.type) ? null : this.store.completedSorted().find((w) => w.type === p.type) ?? null;
    const a = isTest(p.type) && p.part ? this.store.assessmentFor(p.cycleId, p.type) : null;
    const partState = a ? (p.part === 'strength' ? a.strength : a.climbing)?.status : null;
    return {
      p, t, lines: prescriptionLines(p.type, pr.params, p.part, testGradeOf(c)), deload: !isTest(p.type) && pr.deload,
      parts, prev, prevRpe: prev ? sessionRpe(prev) : null, prevPump: prev ? sessionMaxPump(prev) : null,
      startLink: isTest(p.type) ? [p.part ? '/assessment/run' : '/test', p.id] : ['/session', p.id],
      resumable: !!this.store.getDraft(p.id) || partState === 'in_progress',
      when: p.date === this.store.today() ? 'Dziś' : p.date === addDays(this.store.today(), 1) ? 'Jutro' : formatDate(p.date),
    };
  });

  /* ---------------- tydzień ---------------- */

  protected readonly week = computed(() => {
    const t = this.store.today();
    const s = startOfWeek(t);
    const items = this.store.cyclePlanned().filter((p) => p.date >= s && p.date <= addDays(s, 6));
    return items.map((p) => ({
      p, day: WEEKDAY_SHORT[weekdayOf(p.date)], date: p.date, isToday: p.date === t,
      status: p.status === 'done' ? 'Wykonany' : p.status === 'partial' ? 'Częściowo' : p.status === 'skipped' ? 'Pominięty' : p.date < t ? 'Zaległy' : p.date === t ? 'Dziś' : 'Zaplanowany',
      cls: p.status === 'done' ? 'done' : p.status === 'partial' ? 'partial' : p.status === 'skipped' || (isPending(p.status) && p.date < t) ? 'skipped' : 'planned',
    }));
  });
  protected readonly weekDone = computed(() => this.week().filter((x) => x.p.status === 'done' || x.p.status === 'partial').length);

  /* ---------------- ostatnie wyniki ---------------- */

  protected readonly lastHang = computed(() => {
    const w = this.store.completedSorted().find((x) => x.hangs.length);
    if (!w) return null;
    const h = w.hangs[0];
    return { w, h, load: formatLoad(h), eff: effectiveLoadKg(h) };
  });
  protected readonly lastSession = computed(() => {
    const w = this.store.completedSorted()[0];
    if (!w) return null;
    return { w, rpe: sessionRpe(w), pump: sessionMaxPump(w), sent: w.routes.filter((r) => r.completed).length, total: w.routes.length };
  });
  protected readonly lastTest = computed(() => {
    const a = this.store.completedAssessments().at(-1);
    if (!a) return null;
    const c = a.climbing ? climbingResults(a.climbing) : null;
    const s = a.strength ? strengthResults(a.strength) : null;
    return { a, c, s };
  });

  /* ---------------- regeneracja ---------------- */

  protected readonly recovery = computed(() => {
    const last = this.store.lastHeavy();
    const days = last ? diffDays(last, this.store.today()) : null;
    const a = this.store.todayAssessment();
    let text: string;
    let tone: 'ok' | 'warn' = 'ok';
    if (a && a.level !== 'go') { text = a.messages[0]; tone = 'warn'; }
    else if (days == null) text = 'Brak ciężkich jednostek w historii.';
    else if (days === 0) { text = 'Dziś była ciężka jednostka – jutro bez treningu siłowego.'; tone = 'warn'; }
    else if (days === 1) { text = 'Wczoraj była ciężka jednostka. Dziś tylko lekki ruch lub odpoczynek.'; tone = 'warn'; }
    else text = 'Regeneracja wystarczająca do ciężkiej jednostki.';
    return { days, text, tone, assessment: a };
  });

  protected readonly lastEvents = computed(() => this.store.eventsSorted().filter((e) => e.kind !== 'plan').slice(0, 2));
  protected readonly completedCycle = computed(() => {
    if (this.cycle()) return null;
    const c = this.store.lastCycle();
    if (!c) return null;
    return { cycle: c, final: this.store.assessmentFor(c.id, 'FINAL'), legacyFinal: this.store.testsFor(c.id).find((t) => t.kind === 'FINAL') };
  });

  protected readonly focusLabel = (f: { label: string }) => f.label;

  async startCycle() {
    this.busy.set(true);
    await this.store.startCycle(this.baselineDate || this.store.today());
    this.busy.set(false);
  }

  async generatePlan() {
    this.busy.set(true);
    await this.store.generatePlan(this.planStart || this.suggestedStart());
    this.busy.set(false);
  }
}
