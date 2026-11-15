import { Delta } from '../../core/logic/analytics';

/** „+2 kg vs poprz. 6 tyg.” – tylko gdy jest z czym porównać */
export function changeText(d: Delta, unit: string, rangeLabel: string): string | null {
  if (!rangeLabel) return null;
  if (d.trend === 'na' || d.change == null) return d.prev == null && d.value != null ? `brak danych z poprz. ${rangeLabel}` : null;
  if (d.change === 0) return `bez zmian vs poprz. ${rangeLabel}`;
  return `${d.change > 0 ? '+' : '−'}${Math.abs(d.change)}${unit ? ' ' + unit : ''} vs poprz. ${rangeLabel}`;
}
