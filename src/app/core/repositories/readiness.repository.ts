import { inject, Injectable } from '@angular/core';
import type { ReadinessCheckRow } from '../../../../db/schema';
import { ReadinessCheck } from '../models/models';
import { readinessToRow, rowToReadiness } from '../sync/mappers';
import { DataApi } from './data-api';

/** Codzienna ocena gotowości (sen, samopoczucie, zmęczenie, ból) */
@Injectable({ providedIn: 'root' })
export class ReadinessRepository {
  private readonly api = inject(DataApi);

  async list(): Promise<ReadinessCheck[]> {
    return (await this.api.selectAll<ReadinessCheckRow>('readiness_checks')).map(rowToReadiness);
  }

  async save(r: ReadinessCheck): Promise<void> {
    await this.api.upsert('readiness_checks', readinessToRow(r));
  }

  async remove(id: string): Promise<void> {
    await this.api.deleteById('readiness_checks', id);
  }

  async removeAll(): Promise<void> {
    await this.api.run(this.api.from('readiness_checks').delete().not('id', 'is', null));
  }
}
