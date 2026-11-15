import { Assessment } from '../../core/models/assessment';
import { strengthResults } from '../../core/logic/assessment/scoring';
import { climbingResults, formatSeconds } from '../../core/logic/assessment/climbing';
import { KIND_LABELS } from '../../core/logic/assessment/labels';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AppStore } from '../../core/data/store';
import { CompletedWorkout, TestResult } from '../../core/models/models';
import { sessionMaxPump, sessionRpe } from '../../core/logic/progression';
import { summarizeTest } from '../../core/logic/reports';
import { describeLevel } from '../../core/logic/progression';
import { addDays } from '../../core/logic/dates';
import { TEMPLATES, TYPE_SHORT } from '../../core/logic/templates';
import { DatePlPipe } from '../../shared/pipes';

type Filter = 'all' | 'A' | 'B' | 'C' | 'tests';

type Entry =
  | { kind: 'workout'; date: string; ts: string; w: CompletedWorkout; grades: string[]; sent: number; total: number; rpe: number | null; pump: number | null; exercises: string }
  | { kind: 'test'; date: string; ts: string; t: TestResult; completed: number; maxPump: number | null; avgRpe: number | null }
  | { kind: 'assessment'; date: string; ts: string; a: Assessment; title: string; facts: string[] };

@Component({
  selector: 'app-history',
  imports: [RouterLink, FormsModule, DatePlPipe],
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <div class="eyebrow">Historia treningów</div>
          <h1>{{ entries().length }} {{ entries().length === 1 ? 'wpis' : 'wpisów' }}</h1>
        </div>
        @if (store.cycles().length > 1) {
          <select [ngModel]="cycleId()" (ngModelChange)="cycleId.set($event)" aria-label="Cykl" style="max-width: 180px">
            <option value="">Wszystkie cykle</option>
            @for (c of cycles(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
          </select>
        }
      </header>

      <div class="chips">
        @for (f of filters; track f.key) {
          <button type="button" class="chip" [class.on]="filter() === f.key" (click)="filter.set(f.key)">{{ f.label }}</button>
        }
      </div>

      @if (selectedCycle(); as c) {
        <section class="card flat">
          <div class="card-title"><h3>{{ c.name }}</h3><span class="badge plain" [class.done]="c.status === 'completed'">{{ statusLabels[c.status] }}</span></div>
          <small class="muted">Test początkowy: {{ c.baselineDate | datePl }}@if (c.planStart) { · tydzień 1: {{ c.planStart | datePl }} – {{ cycleEnd(c.planStart, c.weeks) | datePl }} }</small>
          <small class="muted">A: {{ level('A', c) }} · B: {{ level('B', c) }} · C: {{ level('C', c) }}</small>
        </section>
      }

      <div class="stack-sm">
        @for (e of entries(); track e.ts) {
          @if (e.kind === 'workout') {
            <a class="card entry" [routerLink]="['/history', e.w.id]">
              <div class="row">
                <span class="type-chip" [class]="'type-chip ' + e.w.type">{{ e.w.type }}</span>
                <div class="grow">
                  <div class="eyebrow">{{ e.date | datePl }} · {{ e.w.durationMin }} min@if (e.w.deload) { · lżej/deload }</div>
                  <strong>{{ templates[e.w.type].name }}</strong>
                </div>
                <span class="badge" [class]="e.w.completion === 'full' ? 'done' : 'partial'">{{ e.w.completion === 'full' ? 'Wykonany' : 'Częściowo' }}</span>
              </div>
              <div class="facts">
                @if (e.total) { <span>Drogi: <b>{{ e.sent }}/{{ e.total }}</b></span> }
                @if (e.grades.length) { <span>Trudności: <b>{{ e.grades.join(', ') }}</b></span> }
                @for (h of e.w.hangs; track h.id) { <span>Zwisy: <b>{{ h.setsDone }}×{{ h.hangSec }} s</b>@if (h.pain) { <b class="bad"> · ból</b> }</span> }
                <span>Pompa: <b>{{ e.pump ?? '–' }}/10</b></span>
                <span>RPE: <b>{{ e.rpe ?? '–' }}</b></span>
              </div>
              <small class="faint">{{ e.exercises }}</small>
              @if (e.w.notes) { <small class="muted">„{{ e.w.notes }}”</small> }
            </a>
          } @else if (e.kind === 'assessment') {
            <a class="card entry" [routerLink]="['/assessment', e.a.id]">
              <div class="row">
                <span class="type-chip T">T</span>
                <div class="grow">
                  <div class="eyebrow">{{ e.date | datePl }}</div>
                  <strong>{{ e.title }}</strong>
                </div>
                <span class="badge" [class.done]="e.a.status === 'completed'">{{ e.a.status === 'completed' ? 'Test' : 'W trakcie' }}</span>
              </div>
              <div class="facts">@for (f of e.facts; track f) { <span><b>{{ f }}</b></span> }</div>
            </a>
          } @else {
            <a class="card entry" [routerLink]="['/tests', e.t.id]">
              <div class="row">
                <span class="type-chip T">T</span>
                <div class="grow">
                  <div class="eyebrow">{{ e.date | datePl }}</div>
                  <strong>{{ typeShort[e.t.kind] }} 3 × 6a</strong>
                </div>
                <span class="badge done">Test</span>
              </div>
              <div class="facts">
                <span>Ukończone: <b>{{ e.completed }}/3</b></span>
                <span>Maks. pompa: <b>{{ e.maxPump ?? '–' }}/10</b></span>
                <span>Śr. RPE: <b>{{ e.avgRpe ?? '–' }}</b></span>
              </div>
              @if (e.t.notes) { <small class="muted">„{{ e.t.notes }}”</small> }
            </a>
          }
        } @empty {
          <div class="card"><p class="empty">Brak zapisanych treningów. Rozpocznij trening z <a routerLink="/">ekranu startowego</a>.</p></div>
        }
      </div>
    </div>
  `,
  styles: `
    .chips { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }
    .chip { min-height: 40px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--muted); font: inherit; font-weight: 600; white-space: nowrap; cursor: pointer; }
    .chip.on { color: var(--text); border-color: var(--accent); }
    .entry { display: flex; flex-direction: column; gap: 6px; color: inherit; text-decoration: none; }
    .facts { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 0.86rem; color: var(--muted); }
    .facts b { color: var(--text); font-weight: 700; }
    .facts b.bad { color: var(--bad); }
  `,
})
export class HistoryPage {
  protected readonly store = inject(AppStore);
  protected readonly templates = TEMPLATES;
  protected readonly typeShort = TYPE_SHORT;
  protected readonly statusLabels = { baseline: 'test początkowy', active: 'aktywny', completed: 'zakończony', archived: 'zarchiwizowany' };
  protected readonly filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'Wszystko' }, { key: 'A', label: 'A – trudne drogi' }, { key: 'B', label: 'B – zwisy + tlenowa' }, { key: 'C', label: 'C – siłowa' }, { key: 'tests', label: 'Testy' },
  ];
  protected readonly filter = signal<Filter>('all');
  protected readonly cycleId = signal('');

  protected readonly cycles = computed(() => [...this.store.cycles()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  protected readonly selectedCycle = computed(() => this.store.cycles().find((c) => c.id === this.cycleId()) ?? null);

  protected readonly entries = computed<Entry[]>(() => {
    const f = this.filter();
    const cid = this.cycleId();
    const out: Entry[] = [];
    if (f !== 'tests') {
      for (const w of this.store.completed()) {
        if (cid && w.cycleId !== cid) continue;
        if (f !== 'all' && w.type !== f) continue;
        const grades = [...new Set(w.routes.map((r) => r.grade))];
        out.push({
          kind: 'workout', date: w.date, ts: w.finishedAt + w.id, w, grades,
          sent: w.routes.filter((r) => r.completed).length, total: w.routes.length,
          rpe: sessionRpe(w), pump: sessionMaxPump(w),
          exercises: w.exercises.filter((e) => e.kind !== 'technique').map((e) => `${e.done ? '✓' : '✗'} ${e.name}`).join(' · '),
        });
      }
    }
    if (f === 'all' || f === 'tests') {
      for (const t of this.store.tests()) {
        if (cid && t.cycleId !== cid) continue;
        const s = summarizeTest(t);
        out.push({ kind: 'test', date: t.date, ts: t.createdAt + t.id, t, completed: s.completed, maxPump: s.maxPump, avgRpe: s.avgRpe });
      }
      for (const a of this.store.assessments()) {
        if (cid && a.cycleId !== cid) continue;
        if (a.strength && a.strength.status !== 'postponed') {
          const r = strengthResults(a.strength);
          const sc = (n: number | null) => (n == null ? 'NT' : `${n}`);
          out.push({
            kind: 'assessment', date: a.strength.date, ts: a.strength.startedAt + a.id + 's', a, title: `${KIND_LABELS[a.kind]} · dzień 1`,
            facts: [`Palce ${sc(r.finger.score)}`, `Przyciąganie ${sc(r.pullUp.score)}`, `Core ${sc(r.core.score)}`, `Dead Hang ${sc(r.deadHang.score)}`, r.nineC.isComplete ? `Suma ${r.nineC.totalPoints}/40` : 'suma: niekompletny'],
          });
        }
        if (a.climbing && a.climbing.status !== 'postponed') {
          const c = climbingResults(a.climbing);
          out.push({
            kind: 'assessment', date: a.climbing.date, ts: a.climbing.startedAt + a.id + 'c', a, title: a.kind === 'CONTROL' ? KIND_LABELS.CONTROL : `${KIND_LABELS[a.kind]} · dzień 2`,
            facts: [`Drogi ${c.time.completedRoutes}/${a.climbing.plannedAttempts}`, `Śr. czas ${formatSeconds(c.time.averageTimeSeconds)}`, `Pompa po ost. ${c.recovery.pumpAfterLastRoute ?? '–'}/10`, `Po 3 min ${c.recovery.points[3].pump ?? '–'}/10`],
          });
        }
      }
    }
    return out.sort((a, b) => (a.date === b.date ? (a.ts < b.ts ? 1 : -1) : a.date < b.date ? 1 : -1));
  });

  protected cycleEnd(start: string, weeks: number) {
    return addDays(start, weeks * 7 - 1);
  }

  protected level(t: 'A' | 'B' | 'C', c: { params: Parameters<typeof describeLevel>[1] }) {
    return describeLevel(t, c.params);
  }
}
