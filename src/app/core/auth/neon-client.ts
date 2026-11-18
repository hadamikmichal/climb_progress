import { Injectable } from '@angular/core';
import { createClient } from '@neon/neon-js';
import { NEON_ENV } from '../config/neon-env.generated';

export type NeonClient = ReturnType<typeof createNeon>;

function createNeon(authUrl: string, dataApiUrl: string) {
  // Adres auth i Data API są publiczne. Uprawnienia wynikają wyłącznie z JWT Neon Auth + RLS w Postgres.
  return createClient({ auth: { url: authUrl }, dataApi: { url: dataApiUrl } });
}

/** Jedna instancja klienta Neon (Neon Auth + Data API) na aplikację */
@Injectable({ providedIn: 'root' })
export class NeonClientService {
  readonly configured = !!(NEON_ENV.authUrl && NEON_ENV.dataApiUrl);
  private instance: NeonClient | null = null;

  get client(): NeonClient {
    if (!this.configured) throw new Error('Brak konfiguracji Neon (NEON_AUTH_URL). Zobacz docs/NEON_SETUP.md.');
    return (this.instance ??= createNeon(NEON_ENV.authUrl, NEON_ENV.dataApiUrl));
  }
}
