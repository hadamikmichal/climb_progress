import { computed, Injectable, signal, WritableSignal } from '@angular/core';
import {
  AdaptationEvent, AppData, CompletedWorkout, ISODate, PlannedWorkout, ReadinessCheck, SessionDraft, SkipReason,
  TestResult, TrainingCycle, TrainingParams, TrainingType, UserProfile, WeeklyReport,
} from '../models/models';
import { Assessment, AssessmentKind, AssessmentPart } from '../models/assessment';
import { Db, StoreName } from './db';
import { buildExport, parseImport } from './backup';
import { addDays, formatDate, today } from '../logic/dates';
import { now, uid } from '../logic/ids';
import {
  baselinePlanned, comparePlanned, createCycle, cycleWeek, generateCyclePlan, isDeloadWeek, migrateLegacyPlanned, redistributeFuture,
  stageLabel, weekStart,
} from '../logic/plan';
import {
  assessmentStatus, BASELINE_ROUTE_ATTEMPTS, CONTROL_ROUTE_ATTEMPTS, newAssessment, newClimbingSession, newStrengthSession,
} from '../logic/assessment/factory';
import { KIND_LABELS, PART_LABELS } from '../logic/assessment/labels';
import { evaluateProgression, HistoryEntry, ProgressionDecision, Track, TRACK_HOST, TRACKS } from '../logic/progression';
import { decideMissed, isPending, MissedDecision, slotViolations } from '../logic/scheduling';
import { evaluateReadiness, readinessFor } from '../logic/readiness';
import { generateWeeklyReport } from '../logic/reports';
import { defaultProfile, initialParams, isHeavy, isTest, SKIP_REASON_LABELS, TYPE_SHORT } from '../logic/templates';

const byTsDesc = <T extends { timestamp: string }>(a: T, b: T) => (a.timestamp < b.timestamp ? 1 : -1);

/**
 * Centralny stan aplikacji. Każda mutacja jest zapisywana w IndexedDB, zanim zaktualizuje sygnał.
 * Logika treningowa jest delegowana do czystych funkcji z core/logic.
 */
@Injectable({ providedIn: 'root' })
export class AppStore {
  private db!: Db;

  readonly ready = signal(false);
  readonly error = signal<string | null>(null);
  /** Pozwala testować widoki z inną datą (?today=YYYY-MM-DD) – domyślnie dzisiaj */
  readonly today = signal<ISODate>(today());

  readonly profile = signal<UserProfile>(defaultProfile(now()));
  readonly cycles = signal<TrainingCycle[]>([]);
  readonly planned = signal<PlannedWorkout[]>([]);
  readonly completed = signal<CompletedWorkout[]>([]);
  readonly readiness = signal<ReadinessCheck[]>([]);
  readonly tests = signal<TestResult[]>([]);
  readonly events = signal<AdaptationEvent[]>([]);
  readonly reports = signal<WeeklyReport[]>([]);
  readonly drafts = signal<SessionDraft[]>([]);
  readonly assessments = signal<Assessment[]>([]);

  /* ---------------- selektory ---------------- */

  readonly cycle = computed<TrainingCycle | null>(() => {
    const cs = this.cycles().filter((c) => c.status === 'baseline' || c.status === 'active');
    return cs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
  });
  readonly lastCycle = computed<TrainingCycle | null>(() => [...this.cycles()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null);

  readonly cyclePlanned = computed(() => {
    const c = this.cycle();
    return c ? this.planned().filter((p) => p.cycleId === c.id).sort(comparePlanned) : [];
  });
  readonly currentWeek = computed(() => {
    const c = this.cycle();
    return c ? cycleWeek(c, this.today()) : 0;
  });
  readonly stage = computed(() => {
    const c = this.cycle();
    return c ? stageLabel(c, this.currentWeek()) : 'Brak aktywnego cyklu';
  });
  readonly isDeload = computed(() => {
    const c = this.cycle();
    return !!c && isDeloadWeek(c, this.currentWeek());
  });
  /** Niezrealizowane jednostki, których termin minął – wymagają decyzji */
  readonly overdue = computed(() => this.cyclePlanned().filter((p) => isPending(p.status) && p.date < this.today()));
  readonly nextWorkout = computed(() => this.cyclePlanned().find((p) => isPending(p.status) && p.date >= this.today()) ?? null);
  readonly todayReadiness = computed(() => readinessFor(this.readiness(), this.today()));
  readonly todayAssessment = computed(() => {
    const r = this.todayReadiness();
    return r ? evaluateReadiness(r) : null;
  });
  readonly completedSorted = computed(() => [...this.completed()].sort((a, b) => (a.date === b.date ? (a.finishedAt < b.finishedAt ? 1 : -1) : a.date < b.date ? 1 : -1)));
  readonly eventsSorted = computed(() => [...this.events()].sort(byTsDesc));

  /* ---------------- inicjalizacja ---------------- */

  async init(): Promise<void> {
    try {
      const q = new URLSearchParams(globalThis.location?.search ?? '').get('today');
      if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) this.today.set(q);
      this.db = await Db.open();
      const data = await this.db.loadAll();
      if (!data.profile.length) {
        const p = defaultProfile(now());
        await this.db.write([{ store: 'profile', put: [p] }]);
        data.profile = [p];
      }
      data.assessments ??= [];
      const migrated = migrateLegacyPlanned(data.planned, now());
      if (migrated.length) {
        await this.db.write([{ store: 'planned', put: migrated }]);
        const ids = new Set(migrated.map((m) => m.id));
        data.planned = [...data.planned.filter((p) => !ids.has(p.id)), ...migrated];
      }
      this.applyData(data);
      await this.ensureWeeklyReports();
      this.ready.set(true);
    } catch (e) {
      console.error(e);
      this.error.set('Nie udało się otworzyć lokalnej bazy danych (IndexedDB). Sprawdź, czy przeglądarka nie działa w trybie prywatnym.');
    }
  }

  private applyData(d: AppData) {
    this.profile.set(d.profile[0] ?? defaultProfile(now()));
    this.cycles.set(d.cycles);
    this.planned.set(d.planned);
    this.completed.set(d.completed);
    this.readiness.set(d.readiness);
    this.tests.set(d.tests);
    this.events.set(d.events);
    this.reports.set(d.reports);
    this.drafts.set(d.drafts);
    this.assessments.set(d.assessments ?? []);
  }

  private upsert<T extends { id: string }>(sig: WritableSignal<T[]>, items: T[]) {
    if (!items.length) return;
    const map = new Map(sig().map((x) => [x.id, x]));
    for (const i of items) map.set(i.id, i);
    sig.set([...map.values()]);
  }

  private async persist(ops: { store: StoreName; put?: unknown[]; del?: string[] }[]) {
    await this.db.write(ops);
  }

  private event(e: Omit<AdaptationEvent, 'id' | 'timestamp'>): AdaptationEvent {
    return { id: uid(), timestamp: now(), ...e };
  }

  private async addEvents(evs: AdaptationEvent[]) {
    await this.persist([{ store: 'events', put: evs }]);
    this.upsert(this.events, evs);
  }

  /* ---------------- profil ---------------- */

  async saveProfile(p: UserProfile): Promise<number> {
    const prev = this.profile();
    const next = { ...p, updatedAt: now() };
    await this.persist([{ store: 'profile', put: [next] }]);
    this.profile.set(next);
    const c = this.cycle();
    if (c && c.planStart && JSON.stringify(prev.trainingDays) !== JSON.stringify(p.trainingDays)) {
      const changed = redistributeFuture(this.planned(), c, p.trainingDays, this.today(), now());
      if (changed.length) {
        await this.persist([{ store: 'planned', put: changed }]);
        this.upsert(this.planned, changed);
        await this.addEvents([this.event({
          cycleId: c.id, kind: 'plan', reason: `Zmieniono dni treningowe – przeliczono ${changed.length} przyszłych jednostek. Obciążenie bez zmian.`, sourceIds: changed.map((x) => x.id),
        })]);
      }
      return changed.length;
    }
    return 0;
  }

  /* ---------------- cykl ---------------- */

  async startCycle(baselineDate: ISODate): Promise<TrainingCycle> {
    const ts = now();
    const prevCycle = this.lastCycle();
    const n = this.cycles().length + 1;
    // Nowy cykl startuje od parametrów, na których zakończył się poprzedni
    const params = prevCycle && (prevCycle.status === 'completed' || prevCycle.status === 'archived') ? prevCycle.params : initialParams(this.profile());
    const cycle = createCycle(`Cykl ${n}`, baselineDate, params, ts);
    const pw = baselinePlanned(cycle, ts);
    const ev = this.event({
      cycleId: cycle.id, kind: 'plan', sourceIds: [cycle.id],
      reason: `Rozpoczęto ${cycle.name}. Najpierw Baseline Test v1.0: dzień siłowy ${formatDate(pw[0].date)} i test 4 × 6a ${formatDate(pw[1].date)} (min. 48 h później), potem plan 6-tygodniowy.`,
    });
    // Zamknięcie ewentualnego aktywnego cyklu
    const archived = this.cycles().filter((c) => c.status === 'baseline' || c.status === 'active').map((c) => ({ ...c, status: 'archived' as const, updatedAt: ts }));
    await this.persist([{ store: 'cycles', put: [...archived, cycle] }, { store: 'planned', put: pw }, { store: 'events', put: [ev] }]);
    this.upsert(this.cycles, [...archived, cycle]);
    this.upsert(this.planned, pw);
    this.upsert(this.events, [ev]);
    return cycle;
  }

  async generatePlan(planStart: ISODate): Promise<void> {
    const c = this.cycle();
    if (!c) throw new Error('Brak aktywnego cyklu');
    const ts = now();
    const items = generateCyclePlan(c, this.profile(), planStart, ts);
    const cycle: TrainingCycle = { ...c, planStart, status: 'active', updatedAt: ts };
    const ev = this.event({
      cycleId: c.id, kind: 'plan',
      reason: `Wygenerowano plan ${c.weeks}-tygodniowy od ${formatDate(planStart)}: 3 jednostki tygodniowo, deload w tygodniu ${c.deloadWeeks.join(', ')}, test kontrolny po tygodniu ${c.controlTestAfterWeeks.join(', ')} i test końcowy po tygodniu ${c.weeks}.`,
      sourceIds: items.map((i) => i.id),
    });
    await this.persist([{ store: 'cycles', put: [cycle] }, { store: 'planned', put: items }, { store: 'events', put: [ev] }]);
    this.upsert(this.cycles, [cycle]);
    this.upsert(this.planned, items);
    this.upsert(this.events, [ev]);
  }

  async updateParams(params: TrainingParams, reason: string): Promise<void> {
    const c = this.cycle();
    if (!c) return;
    const next = { ...c, params, updatedAt: now() };
    await this.persist([{ store: 'cycles', put: [next] }]);
    this.upsert(this.cycles, [next]);
    await this.addEvents([this.event({ cycleId: c.id, kind: 'manual', reason, sourceIds: [] })]);
  }

  /* ---------------- plan: przekładanie i pomijanie ---------------- */

  getPlanned(id: string) {
    return this.planned().find((p) => p.id === id) ?? null;
  }

  previewMissed(plannedId: string, reason: SkipReason): MissedDecision {
    const p = this.getPlanned(plannedId)!;
    return decideMissed(this.cyclePlanned(), p, reason, this.today());
  }

  async applyMissed(plannedId: string, reason: SkipReason, decision: MissedDecision, note = ''): Promise<void> {
    const p = this.getPlanned(plannedId)!;
    if (decision.action === 'reschedule') {
      await this.movePlanned(plannedId, decision.date, `${SKIP_REASON_LABELS[reason]}. ${decision.explanation}`, true);
      return;
    }
    const ts = now();
    const next: PlannedWorkout = { ...p, status: 'skipped', skipReason: decision.reason, skipNote: note, updatedAt: ts };
    const ev = this.event({
      cycleId: p.cycleId, kind: 'skip', workoutType: p.type,
      reason: `${decision.explanation} ${decision.advice.join(' ')}`.trim(), sourceIds: [p.id],
    });
    await this.persist([{ store: 'planned', put: [next] }, { store: 'events', put: [ev] }]);
    this.upsert(this.planned, [next]);
    this.upsert(this.events, [ev]);
  }

  moveViolations(plannedId: string, date: ISODate): string[] {
    const p = this.getPlanned(plannedId)!;
    return slotViolations(this.cyclePlanned(), p.type, date, [p.id]);
  }

  async movePlanned(plannedId: string, date: ISODate, reason: string, validated = false): Promise<string[]> {
    const p = this.getPlanned(plannedId)!;
    if (!validated) {
      const v = this.moveViolations(plannedId, date);
      if (v.length) return v;
    }
    const ts = now();
    const next: PlannedWorkout = {
      ...p, date, status: 'moved', updatedAt: ts, moves: [...p.moves, { from: p.date, to: date, at: ts, reason }],
    };
    const ev = this.event({
      cycleId: p.cycleId, kind: 'reschedule', workoutType: p.type, from: p.date, to: date,
      reason: `${TYPE_SHORT[p.type]} przełożony z ${formatDate(p.date)} na ${formatDate(date)}. ${reason}`, sourceIds: [p.id],
    });
    await this.persist([{ store: 'planned', put: [next] }, { store: 'events', put: [ev] }]);
    this.upsert(this.planned, [next]);
    this.upsert(this.events, [ev]);
    return [];
  }

  async restorePlanned(plannedId: string): Promise<void> {
    const p = this.getPlanned(plannedId)!;
    const next: PlannedWorkout = { ...p, status: p.moves.length ? 'moved' : 'planned', skipReason: undefined, skipNote: undefined, updatedAt: now() };
    await this.persist([{ store: 'planned', put: [next] }]);
    this.upsert(this.planned, [next]);
  }

  /* ---------------- treningi ---------------- */

  /** Historia jednostek realizujących dany tor progresji w cyklu */
  historyFor(cycleId: string, track: Track): HistoryEntry[] {
    const type: TrainingType = TRACK_HOST[track];
    const done: HistoryEntry[] = this.completed()
      .filter((w) => w.cycleId === cycleId && w.type === type)
      .map((w) => ({ kind: 'completed', date: w.date, workout: w }));
    const skipped: HistoryEntry[] = this.planned()
      .filter((p) => p.cycleId === cycleId && p.type === type && p.status === 'skipped')
      .map((p) => ({ kind: 'skipped', date: p.date, id: p.id }));
    const ts = (h: HistoryEntry) => (h.kind === 'completed' ? h.workout.finishedAt : '');
    return [...done, ...skipped].sort((a, b) => (a.date === b.date ? (ts(a) < ts(b) ? -1 : 1) : a.date < b.date ? -1 : 1));
  }

  /**
   * Zapis wykonanego treningu + adaptacja planu (Przypadek A / C).
   * Zwraca decyzje progresji (po jednej na tor), które UI pokazuje w podsumowaniu.
   * Pusta lista = sesja nie wpływa na progresję (deload / lżejsza wersja / trening A).
   */
  async completeWorkout(w: CompletedWorkout): Promise<ProgressionDecision[]> {
    const ts = now();
    const ops: { store: StoreName; put?: unknown[]; del?: string[] }[] = [{ store: 'completed', put: [w] }];
    const p = w.plannedWorkoutId ? this.getPlanned(w.plannedWorkoutId) : null;
    let nextPlanned: PlannedWorkout | null = null;
    if (p) {
      nextPlanned = { ...p, status: w.completion === 'full' ? 'done' : 'partial', completedWorkoutId: w.id, updatedAt: ts };
      ops.push({ store: 'planned', put: [nextPlanned] });
    }
    ops.push({ store: 'drafts', del: [w.plannedWorkoutId ?? w.id] });
    await this.persist(ops);
    this.upsert(this.completed, [w]);
    if (nextPlanned) this.upsert(this.planned, [nextPlanned]);
    this.drafts.update((ds) => ds.filter((d) => d.id !== (w.plannedWorkoutId ?? w.id)));

    const c = this.cycles().find((x) => x.id === w.cycleId);
    if (!c) return [];
    if (w.deload) {
      await this.addEvents([this.event({
        cycleId: c.id, kind: 'deload', workoutType: w.type,
        reason: `${TYPE_SHORT[w.type]} wykonany w wersji obniżonej (deload / lżejsza wersja) – nie wpływa na progresję. Poziom bez zmian.`, sourceIds: [w.id],
      })]);
      return [];
    }
    // Każdy tor oceniany niezależnie; zmiany parametrów różnych torów nie kolidują ze sobą
    const decisions: ProgressionDecision[] = [];
    let params = c.params;
    for (const track of TRACKS[w.type]) {
      const d = evaluateProgression(track, this.historyFor(c.id, track), params);
      params = d.params;
      decisions.push(d);
    }
    if (!decisions.length) {
      await this.ensureWeeklyReports();
      return [];
    }
    const evs = decisions.map((d) => this.event({
      cycleId: c.id, kind: d.action, workoutType: w.type, parameter: d.parameter, from: d.from, to: d.to, reason: d.reason, sourceIds: d.sourceIds,
    }));
    const ops2: { store: StoreName; put?: unknown[] }[] = [{ store: 'events', put: evs }];
    let nextCycle: TrainingCycle | null = null;
    if (decisions.some((d) => d.action !== 'hold')) {
      nextCycle = { ...c, params, updatedAt: ts };
      ops2.push({ store: 'cycles', put: [nextCycle] });
    }
    await this.persist(ops2);
    this.upsert(this.events, evs);
    if (nextCycle) this.upsert(this.cycles, [nextCycle]);
    await this.ensureWeeklyReports();
    return decisions;
  }

  /** Edycja historii – nie zmienia wstecz decyzji adaptacji (są zapisane jako zdarzenia) */
  async updateCompleted(w: CompletedWorkout): Promise<void> {
    const next = { ...w, updatedAt: now() };
    const ops: { store: StoreName; put?: unknown[] }[] = [{ store: 'completed', put: [next] }];
    const p = w.plannedWorkoutId ? this.getPlanned(w.plannedWorkoutId) : null;
    let np: PlannedWorkout | null = null;
    if (p) {
      np = { ...p, status: w.completion === 'full' ? 'done' : 'partial', updatedAt: now() };
      ops.push({ store: 'planned', put: [np] });
    }
    await this.persist(ops);
    this.upsert(this.completed, [next]);
    if (np) this.upsert(this.planned, [np]);
  }

  async deleteCompleted(id: string): Promise<void> {
    const w = this.completed().find((x) => x.id === id);
    if (!w) return;
    const ops: { store: StoreName; put?: unknown[]; del?: string[] }[] = [{ store: 'completed', del: [id] }];
    const p = w.plannedWorkoutId ? this.getPlanned(w.plannedWorkoutId) : null;
    let np: PlannedWorkout | null = null;
    if (p) {
      np = { ...p, status: p.moves.length ? 'moved' : 'planned', completedWorkoutId: undefined, updatedAt: now() };
      ops.push({ store: 'planned', put: [np] });
    }
    await this.persist(ops);
    this.completed.update((xs) => xs.filter((x) => x.id !== id));
    if (np) this.upsert(this.planned, [np]);
  }

  /* ---------------- testy ---------------- */

  async saveTest(t: TestResult): Promise<void> {
    const ts = now();
    const ops: { store: StoreName; put?: unknown[]; del?: string[] }[] = [{ store: 'tests', put: [t] }];
    const p = t.plannedWorkoutId ? this.getPlanned(t.plannedWorkoutId) : null;
    let np: PlannedWorkout | null = null;
    if (p && isTest(p.type)) {
      np = { ...p, status: 'done', completedWorkoutId: t.id, updatedAt: ts };
      ops.push({ store: 'planned', put: [np] });
      ops.push({ store: 'drafts', del: [p.id] });
    }
    let nc: TrainingCycle | null = null;
    const c = this.cycles().find((x) => x.id === t.cycleId);
    if (c && t.kind === 'FINAL') {
      nc = { ...c, status: 'completed', updatedAt: ts };
      ops.push({ store: 'cycles', put: [nc] });
    }
    await this.persist(ops);
    this.upsert(this.tests, [t]);
    if (np) this.upsert(this.planned, [np]);
    if (nc) this.upsert(this.cycles, [nc]);
    if (p) this.drafts.update((ds) => ds.filter((d) => d.id !== p.id));
  }

  async deleteTest(id: string): Promise<void> {
    const t = this.tests().find((x) => x.id === id);
    if (!t) return;
    const ts = now();
    const ops: { store: StoreName; put?: unknown[]; del?: string[] }[] = [{ store: 'tests', del: [id] }];
    const p = t.plannedWorkoutId ? this.getPlanned(t.plannedWorkoutId) : null;
    let np: PlannedWorkout | null = null;
    if (p && p.completedWorkoutId === id) {
      np = { ...p, status: p.moves.length ? 'moved' : 'planned', completedWorkoutId: undefined, updatedAt: ts };
      ops.push({ store: 'planned', put: [np] });
    }
    const c = this.cycles().find((x) => x.id === t.cycleId);
    let nc: TrainingCycle | null = null;
    if (c && t.kind === 'FINAL' && c.status === 'completed') {
      nc = { ...c, status: 'active', updatedAt: ts };
      ops.push({ store: 'cycles', put: [nc] });
    }
    await this.persist(ops);
    this.tests.update((xs) => xs.filter((x) => x.id !== id));
    if (np) this.upsert(this.planned, [np]);
    if (nc) this.upsert(this.cycles, [nc]);
  }

  async updateTest(t: TestResult): Promise<void> {
    const next = { ...t, updatedAt: now() } as TestResult;
    await this.persist([{ store: 'tests', put: [next] }]);
    this.upsert(this.tests, [next]);
  }

  testsFor(cycleId: string) {
    return this.tests().filter((t) => t.cycleId === cycleId).sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  /* ---------------- Baseline Test v1.0 ---------------- */

  assessmentFor(cycleId: string, kind: AssessmentKind): Assessment | null {
    return this.assessments().find((a) => a.cycleId === cycleId && a.kind === kind) ?? null;
  }

  getAssessment(id: string): Assessment | null {
    return this.assessments().find((a) => a.id === id) ?? null;
  }

  /** Testy zakończone (z obu sesjami wymaganymi przez rodzaj testu), chronologicznie */
  readonly completedAssessments = computed(() =>
    this.assessments().filter((a) => a.status === 'completed').sort((a, b) => ((a.completedAt ?? '') < (b.completedAt ?? '') ? -1 : 1)),
  );

  /** Ostatni test (Baseline lub Retest) z danego cyklu lub wcześniejszych – źródło warunków (krawądka, drążek, droga) */
  private referenceFor(cycleId: string, kind: AssessmentKind): Assessment | null {
    const own = kind !== 'BASELINE' ? this.assessmentFor(cycleId, 'BASELINE') : null;
    if (own) return own;
    const prev = this.assessments().filter((a) => a.cycleId !== cycleId && (a.kind === 'BASELINE' || a.kind === 'FINAL') && a.status === 'completed');
    return prev.sort((a, b) => ((a.completedAt ?? '') < (b.completedAt ?? '') ? 1 : -1))[0] ?? null;
  }

  /**
   * Rozpoczyna (lub wznawia) sesję testu dla zaplanowanej jednostki.
   * Jeden rekord Assessment obejmuje obie sesje Baseline/Retest; test pośredni ma własny rekord.
   */
  async beginAssessmentPart(plannedId: string): Promise<Assessment> {
    const p = this.getPlanned(plannedId);
    if (!p || !isTest(p.type) || !p.part) throw new Error('To nie jest sesja Baseline Test v1.0');
    const ts = now();
    const kind = p.type as AssessmentKind;
    let a = this.assessmentFor(p.cycleId, kind);
    a = a ? structuredClone(a) : newAssessment(uid(), p.cycleId, kind, ts);
    if (!a.plannedIds.includes(p.id)) a.plannedIds.push(p.id);
    const ref = this.referenceFor(p.cycleId, kind);
    const mass = this.profile().weightKg || null;
    const part: AssessmentPart = p.part;
    if (part === 'strength' && (!a.strength || a.strength.status === 'postponed')) {
      const hb = this.profile().hangboard;
      const prev = a.strength ?? ref?.strength ?? null;
      a.strength = { ...newStrengthSession(this.today(), ts, mass, prev, hb.edgeSizeMm === 20 ? hb.edge : 'Krawądka 20 mm', hb.edgeSizeMm ?? 20) };
    }
    if (part === 'climbing' && (!a.climbing || a.climbing.status === 'postponed')) {
      const attempts = kind === 'CONTROL' ? CONTROL_ROUTE_ATTEMPTS : BASELINE_ROUTE_ATTEMPTS;
      a.climbing = newClimbingSession(this.today(), ts, a.strength?.readiness.bodyMassKg ?? mass, attempts, ref?.climbing?.route ?? null);
    }
    await this.saveAssessment(a);
    return this.getAssessment(a.id)!;
  }

  /**
   * Zapis testu po każdej zatwierdzonej zmianie (autozapis). Synchronizuje status zaplanowanych jednostek
   * i kończy cykl po Reteście.
   */
  async saveAssessment(input: Assessment): Promise<void> {
    const ts = now();
    const prevStatus = this.getAssessment(input.id)?.status;
    const a: Assessment = { ...input, updatedAt: ts };
    a.status = assessmentStatus(a);
    if (a.status === 'completed' && !a.completedAt) a.completedAt = ts;
    if (a.status !== 'completed') a.completedAt = null;

    const ops: { store: StoreName; put?: unknown[]; del?: string[] }[] = [{ store: 'assessments', put: [a] }];
    const plannedPut: PlannedWorkout[] = [];
    for (const pid of a.plannedIds) {
      const p = this.getPlanned(pid);
      if (!p || !p.part) continue;
      const done = (p.part === 'strength' ? a.strength : a.climbing)?.status === 'completed';
      if (done && p.status !== 'done') plannedPut.push({ ...p, status: 'done', completedWorkoutId: a.id, updatedAt: ts });
      if (!done && p.status === 'done') plannedPut.push({ ...p, status: p.moves.length ? 'moved' : 'planned', completedWorkoutId: undefined, updatedAt: ts });
    }
    if (plannedPut.length) ops.push({ store: 'planned', put: plannedPut });

    const evs: AdaptationEvent[] = [];
    let nc: TrainingCycle | null = null;
    const c = this.cycles().find((x) => x.id === a.cycleId);
    if (a.status === 'completed' && prevStatus !== 'completed') {
      evs.push(this.event({ cycleId: a.cycleId, kind: 'plan', reason: `${KIND_LABELS[a.kind]} zakończony – raport z wynikami jest dostępny w zakładce Progres.`, sourceIds: [a.id] }));
      if (c && a.kind === 'FINAL' && c.status === 'active') {
        nc = { ...c, status: 'completed', updatedAt: ts };
        ops.push({ store: 'cycles', put: [nc] });
      }
    }
    if (prevStatus === 'completed' && a.status !== 'completed' && c && a.kind === 'FINAL' && c.status === 'completed') {
      nc = { ...c, status: 'active', updatedAt: ts };
      ops.push({ store: 'cycles', put: [nc] });
    }
    if (evs.length) ops.push({ store: 'events', put: evs });
    await this.persist(ops);
    this.upsert(this.assessments, [a]);
    if (plannedPut.length) this.upsert(this.planned, plannedPut);
    if (evs.length) this.upsert(this.events, evs);
    if (nc) this.upsert(this.cycles, [nc]);
  }

  /** Przełożenie sesji (np. ból) – zapisane dane sesji zostają, jednostkę przesuwa się w Planie */
  async postponeAssessmentPart(id: string, part: AssessmentPart, reason: string): Promise<void> {
    const a = this.getAssessment(id);
    if (!a) return;
    const n = structuredClone(a);
    const s = part === 'strength' ? n.strength : n.climbing;
    if (!s) return;
    s.status = 'postponed';
    s.notes = [s.notes, reason].filter(Boolean).join(' ');
    await this.saveAssessment(n);
    await this.addEvents([this.event({ cycleId: a.cycleId, kind: 'readiness', reason: `${PART_LABELS[part]} przełożony: ${reason}`, sourceIds: [a.id] })]);
  }

  /** Porzucenie sesji – usuwa jej dane (druga sesja testu zostaje) */
  async discardAssessmentPart(id: string, part: AssessmentPart): Promise<void> {
    const a = this.getAssessment(id);
    if (!a) return;
    const n = structuredClone(a);
    if (part === 'strength') n.strength = null;
    else n.climbing = null;
    if (!n.strength && !n.climbing) {
      await this.persist([{ store: 'assessments', del: [id] }]);
      this.assessments.update((xs) => xs.filter((x) => x.id !== id));
      return;
    }
    await this.saveAssessment(n);
  }

  /* ---------------- gotowość ---------------- */

  async saveReadiness(r: ReadinessCheck): Promise<void> {
    await this.persist([{ store: 'readiness', put: [r] }]);
    this.upsert(this.readiness, [r]);
    const a = evaluateReadiness(r);
    const c = this.cycle();
    if (c && a.level !== 'go') {
      await this.addEvents([this.event({ cycleId: c.id, kind: 'readiness', reason: `Ocena gotowości (${formatDate(r.date)}): ${a.title}. ${a.messages.join(' ')}`, sourceIds: [r.id] })]);
    }
  }

  async deleteReadiness(id: string) {
    await this.persist([{ store: 'readiness', del: [id] }]);
    this.readiness.update((xs) => xs.filter((x) => x.id !== id));
  }

  /* ---------------- szkice sesji ---------------- */

  getDraft<T>(id: string): (SessionDraft & { data: T }) | null {
    return (this.drafts().find((d) => d.id === id) as SessionDraft & { data: T }) ?? null;
  }

  async saveDraft(d: SessionDraft) {
    await this.persist([{ store: 'drafts', put: [d] }]);
    this.upsert(this.drafts, [d]);
  }

  async deleteDraft(id: string) {
    await this.persist([{ store: 'drafts', del: [id] }]);
    this.drafts.update((xs) => xs.filter((x) => x.id !== id));
  }

  /* ---------------- raporty tygodniowe ---------------- */

  /** Generuje brakujące raporty dla zakończonych tygodni aktywnego cyklu */
  async ensureWeeklyReports(force = false): Promise<void> {
    const c = this.cycle() ?? this.lastCycle();
    if (!c || !c.planStart) return;
    const lastFinished = Math.min(c.weeks, cycleWeek(c, this.today()) - 1);
    const fresh: WeeklyReport[] = [];
    const stale: string[] = [];
    for (let w = 1; w <= lastFinished; w++) {
      const existing = this.reports().find((r) => r.cycleId === c.id && r.week === w);
      if (existing && !force) continue;
      if (existing) stale.push(existing.id);
      fresh.push(generateWeeklyReport({
        cycle: c, week: w, weekStart: weekStart(c, w)!, planned: this.planned(), completed: this.completed(), events: this.events(), ts: now(),
      }));
    }
    if (!fresh.length) return;
    await this.persist([{ store: 'reports', put: fresh, del: stale }]);
    this.reports.update((rs) => [...rs.filter((r) => !stale.includes(r.id)), ...fresh]);
  }

  /* ---------------- eksport / import ---------------- */

  exportJson(): string {
    const data: AppData = {
      profile: [this.profile()], cycles: this.cycles(), planned: this.planned(), completed: this.completed(), readiness: this.readiness(),
      tests: this.tests(), events: this.events(), reports: this.reports(), drafts: this.drafts(), assessments: this.assessments(),
    };
    return JSON.stringify(buildExport(data, now()), null, 2);
  }

  async importJson(text: string): Promise<void> {
    const data = parseImport(text);
    if (!data.profile.length) data.profile = [this.profile()];
    await this.db.replaceAll(data);
    this.applyData(data);
  }

  async resetAll(): Promise<void> {
    const p = defaultProfile(now());
    const empty: AppData = { profile: [p], cycles: [], planned: [], completed: [], readiness: [], tests: [], events: [], reports: [], drafts: [], assessments: [] };
    await this.db.replaceAll(empty);
    this.applyData(empty);
  }

  /** Dni od ostatniej ciężkiej jednostki (do karty regeneracji) */
  readonly lastHeavy = computed(() => {
    const heavy = this.completed().filter((w) => isHeavy(w.type)).map((w) => w.date);
    const tests = [...this.tests().map((t) => t.date), ...this.assessments().flatMap((a) => [a.strength, a.climbing]).filter((s) => s?.status === 'completed').map((s) => s!.date)];
    const all = [...heavy, ...tests].filter((d) => d <= this.today()).sort();
    return all[all.length - 1] ?? null;
  });

  weekRange(week: number): { start: ISODate; end: ISODate } | null {
    const c = this.cycle();
    if (!c) return null;
    const s = weekStart(c, week);
    return s ? { start: s, end: addDays(s, 6) } : null;
  }
}
