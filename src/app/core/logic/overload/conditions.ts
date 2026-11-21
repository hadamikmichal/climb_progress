import { CompletedWorkout } from '../../models/models';
import { followUpOk, Quality } from '../progression';
import { ProgressionCondition, SessionCheck } from './types';

/** Mała pierwsza litera, chyba że to skrót (RPE) */
const lowerFirst = (s: string) => (s.length > 1 && s[1] === s[1].toLowerCase() ? s[0].toLowerCase() + s.slice(1) : s);

export const cond = (key: string, label: string, met: boolean | null, detail = ''): ProgressionCondition => ({ key, label, met, detail });

/** Ocena sesji z listy warunków: niespełnione warunki → problemy, brak danych nie blokuje */
export function fromConditions(conditions: ProgressionCondition[], facts: string[], opts: { bad?: boolean; pain?: boolean } = {}): SessionCheck {
  const failed = conditions.filter((c) => c.met === false);
  const issues = failed.map((c) => (c.detail ? `${lowerFirst(c.label)} – ${c.detail}` : lowerFirst(c.label)));
  const successful = failed.length === 0;
  const quality: Quality = opts.bad || opts.pain ? 'bad' : successful ? 'good' : 'ok';
  return { quality, facts, issues, conditions, successful: successful && !opts.pain, pain: !!opts.pain };
}

/** Regeneracja: samopoczucie po treningu i następnego dnia */
export function recoveryConditions(w: CompletedWorkout): ProgressionCondition[] {
  const out: ProgressionCondition[] = [];
  if (w.feelingAfter != null) out.push(cond('feeling', 'Samopoczucie po treningu ≥ 3/5', w.feelingAfter >= 3, `${w.feelingAfter}/5`));
  const f = w.followUp;
  out.push(cond(
    'followUp', 'Samopoczucie następnego dnia', followUpOk(w),
    f ? `${f.feeling}/5${f.fingerPain ? ', ból palców' : ''}` : 'jeszcze nie podano',
  ));
  return out;
}

/** Liczba z przecinkiem (pl) */
export const num = (n: number | null | undefined) => (n == null ? '–' : `${Math.round(n * 100) / 100}`.replace('.', ','));
