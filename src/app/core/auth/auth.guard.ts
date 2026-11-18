import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from './auth.store';
import { UserSession } from '../session/user-session';

/**
 * Widoki prywatne: wymagana aktywna sesja Neon Auth i potwierdzony email.
 * Po przejściu guarda dane konta są otwarte (IndexedDB konta + synchronizacja).
 */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  const session = inject(UserSession);
  await auth.ready();
  const u = auth.user();
  if (!u) return router.createUrlTree(['/login'], { queryParams: state.url && state.url !== '/' ? { returnUrl: state.url } : {} });
  if (!u.emailVerified) return router.createUrlTree(['/verify-email'], { queryParams: { email: u.email } });
  await session.ensure(u.id);
  return true;
};

/** Ekrany logowania/rejestracji: zalogowany użytkownik trafia od razu na dashboard */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  await auth.ready();
  return auth.user()?.emailVerified ? router.createUrlTree(['/']) : true;
};

/** Bezpieczny powrót po zalogowaniu – wyłącznie ścieżki wewnętrzne */
export function safeReturnUrl(v: string | null | undefined): string {
  return v && v.startsWith('/') && !v.startsWith('//') && !/^\/(login|register)/.test(v) ? v : '/';
}
