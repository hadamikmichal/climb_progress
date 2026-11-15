import { Component, computed, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { AppStore } from './core/data/store';

interface NavItem { path: string; label: string; icon: string; exact?: boolean }

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
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
    { path: '/', label: 'Start', exact: true, icon: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
    { path: '/plan', label: 'Plan', icon: 'M4 6h16M4 6v13a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V6M4 6V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v1M8 2v4m8-4v4M8 11h2m4 0h2M8 15h2m4 0h2' },
    { path: '/history', label: 'Historia', icon: 'M12 7v5l3 2M3.5 12a8.5 8.5 0 1 0 2.5-6M3 4v4h4' },
    { path: '/progress', label: 'Progres', icon: 'M4 20V10m6 10V4m6 16v-7m6 7V8' },
    { path: '/profile', label: 'Profil', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0' },
  ];
}
