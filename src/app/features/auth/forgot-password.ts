import { Component, inject, input, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { AUTH_FORM_STYLES, AuthLayout, EMAIL_RE } from './auth-layout';

@Component({
  selector: 'app-forgot-password',
  imports: [AuthLayout, RouterLink],
  template: `
    <app-auth-layout title="Odzyskaj hasło" lead="Podaj email konta – wyślemy kod do ustawienia nowego hasła.">
      @if (linkSent()) {
        <p class="msg ok" role="status">Jeśli konto istnieje, wysłaliśmy link do zmiany hasła na {{ email() }}. Otwórz go na tym urządzeniu.</p>
      } @else {
        <form (submit)="submit($event)" novalidate>
          <label class="field">Email
            <input type="email" autocomplete="email" inputmode="email" required [value]="email()" (input)="email.set($any($event.target).value)" />
          </label>
          @if (error(); as e) { <p class="msg bad" role="alert">{{ e }}</p> }
          <button class="btn primary big block" type="submit" [disabled]="busy()">{{ busy() ? 'Wysyłanie…' : 'Wyślij kod' }}</button>
        </form>
      }
      <div class="links">
        <a routerLink="/reset-password" [queryParams]="email() ? { email: email() } : {}">Mam już kod</a>
        <a routerLink="/login">Wróć do logowania</a>
      </div>
    </app-auth-layout>
  `,
  styles: AUTH_FORM_STYLES,
})
export class ForgotPasswordComponent implements OnInit {
  private readonly api = inject(AuthService);
  private readonly router = inject(Router);

  readonly prefill = input<string>(undefined, { alias: 'email' });
  protected readonly email = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly linkSent = signal(false);

  ngOnInit() {
    this.email.set(this.prefill() ?? '');
  }

  protected async submit(ev: Event) {
    ev.preventDefault();
    const email = this.email().trim();
    if (!EMAIL_RE.test(email)) return this.error.set('Podaj poprawny adres email.');
    this.busy.set(true);
    this.error.set(null);
    // Kod (działa ze współdzielonym dostawcą email Neon); gdy projekt ma wyłączone kody – link
    const code = await this.api.requestPasswordResetCode(email);
    if (code.ok) {
      this.busy.set(false);
      await this.router.navigate(['/reset-password'], { queryParams: { email } });
      return;
    }
    if (code.error.status === 404) {
      const link = await this.api.requestPasswordResetLink(email);
      this.busy.set(false);
      if (link.ok) return this.linkSent.set(true);
      return this.error.set(link.error.message);
    }
    this.busy.set(false);
    this.error.set(code.error.message);
  }
}
