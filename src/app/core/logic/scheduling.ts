import { ISODate, PlannedWorkout, SkipReason, WorkoutStatus, WorkoutType } from '../models/models';
import { addDays, formatDate, startOfWeek } from './dates';
import { isHeavy, TYPE_SHORT } from './templates';

/** Maksymalna liczba dni treningowych z rzędu */
export const MAX_CONSECUTIVE_DAYS = 3;

export interface ScheduleItem {
  id: string;
  type: WorkoutType;
  date: ISODate;
  status: WorkoutStatus;
}

export const isPending = (s: WorkoutStatus) => s === 'planned' || s === 'moved';
/** Pozycje, które zajmują dzień w kalendarzu (pominięte nie zajmują) */
const occupies = (s: WorkoutStatus) => s !== 'skipped';

/**
 * Sprawdza, czy trening danego typu może odbyć się w danym dniu.
 * Zwraca listę naruszeń (pusta = termin bezpieczny).
 */
export function slotViolations(items: ScheduleItem[], type: WorkoutType, date: ISODate, excludeIds: string[] = []): string[] {
  const others = items.filter((i) => occupies(i.status) && !excludeIds.includes(i.id));
  const on = (d: ISODate) => others.filter((i) => i.date === d);
  const v: string[] = [];

  if (on(date).length > 0) {
    v.push(`${formatDate(date)} jest już zaplanowany inny trening (${on(date).map((i) => TYPE_SHORT[i.type]).join(', ')}).`);
  }
  if (isHeavy(type)) {
    for (const [d, label] of [[addDays(date, -1), 'dzień wcześniej'], [addDays(date, 1), 'dzień później']] as const) {
      const heavy = on(d).filter((i) => isHeavy(i.type));
      if (heavy.length) {
        v.push(`Ciężka jednostka ${label} (${heavy.map((i) => TYPE_SHORT[i.type]).join(', ')}) – między ciężkimi treningami potrzebny jest co najmniej 1 dzień przerwy.`);
      }
    }
  }
  // Limit dni treningowych z rzędu
  const busy = (d: ISODate) => d === date || on(d).length > 0;
  let run = 1;
  for (let d = addDays(date, -1); busy(d); d = addDays(d, -1)) run++;
  for (let d = addDays(date, 1); busy(d); d = addDays(d, 1)) run++;
  if (run > MAX_CONSECUTIVE_DAYS) {
    v.push(`Byłby to ${run}. dzień treningowy z rzędu (maks. ${MAX_CONSECUTIVE_DAYS}).`);
  }
  return v;
}

/**
 * Szuka najwcześniejszego bezpiecznego terminu dla opuszczonego treningu
 * w obrębie tego samego tygodnia treningowego (do niedzieli).
 * Nie przenosi treningu do kolejnego tygodnia, żeby nie kumulować obciążeń.
 */
export function proposeReschedule(items: ScheduleItem[], workout: ScheduleItem, todayDate: ISODate, weekOf: ISODate = workout.date): ISODate | null {
  const from = workout.date < todayDate ? todayDate : addDays(workout.date, 1);
  const end = addDays(startOfWeek(weekOf), 6);
  for (let d = from; d <= end; d = addDays(d, 1)) {
    if (slotViolations(items, workout.type, d, [workout.id]).length === 0) return d;
  }
  return null;
}

export type MissedDecision =
  | { action: 'reschedule'; date: ISODate; explanation: string }
  | { action: 'skip'; reason: SkipReason; explanation: string; advice: string[] };

/**
 * Przypadek B – decyzja po zgłoszeniu, że trening się nie odbędzie.
 * Deterministyczna: brak czasu → próba przełożenia, pozostałe powody → pominięcie bez nadrabiania.
 */
export function decideMissed(items: ScheduleItem[], workout: PlannedWorkout, reason: SkipReason, todayDate: ISODate): MissedDecision {
  const name = TYPE_SHORT[workout.type];
  const noProgress = 'Kolejny trening odbędzie się na dotychczasowym poziomie – zmiana daty nie zwiększa obciążenia.';
  switch (reason) {
    case 'time': {
      const date = proposeReschedule(items, workout, todayDate, workout.originalDate);
      if (date) {
        return {
          action: 'reschedule',
          date,
          explanation: `Brak czasu: ${name} można bezpiecznie przełożyć na ${formatDate(date)} – zachowana jest przerwa od ciężkich jednostek i limit ${MAX_CONSECUTIVE_DAYS} dni treningowych z rzędu. ${noProgress}`,
        };
      }
      return {
        action: 'skip',
        reason: 'no_slot',
        explanation: `Brak czasu, a w tym tygodniu nie ma terminu, który nie kumulowałby ciężkich jednostek. ${name} zostaje pominięty – nie nadrabiamy go w kolejnym tygodniu.`,
        advice: [noProgress],
      };
    }
    case 'fatigue':
      return {
        action: 'skip',
        reason,
        explanation: `Zmęczenie: ${name} zostaje pominięty. Odpoczynek jest częścią treningu – nie nadrabiamy tej jednostki.`,
        advice: ['Przed kolejnym treningiem wypełnij ocenę gotowości.', noProgress],
      };
    case 'pain':
      return {
        action: 'skip',
        reason,
        explanation: `Ból lub uraz: ${name} zostaje pominięty. Nie nadrabiamy tej jednostki.`,
        advice: [
          'Dopóki ból się utrzymuje, aplikacja nie zaproponuje ciężkiej chwytotablicy.',
          'Przed kolejnym treningiem wypełnij ocenę gotowości.',
          'Jeśli ból nie ustępuje, skonsultuj się z fizjoterapeutą lub lekarzem.',
        ],
      };
    case 'illness':
      return {
        action: 'skip',
        reason,
        explanation: `Choroba: ${name} zostaje pominięty. Wróć do treningów dopiero po ustąpieniu objawów.`,
        advice: ['Pierwszy trening po chorobie wykonaj lżej (wybierz „lżejszą wersję” po ocenie gotowości).', noProgress],
      };
    default:
      return {
        action: 'skip',
        reason,
        explanation: `${name} zostaje pominięty. Możesz też ręcznie wybrać inny termin w planie – aplikacja sprawdzi, czy jest bezpieczny.`,
        advice: [noProgress],
      };
  }
}
