import { computed, inject, Injectable, signal } from '@angular/core';
import { AuthResult, AuthService, AuthUser } from './auth.service';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

const CACHE_KEY = 'cp.auth.user';

function readCache(): AuthUser | null {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as AuthUser | null;
    return v && typeof v.id === 'string' && typeof v.email === 'string' ? v : null;
  } catch {
    return null;
  }
}

function writeCache(u: AuthUser | null) {
  try {
    if (u) localStorage.setItem(CACHE_KEY, JSON.stringify({ id: u.id, email: u.email, name: u.name, emailVerified: u.emailVerified }));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    /* tryb prywatny – brak trybu offline po restarcie */
  }
}

/**
 * Stan uwierzytelnienia na sygnałach.
 *
 * Przywracanie sesji: przy starcie pytamy Neon Auth o sesję (cookie sesji Neon Auth). Gdy serwer jest
 * nieosiągalny (brak internetu), używamy ostatnio potwierdzonego konta z pamięci podręcznej, żeby można było
 * trenować offline – dostęp do danych w Neon i tak wymaga ważnego JWT, więc nie jest to obejście autoryzacji.
 */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly api = inject(AuthService);

  readonly status = signal<AuthStatus>('loading');
  readonly user = signal<AuthUser | null>(null);
  /** Sesja przywrócona z pamięci podręcznej bez kontaktu z serwerem */
  readonly offline = signal(false);
  readonly configured = this.api.configured;
  readonly signedIn = computed(() => this.status() === 'signedIn');
  readonly verified = computed(() => !!this.user()?.emailVerified);

  private initPromise: Promise<void> | null = null;

  /** Jednorazowe przywrócenie sesji – guardy czekają na wynik */
  ready(): Promise<void> {
    return (this.initPromise ??= this.restore());
  }

  private async restore(): Promise<void> {
    if (!this.configured) {
      this.set(null);
      return;
    }
    const r = await this.api.getSession();
    if (r.ok) {
      this.set(r.data);
      return;
    }
    const cached = readCache();
    if ((r.error.code === 'NETWORK' || !navigator.onLine) && cached) {
      this.offline.set(true);
      this.user.set(cached);
      this.status.set('signedIn');
      window.addEventListener('online', () => void this.revalidate(), { once: true });
      return;
    }
    this.set(null);
  }

  /** Ponowna weryfikacja sesji w Neon Auth (po odzyskaniu sieci, po potwierdzeniu emaila) */
  async revalidate(): Promise<AuthUser | null> {
    const r = await this.api.getSession();
    if (!r.ok) return this.user();
    this.offline.set(false);
    this.set(r.data);
    return r.data;
  }

  private set(u: AuthUser | null) {
    this.user.set(u);
    this.status.set(u ? 'signedIn' : 'signedOut');
    writeCache(u);
  }

  async signIn(email: string, password: string): Promise<AuthResult<AuthUser | null>> {
    const r = await this.api.signIn(email.trim(), password);
    if (r.ok) {
      // sesja z serwera (pełne dane konta, w tym emailVerified)
      const s = await this.api.getSession();
      this.offline.set(false);
      this.set(s.ok ? s.data : r.data);
    }
    return r;
  }

  async signUp(email: string, password: string) {
    const e = email.trim();
    const r = await this.api.signUp(e, password, e.split('@')[0]);
    if (r.ok && r.data.signedIn) await this.revalidate();
    return r;
  }

  /** Lokalne zakończenie sesji (po wylogowaniu na serwerze albo gdy sesja wygasła) */
  clear() {
    this.offline.set(false);
    this.set(null);
  }

  setName(name: string) {
    const u = this.user();
    if (u) this.set({ ...u, name });
  }
}
