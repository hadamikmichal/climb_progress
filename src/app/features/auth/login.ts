import { Component, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';
import { safeReturnUrl } from '../../core/auth/auth.guard';
import { AUTH_FORM_STYLES, AuthLayout, EMAIL_RE } from './auth-layout';

@Component({
  selector: 'app-login',
  imports: [AuthLayout, RouterLink],
  template: `
    <app-auth-layout title="Zaloguj się" lead="Twoje treningi, testy i postępy – na każdym urządzeniu.">
      @if (!auth.configured) {
        <p class="msg bad">Aplikacja nie ma konfiguracji Neon Auth (NEON_AUTH_URL). Logowanie jest niedostępne.</p>
      }
      @if (notice(); as n) { <p class="msg ok" role="status">{{ n }}</p> }
      <form (submit)="submit($event)" novalidate>
        <label class="field">Email
          <input type="email" name="email" autocomplete="email" inputmode="email" required [value]="email()" (input)="email.set($any($event.target).value)" />
        </label>
        <label class="field">Hasło
          <input type="password" name="password" autocomplete="current-password" required [value]="password()" (input)="password.set($any($event.target).value)" />
        </label>
        @if (error(); as e) { <p class="msg bad" role="alert">{{ e }}</p> }
        <button class="btn primary big block" type="submit" [disabled]="busy() || !auth.configured">{{ busy() ? 'Logowanie…' : 'Zaloguj się' }}</button>
      </form>
      <div class="links">
        <a routerLink="/forgot-password" [queryParams]="email() ? { email: email() } : {}">Nie pamiętasz hasła?</a>
        <span>Nie masz konta? <a routerLink="/register">Załóż konto</a></span>
      </div>
    </app-auth-layout>
  `,
  styles: AUTH_FORM_STYLES,
})
export class LoginComponent {
  protected readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  readonly returnUrl = input<string>();
  readonly expired = input<string>();
  readonly m = input<string>();

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected notice() {
    if (this.expired()) return 'Sesja wygasła – zaloguj się ponownie. Niewysłane zmiany czekają na tym urządzeniu.';
    if (this.m() === 'verified') return 'Email potwierdzony. Możesz się zalogować.';
    if (this.m() === 'reset') return 'Hasło zostało zmienione. Zaloguj się nowym hasłem.';
    if (this.m() === 'deleted') return 'Konto i wszystkie dane zostały usunięte.';
    if (this.m() === 'delete_partial') {
      return 'Dane treningowe zostały usunięte, ale Neon Auth nie usunął konta logowania. Administrator może je usunąć w Neon Console (Auth → Users).';
    }
    return null;
  }

  protected async submit(ev: Event) {
    ev.preventDefault();
    const email = this.email().trim();
    if (!EMAIL_RE.test(email)) return this.error.set('Podaj poprawny adres email.');
    if (!this.password()) return this.error.set('Podaj hasło.');
    this.busy.set(true);
    this.error.set(null);
    const r = await this.auth.signIn(email, this.password());
    this.busy.set(false);
    if (!r.ok) {
      if (r.error.code === 'EMAIL_NOT_VERIFIED') {
        await this.router.navigate(['/verify-email'], { queryParams: { email, send: 1 } });
        return;
      }
      this.error.set(r.error.message);
      return;
    }
    const u = this.auth.user();
    if (u && !u.emailVerified) {
      await this.router.navigate(['/verify-email'], { queryParams: { email: u.email } });
      return;
    }
    await this.router.navigateByUrl(safeReturnUrl(this.returnUrl()));
  }
}
