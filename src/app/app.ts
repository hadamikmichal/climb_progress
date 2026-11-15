import { Component, computed, effect, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { AppStore } from './core/data/store';
import { Icon, IconName } from './shared/icon';
import { BrandMark } from './shared/brand';

interface NavItem { path: string; label: string; icon: IconName; exact?: boolean }

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, BrandMark],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly store = inject(AppStore);
  private readonly router = inject(Router);

  private readonly url = toSignal(this.router.events.pipe(filter((e) => e instanceof NavigationEnd), map(() => this.router.url)), { initialValue: this.router.url });
  /** Ekran aktywnego treningu/testu ukrywa nawigację – mniej przypadkowych kliknięć na ścianie */
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
    // Tło całego dokumentu podąża za kontekstem (Active Workout Mode = grafit)
    effect(() => {
      const dark = this.focusMode();
      document.body.classList.toggle('mode-active', dark);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#181C19' : '#F1F0E9');
    });
  }

}
