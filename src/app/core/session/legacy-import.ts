import { inject, Injectable, signal } from '@angular/core';
import { AppStore } from '../data/store';
import { Db, LEGACY_DB_NAME, readLegacy } from '../data/db';
import { AppData } from '../models/models';
import { ProfileRepository } from '../repositories/profile.repository';
import { SyncService } from '../sync/sync.service';

const IMPORTED_KEY = 'cp.legacy.importedBy';
const SKIP_KEY = (uid: string) => `cp.legacy.skipped:${uid}`;

const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* brak pamięci – pytanie pojawi się ponownie */
    }
  },
  del: (k: string) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignorujemy */
    }
  },
};

export interface LegacySummary {
  workouts: number;
  assessments: number;
  cycles: number;
  readiness: number;
  total: number;
}

export function summarizeLegacy(d: AppData): LegacySummary {
  const workouts = d.completed.length;
  const assessments = d.assessments.length + d.tests.length;
  const cycles = d.cycles.length;
  const readiness = d.readiness.length;
  return { workouts, assessments, cycles, readiness, total: workouts + assessments + cycles + readiness + d.planned.length + d.events.length };
}

/**
 * Dane treningowe zapisane w tej przeglądarce przed wprowadzeniem kont (baza „climbprogress”).
 * Nigdy ich nie usuwamy – po imporcie baza zostaje nienaruszona, a znacznik zapobiega ponownemu
 * przypisaniu tych samych danych do innego konta.
 */
@Injectable({ providedIn: 'root' })
export class LegacyImportService {
  private readonly store = inject(AppStore);
  private readonly sync = inject(SyncService);
  private readonly profiles = inject(ProfileRepository);

  /** Dane do zaproponowania po zalogowaniu (dialog) */
  readonly prompt = signal<LegacySummary | null>(null);
  /** Dane dostępne do importu (także po „Pomiń” – w sekcji Konto) */
  readonly available = signal<LegacySummary | null>(null);
  readonly importedBy = signal<string | null>(ls.get(IMPORTED_KEY));
  readonly busy = signal(false);
  readonly result = signal<string | null>(null);

  private userId: string | null = null;

  async check(userId: string): Promise<void> {
    this.userId = userId;
    this.prompt.set(null);
    this.available.set(null);
    this.result.set(null);
    this.importedBy.set(ls.get(IMPORTED_KEY));
    if (this.importedBy()) return;
    const data = await this.read();
    if (!data) return;
    const s = summarizeLegacy(data);
    if (!s.total) return;
    this.available.set(s);
    if (!ls.get(SKIP_KEY(userId))) this.prompt.set(s);
  }

  skip(): void {
    if (this.userId) ls.set(SKIP_KEY(this.userId), new Date().toISOString());
    this.prompt.set(null);
  }

  /**
   * Import: jedna transakcja IndexedDB (rekordy + kolejka), potem synchronizacja z Neon.
   * Przerwanie przed zapisem lokalnym = nic się nie stało (pytanie wróci); po zapisie = kolejka wyśle dane
   * przy następnej okazji. Rekordy zachowują UUID, więc powtórzenie nie tworzy duplikatów.
   */
  async importNow(): Promise<void> {
    const uid = this.userId;
    if (!uid || this.busy()) return;
    this.busy.set(true);
    this.result.set(null);
    try {
      const data = await this.read();
      if (!data) throw new Error('Nie znaleziono lokalnych danych.');
      let takeProfile = true;
      try {
        takeProfile = !(await this.profiles.get());
      } catch {
        // offline – profil z urządzenia zostanie przyjęty tylko, jeśli to konto nie pobrało jeszcze profilu z serwera
        takeProfile = !(await this.store.database?.getMeta('lastPullAt'));
      }
      const n = await this.store.importLegacy(data, takeProfile);
      ls.set(IMPORTED_KEY, uid);
      ls.del(SKIP_KEY(uid));
      this.importedBy.set(uid);
      this.prompt.set(null);
      this.available.set(null);
      await this.store.database?.setMeta('legacyImport', { at: new Date().toISOString(), records: n });
      this.result.set(`Przypisano do konta ${n} rekordów. Wysyłanie do bazy trwa w tle – status widać w sekcji Konto.`);
      void this.sync.syncNow();
    } catch (e) {
      this.result.set(e instanceof Error ? e.message : 'Import nie powiódł się.');
    } finally {
      this.busy.set(false);
    }
  }

  private async read(): Promise<AppData | null> {
    if (typeof indexedDB === 'undefined') return null;
    const db = await Db.openExisting(LEGACY_DB_NAME);
    if (!db) return null;
    try {
      return await readLegacy(db);
    } finally {
      db.close();
    }
  }
}
