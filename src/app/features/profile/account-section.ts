import { Component, computed, inject, output, signal } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { AuthStore } from '../../core/auth/auth.store';
import { AppStore } from '../../core/data/store';
import { SyncService } from '../../core/sync/sync.service';
import { LegacyImportService } from '../../core/session/legacy-import';
import { UserSession } from '../../core/session/user-session';
import { passwordProblem, MIN_PASSWORD } from '../auth/auth-layout';

type Msg = { kind: 'ok' | 'bad' | 'info'; text: string } | null;

/** Profil → Konto: email, nazwa, hasło, synchronizacja, eksport, wylogowanie, usunięcie konta */
@Component({
  selector: 'app-account-section',
  template: `
    <section class="pf-sec" id="konto">
      <header class="pf-head"><span class="num">00</span><h2>Konto</h2><span class="eyebrow">Neon Auth</span></header>

      <div class="grid-md-2">
        <label class="field">Email<input type="email" [value]="auth.user()?.email ?? ''" readonly /></label>
        <label class="field">Nazwa użytkownika
          <span class="row"><input class="grow" type="text" maxlength="60" [value]="name()" (input)="name.set($any($event.target).value)" />
          <button class="btn sm" type="button" [disabled]="busy() || name().trim() === (auth.user()?.name ?? '')" (click)="saveName()">Zapisz</button></span>
        </label>
      </div>
      @if (nameMsg(); as m) { <p class="card flat" [class.danger]="m.kind === 'bad'">{{ m.text }}</p> }

      <h3 class="pf-h4">Synchronizacja</h3>
      <div class="list-item">
        <div class="grow stack-sm">
          <span class="row"><strong>{{ sync.label() }}</strong></span>
          <small class="muted">
            @if (sync.lastSyncedAt(); as t) { Ostatnia synchronizacja: {{ when(t) }}. } @else { Jeszcze nie zsynchronizowano. }
            Dane zapisują się najpierw na urządzeniu, a potem w bazie konta – trening możesz prowadzić bez internetu.
          </small>
          @if (sync.failed()) { <small class="record">{{ sync.failed() }} zmian odrzuconych przez serwer: {{ sync.lastError() }}</small> }
        </div>
        <button class="btn sm" type="button" [disabled]="sync.state() === 'syncing' || !sync.online()" (click)="sync.syncNow()">Synchronizuj</button>
      </div>

      @if (legacy.available(); as l) {
        <div class="list-item">
          <div class="grow stack-sm">
            <strong>Lokalne dane sprzed założenia konta</strong>
            <small class="muted">{{ l.workouts }} treningów, {{ l.assessments }} testów, {{ l.cycles }} cykli na tym urządzeniu.</small>
          </div>
          <button class="btn sm primary" type="button" [disabled]="legacy.busy()" (click)="legacy.importNow()">{{ legacy.busy() ? 'Importowanie…' : 'Importuj dane' }}</button>
        </div>
      }
      @if (legacy.result(); as r) { <p class="muted small-note">{{ r }}</p> }

      <h3 class="pf-h4">Zmiana hasła</h3>
      <form class="stack" (submit)="changePassword($event)" novalidate>
        <div class="grid-md-3">
          <label class="field">Obecne hasło<input type="password" autocomplete="current-password" [value]="cur()" (input)="cur.set($any($event.target).value)" /></label>
          <label class="field">Nowe hasło<input type="password" autocomplete="new-password" [attr.minlength]="min" [value]="pw()" (input)="pw.set($any($event.target).value)" /></label>
          <label class="field">Powtórz nowe hasło<input type="password" autocomplete="new-password" [value]="pw2()" (input)="pw2.set($any($event.target).value)" /></label>
        </div>
        @if (pwMsg(); as m) { <p class="card flat" [class.danger]="m.kind === 'bad'">{{ m.text }}</p> }
        <button class="btn pf-save" type="submit" [disabled]="busy() || !cur() || !pw()">Zmień hasło</button>
        <small class="faint">Po zmianie hasła pozostałe urządzenia zostaną wylogowane.</small>
      </form>

      <h3 class="pf-h4">Dane i sesja</h3>
      <div class="btn-row">
        <button class="btn" type="button" (click)="exportRequested.emit()">Eksportuj dane (JSON)</button>
        <button class="btn" type="button" [disabled]="busy()" (click)="signOut()">Wyloguj</button>
      </div>
      @if (outMsg(); as m) { <p class="card flat" [class.danger]="m.kind === 'bad'">{{ m.text }}</p> }

      <details class="danger-zone">
        <summary>Usuń konto</summary>
        <div class="stack">
          <p class="muted">Usuwa konto logowania oraz wszystkie treningi, testy, cykle i oceny gotowości z bazy i z tego urządzenia. Tej operacji nie można cofnąć – najpierw wyeksportuj dane.</p>
          <div class="grid-md-2">
            <label class="field">Hasło<input type="password" autocomplete="current-password" [value]="delPw()" (input)="delPw.set($any($event.target).value)" /></label>
            <label class="field">Wpisz USUŃ, aby potwierdzić<input type="text" autocomplete="off" [value]="delConfirm()" (input)="delConfirm.set($any($event.target).value)" /></label>
          </div>
          @if (delMsg(); as m) { <p class="card flat" [class.danger]="m.kind === 'bad'">{{ m.text }}</p> }
          <button class="btn danger pf-save" type="button" [disabled]="busy() || !canDelete()" (click)="deleteAccount()">Usuń konto na zawsze</button>
        </div>
      </details>
    </section>
  `,
  styles: `
    .pf-sec { display: flex; flex-direction: column; gap: var(--s4); }
    .pf-head { display: flex; align-items: baseline; gap: var(--s3); padding-top: var(--s2); border-top: 1px solid var(--color-border-strong); }
    .pf-head .num { font-size: 0.75rem; color: var(--color-text-secondary); }
    .pf-head h2 { flex: 1; }
    .pf-h4 { margin-top: var(--s3); padding-bottom: 6px; border-bottom: 1px solid var(--color-border); }
    .pf-save { align-self: flex-start; }
    .small-note { font-size: 0.82rem; }
    .danger-zone { border-top: 1px solid var(--color-border); padding-top: var(--s3); }
    .danger-zone summary { cursor: pointer; color: var(--color-error); font-weight: 600; margin-bottom: var(--s3); }
    @media (max-width: 559px) { .pf-save { align-self: stretch; } }
  `,
})
export class AccountSection {
  protected readonly auth = inject(AuthStore);
  private readonly api = inject(AuthService);
  private readonly store = inject(AppStore);
  protected readonly sync = inject(SyncService);
  protected readonly legacy = inject(LegacyImportService);
  private readonly session = inject(UserSession);

  readonly exportRequested = output<void>();
  protected readonly min = MIN_PASSWORD;

  protected readonly name = signal(this.auth.user()?.name ?? '');
  protected readonly cur = signal('');
  protected readonly pw = signal('');
  protected readonly pw2 = signal('');
  protected readonly delPw = signal('');
  protected readonly delConfirm = signal('');
  protected readonly busy = signal(false);
  protected readonly nameMsg = signal<Msg>(null);
  protected readonly pwMsg = signal<Msg>(null);
  protected readonly outMsg = signal<Msg>(null);
  protected readonly delMsg = signal<Msg>(null);
  protected readonly canDelete = computed(() => !!this.delPw() && this.delConfirm().trim().toUpperCase() === 'USUŃ');

  protected when(t: string) {
    return new Date(t).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  protected async saveName() {
    const n = this.name().trim();
    this.busy.set(true);
    const r = await this.api.updateName(n);
    this.busy.set(false);
    if (!r.ok) return this.nameMsg.set({ kind: 'bad', text: r.error.message });
    this.auth.setName(n);
    // nazwa w profilu treningowym (profiles.display_name) – ta sama wartość
    await this.store.saveProfile({ ...this.store.profile(), name: n });
    this.nameMsg.set({ kind: 'ok', text: 'Zapisano nazwę użytkownika.' });
  }

  protected async changePassword(ev: Event) {
    ev.preventDefault();
    const p = passwordProblem(this.pw(), this.pw2());
    if (p) return this.pwMsg.set({ kind: 'bad', text: p });
    this.busy.set(true);
    const r = await this.api.changePassword(this.cur(), this.pw());
    this.busy.set(false);
    if (!r.ok) return this.pwMsg.set({ kind: 'bad', text: r.error.message });
    this.cur.set('');
    this.pw.set('');
    this.pw2.set('');
    this.pwMsg.set({ kind: 'ok', text: 'Hasło zostało zmienione.' });
  }

  protected async signOut() {
    this.busy.set(true);
    const pending = await this.session.flush();
    if (pending && !confirm(`${pending} zmian nie zostało jeszcze wysłanych (brak połączenia). Zostaną na tym urządzeniu i wyślą się po ponownym zalogowaniu. Wylogować?`)) {
      this.busy.set(false);
      return;
    }
    const r = await this.session.signOut();
    this.busy.set(false);
    if (r.serverError) this.outMsg.set({ kind: 'info', text: `Wylogowano na tym urządzeniu. Serwer: ${r.serverError}` });
  }

  protected async deleteAccount() {
    if (!this.canDelete()) return;
    if (!confirm('Na pewno usunąć konto i wszystkie dane? Tej operacji nie można cofnąć.')) return;
    this.busy.set(true);
    const r = await this.session.deleteAccount(this.delPw());
    this.busy.set(false);
    if (!r.ok) this.delMsg.set({ kind: 'bad', text: r.message });
  }
}
