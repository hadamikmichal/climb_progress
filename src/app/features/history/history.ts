import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AppStore } from '../../core/data/store';
import { Assessment } from '../../core/models/assessment';
import { CompletedWorkout, TestResult, TrainingCycle } from '../../core/models/models';
import { describeLevel, formatLoad, sessionMaxPump, sessionRpe } from '../../core/logic/progression';
import { summarizeTest } from '../../core/logic/reports';
import { addDays, formatMonth, parseISODate, WEEKDAY_SHORT, weekdayOf } from '../../core/logic/dates';
import { maxGrade } from '../../core/logic/grades';
import { ASCENT_LABELS, TEMPLATES, TYPE_SHORT } from '../../core/logic/templates';
import { strengthResults } from '../../core/logic/assessment/scoring';
import { climbingResults, formatSeconds } from '../../core/logic/assessment/climbing';
import { KIND_LABELS } from '../../core/logic/assessment/labels';
import { DatePlPipe } from '../../shared/pipes';
import { Icon } from '../../shared/icon';

type Filter = 'all' | 'A' | 'B' | 'C' | 'tests';

/** Wpis dziennika – jednolita reprezentacja treningu, testu v1.0 i testu sprzed v1.0 */
interface JournalEntry {
  id: string;
  date: string;
  ts: string;
  code: string;
  title: string;
  link: string[];
  status: string | null;
  statusKind: 'done' | 'partial' | 'light' | 'test';
  facts: string[];
  lines: string[];
  notes: string;
}

interface JournalDay {
  date: string;
  weekday: string;
  dayNum: string;
  /** nagłówek miesiąca przed pierwszym dniem danego miesiąca */
  monthHead: string | null;
  entries: JournalEntry[];
}

const plural = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;

function workoutEntry(w: CompletedWorkout): JournalEntry {
  const done = w.routes.filter((r) => r.completed);
  const facts: string[] = [];
  if (w.routes.length) facts.push(`drogi ${done.length}/${w.routes.length}`);
  const hardest = maxGrade(done.map((r) => r.grade));
  if (hardest) facts.push(`max ${hardest}`);
  for (const h of w.hangs) facts.push(`zwisy ${h.setsDone}×${h.hangSec}s ${formatLoad(h)}${h.pain ? ' · ból' : ''}`);
  const rpe = sessionRpe(w);
  const pump = sessionMaxPump(w);
  if (rpe != null) facts.push(`RPE ${rpe}`);
  if (pump != null) facts.push(`pompa ${pump}/10`);
  facts.push(`${w.durationMin} min`);
  const lines: string[] = [];
  const ex = w.exercises.filter((e) => e.kind !== 'technique').map((e) => `${e.done ? '✓' : '✗'} ${e.name}`);
  if (ex.length) lines.push(ex.join('   '));
  const styles = done.filter((r) => r.ascent).map((r) => `${r.grade} ${ASCENT_LABELS[r.ascent!]}`);
  if (styles.length) lines.push(`Przejścia: ${styles.join(', ')}`);
  return {
    id: w.id, date: w.date, ts: w.finishedAt + w.id, code: w.type, title: TEMPLATES[w.type].name, link: ['/history', w.id],
    status: w.deload ? 'lżej / deload' : w.completion === 'full' ? 'wykonany' : 'częściowo',
    statusKind: w.deload ? 'light' : w.completion === 'full' ? 'done' : 'partial',
    facts, lines, notes: w.notes,
  };
}

function legacyTestEntry(t: TestResult): JournalEntry {
  const s = summarizeTest(t);
  return {
    id: t.id, date: t.date, ts: t.createdAt + t.id, code: 'T', title: `${TYPE_SHORT[t.kind]} 3 × 6a`, link: ['/tests', t.id], status: 'test', statusKind: 'test',
    facts: [`ukończone ${s.completed}/${s.total}`, `maks. pompa ${s.maxPump ?? '–'}/10`, `śr. RPE ${s.avgRpe ?? '–'}`], lines: [], notes: t.notes,
  };
}

function assessmentEntries(a: Assessment): JournalEntry[] {
  const out: JournalEntry[] = [];
  const nt = (n: number | null) => (n == null ? 'NT' : `${n}/10`);
  if (a.strength && a.strength.status !== 'postponed') {
    const r = strengthResults(a.strength);
    out.push({
      id: a.id + 's', date: a.strength.date, ts: a.strength.startedAt + a.id + 's', code: 'T', title: `${KIND_LABELS[a.kind]} · dzień 1`, link: ['/assessment', a.id],
      status: a.strength.status === 'completed' ? 'test' : 'w trakcie', statusKind: 'test',
      facts: [`palce ${nt(r.finger.score)}`, `przyciąganie ${nt(r.pullUp.score)}`, `core ${nt(r.core.score)}`, `dead hang ${nt(r.deadHang.score)}`, r.nineC.isComplete ? `suma ${r.nineC.totalPoints}/40` : 'suma: niekompletna'],
      lines: r.finger.totalLoadKg != null ? [`Max Hang ${a.strength.maxFingerStrength.edgeDepthMm ?? '?'} mm / 5 s: ${Math.round(r.finger.totalLoadKg * 10) / 10} kg całkowite`] : [],
      notes: a.strength.notes,
    });
  }
  if (a.climbing && a.climbing.status !== 'postponed') {
    const c = climbingResults(a.climbing);
    out.push({
      id: a.id + 'c', date: a.climbing.date, ts: a.climbing.startedAt + a.id + 'c', code: 'T', title: a.kind === 'CONTROL' ? KIND_LABELS.CONTROL : `${KIND_LABELS[a.kind]} · dzień 2`,
      link: ['/assessment', a.id], status: a.climbing.status === 'completed' ? 'test' : 'w trakcie', statusKind: 'test',
      facts: [`drogi ${c.time.completedRoutes}/${a.climbing.plannedAttempts}`, `śr. czas ${formatSeconds(c.time.averageTimeSeconds)}`, `pompa po ost. ${c.recovery.pumpAfterLastRoute ?? '–'}/10`, `po 3′ ${c.recovery.points[3].pump ?? '–'}/10`],
      lines: a.climbing.route.name ? [`${a.climbing.route.name} · ${a.climbing.route.frenchGrade}`] : [],
      notes: a.climbing.notes,
    });
  }
  return out;
}

/** Historia – chronologiczny dziennik wspinacza (dni → wpisy), z filtrami typu i cyklu */
@Component({
  selector: 'app-history',
  imports: [RouterLink, FormsModule, DatePlPipe, Icon],
  templateUrl: './history.html',
  styleUrl: './history.scss',
})
export class HistoryPage {
  protected readonly store = inject(AppStore);
  protected readonly filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'Wszystko' }, { key: 'A', label: 'A · trudne' }, { key: 'B', label: 'B · zwisy + tlen.' }, { key: 'C', label: 'C · obwody' }, { key: 'tests', label: 'Testy' },
  ];
  protected readonly filter = signal<Filter>('all');
  protected readonly cycleId = signal('');

  protected readonly cycles = computed(() => [...this.store.cycles()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  protected readonly selectedCycle = computed(() => this.store.cycles().find((c) => c.id === this.cycleId()) ?? null);

  protected readonly entries = computed<JournalEntry[]>(() => {
    const f = this.filter();
    const cid = this.cycleId();
    const out: JournalEntry[] = [];
    if (f !== 'tests') {
      for (const w of this.store.completed()) {
        if (cid && w.cycleId !== cid) continue;
        if (f !== 'all' && w.type !== f) continue;
        out.push(workoutEntry(w));
      }
    }
    if (f === 'all' || f === 'tests') {
      for (const t of this.store.tests()) if (!cid || t.cycleId === cid) out.push(legacyTestEntry(t));
      for (const a of this.store.assessments()) if (!cid || a.cycleId === cid) out.push(...assessmentEntries(a));
    }
    return out.sort((a, b) => (a.date === b.date ? (a.ts < b.ts ? 1 : -1) : a.date < b.date ? 1 : -1));
  });

  protected readonly days = computed<JournalDay[]>(() => {
    const map = new Map<string, JournalEntry[]>();
    for (const e of this.entries()) (map.get(e.date) ?? map.set(e.date, []).get(e.date)!).push(e);
    let lastMonth = '';
    return [...map.entries()].map(([date, entries]) => {
      const month = date.slice(0, 7);
      const head = month !== lastMonth ? formatMonth(month) : null;
      lastMonth = month;
      return { date, entries, monthHead: head, weekday: WEEKDAY_SHORT[weekdayOf(date)], dayNum: String(parseISODate(date).getDate()).padStart(2, '0') };
    });
  });

  protected readonly summary = computed(() => {
    const e = this.entries();
    const sessions = e.filter((x) => x.statusKind !== 'test').length;
    const tests = e.length - sessions;
    return `${sessions} ${plural(sessions, 'sesja', 'sesje', 'sesji')} · ${tests} ${plural(tests, 'test', 'testy', 'testów')}`;
  });

  protected cycleEnd(start: string, weeks: number) {
    return addDays(start, weeks * 7 - 1);
  }

  protected level(t: 'A' | 'B' | 'C', c: TrainingCycle) {
    return describeLevel(t, c.params);
  }
}
