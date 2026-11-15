import { CanDeactivateFn } from '@angular/router';

/** Ekran, który może zablokować przypadkowe opuszczenie (aktywny trening / test) */
export interface LeaveGuarded {
  canLeave(): boolean;
  leaveMessage?(): string;
}

/** Potwierdzenie przed opuszczeniem aktywnej sesji. Dane są zapisane – chodzi o przypadkowe dotknięcie. */
export const confirmLeave: CanDeactivateFn<LeaveGuarded> = (c) => {
  if (!c || typeof c.canLeave !== 'function' || c.canLeave()) return true;
  return confirm(c.leaveMessage?.() ?? 'Sesja trwa. Wyniki są zapisane. Wyjść teraz?');
};
