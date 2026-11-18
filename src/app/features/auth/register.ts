import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';
import { AUTH_FORM_STYLES, AuthLayout, EMAIL_RE, MIN_PASSWORD, passwordProblem } from './auth-layout';

@Component({
  selector: 'app-register',
  imports: [AuthLayout, RouterLink],
  template: `
    <app-auth-layout title="Załóż konto" lead="Email i hasło. Potwierdzisz adres kodem wysłanym na skrzynkę.">
      <form (submit)="submit($event)" novalidate>
        <label class="field">Email
          <input type="email" name="email" autocomplete="email" inputmode="email" required [value]="email()" (input)="email.set($any($event.target).value)" />
        </label>
        <label class="field">Hasło
          <input type="password" name="new-password" autocomplete="new-password" required [attr.minlength]="min" [value]="password()" (input)="password.set($any($event.target).value)" />
        </label>
        <label class="field">Powtórz hasło
          <input type="password" name="confirm-password" autocomplete="new-password" required [value]="confirm()" (input)="confirm.set($any($event.target).value)" />
        </label>
        <p class="hint">Co najmniej {{ min }} znaków. Hasło przechowuje wyłącznie Neon Auth – aplikacja go nie zapisuje.</p>
        @if (error(); as e) { <p class="msg bad" role="alert">{{ e }}</p> }
        <button class="btn primary big block" type="submit" [disabled]="busy() || !auth.configured">{{ busy() ? 'Tworzenie konta…' : 'Załóż konto' }}</button>
      </form>
      <div class="links"><span>Masz już konto? <a routerLink="/login">Zaloguj się</a></span></div>
    </app-auth-layout>
  `,
  styles: AUTH_FORM_STYLES,
})
export class RegisterComponent {
  protected readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  protected readonly min = MIN_PASSWORD;

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly confirm = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async submit(ev: Event) {
    ev.preventDefault();
    const email = this.email().trim();
    if (!EMAIL_RE.test(email)) return this.error.set('Podaj poprawny adres email.');
    const p = passwordProblem(this.password(), this.confirm());
    if (p) return this.error.set(p);
    this.busy.set(true);
    this.error.set(null);
    const r = await this.auth.signUp(email, this.password());
    this.busy.set(false);
    if (!r.ok) return this.error.set(r.error.message);
    const u = this.auth.user();
    if (u?.emailVerified) {
      await this.router.navigateByUrl('/');
      return;
    }
    await this.router.navigate(['/verify-email'], { queryParams: { email } });
  }
}
