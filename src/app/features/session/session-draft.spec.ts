import { advanceTimers, draftToCompleted, missingParts, newDraft, startHang } from './session-draft';
import { createCycle } from '../../core/logic/plan';
import { initialParams, defaultProfile } from '../../core/logic/templates';
import { PlannedWorkout, TrainingType } from '../../core/models/models';

const ts = '2026-01-05T10:00:00.000Z';
const params = initialParams(defaultProfile(ts));
const cycle = createCycle('Cykl 1', '2025-12-29', params, ts);
const planned = (type: TrainingType): PlannedWorkout => ({
  id: `p-${type}`, cycleId: cycle.id, type, week: 1, date: '2026-01-05', originalDate: '2026-01-05', order: 1, status: 'planned', moves: [], createdAt: ts, updatedAt: ts,
});

describe('szkic sesji – wykonanie pełne vs częściowe', () => {
  it('trening C: nie wszystkie drogi obwodu → zapis częściowy', () => {
    const d = newDraft(planned('C'), params, false, false, ts, false);
    expect(d.routes.length).toBe(params.powerEndurance.sets * params.powerEndurance.routesPerSet);
    d.exercises.find((e) => e.kind === 'warmup')!.done = true;
    d.routes.slice(0, 3).forEach((r) => (r.state = 'sent'));
    expect(missingParts(d).length).toBeGreaterThan(0);
    const w = draftToCompleted(d, planned('C'), cycle, '2026-01-05T11:30:00.000Z', '2026-01-05');
    expect(w.completion).toBe('partial');
    // zapisujemy tylko rzeczywiście wykonane drogi
    expect(w.routes.length).toBe(3);
  });

  it('trening C: wszystkie drogi wspinane (z odpadnięciem) → pełne wykonanie, odpadnięcie zapisane', () => {
    const d = newDraft(planned('C'), params, false, false, ts, false);
    d.exercises.find((e) => e.kind === 'warmup')!.done = true;
    d.routes.forEach((r, i) => (r.state = i === 5 ? 'fell' : 'sent'));
    const w = draftToCompleted(d, planned('C'), cycle, '2026-01-05T11:30:00.000Z', '2026-01-05');
    expect(w.completion).toBe('full');
    expect(w.routes.filter((r) => !r.completed).length).toBe(1);
  });

  it('trening A (trudne drogi) nie zawiera już zwisów', () => {
    const d = newDraft(planned('A'), params, false, false, ts, false);
    expect(d.hang).toBeNull();
    expect(d.exercises.some((e) => e.kind === 'hangboard')).toBe(false);
  });

  it('trening B: zwisy zablokowane (ból) → częściowy, bez wpisu w historii zwisów', () => {
    const d = newDraft(planned('B'), params, false, false, ts, true);
    d.exercises.forEach((e) => (e.done = true));
    d.routes.forEach((r) => (r.state = 'sent'));
    const w = draftToCompleted(d, planned('B'), cycle, '2026-01-05T11:30:00.000Z', '2026-01-05');
    expect(w.completion).toBe('partial');
    expect(w.hangs).toEqual([]);
  });

  it('trening B: komplet serii zwisów i dróg → pełny, zwis zapisany z faktycznymi parametrami', () => {
    const d = newDraft(planned('B'), params, false, false, ts, false);
    d.exercises.forEach((e) => (e.done = true));
    d.hang!.setsDone = d.hang!.setsPlanned;
    d.hang!.edge = 'Krawądka 20 mm';
    d.hang!.addedKg = 2;
    d.routes.forEach((r) => (r.state = 'sent'));
    const w = draftToCompleted(d, planned('B'), cycle, '2026-01-05T11:30:00.000Z', '2026-01-05');
    expect(w.completion).toBe('full');
    expect(w.hangs[0].edge).toBe('Krawądka 20 mm');
    expect(w.hangs[0].addedKg).toBe(2);
  });

  it('lżejsza wersja jest oznaczana jako deload (nie liczy się do progresji)', () => {
    const d = newDraft(planned('B'), params, false, true, ts, false);
    const w = draftToCompleted(d, planned('B'), cycle, '2026-01-05T11:30:00.000Z', '2026-01-05');
    expect(w.deload).toBe(true);
  });

  it('wymuszony zapis częściowy', () => {
    const d = newDraft(planned('B'), params, false, false, ts, false);
    d.exercises.forEach((e) => (e.done = true));
    d.hang!.setsDone = d.hang!.setsPlanned;
    d.routes.forEach((r) => (r.state = 'sent'));
    expect(draftToCompleted(d, planned('B'), cycle, ts, '2026-01-05').completion).toBe('full');
    d.forcePartial = true;
    expect(draftToCompleted(d, planned('B'), cycle, ts, '2026-01-05').completion).toBe('partial');
  });

  it('timer zwisów: zakończony zwis zalicza serię i uruchamia przerwę od momentu końca zwisu', () => {
    const d = newDraft(planned('B'), params, false, false, ts, false);
    const t0 = Date.parse(ts);
    startHang(d, ts);
    expect(advanceTimers(d, t0 + 5_000)).toBe(false);
    // aplikacja wraca po 30 s: zwis zakończony, przerwa trwa od końca zwisu
    const hangMs = params.hangboard.hangSec * 1000;
    expect(advanceTimers(d, t0 + 30_000)).toBe(true);
    expect(d.hang!.setsDone).toBe(1);
    expect(d.hang!.holdTimes).toEqual([params.hangboard.hangSec]);
    expect(d.timer!.kind).toBe('rest');
    expect(Date.parse(d.timer!.startedAt)).toBe(t0 + hangMs);
    // po przerwie timer jest pusty – czeka na start kolejnego zwisu
    advanceTimers(d, t0 + hangMs + params.hangboard.restSec * 1000);
    expect(d.timer).toBeNull();
  });

  it('timer zwisów: po ostatniej serii nie ma przerwy, nie przekracza planu', () => {
    const d = newDraft(planned('B'), params, false, false, ts, false);
    d.hang!.setsDone = d.hang!.setsPlanned - 1;
    startHang(d, ts);
    advanceTimers(d, Date.parse(ts) + 60_000);
    expect(d.hang!.setsDone).toBe(d.hang!.setsPlanned);
    expect(d.timer).toBeNull();
    startHang(d, ts);
    expect(d.timer).toBeNull();
  });
});
