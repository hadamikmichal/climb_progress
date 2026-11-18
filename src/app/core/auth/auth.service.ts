import { inject, Injectable } from '@angular/core';
import { NeonClientService } from './neon-client';
import { AuthFailure, toAuthFailure } from './auth-errors';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

export type AuthResult<T = void> = { ok: true; data: T } | { ok: false; error: AuthFailure };

type BetterAuthResponse<T> = { data: T | null; error: unknown | null } | null | undefined;

const toUser = (u: { id: string; email: string; name?: string | null; emailVerified?: boolean | null }): AuthUser => ({
  id: u.id, email: u.email, name: u.name ?? '', emailVerified: !!u.emailVerified,
});

/**
 * Cienka warstwa nad Neon Auth (zarządzany Better Auth). Hasła i sesje obsługuje wyłącznie Neon –
 * aplikacja niczego nie przechowuje poza publicznymi danymi konta w pamięci podręcznej (tryb offline).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly neon = inject(NeonClientService);

  get configured(): boolean {
    return this.neon.configured;
  }

  private get auth() {
    return this.neon.client.auth;
  }

  private origin(path: string): string {
    return new URL(path, location.origin).toString();
  }

  private async call<T>(fn: () => Promise<BetterAuthResponse<T>>): Promise<AuthResult<T | null>> {
    try {
      const r = await fn();
      if (r?.error) return { ok: false, error: toAuthFailure(r.error) };
      return { ok: true, data: r?.data ?? null };
    } catch (e) {
      return { ok: false, error: toAuthFailure(e) };
    }
  }

  /** Bieżąca sesja; `null` = brak sesji. Błąd sieci jest zwracany jako błąd (tryb offline). */
  async getSession(): Promise<AuthResult<AuthUser | null>> {
    const r = await this.call(() => this.auth.getSession());
    if (!r.ok) return r;
    const u = r.data?.user;
    return { ok: true, data: u ? toUser(u) : null };
  }

  async signUp(email: string, password: string, name: string): Promise<AuthResult<{ user: AuthUser | null; signedIn: boolean }>> {
    const r = await this.call(() => this.auth.signUp.email({ email, password, name, callbackURL: this.origin('/verify-email?verified=1') }));
    if (!r.ok) return r;
    const data = r.data as { user?: Parameters<typeof toUser>[0]; token?: string | null } | null;
    return { ok: true, data: { user: data?.user ? toUser(data.user) : null, signedIn: !!data?.token } };
  }

  async signIn(email: string, password: string): Promise<AuthResult<AuthUser | null>> {
    const r = await this.call(() => this.auth.signIn.email({ email, password, rememberMe: true }));
    if (!r.ok) return r;
    const data = r.data as { user?: Parameters<typeof toUser>[0] } | null;
    return { ok: true, data: data?.user ? toUser(data.user) : null };
  }

  async signOut(): Promise<AuthResult<unknown>> {
    return this.call(() => this.auth.signOut());
  }

  /* ---------- potwierdzenie emaila: kod (domyślny dostawca Neon) lub link (własny dostawca) ---------- */

  async sendVerificationEmail(email: string): Promise<AuthResult<unknown>> {
    return this.call(() => this.auth.sendVerificationEmail({ email, callbackURL: this.origin('/verify-email?verified=1') }));
  }

  async verifyEmailCode(email: string, otp: string): Promise<AuthResult<unknown>> {
    return this.call(() => this.auth.emailOtp.verifyEmail({ email, otp }));
  }

  async verifyEmailToken(token: string): Promise<AuthResult<unknown>> {
    return this.call(() => this.auth.verifyEmail({ query: { token } }));
  }

  /* ---------- odzyskiwanie hasła ---------- */

  /** Kod resetu (działa ze współdzielonym dostawcą email Neon) */
  async requestPasswordResetCode(email: string): Promise<AuthResult<unknown>> {
    return this.call(() => this.auth.emailOtp.requestPasswordReset({ email }));
  }

  /** Link resetu – wymaga własnego dostawcy email w Neon Auth */
  async requestPasswordResetLink(email: string): Promise<AuthResult<unknown>> {
    return this.call(() => this.auth.requestPasswordReset({ email, redirectTo: this.origin('/reset-password') }));
  }

  async resetPasswordWithCode(email: string, otp: string, password: string): Promise<AuthResult<unknown>> {
    return this.call(() => this.auth.emailOtp.resetPassword({ email, otp, password }));
  }

  async resetPasswordWithToken(token: string, newPassword: string): Promise<AuthResult<unknown>> {
    return this.call(() => this.auth.resetPassword({ token, newPassword }));
  }

  /* ---------- konto ---------- */

  async changePassword(currentPassword: string, newPassword: string): Promise<AuthResult<unknown>> {
    return this.call(() => this.auth.changePassword({ currentPassword, newPassword, revokeOtherSessions: true }));
  }

  async updateName(name: string): Promise<AuthResult<unknown>> {
    return this.call(() => this.auth.updateUser({ name }));
  }

  async deleteUser(password: string): Promise<AuthResult<unknown>> {
    return this.call(() => this.auth.deleteUser({ password }));
  }
}
