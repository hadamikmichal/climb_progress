import { inject, Injectable } from '@angular/core';
import { AuthRequiredError } from '@neon/neon-js';
import { NeonClientService } from '../auth/neon-client';

export type DataApiErrorKind = 'network' | 'auth' | 'rejected' | 'unknown';

/** Błąd Neon Data API z klasyfikacją potrzebną do decyzji o ponowieniu */
export class DataApiError extends Error {
  constructor(
    message: string,
    readonly kind: DataApiErrorKind,
    readonly code: string | null = null,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'DataApiError';
  }
}

interface PgResult<T> {
  data: T | null;
  error: { message: string; code?: string; details?: string | null; hint?: string | null } | null;
  status: number;
}

const PAGE = 1000;

export function classify(e: { message?: string; code?: string } | null, status: number | null): DataApiErrorKind {
  const code = e?.code ?? '';
  const msg = e?.message ?? '';
  if (status === 0 || /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(msg)) return 'network';
  if (status === 401 || code === 'PGRST301' || code === 'PGRST302' || /JWT/i.test(msg)) return 'auth';
  if (status === 403 || code === '42501' || /^2[23]/.test(code) || status === 400 || status === 409) return 'rejected';
  return 'unknown';
}

/**
 * Cienka warstwa nad Neon Data API (PostgREST). Token JWT Neon Auth dołącza SDK –
 * aplikacja nie przekazuje user_id ani żadnych sekretów.
 */
@Injectable({ providedIn: 'root' })
export class DataApi {
  private readonly neon = inject(NeonClientService);

  from(table: string) {
    return this.neon.client.from(table);
  }

  async run<T>(q: PromiseLike<PgResult<T>>): Promise<T> {
    let r: PgResult<T>;
    try {
      r = await q;
    } catch (e) {
      if (e instanceof AuthRequiredError) throw new DataApiError('Sesja wygasła – zaloguj się ponownie.', 'auth');
      const m = e instanceof Error ? e.message : String(e);
      throw new DataApiError(m, classify({ message: m }, null));
    }
    if (r.error) {
      const msg = [r.error.message, r.error.details, r.error.hint].filter(Boolean).join(' – ');
      throw new DataApiError(msg, classify(r.error, r.status), r.error.code ?? null, r.status);
    }
    return r.data as T;
  }

  /** Wszystkie wiersze tabeli widoczne dla zalogowanego użytkownika (RLS), stronicowane */
  async selectAll<T>(table: string, order = 'id'): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const page = await this.run<T[]>(this.from(table).select('*').order(order, { ascending: true }).range(from, from + PAGE - 1));
      out.push(...(page ?? []));
      if (!page || page.length < PAGE) return out;
    }
  }

  async upsert(table: string, rows: object | object[], onConflict = 'id'): Promise<void> {
    if (Array.isArray(rows) && !rows.length) return;
    await this.run(this.from(table).upsert(rows as never, { onConflict }));
  }

  async deleteById(table: string, id: string): Promise<void> {
    await this.run(this.from(table).delete().eq('id', id));
  }

  /** Usuwa wiersze podrzędne rodzica, których nie ma już w zestawie `keepIds` */
  async deleteChildrenExcept(table: string, parentCol: string, parentId: string, keepIds: string[]): Promise<void> {
    let q = this.from(table).delete().eq(parentCol, parentId);
    if (keepIds.length) q = q.not('id', 'in', `(${keepIds.join(',')})`);
    await this.run(q);
  }
}
