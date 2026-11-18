import { inject, Injectable } from '@angular/core';
import type { HangboardLogRow } from '../../../../db/schema';
import { WorkoutRows } from '../sync/mappers';
import { DataApi } from './data-api';

/** Zwisy na chwytotablicy (Max Hangs / Repeaters: krawądka, obciążenie, odciążenie, czas zwisu) */
@Injectable({ providedIn: 'root' })
export class HangboardRepository {
  private readonly api = inject(DataApi);

  listAll(): Promise<HangboardLogRow[]> {
    return this.api.selectAll<HangboardLogRow>('hangboard_logs');
  }

  async replaceForSession(sessionId: string, rows: WorkoutRows['hangs']): Promise<void> {
    await this.api.upsert('hangboard_logs', rows);
    await this.api.deleteChildrenExcept('hangboard_logs', 'workout_session_id', sessionId, rows.map((r) => r.id));
  }
}
