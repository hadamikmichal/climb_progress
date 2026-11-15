import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AppStore } from '../../core/data/store';
import { Assessment } from '../../core/models/assessment';
import { inRange, RANGE_LABELS, RangeKey, rangeBounds } from '../../core/logic/analytics';
import { strengthResults } from '../../core/logic/assessment/scoring';
import { climbingResults, formatSeconds } from '../../core/logic/assessment/climbing';
import { KIND_LABELS, PART_LABELS, TEST_STATUS_LABELS } from '../../core/logic/assessment/labels';
import { isPending } from '../../core/logic/scheduling';
import { DatePlPipe } from '../../shared/pipes';
import { Icon } from '../../shared/icon';
import { TabFingers } from './tab-fingers';
import { TabEndurance } from './tab-endurance';
import { TabRecovery } from './tab-recovery';
import { TabClimbing } from './tab-climbing';

type Tab = 'fingers' | 'endurance' | 'recovery' | 'climbing';

const firstDate = (a: Assessment) => (a.strength ?? a.climbing)?.date ?? a.createdAt.slice(0, 10);

/** Progres – analityka w czterech podsekcjach + dostęp do testów (Baseline / Retest) */
@Component({
  selector: 'app-progress',
  imports: [RouterLink, DatePlPipe, Icon, TabFingers, TabEndurance, TabRecovery, TabClimbing],
  templateUrl: './progress.html',
  styleUrl: './progress.scss',
})
export class ProgressPage {
  protected readonly store = inject(AppStore);

  protected readonly tabs: { key: Tab; label: string; short: string }[] = [
    { key: 'fingers', label: 'Siła palców', short: '01' },
    { key: 'endurance', label: 'Wytrzymałość', short: '02' },
    { key: 'recovery', label: 'Regeneracja', short: '03' },
    { key: 'climbing', label: 'Wspinanie', short: '04' },
  ];
  protected readonly ranges = Object.entries(RANGE_LABELS) as [RangeKey, string][];
  protected readonly tab = signal<Tab>('fingers');
  protected readonly range = signal<RangeKey>('12w');
  protected readonly showReports = signal(false);

  protected readonly kindLabels = KIND_LABELS;
  protected readonly partLabels = PART_LABELS;
  protected readonly statusLabels = TEST_STATUS_LABELS;
  protected readonly fmtSec = formatSeconds;

  constructor() {
    if (inject(ActivatedRoute).snapshot.fragment === 'reports') this.showReports.set(true);
  }

  /* ---------- zakres dat ---------- */

  protected readonly bounds = computed(() => rangeBounds(this.store.today(), this.range()));
  protected readonly workouts = computed(() => [...this.store.completed()].sort((a, b) => (a.date < b.date ? -1 : 1)));
  protected readonly cur = computed(() => inRange(this.workouts(), this.bounds().from, this.bounds().to));
  protected readonly prev = computed(() => {
    const b = this.bounds();
    if (!b.prevFrom) return null;
    const list = inRange(this.workouts(), b.prevFrom, b.prevTo);
    // pusty poprzedni okres = brak danych do porównania (nie „+128 vs 0”)
    return list.length ? list : null;
  });
  /** Etykieta porównania („6 tyg.”) – pusta dla „całość” */
  protected readonly compareLabel = computed(() => (this.range() === 'all' ? '' : RANGE_LABELS[this.range()]));
  protected readonly legacyTests = computed(() => [...this.store.tests()].sort((a, b) => (a.date < b.date ? -1 : 1)));
  protected readonly aerobicTarget = computed(() => (this.store.cycle() ?? this.store.lastCycle())?.params.aerobic.targetMaxPump ?? 4);

  /* ---------- testy ---------- */

  /** Testy chronologicznie; testy nie są filtrowane zakresem (są rzadkie, porównujemy całą historię) */
  protected readonly assessments = computed(() => [...this.store.assessments()].sort((a, b) => (firstDate(a) < firstDate(b) ? -1 : 1)));
  protected readonly testRows = computed(() => [...this.assessments()].reverse().map((a) => {
    const s = a.strength ? strengthResults(a.strength) : null;
    const c = a.climbing ? climbingResults(a.climbing) : null;
    return {
      a, date: firstDate(a),
      cycle: this.store.cycles().find((x) => x.id === a.cycleId)?.name ?? '',
      nineC: s ? (s.nineC.isComplete ? `${s.nineC.totalPoints}/40` : 'niekompl.') : null,
      routes: c ? `${c.time.completedRoutes}/${a.climbing!.plannedAttempts}` : null,
      rec: c?.recovery.points[3].pump ?? null,
    };
  }));
  /** Zaplanowane, jeszcze niewykonane sesje testów bieżącego cyklu */
  protected readonly upcomingTests = computed(() =>
    this.store.cyclePlanned().filter((p) => p.part && isPending(p.status)).slice(0, 2),
  );

  /* ---------- raporty tygodniowe ---------- */

  protected readonly reports = computed(() => {
    const cycles = new Map(this.store.cycles().map((c) => [c.id, c.name]));
    return [...this.store.reports()].sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1)).map((r) => ({ r, cycle: cycles.get(r.cycleId) ?? '' }));
  });

  protected regenerate() {
    void this.store.ensureWeeklyReports(true);
  }
}
