import { describe, expect, it } from 'vitest';
import { CompletedWorkout, HangboardLog, ReadinessCheck, TrainingParams } from '../../models/models';
import { HistoryEntry } from '../progression';
import { deloadParams } from '../plan';
import { hang, P0, route, workout } from '../testing/fixtures';
import { baseline, circuit, peParams } from '../testing/adaptive-fixtures';
import { progressiveOverload as engine, HangboardProgressionService } from './index';

/**
 * Progressive Overload Engine – progresja wynika z wykonanej pracy, techniki i regeneracji, nie z kalendarza.
 */

const done = (w: CompletedWorkout): HistoryEntry => ({ kind: 'completed', date: w.date, workout: w });
const skip = (date: string): HistoryEntry => ({ kind: 'skipped', date, id: `s-${date}` });

/** Parametry Max Hangs: 4 × 7 s, 180 s, 20 mm half crimp, +7,5 kg (zatwierdzone) */
function hangParams(addedKg = 7.5, o: Partial<TrainingParams['hangboard']> = {}): TrainingParams {
  const p = structuredClone(P0);
  Object.assign(p.hangboard, { sets: 4, hangSec: 7, restSec: 180, edgeSizeMm: 20, grip: 'half_crimp', addedKg, assistKg: 0, calibration: 'confirmed' }, o);
  return p;
}

/** Sesja B z zapisanymi zwisami; domyślnie udana: 4/4, pełny czas, RPE 7,5, technika OK, bez bólu */
function hangSession(date: string, p: TrainingParams, o: Partial<HangboardLog> = {}, w: Partial<CompletedWorkout> = {}): CompletedWorkout {
  const h = p.hangboard;
  return workout('B', date, p, {
    hangs: [hang({
      date, setsPlanned: h.sets, setsDone: h.sets, hangSec: h.hangSec, addedKg: h.addedKg, assistKg: h.assistKg, rpe: 7.5,
      holdTimes: Array(h.sets).fill(h.hangSec), techniqueOk: true, ...o,
    })],
    ...w,
  });
}

/* ================= MAX HANGS ================= */

describe('Max Hangs – kalibracja ciężaru', () => {
  const svc = new HangboardProgressionService();

  it('ciężar orientacyjny z maksimum: 70 kg + 21,25 kg → +7,5 kg (4 × 7 s, 180 s, half crimp)', () => {
    expect(svc.calibrationLoad(21.25, 70)).toBe(7.5);
    const hp = svc.calibrationParams(P0.hangboard, 21.25, 70);
    expect(hp).toMatchObject({ sets: 4, hangSec: 7, restSec: 180, grip: 'half_crimp', addedKg: 7.5, assistKg: 0, calibration: 'pending' });
  });

  it('RPE 7–8 i wszystkie zwisy → ciężar zatwierdzony bez zmiany', () => {
    const p = hangParams(7.5, { calibration: 'pending' });
    const d = engine.evaluate('hang', [done(hangSession('2026-03-09', p, { rpe: 8 }))], p);
    expect(d.params.hangboard.calibration).toBe('confirmed');
    expect(d.params.hangboard.addedKg).toBe(7.5);
    expect(d.action).toBe('hold');
    expect(d.reason).toContain('ciężar treningowy zatwierdzony');
  });

  it('za trudno (RPE 9, nieukończone zwisy) → mniej, kalibracja powtarzana', () => {
    const p = hangParams(7.5, { calibration: 'pending' });
    const d = engine.evaluate('hang', [done(hangSession('2026-03-09', p, { rpe: 9, setsDone: 3, holdTimes: [7, 7, 5] }))], p);
    expect(d.action).toBe('reduce');
    expect(d.params.hangboard.addedKg).toBe(5);
    expect(d.params.hangboard.calibration).toBe('pending');
  });

  it('za trudno przy małym ciężarze → odciążenie', () => {
    const p = hangParams(1.25, { calibration: 'pending' });
    const d = engine.evaluate('hang', [done(hangSession('2026-03-09', p, { rpe: 10, setsDone: 2 }))], p);
    expect(d.params.hangboard.addedKg).toBe(0);
    expect(d.params.hangboard.assistKg).toBe(1.25);
    expect(d.reason).toContain('odciążenie');
  });

  it('bardzo łatwo (RPE 5) → ostrożne zwiększenie, kalibracja powtarzana', () => {
    const p = hangParams(7.5, { calibration: 'pending' });
    const d = engine.evaluate('hang', [done(hangSession('2026-03-09', p, { rpe: 5 }))], p);
    expect(d.action).toBe('progress');
    expect(d.params.hangboard.addedKg).toBe(10);
    expect(d.params.hangboard.calibration).toBe('pending');
  });

  it('ciężar zmieniony w trakcie kalibracji → zatwierdzany rzeczywiście użyty ciężar', () => {
    const p = hangParams(7.5, { calibration: 'pending' });
    const d = engine.evaluate('hang', [done(hangSession('2026-03-09', p, { addedKg: 8.75, rpe: 7.5 }))], p);
    expect(d.params.hangboard.calibration).toBe('confirmed');
    expect(d.params.hangboard.addedKg).toBe(8.75);
    expect(d.reason).toContain('zaplanowano +7,5 kg, wykonano +8,75 kg');
  });
});

describe('Max Hangs – progresja ciężaru', () => {
  const p = hangParams(7.5);

  it('dwie kolejne udane sesje → +1,25 kg z uzasadnieniem', () => {
    const d = engine.evaluate('hang', [done(hangSession('2026-03-09', p)), done(hangSession('2026-03-16', p, { rpe: 7 }))], p);
    expect(d.action).toBe('progress');
    expect(d.params.hangboard.addedKg).toBe(8.75);
    expect(d.params.hangboard.sets).toBe(4);
    expect(d.params.hangboard.hangSec).toBe(7);
    expect(d.reason).toContain('zwiększamy Max Hang o 1,25 kg');
    expect(d.reason).toContain('dwa ostatnie treningi zostały wykonane poprawnie');
    expect(d.reason).toContain('RPE 7,5 i 7');
  });

  it('jedna udana sesja → powtórzenie tego samego obciążenia („jeszcze jedna udana sesja”)', () => {
    const d = engine.evaluate('hang', [done(hangSession('2026-03-09', p))], p);
    expect(d.action).toBe('hold');
    expect(d.params).toEqual(p);
    expect(d.reason).toContain('jeszcze jedna udana sesja przed progresją');
    const st = engine.status('hang', [done(hangSession('2026-03-09', p))], p);
    expect(st.streak).toBe(1);
    expect(st.text).toBe('Jeszcze jedna udana sesja przed progresją.');
    expect(st.next?.to).toBe('+8,75 kg');
  });

  it('RPE powyżej 8 → utrzymanie ciężaru', () => {
    const d = engine.evaluate('hang', [done(hangSession('2026-03-09', p)), done(hangSession('2026-03-16', p, { rpe: 8.5 }))], p);
    expect(d.action).toBe('hold');
    expect(d.params.hangboard.addedKg).toBe(7.5);
    expect(d.reason).toContain('utrzymujemy obciążenie');
  });

  it('nieprawidłowa technika → utrzymanie ciężaru', () => {
    const d = engine.evaluate('hang', [done(hangSession('2026-03-09', p)), done(hangSession('2026-03-16', p, { techniqueOk: false }))], p);
    expect(d.action).toBe('hold');
    expect(d.reason).toContain('Technika w ostatniej sesji nie była prawidłowa');
  });

  it('upływ czasu sam w sobie nie zwiększa obciążenia – brak sesji = brak zmiany', () => {
    expect(engine.evaluate('hang', [], p).action).toBe('hold');
    expect(engine.evaluate('hang', [], p).params).toEqual(p);
  });
});

describe('Max Hangs – nieukończona sesja', () => {
  const p = hangParams(7.5);

  it('nie wszystkie serie → utrzymanie i analiza przyczyny', () => {
    const d = engine.evaluate('hang', [done(hangSession('2026-03-09', p)), done(hangSession('2026-03-16', p, { setsDone: 3, holdTimes: [7, 7, 7] }))], p);
    expect(d.action).toBe('hold');
    expect(d.params).toEqual(p);
    expect(d.reason).toContain('utrzymujemy obciążenie');
    expect(d.reason).toContain('nie udało się ukończyć wszystkich zwisów');
  });

  it('czas zwisu nieutrzymany (puszczenie po 5 s) → brak progresji mimo kompletu serii', () => {
    const d = engine.evaluate('hang', [done(hangSession('2026-03-09', p)), done(hangSession('2026-03-16', p, { holdTimes: [7, 7, 7, 5] }))], p);
    expect(d.action).toBe('hold');
    const c = engine.check('hang', hangSession('2026-03-16', p, { holdTimes: [7, 7, 7, 5] }));
    expect(c.conditions.find((x) => x.key === 'time')?.met).toBe(false);
  });

  it('dwie nieukończone sesje z rzędu → powrót o 1,25 kg', () => {
    const fail = (d: string) => hangSession(d, p, { setsDone: 3, holdTimes: [7, 7, 7] });
    const d = engine.evaluate('hang', [done(fail('2026-03-09')), done(fail('2026-03-16'))], p);
    expect(d.action).toBe('reduce');
    expect(d.params.hangboard.addedKg).toBe(6.25);
  });

  it('nieukończone przy RPE 9 z rozpadem techniki → mniejsza objętość, ciężar bez zmian', () => {
    const d = engine.evaluate('hang', [done(hangSession('2026-03-16', p, { setsDone: 3, rpe: 9.5, techniqueOk: false }))], p);
    expect(d.action).toBe('reduce');
    expect(d.params.hangboard.sets).toBe(3);
    expect(d.params.hangboard.addedKg).toBe(7.5);
    expect(d.reason).toContain('zmniejszamy objętość. Wykryto podwyższone zmęczenie');
    // po powrocie do formy najpierw wracają serie, dopiero potem ciężar
    expect(engine.service('hang').progress(d.params, [])!.params.hangboard.sets).toBe(4);
  });

  it('mniejszy ciężar niż planowany → sesja nie liczy się do progresji', () => {
    const c = engine.check('hang', hangSession('2026-03-16', p, { addedKg: 5 }));
    expect(c.successful).toBe(false);
    expect(c.issues.join(' ')).toContain('+5 kg zamiast +7,5 kg');
  });
});

describe('Max Hangs – ból palców', () => {
  const p = hangParams(7.5);

  it('ból podczas zwisów → koniec ciężkich zwisów, brak progresji, regeneracja', () => {
    const d = engine.evaluate('hang', [done(hangSession('2026-03-09', p)), done(hangSession('2026-03-16', p, { pain: true, setsDone: 2 }))], p);
    expect(d.action).toBe('hold');
    expect(d.recovery).toBe(true);
    expect(d.params).toEqual(p);
    expect(d.reason).toContain('Kończymy ciężkie zwisy – brak progresji');
  });

  it('ból mimo kompletnej, lekkiej sesji nadal blokuje progresję', () => {
    const d = engine.evaluate('hang', [done(hangSession('2026-03-09', p)), done(hangSession('2026-03-16', p, { pain: true, rpe: 6 }))], p);
    expect(d.action).toBe('hold');
    expect(d.recovery).toBe(true);
  });

  it('po bólu kolejne zwisy wymagają oceny gotowości bez bólu', () => {
    const h = [done(hangSession('2026-03-16', p, { pain: true }))];
    const r = (date: string, fingerPain: boolean): ReadinessCheck => ({
      id: date, date, timestamp: '', wellbeing: 4, fatigue: 2, sleep: 4, fingerPain, elbowShoulderPain: false, unusualFatigue: false, notes: '',
    });
    expect(engine.hangboard.requiresReadiness(h, [])).toBe(true);
    expect(engine.hangboard.requiresReadiness(h, [r('2026-03-18', true)])).toBe(true);
    expect(engine.hangboard.requiresReadiness(h, [r('2026-03-19', false)])).toBe(false);
  });

  it('seria udanych sesji liczy się od nowa po bólu', () => {
    const d = engine.evaluate('hang', [done(hangSession('2026-03-09', p)), done(hangSession('2026-03-16', p, { pain: true })), done(hangSession('2026-03-23', p))], p);
    expect(d.action).toBe('hold');
    expect(d.reason).toContain('1 z 2');
  });
});

describe('Opuszczona sesja i powrót po przerwie', () => {
  const p = hangParams(7.5);

  it('opuszczona sesja → utrzymanie, bez nadrabiania; seria przerwana', () => {
    const d = engine.evaluate('hang', [done(hangSession('2026-03-09', p)), skip('2026-03-16')], p);
    expect(d.action).toBe('hold');
    expect(d.params).toEqual(p);
    expect(d.reason).toContain('nie nadrabiamy');
    const after = engine.evaluate('hang', [done(hangSession('2026-03-09', p)), skip('2026-03-16'), done(hangSession('2026-03-23', p))], p);
    expect(after.action).toBe('hold');
    expect(after.reason).toContain('przerwana przez pominiętą jednostkę');
  });

  it('dwie opuszczone sesje z rzędu → powrót z mniejszym ciężarem (−2,5 kg)', () => {
    const d = engine.evaluate('hang', [done(hangSession('2026-03-09', p)), skip('2026-03-16'), skip('2026-03-23')], p);
    expect(d.action).toBe('reduce');
    expect(d.params.hangboard.addedKg).toBe(5);
    expect(d.params.hangboard.sets).toBe(4);
    expect(d.reason).toContain('mniejszym ciężarem');
  });

  it('powrót po ≥ 21 dniach przerwy: udana sesja tylko potwierdza poziom', () => {
    const d = engine.evaluate('hang', [done(hangSession('2026-03-02', p)), done(hangSession('2026-03-30', p))], p);
    expect(d.action).toBe('hold');
    expect(d.reason).toContain('dniach przerwy');
  });

  it('drogi tlenowe: dwie opuszczone → mniej dróg, trudność bez zmian', () => {
    const d = engine.evaluate('aerobic', [done(workout('B', '2026-03-09')), skip('2026-03-16'), skip('2026-03-23')], P0);
    expect(d.action).toBe('reduce');
    expect(d.params.aerobic.routes).toBe(3);
    expect(d.params.aerobic.grade).toBe(P0.aerobic.grade);
  });
});

describe('Deload', () => {
  it('tydzień deload: objętość −40–50%, obciążenie bez zmian', () => {
    const p = hangParams(8.75);
    p.aerobic.routes = 5;
    p.powerEndurance.sets = 3;
    const d = deloadParams(p);
    expect(d.hangboard.sets).toBe(2);
    expect(d.hangboard.addedKg).toBe(8.75);
    expect(d.aerobic.routes).toBe(3);
    expect(d.powerEndurance.sets).toBe(2);
    expect(d.hardRoutes.maxAttempts).toBe(3);
    expect(engine.deload(p)).toEqual(d);
  });

  it('sesja deload nie wpływa na progresję – pierwsza sesja po deloadzie potwierdza poziom', () => {
    const p = hangParams(7.5);
    const dl = hangSession('2026-03-23', { ...p, hangboard: { ...p.hangboard, sets: 2 } }, {}, { deload: true });
    const d = engine.evaluate('hang', [done(hangSession('2026-03-16', p)), done(dl), done(hangSession('2026-03-30', p))], p);
    expect(d.action).toBe('hold');
    expect(d.reason).toContain('pierwsza sesja po deloadzie');
  });

  it('po deloadzie wznowienie od ostatniego dobrze tolerowanego ciężaru, nie automatyczne +kg', () => {
    const p1 = hangParams(7.5);
    const p2 = hangParams(8.75); // progresja tuż przed deloadem – jeszcze niewykonana
    const dl = hangSession('2026-03-23', { ...p2, hangboard: { ...p2.hangboard, sets: 2 } }, {}, { deload: true });
    const hist = [done(hangSession('2026-03-09', p1)), done(hangSession('2026-03-16', p1)), done(dl)];
    const d = engine.afterDeload('hang', hist, p2)!;
    expect(d.action).toBe('reduce');
    expect(d.params.hangboard.addedKg).toBe(7.5);
    expect(d.reason).toContain('ostatniego dobrze tolerowanego obciążenia');
    // ciężar już tolerowany → bez zmian
    expect(engine.afterDeload('hang', hist, p1)).toBeNull();
  });
});

describe('Samopoczucie następnego dnia', () => {
  const p = hangParams(7.5);

  it('ból palców następnego dnia po sesji, która dała progresję → cofnięcie progresji i regeneracja', () => {
    const w = hangSession('2026-03-16', p, {}, { followUp: { date: '2026-03-17', feeling: 3, fingerPain: true, notes: '', at: '' } });
    const progressed = hangParams(8.75);
    const d = engine.onFollowUp('hang', w, progressed, true)!;
    expect(d.action).toBe('reduce');
    expect(d.params.hangboard.addedKg).toBe(7.5);
    expect(d.recovery).toBe(true);
    expect(d.reason).toContain('Cofamy ostatnią progresję');
  });

  it('dobre samopoczucie → brak zmian', () => {
    const w = hangSession('2026-03-16', p, {}, { followUp: { date: '2026-03-17', feeling: 4, fingerPain: false, notes: '', at: '' } });
    expect(engine.onFollowUp('hang', w, p, true)).toBeNull();
  });

  it('złe samopoczucie następnego dnia przerywa serię udanych sesji', () => {
    const bad = hangSession('2026-03-16', p, {}, { followUp: { date: '2026-03-17', feeling: 2, fingerPain: false, notes: '', at: '' } });
    const d = engine.evaluate('hang', [done(hangSession('2026-03-09', p)), done(bad)], p);
    expect(d.action).toBe('hold');
    expect(d.reason).toContain('Słaba regeneracja');
  });
});

/* ================= DROGI TLENOWE ================= */

describe('Aerobic Endurance', () => {
  const pumped = (date: string) => {
    const w = workout('B', date);
    w.routes.forEach((r) => (r.pump = 5));
    return w;
  };

  it('pompowanie ponad 4/10 → nie zwiększamy obciążenia', () => {
    const d = engine.evaluate('aerobic', [done(workout('B', '2026-03-09')), done(pumped('2026-03-16'))], P0);
    expect(d.action).toBe('hold');
    expect(d.reason).toContain('przekroczyło docelowe 4/10');
  });

  it('nigdy jednocześnie liczba dróg i trudność', () => {
    const d = engine.evaluate('aerobic', [done(workout('B', '2026-03-09')), done(workout('B', '2026-03-16'))], P0);
    expect(d.action).toBe('progress');
    expect(d.params.aerobic.routes).toBe(5);
    expect(d.params.aerobic.grade).toBe(P0.aerobic.grade);
  });
});

/* ================= WYTRZYMAŁOŚĆ SIŁOWA ================= */

describe('Power Endurance – indywidualna ścieżka', () => {
  const p = peParams('rope_2x3', '5c+', '6b');

  it('kontrolowane zmęczenie (RPE 7) → więcej objętości: 3 × 3 na 5c+', () => {
    const d = engine.evaluate('pe', [done(circuit('2026-03-04', p, { rpe: 7, pump: 6 })), done(circuit('2026-03-11', p, { rpe: 7, pump: 6 }))], p);
    expect(d.action).toBe('progress');
    expect(d.params.powerEndurance.sets).toBe(3);
    expect(d.params.powerEndurance.grade).toBe('5c+');
    expect(d.reason).toContain('najpierw więcej objętości');
  });

  it('obie sesje wyraźnie lekkie przy bardzo dobrej technice → trudność: 2 × 3 na 6a', () => {
    const easy = (date: string) => circuit(date, p, { rpe: 6, pump: 5, technique: 5 });
    const d = engine.evaluate('pe', [done(easy('2026-03-04')), done(easy('2026-03-11'))], p);
    expect(d.params.powerEndurance.sets).toBe(2);
    expect(d.params.powerEndurance.grade).toBe('6a');
    expect(d.reason).toContain('rezerwa intensywności');
  });

  it('górna granica 3 × 3 → propozycja zaawansowanych obwodów / 4 × 4, bez automatycznej zmiany', () => {
    const top = peParams('rope_3x3', '6b', '6b');
    top.powerEndurance.restBetweenSetsMin = 8;
    const d = engine.evaluate('pe', [done(circuit('2026-03-04', top)), done(circuit('2026-03-11', top))], top);
    expect(d.action).toBe('hold');
    expect(d.params).toEqual(top);
    expect(d.suggestion).toContain('4 × 4');
    expect(d.suggestion).toContain('nie obowiązkowy etap');
  });
});

/* ================= TRUDNE DROGI ================= */

describe('Hard Routes', () => {
  const p = structuredClone(P0); // 6b–6c, maks. 6 prób
  const session = (date: string, routes: ReturnType<typeof route>[]) => workout('A', date, p, { routes });

  it('czyste przejścia na 6c w dwóch kolejnych sesjach → zakres 6b+–6c+, liczba prób bez zmian', () => {
    const s = (d: string) => session(d, [route({ grade: '6b', completed: true }), route({ grade: '6c', completed: false, cruxSent: true }), route({ grade: '6c', completed: true })]);
    const d = engine.evaluate('hard', [done(s('2026-03-03')), done(s('2026-03-10'))], p);
    expect(d.action).toBe('progress');
    expect(d.params.hardRoutes).toEqual({ gradeFrom: '6b+', gradeTo: '6c+', maxAttempts: 6 });
  });

  it('przejście z rozpadem techniki nie wystarcza do podniesienia trudności', () => {
    const s = (d: string) => session(d, [route({ grade: '6c', completed: true, techniqueDegraded: true })]);
    const d = engine.evaluate('hard', [done(s('2026-03-03')), done(s('2026-03-10'))], p);
    expect(d.action).toBe('hold');
    expect(d.reason).toContain('Liczba prób nie jest zwiększana automatycznie');
  });

  it('rozpoznaje poprawę konkretnej sekwencji na projekcie', () => {
    const s1 = session('2026-03-03', [route({ grade: '6c', project: 'Rysa', completed: false, cruxSent: false }), route({ grade: '6c', project: 'Rysa', completed: false, cruxSent: false })]);
    const s2 = session('2026-03-10', [route({ grade: '6c', project: 'Rysa', completed: false, cruxSent: true }), route({ grade: '6c', project: 'Rysa', completed: false, cruxSent: true })]);
    const ps = engine.hardRoutes.projects([s1, s2]);
    expect(ps[0].label).toBe('6c „Rysa”');
    expect(ps[0].note).toContain('poprawa sekwencji kluczowej');
    const d = engine.evaluate('hard', [done(s1), done(s2)], p);
    expect(d.reason).toContain('Rysa');
  });

  it('za dużo prób → sesja nie spełnia warunków', () => {
    const c = engine.check('hard', session('2026-03-03', Array.from({ length: 7 }, () => route({ grade: '6c', completed: true }))));
    expect(c.successful).toBe(false);
  });
});

/* ================= RETEST ================= */

describe('Retest Max Hang', () => {
  it('porównuje ciężar dodatkowy, całkowity, % masy ciała, czas i RPE', () => {
    const a = baseline({ mass: 70, fingerAddedKg: 21.25 });
    const b = baseline({ mass: 70, fingerAddedKg: 25 });
    const cmp = engine.hangboard.compareMaxHang(a, b)!;
    const row = (l: string) => cmp.rows.find((r) => r.label === l)!;
    expect(row('Ciężar dodatkowy')).toMatchObject({ before: 21.25, after: 25, delta: 3.75 });
    expect(row('Ciężar całkowity')).toMatchObject({ before: 91.25, after: 95 });
    expect(row('Stosunek do masy ciała').after).toBeGreaterThan(row('Stosunek do masy ciała').before!);
    expect(cmp.rows.map((r) => r.label)).toEqual(['Ciężar dodatkowy', 'Ciężar całkowity', 'Stosunek do masy ciała', 'Czas utrzymania', 'RPE']);
    expect(cmp.conditionIssues).toEqual([]);
  });
});

/* ================= WIDOK ================= */

describe('Training Load Progression – model widoku', () => {
  it('pokazuje aktualne / następne obciążenie, udane sesje, warunki i status', () => {
    const p = hangParams(7.5);
    const v = engine.trackView('hang', [done(hangSession('2026-03-09', p))], p, []);
    expect(v.title).toBe('MAX HANG / 20 MM');
    expect(v.current).toBe('+7,5 kg');
    expect(v.next).toBe('+8,75 kg');
    expect(v.successful).toBe(1);
    expect(v.lastLines.find((l) => l.label === 'Wykonane')?.value).toBe('4/4 serii');
    expect(v.lastLines.find((l) => l.label === 'Technika')?.value).toBe('PRAWIDŁOWA');
    expect(v.status).toBe('Jeszcze jedna udana sesja przed progresją.');
    expect(v.conditions.every((c) => c.met !== false)).toBe(true);
  });

  it('historia zmian obciążenia z uzasadnieniem (zdarzenia toru)', () => {
    const p = hangParams(8.75);
    const v = engine.trackView('hang', [], p, [
      { id: 'e1', cycleId: 'c1', timestamp: '2026-03-16T10:00:00Z', kind: 'progress', track: 'hang', parameter: 'Obciążenie zwisów', from: '+7,5 kg', to: '+8,75 kg', reason: 'x', sourceIds: [] },
      { id: 'e2', cycleId: 'c1', timestamp: '2026-03-16T10:00:00Z', kind: 'progress', track: 'aerobic', parameter: 'Liczba dróg tlenowych', from: '4', to: '5', reason: 'y', sourceIds: [] },
    ]);
    expect(v.changes.map((c) => c.id)).toEqual(['e1']);
    expect(v.previous).toBe('+7,5 kg');
  });
});
