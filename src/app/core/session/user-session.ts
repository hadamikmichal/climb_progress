import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AppStore } from '../data/store';
import { Db, userDbName } from '../data/db';
import { AuthService } from '../auth/auth.service';
import { AuthStore } from '../auth/auth.store';
import { SyncService } from '../sync/sync.service';
import { LegacyImportService } from './legacy-import';
import { ProfileRepository } from '../repositories/profile.repository';
import { ReadinessRepository } from '../repositories/readiness.repository';
import { TrainingCycleRepository } from '../repositories/training-cycle.repository';

const FIRST_PULL_TIMEOUT_MS = 15_000;

const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T) =>
  Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

/**
 * Cykl życia danych zalogowanego konta: otwarcie lokalnej bazy konta, pierwsze pobranie z Neon,
 * synchronizacja w tle, wylogowanie i usunięcie konta.
 */
@Injectable({ providedIn: 'root' })
export class UserSession {
  private readonly store = inject(AppStore);
  private readonly sync = inject(SyncService);
  private readonly auth = inject(AuthStore);
  private readonly authApi = inject(AuthService);
  private readonly legacy = inject(LegacyImportService);
  private readonly router = inject(Router);
  private readonly profiles = inject(ProfileRepository);
  private readonly cyclesRepo = inject(TrainingCycleRepository);
  private readonly readinessRepo = inject(ReadinessRepository);

  readonly activeUserId = signal<string | null>(null);
  private opening: Promise<void> | null = null;

  /** Wywoływane przez guard – otwiera dane konta raz na sesję */
  ensure(userId: string): Promise<void> {
    if (this.activeUserId() === userId && this.store.ready()) return Promise.resolve();
    return (this.opening ??= this.activate(userId).finally(() => (this.opening = null)));
  }

  private async activate(userId: string): Promise<void> {
    if (this.activeUserId() && this.activeUserId() !== userId) await this.deactivate(false);
    const db = await Db.open(userDbName(userId));
    this.sync.attach(db, () => this.store.reload());
    // Nowe urządzenie / pierwsze logowanie: najpierw dane z Neon, żeby nie zaczynać od pustego profilu
    if (!(await db.getMeta('lastPullAt')) && navigator.onLine) {
      await withTimeout(this.sync.pull(), FIRST_PULL_TIMEOUT_MS, false);
    }
    await this.store.open(db);
    this.store.onLocalChange = () => this.sync.schedule();
    this.activeUserId.set(userId);
    this.sync.start();
    void this.legacy.check(userId);
  }

  /**
   * Zamyka dane konta. `wipe` usuwa lokalną kopię – wyłącznie, gdy kolejka jest pusta
   * (wszystko potwierdzone przez serwer).
   */
  private async deactivate(wipe: boolean): Promise<void> {
    const db = this.store.database;
    const pending = await this.sync.hasPending();
    this.sync.stop();
    this.store.close();
    this.activeUserId.set(null);
    if (db && wipe && !pending) await Db.delete(db.name);
  }

  /** Liczba niewysłanych zmian – przed wylogowaniem próbujemy je jeszcze wysłać */
  async flush(): Promise<number> {
    if (navigator.onLine) await this.sync.push();
    return this.sync.pending();
  }

  /**
   * Wylogowanie. Niewysłane zmiany zostają na urządzeniu (w bazie tego konta) i zostaną wysłane po
   * ponownym zalogowaniu; gdy wszystko jest zsynchronizowane, lokalna kopia jest usuwana.
   */
  async signOut(): Promise<{ serverError: string | null }> {
    const pending = await this.flush();
    const r = await this.authApi.signOut();
    await this.deactivate(pending === 0);
    this.auth.clear();
    await this.router.navigateByUrl('/login');
    return { serverError: r.ok ? null : r.error.message };
  }

  /**
   * Usunięcie konta: dane treningowe w Neon (kaskadowo od cykli), potem konto w Neon Auth, na końcu kopia lokalna.
   * Synchronizacja jest zatrzymana wcześniej, żeby kolejka nie wysłała usuniętych danych ponownie.
   */
  async deleteAccount(password: string): Promise<{ ok: boolean; message: string }> {
    if (!navigator.onLine) return { ok: false, message: 'Usunięcie konta wymaga połączenia z internetem.' };
    // weryfikacja hasła przed usunięciem danych
    const email = this.auth.user()?.email;
    if (!email) return { ok: false, message: 'Brak aktywnej sesji.' };
    const check = await this.authApi.signIn(email, password);
    if (!check.ok) return { ok: false, message: check.error.message };

    const db = this.store.database;
    this.sync.stop();
    try {
      await this.cyclesRepo.removeAll();
      await this.readinessRepo.removeAll();
      await this.profiles.removeAll();
    } catch (e) {
      // dane lokalne nietknięte – można ponowić
      if (db) this.sync.attach(db, () => this.store.reload());
      this.sync.start();
      return { ok: false, message: `Nie udało się usunąć danych z bazy: ${e instanceof Error ? e.message : e}` };
    }
    const del = await this.authApi.deleteUser(password);
    this.store.close();
    this.activeUserId.set(null);
    if (db) await Db.delete(db.name);
    if (!del.ok) {
      console.error('Neon Auth deleteUser:', del.error);
      await this.authApi.signOut();
      this.auth.clear();
      await this.router.navigateByUrl('/login?m=delete_partial');
      return {
        ok: false,
        message: `Dane treningowe zostały usunięte, ale Neon Auth odrzucił usunięcie konta (${del.error.message}). Konto logowania nadal istnieje – usuń je w Neon Console (Auth → Users) albo skontaktuj się z administratorem.`,
      };
    }
    this.auth.clear();
    await this.router.navigateByUrl('/login?m=deleted');
    return { ok: true, message: 'Konto i wszystkie dane zostały usunięte.' };
  }

  /** Sesja wygasła na serwerze (np. 401 z Data API) – lokalne dane zostają, wymagane ponowne logowanie */
  async expire(): Promise<void> {
    await this.deactivate(false);
    this.auth.clear();
    await this.router.navigateByUrl('/login?expired=1');
  }
}
