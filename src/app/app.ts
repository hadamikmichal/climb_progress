import { Component, computed, effect, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { AppStore } from './core/data/store';
import { Icon, IconName } from './shared/icon';
import { BrandMark } from './shared/brand';
import { ThemeService } from './shared/theme';
import { Sheet } from './shared/sheet';
import { AuthStore } from './core/auth/auth.store';
import { SyncService } from './core/sync/sync.service';
import { LegacyImportService } from './core/session/legacy-import';
import { UserSession } from './core/session/user-session';

/** Ekrany kont – bez nawigacji i bez danych treningowych */
const AUTH_ROUTE = /^\/(login|register|forgot-password|reset-password|verify-email)(\/|\?|$)/;

interface NavItem { path: string; label: string; icon: IconName; exact?: boolean }

/** Kolor paska przeglądarki / PWA – zgodny z --color-background motywu */
const NORDIC_FJORD = '#11191B';
const NORDIC_SNOW = '#F0F3ED';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, BrandMark, Sheet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly store = inject(AppStore);
  private readonly router = inject(Router);
  private readonly theme = inject(ThemeService);
  protected readonly auth = inject(AuthStore);
  protected readonly sync = inject(SyncService);
  protected readonly legacy = inject(LegacyImportService);
  private readonly session = inject(UserSession);

  private readonly url = toSignal(this.router.events.pipe(filter((e) => e instanceof NavigationEnd), map(() => this.router.url)), { initialValue: this.router.url });
  /** Ekran aktywnego treningu/testu ukrywa nawigację – mniej przypadkowych kliknięć na ścianie */
  protected readonly authRoute = computed(() => AUTH_ROUTE.test(this.url()));
  protected readonly focusMode = computed(() => /^\/(session|test|assessment\/run)\//.test(this.url()));

  protected readonly nav: NavItem[] = [
    { path: '/', label: 'Dziś', exact: true, icon: 'today' },
    { path: '/plan', label: 'Plan', icon: 'plan' },
    { path: '/progress', label: 'Progres', icon: 'progress' },
    { path: '/history', label: 'Historia', icon: 'history' },
    { path: '/profile', label: 'Profil', icon: 'profile' },
  ];

  /** „TYDZ. 02 / 06” – tylko w trakcie cyklu */
  protected readonly weekLabel = computed(() => {
    const c = this.store.cycle();
    const w = this.store.currentWeek();
    if (!c?.planStart || w < 1 || w > c.weeks) return null;
    return `Tydz. ${String(w).padStart(2, '0')} / ${String(c.weeks).padStart(2, '0')}`;
  });

  constructor() {
    // Data API odrzuciło token: jeśli Neon Auth potwierdza brak sesji – ponowne logowanie (dane lokalne zostają)
    effect(() => {
      if (this.sync.state() !== 'auth') return;
      void this.auth.revalidate().then((u) => {
        if (!u) void this.session.expire();
        else void this.sync.syncNow();
      });
    });
    // Tło całego dokumentu podąża za kontekstem (Active Workout Mode = zawsze Nordic dark)
    effect(() => {
      const focus = this.focusMode();
      document.body.classList.toggle('mode-active', focus);
      const dark = focus || this.theme.isDark();
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? NORDIC_FJORD : NORDIC_SNOW);
    });
  }

}
