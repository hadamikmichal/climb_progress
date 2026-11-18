import { AppData } from '../models/models';

/** Baza sprzed kont (jedna na przeglądarkę) – źródło importu „lokalnych danych treningowych” */
export const LEGACY_DB_NAME = 'climbprogress';
export const DB_PREFIX = 'climbprogress:u:';
export const DB_VERSION = 3;
export const STORES = ['profile', 'cycles', 'planned', 'completed', 'readiness', 'tests', 'events', 'reports', 'drafts', 'assessments'] as const;
export type StoreName = (typeof STORES)[number];

/**
 * Magazyny synchronizowane z Neon – w kolejności zależności kluczy obcych (rodzic przed dzieckiem).
 * `reports` (raporty tygodniowe) są wyliczane z danych, a `drafts` (szkic trwającej sesji) są lokalne.
 */
export const SYNCED_STORES = ['profile', 'cycles', 'planned', 'completed', 'assessments', 'tests', 'readiness', 'events'] as const;
export type SyncedStore = (typeof SYNCED_STORES)[number];
export const isSynced = (s: string): s is SyncedStore => (SYNCED_STORES as readonly string[]).includes(s);

/** Operacja oczekująca na wysłanie. Klucz `store:id` – kolejne zmiany tego samego rekordu scalają się w jedną. */
export interface OutboxEntry {
  key: string;
  store: SyncedStore;
  entityId: string;
  op: 'put' | 'del';
  /** Rośnie przy każdej zmianie – potwierdzenie usuwa wpis tylko, jeśli w międzyczasie nie było nowej zmiany */
  rev: number;
  queuedAt: string;
  attempts: number;
  lastError: string | null;
}

export interface MetaRecord {
  key: string;
  value: unknown;
}

const INTERNAL = ['outbox', 'meta'] as const;

export const userDbName = (userId: string) => `${DB_PREFIX}${userId}`;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transakcja przerwana'));
  });
}

export type WriteOp = { store: StoreName; put?: unknown[]; del?: string[] };

let revCounter = 0;
const nextRev = () => Date.now() * 1000 + (revCounter = (revCounter + 1) % 1000);

/** Minimalny wrapper IndexedDB – bez zewnętrznych zależności */
export class Db {
  private constructor(
    private readonly db: IDBDatabase,
    readonly name: string,
  ) {}

  /** Otwiera bazę konta. Każde konto ma osobną bazę – dane innego użytkownika nie są nawet wczytywane. */
  static open(name: string): Promise<Db> {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(name, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
        for (const s of INTERNAL) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'key' });
      };
      r.onsuccess = () => resolve(new Db(r.result, name));
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('Baza danych jest otwarta w innej karcie w starszej wersji – zamknij pozostałe karty ClimbProgress.'));
    });
  }

  /**
   * Otwiera istniejącą bazę tylko do odczytu (np. dane sprzed kont). Nie tworzy nowej bazy –
   * zwraca null, jeśli jej nie ma.
   */
  static openExisting(name: string): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
      const r = indexedDB.open(name);
      // baza nie istniała – przerwanie transakcji wersji usuwa ją z powrotem
      r.onupgradeneeded = () => r.transaction?.abort();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    });
  }

  static delete(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const r = indexedDB.deleteDatabase(name);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
      r.onblocked = () => resolve();
    });
  }

  close() {
    this.db.close();
  }

  async all<T>(store: StoreName): Promise<T[]> {
    const tx = this.db.transaction(store, 'readonly');
    return req(tx.objectStore(store).getAll()) as Promise<T[]>;
  }

  async get<T>(store: StoreName, id: string): Promise<T | undefined> {
    const tx = this.db.transaction(store, 'readonly');
    return req(tx.objectStore(store).get(id)) as Promise<T | undefined>;
  }

  /**
   * Zapis wielu rekordów w wielu magazynach w jednej transakcji.
   * `track` (domyślnie) dopisuje zmiany synchronizowanych magazynów do kolejki w tej samej transakcji –
   * zapis lokalny i wpis do kolejki są atomowe, więc przerwanie (zamknięcie aplikacji) niczego nie gubi.
   */
  async write(ops: WriteOp[], track = true): Promise<void> {
    const names = [...new Set(ops.map((o) => o.store))];
    if (!names.length) return;
    const tracked = track && ops.some((o) => isSynced(o.store));
    const tx = this.db.transaction(tracked ? [...names, 'outbox'] : names, 'readwrite');
    const out = tracked ? tx.objectStore('outbox') : null;
    const ts = new Date().toISOString();
    for (const o of ops) {
      const os = tx.objectStore(o.store);
      for (const v of o.put ?? []) {
        os.put(v);
        if (out && isSynced(o.store)) out.put(this.entry(o.store, (v as { id: string }).id, 'put', ts));
      }
      for (const k of o.del ?? []) {
        os.delete(k);
        if (out && isSynced(o.store)) out.put(this.entry(o.store, k, 'del', ts));
      }
    }
    await done(tx);
  }

  private entry(store: SyncedStore, id: string, op: 'put' | 'del', ts: string): OutboxEntry {
    return { key: `${store}:${id}`, store, entityId: id, op, rev: nextRev(), queuedAt: ts, attempts: 0, lastError: null };
  }

  async loadAll(): Promise<AppData> {
    const out = {} as Record<StoreName, unknown[]>;
    for (const s of STORES) out[s] = await this.all(s);
    return out as unknown as AppData;
  }

  /**
   * Zastępuje wszystkie dane (import kopii JSON, „usuń wszystkie dane”).
   * Usunięte rekordy i nowe rekordy trafiają do kolejki synchronizacji.
   */
  async replaceAll(data: AppData, previousIds: Partial<Record<StoreName, string[]>> = {}, track = true): Promise<void> {
    const tx = this.db.transaction([...STORES, 'outbox'], 'readwrite');
    const out = tx.objectStore('outbox');
    const ts = new Date().toISOString();
    for (const s of STORES) {
      const os = tx.objectStore(s);
      os.clear();
      const next = (data[s] as { id: string }[]) ?? [];
      for (const v of next) os.put(v);
      if (!track || !isSynced(s)) continue;
      const keep = new Set(next.map((v) => v.id));
      for (const id of previousIds[s] ?? []) if (!keep.has(id)) out.put(this.entry(s, id, 'del', ts));
      for (const v of next) out.put(this.entry(s, v.id, 'put', ts));
    }
    await done(tx);
  }

  /* ---------------- kolejka synchronizacji ---------------- */

  async outbox(): Promise<OutboxEntry[]> {
    const tx = this.db.transaction('outbox', 'readonly');
    return req(tx.objectStore('outbox').getAll()) as Promise<OutboxEntry[]>;
  }

  /** Potwierdzenie wysłania – usuwa wpis tylko, jeśli rekord nie zmienił się od chwili wysłania */
  async ack(key: string, rev: number): Promise<boolean> {
    const tx = this.db.transaction('outbox', 'readwrite');
    const os = tx.objectStore('outbox');
    const cur = (await req(os.get(key))) as OutboxEntry | undefined;
    let removed = false;
    if (cur && cur.rev === rev) {
      os.delete(key);
      removed = true;
    }
    await done(tx);
    return removed;
  }

  async markFailed(key: string, rev: number, error: string): Promise<void> {
    const tx = this.db.transaction('outbox', 'readwrite');
    const os = tx.objectStore('outbox');
    const cur = (await req(os.get(key))) as OutboxEntry | undefined;
    if (cur && cur.rev === rev) os.put({ ...cur, attempts: cur.attempts + 1, lastError: error });
    await done(tx);
  }

  /**
   * Scalenie danych z serwera w jednej transakcji: rekordy z oczekującymi lokalnymi zmianami
   * (wpis w kolejce) nie są nadpisywane ani usuwane – lokalna zmiana zostanie wysłana później.
   */
  async mergeRemote(build: (pending: Set<string>, local: AppData) => WriteOp[]): Promise<void> {
    const pending = new Set((await this.outbox()).map((e) => e.key));
    const local = await this.loadAll();
    const ops = build(pending, local);
    // drugi odczyt kolejki w transakcji zapisu: zmiany zrobione w trakcie pobierania też są chronione
    const tx = this.db.transaction([...new Set([...ops.map((o) => o.store), 'outbox' as const])], 'readwrite');
    const outReq = tx.objectStore('outbox').getAllKeys();
    outReq.onsuccess = () => {
      const nowPending = new Set(outReq.result as string[]);
      for (const o of ops) {
        const os = tx.objectStore(o.store);
        for (const v of o.put ?? []) if (!nowPending.has(`${o.store}:${(v as { id: string }).id}`)) os.put(v);
        for (const k of o.del ?? []) if (!nowPending.has(`${o.store}:${k}`)) os.delete(k);
      }
    };
    await done(tx);
  }

  /* ---------------- metadane ---------------- */

  async getMeta<T>(key: string): Promise<T | null> {
    const tx = this.db.transaction('meta', 'readonly');
    const r = (await req(tx.objectStore('meta').get(key))) as MetaRecord | undefined;
    return (r?.value as T) ?? null;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    const tx = this.db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ key, value });
    await done(tx);
  }
}

/** Odczyt wszystkich magazynów z bazy sprzed kont (tylko te, które w niej istnieją) */
export async function readLegacy(db: IDBDatabase): Promise<AppData> {
  const out = {} as Record<StoreName, unknown[]>;
  for (const s of STORES) {
    if (!db.objectStoreNames.contains(s)) {
      out[s] = [];
      continue;
    }
    const tx = db.transaction(s, 'readonly');
    out[s] = (await req(tx.objectStore(s).getAll())) as unknown[];
  }
  return out as unknown as AppData;
}
