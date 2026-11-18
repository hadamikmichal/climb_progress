import { Component, inject, input, OnDestroy, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { AuthStore } from '../../core/auth/auth.store';
import { AUTH_FORM_STYLES, AuthLayout, EMAIL_RE } from './auth-layout';

const RESEND_COOLDOWN_S = 30;

/**
 * Potwierdzenie adresu email. Domyślnie Neon Auth wysyła kod (współdzielony dostawca email);
 * przy własnym dostawcy może wysyłać link – wtedy wracamy tu z `?verified=1` albo `?token=…`.
 */
@Component({
  selector: 'app-verify-email',
  imports: [AuthLayout, RouterLink],
  template: `
    <app-auth-layout eyebrow="Rejestracja" title="Potwierdź email" [lead]="lead()">
      @if (info(); as i) { <p class="msg ok" role="status">{{ i }}</p> }
      <form (submit)="submit($event)" novalidate>
        @if (!emailFixed()) {
          <label class="field">Email
            <input type="email" autocomplete="email" inputmode="email" required [value]="addr()" (input)="addr.set($any($event.target).value)" />
          </label>
        }
        <label class="field">Kod z wiadomości
          <input class="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required [value]="code()" (input)="setCode($any($event.target).value)" />
        </label>
        @if (error(); as e) { <p class="msg bad" role="alert">{{ e }}</p> }
        <button class="btn primary big block" type="submit" [disabled]="busy()">{{ busy() ? 'Sprawdzanie…' : 'Potwierdź' }}</button>
      </form>
      <div class="links">
        <button class="btn ghost sm" type="button" [disabled]="cooldown() > 0 || busy()" (click)="resend()">
          {{ cooldown() > 0 ? 'Wyślij ponownie (' + cooldown() + ' s)' : 'Wyślij kod ponownie' }}
        </button>
        <span class="hint">Kod jest ważny 15 minut. Sprawdź też folder spam.</span>
        <a routerLink="/login">Wróć do logowania</a>
      </div>
    </app-auth-layout>
  `,
  styles: AUTH_FORM_STYLES,
})
export class VerifyEmailComponent implements OnInit, OnDestroy {
  private readonly api = inject(AuthService);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  readonly email = input<string>();
  readonly send = input<string>();
  readonly verified = input<string>();
  readonly token = input<string>();

  protected readonly addr = signal('');
  protected readonly code = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly info = signal<string | null>(null);
  protected readonly cooldown = signal(0);
  private timer: ReturnType<typeof setInterval> | null = null;

  protected emailFixed() {
    return !!this.email() && EMAIL_RE.test(this.email()!);
  }

  protected lead() {
    const e = this.addr();
    return e ? `Wysłaliśmy kod na ${e}. Wpisz go poniżej, aby aktywować konto.` : 'Wpisz adres i kod z wiadomości, aby aktywować konto.';
  }

  async ngOnInit() {
    await this.auth.ready();
    this.addr.set(this.email() ?? this.auth.user()?.email ?? '');
    if (this.token()) {
      this.busy.set(true);
      const r = await this.api.verifyEmailToken(this.token()!);
      this.busy.set(false);
      if (!r.ok) return this.error.set(r.error.message);
      return this.finish();
    }
    if (this.verified()) return this.finish();
    if (this.send() && this.addr()) await this.resend();
  }

  ngOnDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  protected setCode(v: string) {
    this.code.set(v.replace(/\D/g, ''));
  }

  protected async submit(ev: Event) {
    ev.preventDefault();
    const email = this.addr().trim();
    if (!EMAIL_RE.test(email)) return this.error.set('Podaj poprawny adres email.');
    if (this.code().length < 4) return this.error.set('Wpisz kod z wiadomości.');
    this.busy.set(true);
    this.error.set(null);
    const r = await this.api.verifyEmailCode(email, this.code());
    this.busy.set(false);
    if (!r.ok) return this.error.set(r.error.message);
    await this.finish();
  }

  protected async resend() {
    const email = this.addr().trim();
    if (!EMAIL_RE.test(email)) return this.error.set('Podaj poprawny adres email.');
    this.error.set(null);
    const r = await this.api.sendVerificationEmail(email);
    if (!r.ok) return this.error.set(r.error.message);
    this.info.set(`Wysłano nowy kod na ${email}.`);
    this.cooldown.set(RESEND_COOLDOWN_S);
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.cooldown.update((c) => Math.max(0, c - 1));
      if (!this.cooldown() && this.timer) clearInterval(this.timer);
    }, 1000);
  }

  /** Po potwierdzeniu: jeśli Neon zalogował automatycznie – dashboard, w przeciwnym razie logowanie */
  private async finish() {
    const u = await this.auth.revalidate();
    if (u?.emailVerified) await this.router.navigateByUrl('/');
    else await this.router.navigate(['/login'], { queryParams: { m: 'verified' } });
  }
}
