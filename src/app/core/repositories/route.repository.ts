import { inject, Injectable } from '@angular/core';
import type { RouteLogRow } from '../../../../db/schema';
import { WorkoutRows } from '../sync/mappers';
import { DataApi } from './data-api';

/** Drogi wspinane w treningach (trudność, ukończenie, RPE, pompowanie, technika) */
@Injectable({ providedIn: 'root' })
export class RouteRepository {
  private readonly api = inject(DataApi);

  listAll(): Promise<RouteLogRow[]> {
    return this.api.selectAll<RouteLogRow>('route_logs');
  }

  /** Idempotentna zamiana zestawu dróg treningu: upsert po id + usunięcie dróg skasowanych w edycji */
  async replaceForSession(sessionId: string, rows: WorkoutRows['routes']): Promise<void> {
    await this.api.upsert('route_logs', rows);
    await this.api.deleteChildrenExcept('route_logs', 'workout_session_id', sessionId, rows.map((r) => r.id));
  }
}
