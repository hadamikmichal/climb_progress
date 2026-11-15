import { inject, Pipe, PipeTransform } from '@angular/core';
import { addDays, formatDate } from '../core/logic/dates';
import { AppStore } from '../core/data/store';

@Pipe({ name: 'datePl' })
export class DatePlPipe implements PipeTransform {
  private readonly store = inject(AppStore);
  transform(v: string | null | undefined, mode: 'short' | 'relative' = 'short'): string {
    if (!v) return '–';
    const d = v.slice(0, 10);
    if (mode === 'relative') {
      const t = this.store.today();
      if (d === t) return 'Dziś';
      if (d === addDays(t, 1)) return 'Jutro';
      if (d === addDays(t, -1)) return 'Wczoraj';
    }
    return formatDate(d);
  }
}
