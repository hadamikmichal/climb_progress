import { Component, inject, input, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { AUTH_FORM_STYLES, AuthLayout, EMAIL_RE, MIN_PASSWORD, passwordProblem } from './auth-layout';

/** Nowe hasło – kodem z wiadomości albo z linku (`?token=…`) */
@Component({
  selector: 'app-reset-password',
  imports: [AuthLayout, RouterLink],
  template: `
    <app-auth-layout title="Ustaw nowe hasło" [lead]="token() ? 'Wpisz nowe hasło do konta.' : 'Wpisz kod z wiadomości i nowe hasło.'">
      <form (submit)="submit($event)" novalidate>
        @if (!token()) {
          <label class="field">Email
            <input type="email" autocomplete="email" inputmode="email" required [value]="email()" (input)="email.set($any($event.target).value)" />
          </label>
          <label class="field">Kod z wiadomości
            <input class="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required [value]="code()" (input)="setCode($any($event.target).value)" />
          </label>
        }
        <label class="field">Nowe hasło
          <input type="password" autocomplete="new-password" required [attr.minlength]="min" [value]="password()" (input)="password.set($any($event.target).value)" />
        </label>
        <label class="field">Powtórz nowe hasło
          <input type="password" autocomplete="new-password" required [value]="confirm()" (input)="confirm.set($any($event.target).value)" />
        </label>
        @if (error(); as e) { <p class="msg bad" role="alert">{{ e }}</p> }
        <button class="btn primary big block" type="submit" [disabled]="busy()">{{ busy() ? 'Zapisywanie…' : 'Zmień hasło' }}</button>
      </form>
      <div class="links">
        <a routerLink="/forgot-password" [queryParams]="email() ? { email: email() } : {}">Wyślij nowy kod</a>
        <a routerLink="/login">Wróć do logowania</a>
      </div>
    </app-auth-layout>
  `,
  styles: AUTH_FORM_STYLES,
})
export class ResetPasswordComponent implements OnInit {
  private readonly api = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly min = MIN_PASSWORD;

  readonly token = input<string>();
  readonly prefill = input<string>(undefined, { alias: 'email' });

  protected readonly email = signal('');
  protected readonly code = signal('');
  protected readonly password = signal('');
  protected readonly confirm = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  ngOnInit() {
    this.email.set(this.prefill() ?? '');
  }

  protected setCode(v: string) {
    this.code.set(v.replace(/\D/g, ''));
  }

  protected async submit(ev: Event) {
    ev.preventDefault();
    const p = passwordProblem(this.password(), this.confirm());
    const token = this.token();
    if (!token) {
      if (!EMAIL_RE.test(this.email().trim())) return this.error.set('Podaj poprawny adres email.');
      if (this.code().length < 4) return this.error.set('Wpisz kod z wiadomości.');
    }
    if (p) return this.error.set(p);
    this.busy.set(true);
    this.error.set(null);
    const r = token
      ? await this.api.resetPasswordWithToken(token, this.password())
      : await this.api.resetPasswordWithCode(this.email().trim(), this.code(), this.password());
    this.busy.set(false);
    if (!r.ok) return this.error.set(r.error.message);
    await this.router.navigate(['/login'], { queryParams: { m: 'reset' } });
  }
}
