import { inject, Injectable } from '@angular/core';
import type { AssessmentSessionRow } from '../../../../db/schema';
import { TestResult } from '../models/models';
import { Assessment } from '../models/assessment';
import { assessmentToRows, LEGACY_TEST_PROTOCOL, legacyTestToRow, rowToAssessment, rowToLegacyTest } from '../sync/mappers';
import { DataApi } from './data-api';

/** Baseline Test v1.0 (obie sesje, wyniki, krzywa regeneracji) oraz testy w starym formacie 3 × 6a */
@Injectable({ providedIn: 'root' })
export class AssessmentRepository {
  private readonly api = inject(DataApi);

  async list(): Promise<{ assessments: Assessment[]; tests: TestResult[] }> {
    const rows = await this.api.selectAll<AssessmentSessionRow>('assessment_sessions');
    return {
      assessments: rows.filter((r) => r.protocol_version !== LEGACY_TEST_PROTOCOL).map(rowToAssessment),
      tests: rows.filter((r) => r.protocol_version === LEGACY_TEST_PROTOCOL).map(rowToLegacyTest),
    };
  }

  /**
   * Zapis testu: sesja z pełnym dokumentem, a potem wyniki (assessment_results) i krzywa regeneracji
   * (recovery_measurements) wyliczone na nowo – stare wiersze pochodne są zastępowane, nie dublowane.
   */
  async save(a: Assessment): Promise<void> {
    const rows = assessmentToRows(a);
    await this.api.upsert('assessment_sessions', rows.session);
    await this.api.run(this.api.from('assessment_results').delete().eq('assessment_session_id', a.id));
    await this.api.upsert('assessment_results', rows.results, 'assessment_session_id,category,metric_key,attempt_number');
    await this.api.run(this.api.from('recovery_measurements').delete().eq('assessment_session_id', a.id));
    await this.api.upsert('recovery_measurements', rows.recovery, 'assessment_session_id,elapsed_seconds');
  }

  async saveLegacy(t: TestResult): Promise<void> {
    await this.api.upsert('assessment_sessions', legacyTestToRow(t));
  }

  async remove(id: string): Promise<void> {
    await this.api.deleteById('assessment_sessions', id);
  }
}
