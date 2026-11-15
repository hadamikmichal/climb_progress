import { ISODate, Weekday } from '../models/models';

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISODate(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function today(): ISODate {
  return toISODate(new Date());
}

export function addDays(s: ISODate, days: number): ISODate {
  const d = parseISODate(s);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Różnica w dniach b - a */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000);
}

export function weekdayOf(s: ISODate): Weekday {
  const js = parseISODate(s).getDay();
  return (js === 0 ? 7 : js) as Weekday;
}

/** Poniedziałek tygodnia, w którym leży data */
export function startOfWeek(s: ISODate): ISODate {
  return addDays(s, 1 - weekdayOf(s));
}

/** Najbliższy poniedziałek ściśle po dacie */
export function nextMonday(s: ISODate): ISODate {
  return addDays(startOfWeek(s), 7);
}

export const WEEKDAY_NAMES: Record<Weekday, string> = {
  1: 'Poniedziałek', 2: 'Wtorek', 3: 'Środa', 4: 'Czwartek', 5: 'Piątek', 6: 'Sobota', 7: 'Niedziela',
};
export const WEEKDAY_SHORT: Record<Weekday, string> = {
  1: 'Pn', 2: 'Wt', 3: 'Śr', 4: 'Cz', 5: 'Pt', 6: 'So', 7: 'Nd',
};

const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

export function formatDate(s: ISODate, withWeekday = true): string {
  const d = parseISODate(s);
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return withWeekday ? `${WEEKDAY_SHORT[weekdayOf(s)]}, ${base}` : base;
}

export function monthKey(s: ISODate): string {
  return s.slice(0, 7);
}

export function formatMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
