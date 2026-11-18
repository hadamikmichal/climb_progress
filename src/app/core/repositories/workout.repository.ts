import { inject, Injectable } from '@angular/core';
import type { HangboardLogRow, PlannedWorkoutRow, RouteLogRow, WorkoutSessionRow } from '../../../../db/schema';
import { CompletedWorkout, PlannedWorkout } from '../models/models';
import { plannedToRow, rowsToWorkout, rowToPlanned, workoutToRows } from '../sync/mappers';
import { DataApi } from './data-api';
import { HangboardRepository } from './hangboard.repository';
import { RouteRepository } from './route.repository';

const groupBy = <T>(rows: T[], key: (r: T) => string) => {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return m;
};

/** Plan (zaplanowane jednostki) i wykonane treningi wraz z drogami i zwisami */
@Injectable({ providedIn: 'root' })
export class WorkoutRepository {
  private readonly api = inject(DataApi);
  private readonly routes = inject(RouteRepository);
  private readonly hangs = inject(HangboardRepository);

  /* ---------- plan ---------- */

  async listPlanned(): Promise<PlannedWorkout[]> {
    return (await this.api.selectAll<PlannedWorkoutRow>('planned_workouts')).map(rowToPlanned);
  }

  async savePlanned(p: PlannedWorkout): Promise<void> {
    await this.api.upsert('planned_workouts', plannedToRow(p));
  }

  async removePlanned(id: string): Promise<void> {
    await this.api.deleteById('planned_workouts', id);
  }

  /* ---------- wykonane treningi ---------- */

  async listSessions(): Promise<CompletedWorkout[]> {
    const [sessions, routes, hangs] = await Promise.all([
      this.api.selectAll<WorkoutSessionRow>('workout_sessions'),
      this.routes.listAll(),
      this.hangs.listAll(),
    ]);
    const r = groupBy<RouteLogRow>(routes, (x) => x.workout_session_id);
    const h = groupBy<HangboardLogRow>(hangs, (x) => x.workout_session_id);
    return sessions.map((s) => rowsToWorkout(s, r.get(s.id) ?? [], h.get(s.id) ?? []));
  }

  /**
   * Zapis treningu: najpierw sesja (rodzic), potem drogi i zwisy. Każdy krok jest idempotentny,
   * więc przerwany zapis jest bezpiecznie powtarzany w całości przy kolejnej synchronizacji.
   */
  async saveSession(w: CompletedWorkout): Promise<void> {
    const rows = workoutToRows(w);
    await this.api.upsert('workout_sessions', rows.session);
    await this.routes.replaceForSession(w.id, rows.routes);
    await this.hangs.replaceForSession(w.id, rows.hangs);
  }

  async removeSession(id: string): Promise<void> {
    // drogi i zwisy usuwa kaskada
    await this.api.deleteById('workout_sessions', id);
  }
}
