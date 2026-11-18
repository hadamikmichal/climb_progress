import { inject, Injectable } from '@angular/core';
import type { AdaptationEventRow, TrainingCycleRow } from '../../../../db/schema';
import { AdaptationEvent, TrainingCycle } from '../models/models';
import { cycleToRow, eventToRow, rowToCycle, rowToEvent } from '../sync/mappers';
import { DataApi } from './data-api';

/** Cykle treningowe i historia zmian planu (zdarzenia adaptacji należą do cyklu) */
@Injectable({ providedIn: 'root' })
export class TrainingCycleRepository {
  private readonly api = inject(DataApi);

  async list(): Promise<TrainingCycle[]> {
    return (await this.api.selectAll<TrainingCycleRow>('training_cycles')).map(rowToCycle);
  }

  async save(c: TrainingCycle): Promise<void> {
    await this.api.upsert('training_cycles', cycleToRow(c));
  }

  async remove(id: string): Promise<void> {
    // ON DELETE CASCADE: plan, treningi, testy i zdarzenia cyklu
    await this.api.deleteById('training_cycles', id);
  }

  /** Usuwa wszystkie cykle konta wraz z całą zależną historią (kaskada) */
  async removeAll(): Promise<void> {
    await this.api.run(this.api.from('training_cycles').delete().not('id', 'is', null));
  }

  async listEvents(): Promise<AdaptationEvent[]> {
    return (await this.api.selectAll<AdaptationEventRow>('adaptation_events')).map(rowToEvent);
  }

  async saveEvent(e: AdaptationEvent): Promise<void> {
    await this.api.upsert('adaptation_events', eventToRow(e));
  }

  async removeEvent(id: string): Promise<void> {
    await this.api.deleteById('adaptation_events', id);
  }
}
