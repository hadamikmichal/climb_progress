import { computed, inject, Injectable, signal } from '@angular/core';
import { Db, OutboxEntry, SYNCED_STORES, SyncedStore } from '../data/db';
import { AdaptationEvent, CompletedWorkout, PlannedWorkout, ReadinessCheck, TestResult, TrainingCycle, UserProfile } from '../models/models';
import { Assessment } from '../models/assessment';
import { DataApiError } from '../repositories/data-api';
import { AssessmentRepository } from '../repositories/assessment.repository';
import { ProfileRepository } from '../repositories/profile.repository';
import { ReadinessRepository } from '../repositories/readiness.repository';
import { TrainingCycleRepository } from '../repositories/training-cycle.repository';
import { WorkoutRepository } from '../repositories/workout.repository';
import { buildMergeOps, RemoteSnapshot } from './merge';

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'auth';

const PUSH_DEBOUNCE_MS = 1500;
const PERIODIC_MS = 60_000;
const ORDER = new Map<string, number>(SYNCED_STORES.map((s, i) => [s, i]));

/** Kolejność wysyłki: zapisy rodzic → dziecko (klucze obce), usunięcia na końcu w odwrotnej kolejności */
export function pushOrder(entries: OutboxEntry[]): OutboxEntry[] {
  const rank = (e: OutboxEntry) => (e.op === 'put' ? ORDER.get(e.store)! : 100 - ORDER.get(e.store)!);
  return [...entries].sort((a, b) => rank(a) - rank(b) || (a.queuedAt < b.queuedAt ? -1 : a.queuedAt > b.queuedAt ? 1 : 0));
}

/**
 * Synchronizacja IndexedDB ↔ Neon.
 *
 *  - Każdy zapis lokalny trafia atomowo do kolejki (`outbox`) w tej samej transakcji IndexedDB.
 *  - Wysyłka: upsert po UUID (idempotentny) → potwierdzenie usuwa wpis tylko, jeśli rekord nie zmienił się
 *    w międzyczasie. Brak sieci zatrzymuje wysyłkę bez utraty danych; ponowienie nie tworzy duplikatów.
 *  - Pobieranie: pełny stan konta z Neon (RLS zwraca wyłącznie rekordy zalogowanego użytkownika) scalony
 *    z lokalnym; rekordy z niewysłanymi zmianami nie są nadpisywane.
 *  - Lokalne dane są usuwane dopiero po potwierdzeniu, że kolejka jest pusta.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly profiles = inject(ProfileRepository);
  private readonly cycles = inject(TrainingCycleRepository);
  private readonly workouts = inject(WorkoutRepository);
  private readonly assessments = inject(AssessmentRepository);
  private readonly readinessRepo = inject(ReadinessRepository);

  readonly state = signal<SyncState>('idle');
  readonly pending = signal(0);
  /** Wpisy odrzucone przez serwer (np. naruszenie ograniczeń) – ponawiane, ale wymagają uwagi */
  readonly failed = signal(0);
  readonly lastSyncedAt = signal<string | null>(null);
  readonly lastError = signal<string | null>(null);
  readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  readonly label = computed(() => {
    const st = this.state();
    const n = this.pending();
    if (st === 'syncing') return 'Synchronizacja…';
    if (st === 'offline') return n ? `Offline · ${n} do wysłania` : 'Offline';
    if (st === 'auth') return 'Sesja wygasła – zaloguj się';
    if (st === 'error') return n ? `Błąd synchronizacji · ${n} oczekuje` : 'Błąd synchronizacji';
    return n ? `${n} do wysłania` : 'Zsynchronizowano';
  });

  private db: Db | null = null;
  private onRemote: (() => Promise<void>) | null = null;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly onOnline = () => {
    this.online.set(true);
    void this.syncNow();
  };
  private readonly onOffline = () => {
    this.online.set(false);
    this.state.set('offline');
  };
  private readonly onVisible = () => {
    if (document.visibilityState === 'visible') void this.syncNow();
  };

  attach(db: Db, onRemoteApplied: () => Promise<void>): void {
    this.db = db;
    this.onRemote = onRemoteApplied;
    this.state.set(this.online() ? 'idle' : 'offline');
    this.lastError.set(null);
    void db.getMeta<string>('lastSyncedAt').then((v) => this.lastSyncedAt.set(v));
    void this.refreshCounts();
  }

  /** Nasłuch sieci i okresowa synchronizacja */
  start(): void {
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    document.addEventListener('visibilitychange', this.onVisible);
    this.interval = setInterval(() => void this.syncNow(), PERIODIC_MS);
    void this.syncNow();
  }

  stop(): void {
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    document.removeEventListener('visibilitychange', this.onVisible);
    if (this.interval) clearInterval(this.interval);
    if (this.timer) clearTimeout(this.timer);
    this.interval = this.timer = null;
    this.db = null;
    this.onRemote = null;
    this.pending.set(0);
    this.failed.set(0);
    this.lastSyncedAt.set(null);
    this.state.set('idle');
  }

  /** Lokalny zapis – wysyłka po krótkiej przerwie (kilka szybkich zmian = jedna runda) */
  schedule(): void {
    void this.refreshCounts();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.push(), PUSH_DEBOUNCE_MS);
  }

  /** Pełna synchronizacja: najpierw wysyłka zmian lokalnych, potem pobranie stanu z serwera */
  syncNow(): Promise<void> {
    return this.exclusive(async () => {
      if (await this.pushOnce()) await this.pullOnce();
    });
  }

  push(): Promise<void> {
    return this.exclusive(async () => void (await this.pushOnce()));
  }

  /** Pierwsze pobranie danych konta (np. nowe urządzenie) – zwraca false, gdy serwer jest nieosiągalny */
  async pull(): Promise<boolean> {
    let ok = false;
    await this.exclusive(async () => {
      ok = await this.pullOnce();
    });
    return ok;
  }

  async hasPending(): Promise<boolean> {
    return !!this.db && (await this.db.outbox()).length > 0;
  }

  /* ---------------- implementacja ---------------- */

  /** Operacje synchronizacji wykonują się po kolei (nigdy równolegle na tej samej kolejce) */
  private exclusive(fn: () => Promise<void>): Promise<void> {
    const run = this.running ? this.running.then(fn, fn) : fn();
    const tail = run.finally(() => {
      if (this.running === tail) this.running = null;
    });
    this.running = tail;
    return tail;
  }

  private async refreshCounts(): Promise<void> {
    if (!this.db) return;
    const out = await this.db.outbox();
    this.pending.set(out.length);
    this.failed.set(out.filter((e) => e.lastError).length);
  }

  private fail(e: unknown): 'stop' | 'continue' {
    const err = e instanceof DataApiError ? e : null;
    if (err?.kind === 'network' || !this.online()) {
      this.state.set('offline');
      return 'stop';
    }
    if (err?.kind === 'auth') {
      this.state.set('auth');
      this.lastError.set(err.message);
      return 'stop';
    }
    this.state.set('error');
    this.lastError.set(e instanceof Error ? e.message : String(e));
    return 'continue';
  }

  /** Zwraca true, gdy kolejka została przetworzona bez problemów z siecią / sesją */
  private async pushOnce(): Promise<boolean> {
    const db = this.db;
    if (!db) return false;
    if (!navigator.onLine) {
      this.state.set('offline');
      await this.refreshCounts();
      return false;
    }
    this.state.set('syncing');
    let hadError = false;
    for (const e of pushOrder(await db.outbox())) {
      if (this.db !== db) return false;
      try {
        await this.send(db, e);
        await db.ack(e.key, e.rev);
      } catch (err) {
        if (this.fail(err) === 'stop') {
          await this.refreshCounts();
          return false;
        }
        hadError = true;
        await db.markFailed(e.key, e.rev, err instanceof Error ? err.message : String(err));
      }
    }
    await this.refreshCounts();
    if (!hadError) {
      this.state.set('idle');
      this.lastError.set(null);
      const ts = new Date().toISOString();
      this.lastSyncedAt.set(ts);
      await db.setMeta('lastSyncedAt', ts);
    }
    return true;
  }

  private async send(db: Db, e: OutboxEntry): Promise<void> {
    const value = e.op === 'put' ? await db.get<unknown>(e.store, e.entityId) : undefined;
    // zapis rekordu, który w międzyczasie usunięto lokalnie = usunięcie
    const op = e.op === 'put' && value === undefined ? 'del' : e.op;
    const s: SyncedStore = e.store;
    if (op === 'put') {
      switch (s) {
        case 'profile': return this.profiles.save(value as UserProfile);
        case 'cycles': return this.cycles.save(value as TrainingCycle);
        case 'planned': return this.workouts.savePlanned(value as PlannedWorkout);
        case 'completed': return this.workouts.saveSession(value as CompletedWorkout);
        case 'assessments': return this.assessments.save(value as Assessment);
        case 'tests': return this.assessments.saveLegacy(value as TestResult);
        case 'readiness': return this.readinessRepo.save(value as ReadinessCheck);
        case 'events': return this.cycles.saveEvent(value as AdaptationEvent);
      }
    }
    switch (s) {
      case 'profile': return; // profilu konta nie usuwamy – zostaje zastąpiony przy kolejnym zapisie
      case 'cycles': return this.cycles.remove(e.entityId);
      case 'planned': return this.workouts.removePlanned(e.entityId);
      case 'completed': return this.workouts.removeSession(e.entityId);
      case 'assessments':
      case 'tests': return this.assessments.remove(e.entityId);
      case 'readiness': return this.readinessRepo.remove(e.entityId);
      case 'events': return this.cycles.removeEvent(e.entityId);
    }
  }

  private async pullOnce(): Promise<boolean> {
    const db = this.db;
    if (!db) return false;
    if (!navigator.onLine) {
      this.state.set('offline');
      return false;
    }
    this.state.set('syncing');
    try {
      const [profile, cycles, planned, completed, tests, readiness, events] = await Promise.all([
        this.profiles.get(), this.cycles.list(), this.workouts.listPlanned(), this.workouts.listSessions(), this.assessments.list(),
        this.readinessRepo.list(), this.cycles.listEvents(),
      ]);
      const remote: RemoteSnapshot = { profile, cycles, planned, completed, assessments: tests.assessments, tests: tests.tests, readiness, events };
      if (this.db !== db) return false;
      await db.mergeRemote((pending, local) => buildMergeOps(remote, local, pending));
      const ts = new Date().toISOString();
      await db.setMeta('lastPullAt', ts);
      await db.setMeta('lastSyncedAt', ts);
      this.lastSyncedAt.set(ts);
      await this.onRemote?.();
      await this.refreshCounts();
      if (this.state() === 'syncing') this.state.set(this.failed() ? 'error' : 'idle');
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    }
  }
}
