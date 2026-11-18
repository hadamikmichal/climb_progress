import { inject, Injectable } from '@angular/core';
import type { ProfileRow } from '../../../../db/schema';
import { UserProfile } from '../models/models';
import { profileToRow, rowToProfile } from '../sync/mappers';
import { DataApi } from './data-api';

/** Profil wspinacza – jeden wiersz na konto (unikalny user_id nadawany przez bazę z JWT) */
@Injectable({ providedIn: 'root' })
export class ProfileRepository {
  private readonly api = inject(DataApi);

  async get(): Promise<UserProfile | null> {
    const rows = await this.api.selectAll<ProfileRow>('profiles');
    return rows[0] ? rowToProfile(rows[0]) : null;
  }

  /** Upsert po user_id – kolumny user_id nie wysyłamy, Postgres bierze ją z auth.user_id() */
  async save(p: UserProfile): Promise<void> {
    await this.api.upsert('profiles', profileToRow(p), 'user_id');
  }

  async removeAll(): Promise<void> {
    await this.api.run(this.api.from('profiles').delete().not('id', 'is', null));
  }
}
