import { AppData } from '../models/models';

export const DB_NAME = 'climbprogress';
export const DB_VERSION = 2;
export const STORES = ['profile', 'cycles', 'planned', 'completed', 'readiness', 'tests', 'events', 'reports', 'drafts', 'assessments'] as const;
export type StoreName = (typeof STORES)[number];

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

/** Minimalny wrapper IndexedDB – bez zewnętrznych zależności */
export class Db {
  private constructor(private readonly db: IDBDatabase) {}

  static open(): Promise<Db> {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(new Db(r.result));
      r.onerror = () => reject(r.error);
    });
  }

  async all<T>(store: StoreName): Promise<T[]> {
    const tx = this.db.transaction(store, 'readonly');
    return req(tx.objectStore(store).getAll()) as Promise<T[]>;
  }

  /** Zapis wielu rekordów w wielu magazynach w jednej transakcji */
  async write(ops: { store: StoreName; put?: unknown[]; del?: string[] }[]): Promise<void> {
    const names = [...new Set(ops.map((o) => o.store))];
    if (!names.length) return;
    const tx = this.db.transaction(names, 'readwrite');
    for (const o of ops) {
      const os = tx.objectStore(o.store);
      for (const v of o.put ?? []) os.put(v);
      for (const k of o.del ?? []) os.delete(k);
    }
    await done(tx);
  }

  async loadAll(): Promise<AppData> {
    const out = {} as Record<StoreName, unknown[]>;
    for (const s of STORES) out[s] = await this.all(s);
    return out as unknown as AppData;
  }

  async replaceAll(data: AppData): Promise<void> {
    const tx = this.db.transaction([...STORES], 'readwrite');
    for (const s of STORES) {
      const os = tx.objectStore(s);
      os.clear();
      for (const v of (data[s] as unknown[]) ?? []) os.put(v);
    }
    await done(tx);
  }
}
