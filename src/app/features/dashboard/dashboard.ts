import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import type { ChartConfiguration } from 'chart.js';
import { AppStore } from '../../core/data/store';
import { addDays, diffDays, startOfWeek } from '../../core/logic/dates';
import { suggestPlanStart } from '../../core/logic/plan';
import { isPending } from '../../core/logic/scheduling';
import { routesByWeek, regularitySummary } from '../../core/logic/stats';
import { summarizeTest, RESERVE_LABELS } from '../../core/logic/reports';
import { sessionMaxPump, sessionRpe } from '../../core/logic/progression';
import { maxGrade } from '../../core/logic/grades';
import { TYPE_SHORT, TEMPLATES } from '../../core/logic/templates';
import { Weekday } from '../../core/models/models';
import { PlannedCard } from '../plan/planned-card';
import { ScoreChip } from '../assessment/score-chip';
import { strengthResults } from '../../core/logic/assessment/scoring';
import { climbingResults } from '../../core/logic/assessment/climbing';
import { generateConclusions } from '../../core/logic/assessment/conclusions';
import { ChartView } from '../../shared/chart';
import { DatePlPipe } from '../../shared/pipes';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, FormsModule, PlannedCard, ChartView, DatePlPipe, ScoreChip],
  templateUrl: './dashboard.html',
})
export class Dashboard {
  protected readonly store = inject(AppStore);
  protected readonly typeShort = TYPE_SHORT;
  protected readonly templates = TEMPLATES;
  protected readonly reserveLabels = RESERVE_LABELS;

  protected baselineDate = this.store.today();
  protected planStart = '';
  protected readonly busy = signal(false);

  protected readonly cycle = this.store.cycle;

  /** Baseline Test v1.0 bieżącego cyklu (rekord istnieje od rozpoczęcia pierwszej sesji) */
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
    const a = this.baseline();
    const end = a?.climbing?.date ?? this.legacyBaseline()?.date;
    const p = this.store.profile().trainingDays;
    return end ? suggestPlanStart(end > this.store.today() ? end : this.store.today(), Math.min(p.A, p.B, p.C) as Weekday) : '';
  });

  protected readonly week = computed(() => {
    const t = this.store.today();
    const s = startOfWeek(t);
    const e = addDays(s, 6);
    const items = this.store.cyclePlanned().filter((p) => (p.date >= s && p.date <= e) || (p.status === 'skipped' && p.originalDate >= s && p.originalDate <= e));
    const uniq = [...new Map(items.map((i) => [i.id, i])).values()];
    return {
      total: uniq.length,
      done: uniq.filter((p) => p.status === 'done').length,
      partial: uniq.filter((p) => p.status === 'partial').length,
      skipped: uniq.filter((p) => p.status === 'skipped').length,
      left: uniq.filter((p) => isPending(p.status)).length,
    };
  });

  protected readonly regularity = computed(() => regularitySummary(this.store.cyclePlanned(), this.store.completed().filter((w) => w.cycleId === this.cycle()?.id), this.store.today()));
  protected readonly cyclePct = computed(() => {
    const all = this.store.cyclePlanned();
    const settled = all.filter((p) => !isPending(p.status)).length;
    return all.length ? Math.round((settled / all.length) * 100) : 0;
  });

  protected readonly recent = computed(() => this.store.completedSorted().slice(0, 3).map((w) => ({
    w, rpe: sessionRpe(w), pump: sessionMaxPump(w),
    routes: w.routes.filter((r) => r.completed).length, total: w.routes.length,
    hardest: maxGrade(w.routes.filter((r) => r.completed).map((r) => r.grade)),
  })));

  protected readonly hardestRecent = computed(() => {
    const since = addDays(this.store.today(), -42);
    return maxGrade(this.store.completed().filter((w) => w.date >= since).flatMap((w) => w.routes.filter((r) => r.completed).map((r) => r.grade)));
  });

  protected readonly recovery = computed(() => {
    const last = this.store.lastHeavy();
    const days = last ? diffDays(last, this.store.today()) : null;
    const a = this.store.todayAssessment();
    const next = this.store.nextWorkout();
    let text: string;
    if (a && a.level !== 'go') text = a.messages[0];
    else if (days == null) text = 'Brak ciężkich jednostek w historii.';
    else if (days === 0) text = 'Dziś była ciężka jednostka – jutro bez treningu siłowego.';
    else if (days === 1) text = 'Wczoraj była ciężka jednostka. Dziś tylko lekki trening lub odpoczynek.';
    else text = `${days} dni od ostatniej ciężkiej jednostki – regeneracja wystarczająca.`;
    return { days, text, assessment: a, nextHeavy: next ? TEMPLATES[next.type].heavy : false };
  });

  protected readonly lastReport = computed(() => {
    const c = this.cycle() ?? this.store.lastCycle();
    return c ? [...this.store.reports()].filter((r) => r.cycleId === c.id).sort((a, b) => b.week - a.week)[0] ?? null : null;
  });
  protected readonly lastEvents = computed(() => this.store.eventsSorted().filter((e) => e.kind !== 'plan').slice(0, 3));

  protected readonly miniChart = computed<ChartConfiguration | null>(() => {
    const weeks = routesByWeek(this.store.completed()).slice(-6);
    if (!weeks.length) return null;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#d6f54a';
    return {
      type: 'bar',
      data: {
        labels: weeks.map((w) => w.weekStart.slice(5).split('-').reverse().join('.')),
        datasets: [{ label: 'Ukończone drogi', data: weeks.map((w) => w.completed), backgroundColor: accent, borderRadius: 6 }],
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } } },
    };
  });

  protected readonly completedCycle = computed(() => {
    if (this.cycle()) return null;
    const c = this.store.lastCycle();
    if (!c) return null;
    const tests = this.store.testsFor(c.id);
    return { cycle: c, final: this.store.assessmentFor(c.id, 'FINAL'), legacyFinal: tests.find((t) => t.kind === 'FINAL') };
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
