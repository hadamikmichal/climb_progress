import { Component, input } from '@angular/core';
import { BrandMark } from '../../shared/brand';

/** Wspólny układ ekranów konta: znak marki, tytuł, formularz – minimalistyczny i responsywny */
@Component({
  selector: 'app-auth-layout',
  imports: [BrandMark],
  template: `
    <div class="auth topo">
      <div class="auth-card">
        <header class="auth-head">
          <span class="wordmark"><app-brand-mark [size]="28" /><span>CLIMBPROGRESS</span></span>
          <div class="stack-sm">
            <span class="eyebrow kicker">{{ eyebrow() }}</span>
            <h1>{{ title() }}</h1>
            @if (lead()) { <p class="muted">{{ lead() }}</p> }
          </div>
        </header>
        <ng-content />
      </div>
    </div>
  `,
  styles: `
    :host { display: block; }
    .auth { min-height: 100vh; display: grid; place-items: center; padding: calc(24px + env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom)); }
    .auth-card {
      width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: var(--s5, 24px);
      padding: 28px 24px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md, 12px);
    }
    .auth-head { display: flex; flex-direction: column; gap: var(--s4, 20px); }
    .wordmark { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-heading); font-weight: 700; font-size: 0.875rem; letter-spacing: 0.08em; color: var(--color-text-primary); }
    h1 { font-size: 1.75rem; }
    @media (max-width: 479px) { .auth-card { padding: 22px 18px; border-radius: var(--radius-sm, 8px); } }
  `,
})
export class AuthLayout {
  readonly eyebrow = input('Konto');
  readonly title = input.required<string>();
  readonly lead = input('');
}

/** Style formularzy kont – współdzielone przez komponenty */
export const AUTH_FORM_STYLES = `
  form { display: flex; flex-direction: column; gap: var(--s3, 14px); }
  .msg { padding: 10px 12px; border-radius: var(--radius-sm, 8px); font-size: 0.875rem; line-height: 1.4; border: 1px solid var(--color-border); }
  .msg.bad { border-color: var(--color-error); color: var(--color-error); }
  .msg.ok { border-color: var(--color-primary); }
  .links { display: flex; flex-direction: column; gap: 8px; font-size: 0.875rem; color: var(--color-text-secondary); }
  .links a { color: var(--color-text-primary); }
  .hint { font-size: 0.78rem; color: var(--color-text-muted); }
  .code { font-family: var(--font-mono); letter-spacing: 0.3em; font-size: 1.25rem; text-align: center; }
`;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD = 8;

export function passwordProblem(pw: string, confirm: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Hasło musi mieć co najmniej ${MIN_PASSWORD} znaków.`;
  if (pw.length > 128) return 'Hasło może mieć najwyżej 128 znaków.';
  if (pw !== confirm) return 'Hasła nie są takie same.';
  return null;
}
