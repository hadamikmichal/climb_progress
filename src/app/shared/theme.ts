import { computed, Injectable, signal } from '@angular/core';

/** Preferencja motywu: Nordic Alpine ciemny (domyślny), jasny albo zgodny z ustawieniem systemu */
export type ThemePref = 'light' | 'dark' | 'auto';
export type ResolvedTheme = 'light' | 'dark';

/** Klucz w localStorage – czytany też przez skrypt w index.html, żeby uniknąć mignięcia złego motywu */
export const THEME_KEY = 'climbprogress.theme';
const DEFAULT_PREF: ThemePref = 'dark';

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' || v === 'auto' ? v : DEFAULT_PREF;
  } catch {
    return DEFAULT_PREF;
  }
}

const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const pref = signal<ThemePref>(readPref());
const systemDark = signal(!!media?.matches);
media?.addEventListener?.('change', (e) => systemDark.set(e.matches));

/**
 * Rozstrzygnięty motyw. Funkcje budujące wykresy czytają go, aby obliczone kolory
 * (z custom properties) przeliczały się po zmianie motywu.
 */
export const resolvedTheme = computed<ResolvedTheme>(() => {
  const p = pref();
  return p === 'auto' ? (systemDark() ? 'dark' : 'light') : p;
});

function apply(p: ThemePref) {
  if (typeof document !== 'undefined') document.documentElement.dataset['theme'] = p;
}
apply(pref());

/** Motyw interfejsu. Active Workout Mode jest zawsze ciemny, niezależnie od wyboru. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly pref = pref.asReadonly();
  readonly resolved = resolvedTheme;
  readonly isDark = computed(() => resolvedTheme() === 'dark');

  set(p: ThemePref) {
    apply(p);
    try {
      localStorage.setItem(THEME_KEY, p);
    } catch { /* tryb prywatny – motyw obowiązuje do końca sesji */ }
    pref.set(p);
  }
}
