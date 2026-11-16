import { Component, computed, inject, input, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AppStore } from '../../core/data/store';
import { Assessment } from '../../core/models/assessment';
import { strengthResults } from '../../core/logic/assessment/scoring';
import { climbingResults, formatSeconds } from '../../core/logic/assessment/climbing';
import { compareBaselineResults } from '../../core/logic/assessment/compare';
import { generateConclusions } from '../../core/logic/assessment/conclusions';
import { CORE_LABELS, DEAD_HANG_END_LABELS, KIND_LABELS, PART_LABELS, STYLE_LABELS, TEST_STATUS_LABELS, WALL_LABELS } from '../../core/logic/assessment/labels';
import { demoAssessments } from '../../core/logic/assessment/demo';
import { AbilityReportView } from './ability-report';
import { CalibrationOutcome } from '../../core/models/models';
import { ChartView } from '../../shared/chart';
import { DatePlPipe } from '../../shared/pipes';
import { BaselineSteps, stepsFor } from './baseline-steps';
import { Icon } from '../../shared/icon';
import { baselineVsRetestChart, pumpByAttemptChart, recoveryCurveChart, routeTimingChart } from './assessment-charts';

const r1 = (n: number | null | undefined) => (n == null ? '–' : String(Math.round(n * 10) / 10));

/** Raport Baseline / Retest / testu pośredniego + porównanie Baseline vs Retest */
@Component({
  selector: 'app-assessment-report',
  imports: [AbilityReportView, RouterLink, FormsModule, ChartView, DatePlPipe, BaselineSteps, Icon],
  templateUrl: './assessment-report.html',
  styleUrl: './assessment.scss',
})
export class AssessmentReportPage {
  protected readonly store = inject(AppStore);
  readonly id = input<string>('');
  /** Tryb Demo – dane przykładowe tylko w pamięci, nigdy w bazie */
  protected readonly demo = !!inject(ActivatedRoute).snapshot.data['demo'];
  private readonly demoData = this.demo ? demoAssessments() : null;
  protected readonly demoView = signal<'retest' | 'baseline'>('retest');

  protected readonly r1 = r1;
  protected readonly fmt = formatSeconds;
  protected readonly coreLabels = CORE_LABELS;
  protected readonly endLabels = DEAD_HANG_END_LABELS;
  protected readonly wallLabels = WALL_LABELS;
  protected readonly styleLabels = STYLE_LABELS;
  protected readonly kindLabels = KIND_LABELS;
  protected readonly partLabels = PART_LABELS;
  protected readonly statusLabels = TEST_STATUS_LABELS;
  protected readonly Math = Math;

  protected readonly a = computed<Assessment | null>(() => {
    if (this.demoData) return this.demoView() === 'retest' ? this.demoData.retest : this.demoData.baseline;
    return this.store.getAssessment(this.id());
  });

  protected readonly cycleName = computed(() => (this.demo ? 'Demo' : this.store.cycles().find((c) => c.id === this.a()?.cycleId)?.name ?? ''));
  protected readonly strength = computed(() => (this.a()?.strength ? strengthResults(this.a()!.strength!) : null));
  protected readonly climbing = computed(() => (this.a()?.climbing ? climbingResults(this.a()!.climbing!) : null));
  /** Profile zdolności – tylko gdy test zawiera pomiary (nie dla testu pośredniego) */
  protected readonly abilities = computed(() => {
    const a = this.a();
    if (!a || a.kind === 'CONTROL' || (!a.strength && !a.climbing)) return null;
    return this.store.abilityReportFor(a);
  });
  protected readonly calibration = computed(() => {
    const a = this.a();
    if (!a || this.demo || a.kind !== 'BASELINE') return null;
    const cal = this.store.cycles().find((c) => c.id === a.cycleId)?.calibration;
    return cal?.runs.length ? cal : null;
  });
  protected readonly outcomeLabels: Record<CalibrationOutcome, string> = {
    confirmed: 'trudność potwierdzona', raise: 'za łatwo – podnosimy', lower: 'za trudno – obniżamy', hold: 'wynik mieszany – powtarzamy',
  };
  protected readonly conclusions = computed(() => (this.a() ? generateConclusions(this.a()!) : null));

  /** Planowane sesje tego testu, które nie są jeszcze zakończone */
  protected readonly pendingParts = computed(() => {
    const a = this.a();
    if (!a || this.demo) return [];
    return this.store.planned().filter((p) => p.cycleId === a.cycleId && p.type === a.kind && p.part && p.status !== 'done' && p.status !== 'skipped');
  });

  /* ---------- porównanie ---------- */

  /** Kandydaci do porównania: inne testy z danymi z tych samych części */
  protected readonly candidates = computed(() => {
    const a = this.a();
    if (!a || this.demo) return [];
    return this.store.assessments().filter((x) => x.id !== a.id && (x.strength?.status === 'completed' || x.climbing?.status === 'completed'));
  });
  protected readonly compareId = signal<string | null>(null);
  protected readonly counterpart = computed<Assessment | null>(() => {
    const a = this.a();
    if (!a) return null;
    if (this.demoData) return this.demoView() === 'retest' ? this.demoData.baseline : null;
    const chosen = this.compareId();
    if (chosen) return this.store.getAssessment(chosen);
    if (a.kind !== 'BASELINE') return this.store.assessmentFor(a.cycleId, 'BASELINE');
    // Baseline nowego cyklu → porównanie z retestem poprzedniego cyklu, jeśli istnieje
    return this.store.completedAssessments().filter((x) => x.kind === 'FINAL' && x.cycleId !== a.cycleId && (x.completedAt ?? '') < (a.createdAt ?? '')).at(-1) ?? null;
  });
  protected readonly comparison = computed(() => {
    const a = this.a();
    const b = this.counterpart();
    return a && b ? compareBaselineResults(b, a) : null;
  });

  /* ---------- wykresy ---------- */

  protected readonly overlay = computed(() => [this.counterpart(), this.a()].filter((x): x is Assessment => !!x));
  protected readonly timingChart = computed(() => routeTimingChart(this.overlay()));
  protected readonly pumpChart = computed(() => pumpByAttemptChart(this.overlay()));
  protected readonly recoveryChart = computed(() => recoveryCurveChart(this.overlay()));
  protected readonly vsChart = computed(() => (this.counterpart() && this.a() ? baselineVsRetestChart(this.counterpart()!, this.a()!) : null));

  /** Krok wskaźnika: raport po zakończeniu, inaczej najbliższa niewykonana sesja */
  protected readonly reportStep = computed(() => {
    const a = this.a();
    if (!a) return 1;
    const n = stepsFor(a.kind).length;
    if (a.status === 'completed') return n;
    if (a.kind === 'CONTROL') return 2;
    return a.strength?.status === 'completed' ? 6 : 1;
  });

  protected readonly groupLabels: Record<string, string> = {
    finger: 'Finger Strength', pulling: 'Pulling Strength', core: 'Core', endurance: 'Dead Hang', nine_c: '9c', climbing: 'Climbing Performance', recovery: 'Recovery Curve',
  };
  protected readonly comparisonGroups = computed(() => {
    const c = this.comparison();
    if (!c) return [];
    const order = ['finger', 'pulling', 'core', 'endurance', 'nine_c', 'climbing', 'recovery'];
    return order.map((g) => ({ key: g, label: this.groupLabels[g], rows: c.rows.filter((r) => r.group === g) })).filter((g) => g.rows.length);
  });

  protected readonly canGeneratePlan = computed(() => {
    const a = this.a();
    const c = this.store.cycle();
    return !this.demo && !!a && a.kind === 'BASELINE' && a.status === 'completed' && c?.id === a.cycleId && c.status === 'baseline';
  });

  protected trendClass(i: string) {
    return i === 'improved' ? 'trend-better' : i === 'declined' ? 'trend-worse' : '';
  }

  protected trendText(i: string) {
    return i === 'improved' ? 'poprawa' : i === 'declined' ? 'spadek' : i === 'unchanged' ? 'bez zmian' : 'nieporównywalne';
  }

  protected signed(n: number | null, unit = '') {
    if (n == null) return '–';
    return `${n > 0 ? '+' : ''}${r1(n)}${unit}`;
  }

  protected loadText(added: number | null, assist: number | null) {
    if (added == null) return '–';
    if (assist) return `−${r1(assist)} kg (odciążenie)`;
    return `+${r1(added)} kg`;
  }

  protected exportJson() {
    const a = this.a();
    if (!a) return;
    const payload = {
      app: 'ClimbProgress', type: 'baseline-test', protocolVersion: a.protocolVersion, exportedAt: new Date().toISOString(), demo: this.demo,
      assessment: a,
      results: { strength: this.strength(), climbing: this.climbing(), conclusions: this.conclusions() },
      comparison: this.comparison(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `climbprogress-${a.kind.toLowerCase()}-${(a.strength ?? a.climbing)?.date ?? 'test'}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
