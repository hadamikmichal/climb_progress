import { TestBed } from '@angular/core/testing';
import { THEME_KEY, ThemeService } from './theme';

describe('ThemeService', () => {
  it('zapisuje wybór, ustawia data-theme i rozstrzyga motyw', () => {
    const t = TestBed.inject(ThemeService);
    t.set('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(t.resolved()).toBe('dark');
    expect(t.isDark()).toBe(true);
    t.set('light');
    expect(t.resolved()).toBe('light');
    t.set('auto');
    expect(document.documentElement.dataset['theme']).toBe('auto');
    // jsdom nie raportuje ciemnego motywu systemu → auto = jasny
    expect(t.resolved()).toBe('light');
  });
});
