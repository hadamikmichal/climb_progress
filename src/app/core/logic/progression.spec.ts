import { evaluateProgression, assessSession, HistoryEntry, progressStep, levelKey, TRACKS } from './progression';
import { P0, workout, route, hang } from './testing/fixtures';
import { TrainingParams } from '../models/models';

const done = (w: ReturnType<typeof workout>): HistoryEntry => ({ kind: 'completed', date: w.date, workout: w });
const skip = (date: string): HistoryEntry => ({ kind: 'skipped', date, id: `s-${date}` });

describe('assessSession', () => {
  it('ocenia dobrze wykonany trening C jako dobry', () => {
    expect(assessSession(workout('C', '2026-01-03')).quality).toBe('good');
  });

  it('trening częściowy nie jest dobry', () => {
    const w = workout('C', '2026-01-03', P0, { completion: 'partial' });
    expect(assessSession(w).quality).not.toBe('good');
  });

  it('ból podczas zwisów = zła sesja', () => {
    const w = workout('B', '2026-01-05', P0, { hangs: [hang({ pain: true })] });
    expect(assessSession(w).quality).toBe('bad');
  });

  it('pompowanie > 4 na treningu tlenowym = brak progresji', () => {
    const w = workout('B', '2026-01-07');
    w.routes.forEach((r) => (r.pump = 6));
    const a = assessSession(w);
    expect(a.quality).toBe('ok');
    expect(a.issues.join(' ')).toContain('pompowanie');
  });
});

describe('evaluateProgression – reguły', () => {
  it('jedna dobra sesja → utrzymanie poziomu', () => {
    const d = evaluateProgression('pe', [done(workout('C', '2026-01-03'))], P0);
    expect(d.action).toBe('hold');
    expect(d.params).toEqual(P0);
    expect(d.reason).toContain('1 z 2');
  });

  it('dwie dobre sesje na tym samym poziomie → progresja jednego parametru (C: 2×3 → 3×3)', () => {
    const d = evaluateProgression('pe', [done(workout('C', '2026-01-03')), done(workout('C', '2026-01-10'))], P0);
    expect(d.action).toBe('progress');
    expect(d.params.powerEndurance.sets).toBe(3);
    // tylko jeden parametr się zmienił
    expect(d.params.powerEndurance.grade).toBe(P0.powerEndurance.grade);
    expect(d.params.powerEndurance.routesPerSet).toBe(3);
    expect({ ...d.params, powerEndurance: P0.powerEndurance }).toEqual(P0);
  });

  it('nigdy nie przechodzi do 4×4 – po 3×3 zwiększa trudność', () => {
    const p: TrainingParams = structuredClone(P0);
    p.powerEndurance.sets = 3;
    const ch = progressStep('pe', p)!;
    expect(ch.params.powerEndurance.sets).toBe(3);
    expect(ch.params.powerEndurance.routesPerSet).toBe(3);
    expect(ch.params.powerEndurance.grade).toBe('6a');
  });

  it('wysokie RPE w ostatniej sesji → brak progresji', () => {
    const d = evaluateProgression('pe', [done(workout('C', '2026-01-03')), done(workout('C', '2026-01-10', P0, { rpe: 9 }))], P0);
    expect(d.action).toBe('hold');
    expect(d.params).toEqual(P0);
  });

  it('nieukończenie przy skrajnym zmęczeniu → zmniejszenie', () => {
    const p: TrainingParams = structuredClone(P0);
    p.powerEndurance.sets = 3;
    const w = workout('C', '2026-01-10', p, { completion: 'partial', rpe: 10 });
    w.routes[7].completed = false;
    const d = evaluateProgression('pe', [done(w)], p);
    expect(d.action).toBe('reduce');
    expect(d.params.powerEndurance.sets).toBe(2);
  });

  it('nieukończony trening nie zwiększa trudności', () => {
    const w1 = workout('C', '2026-01-03');
    const w2 = workout('C', '2026-01-10', P0, { completion: 'partial' });
    w2.routes[5].completed = false;
    const d = evaluateProgression('pe', [done(w1), done(w2)], P0);
    expect(d.action).toBe('hold');
  });

  it('dwie częściowe sesje pod rząd → zmniejszenie obciążenia', () => {
    const p: TrainingParams = structuredClone(P0);
    p.aerobic.routes = 5;
    const w1 = workout('B', '2026-01-07', p, { completion: 'partial' });
    const w2 = workout('B', '2026-01-14', p, { completion: 'partial' });
    w1.routes[4].completed = false;
    w2.routes[4].completed = false;
    const d = evaluateProgression('aerobic', [done(w1), done(w2)], p);
    expect(d.action).toBe('reduce');
    expect(d.params.aerobic.routes).toBe(4);
  });

  it('pominięta jednostka przerywa serię – po opuszczeniu utrzymujemy poziom', () => {
    const d1 = evaluateProgression('pe', [done(workout('C', '2026-01-03')), skip('2026-01-10')], P0);
    expect(d1.action).toBe('hold');
    expect(d1.reason).toContain('pominięta');

    const d2 = evaluateProgression('pe', [done(workout('C', '2026-01-03')), skip('2026-01-10'), done(workout('C', '2026-01-17'))], P0);
    expect(d2.action).toBe('hold');
    expect(d2.reason).toContain('przerwana');
  });

  it('sesje deload nie są liczone do progresji', () => {
    const d = evaluateProgression('pe', [done(workout('C', '2026-01-03')), done(workout('C', '2026-01-10', P0, { deload: true }))], P0);
    expect(d.action).toBe('hold');
  });

  it('sesje na poprzednim poziomie nie liczą się do serii na nowym poziomie', () => {
    const p1: TrainingParams = structuredClone(P0);
    p1.powerEndurance.sets = 3;
    const d = evaluateProgression('pe', [done(workout('C', '2026-01-03')), done(workout('C', '2026-01-10')), done(workout('C', '2026-01-17', p1))], p1);
    expect(d.action).toBe('hold');
    expect(levelKey('pe', d.params)).toBe(levelKey('pe', p1));
  });

  it('Max Hangs (B): progresja najpierw liczby serii, potem obciążenia o 2 kg', () => {
    const d = evaluateProgression('hang', [done(workout('B', '2026-01-05')), done(workout('B', '2026-01-12'))], P0);
    expect(d.action).toBe('progress');
    expect(d.params.hangboard.sets).toBe(4);
    expect(d.params.hangboard.addedKg).toBe(0);

    const p5: TrainingParams = structuredClone(P0);
    p5.hangboard.sets = 5;
    const ch = progressStep('hang', p5)!;
    expect(ch.params.hangboard.sets).toBe(5);
    expect(ch.params.hangboard.addedKg).toBe(2);
  });

  it('Max Hangs: przy odciążeniu progres zmniejsza odciążenie zamiast dodawać ciężar', () => {
    const p: TrainingParams = structuredClone(P0);
    p.hangboard.sets = 5;
    p.hangboard.assistKg = 5;
    const ch = progressStep('hang', p)!;
    expect(ch.params.hangboard.assistKg).toBe(3);
    expect(ch.params.hangboard.addedKg).toBe(0);
  });

  it('Max Hangs: ból → zmniejszenie obciążenia (nie liczby serii)', () => {
    const p: TrainingParams = structuredClone(P0);
    p.hangboard.sets = 4;
    p.hangboard.addedKg = 4;
    const w = workout('B', '2026-01-05', p, { hangs: [hang({ pain: true, setsPlanned: 4, setsDone: 4, addedKg: 4 })] });
    const d = evaluateProgression('hang', [done(w)], p);
    expect(d.action).toBe('reduce');
    expect(d.params.hangboard.addedKg).toBe(2);
    expect(d.params.hangboard.sets).toBe(4);
  });

  it('Drogi tlenowe (B): dobre sesje → +1 droga, potem trudność', () => {
    const d = evaluateProgression('aerobic', [done(workout('B', '2026-01-07')), done(workout('B', '2026-01-14'))], P0);
    expect(d.params.aerobic.routes).toBe(5);
    expect(d.params.aerobic.grade).toBe('5b');
    const p: TrainingParams = structuredClone(P0);
    p.aerobic.routes = 5;
    expect(progressStep('aerobic', p)!.params.aerobic.grade).toBe('5b+');
  });

  it('jest deterministyczna – te same dane dają tę samą decyzję', () => {
    const h = [done(workout('C', '2026-01-03')), done(workout('C', '2026-01-10'))];
    expect(evaluateProgression('pe', h, P0)).toEqual(evaluateProgression('pe', h, P0));
  });

  it('odpadnięcie w obwodzie = brak progresji nawet przy niskim RPE', () => {
    const w2 = workout('C', '2026-01-10');
    w2.routes[2] = route({ setIndex: 1, completed: false });
    const d = evaluateProgression('pe', [done(workout('C', '2026-01-03')), done(w2)], P0);
    expect(d.action).toBe('hold');
  });

  it('B: tory zwisów i dróg tlenowych są oceniane niezależnie', () => {
    const w1 = workout('B', '2026-01-07');
    const w2 = workout('B', '2026-01-14');
    w2.routes.forEach((r) => (r.pump = 6));
    const hist = [done(w1), done(w2)];
    expect(evaluateProgression('hang', hist, P0).action).toBe('progress');
    expect(evaluateProgression('aerobic', hist, P0).action).toBe('hold');
  });

  it('B: wysokie RPE zwisów nie blokuje progresji dróg tlenowych', () => {
    const mk = (date: string) => workout('B', date, P0, { hangs: [hang({ rpe: 9 })], rpe: 9 });
    const hist = [done(mk('2026-01-07')), done(mk('2026-01-14'))];
    expect(evaluateProgression('hang', hist, P0).action).toBe('hold');
    expect(evaluateProgression('aerobic', hist, P0).action).toBe('progress');
  });

  it('A (trudne drogi) nie ma torów automatycznej progresji', () => {
    expect(TRACKS.A).toEqual([]);
    expect(TRACKS.B).toEqual(['hang', 'aerobic']);
  });
});
