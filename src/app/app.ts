import { Component, computed, effect, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { AppStore } from './core/data/store';
import { Icon, IconName } from './shared/icon';
import { BrandMark } from './shared/brand';
import { ThemeService } from './shared/theme';

interface NavItem { path: string; label: string; icon: IconName; exact?: boolean }
interface NavGroup { label: string; items: NavItem[]; end?: boolean }

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, BrandMark],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly store = inject(AppStore);
  private readonly router = inject(Router);
  private readonly theme = inject(ThemeService);

  private readonly url = toSignal(this.router.events.pipe(filter((e) => e instanceof NavigationEnd), map(() => this.router.url)), { initialValue: this.router.url });
  /** Ekran aktywnego treningu/testu ukrywa nawigację – mniej przypadkowych kliknięć na ścianie */
  protected readonly focusMode = computed(() => /^\/(session|test|assessment\/run)\//.test(this.url()));

  /** Nawigacja w grupach: trening → analiza → konto */
  protected readonly groups: NavGroup[] = [
    { label: 'Trening', items: [
      { path: '/', label: 'Dziś', exact: true, icon: 'today' },
      { path: '/plan', label: 'Plan', icon: 'plan' },
    ] },
    { label: 'Analiza', items: [
      { path: '/progress', label: 'Progres', icon: 'progress' },
      { path: '/history', label: 'Historia', icon: 'history' },
    ] },
    { label: 'Konto', end: true, items: [{ path: '/profile', label: 'Profil', icon: 'profile' }] },
  ];

  /** Postęp cyklu (tydzień N z M) – tylko w trakcie cyklu */
  protected readonly cycleProgress = computed(() => {
    const c = this.store.cycle();
    const w = this.store.currentWeek();
    if (!c?.planStart || w < 1 || w > c.weeks) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    const steps = Array.from({ length: c.weeks }, (_, i) => (i + 1 < w ? 'done' : i + 1 === w ? 'now' : 'todo'));
    return { week: pad(w), of: pad(c.weeks), steps };
  });

  constructor() {
    // Tło całego dokumentu podąża za kontekstem (Active Workout Mode = grafit)
    effect(() => {
      const focus = this.focusMode();
      document.body.classList.toggle('mode-active', focus);
      const dark = focus || this.theme.isDark();
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1A1F1B' : '#F3F2ED');
    });
  }

}
