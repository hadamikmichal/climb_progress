import { describe, expect, it } from 'vitest';
import { evaluateProgression, HistoryEntry, levelKey } from '../progression';
import { P0, hang, workout } from '../testing/fixtures';
import { baseline, circuit, climbingTest, intake, peParams } from '../testing/adaptive-fixtures';
import { assessAbilities } from './abilities';
import { prescribe, selectPeProtocol } from './prescription';
import { protocolOf } from './protocols';
import { gradeIndex } from '../grades';
import { ClimberIntake, CompletedWorkout, TrainingParams } from '../../models/models';
import { Assessment } from '../../models/assessment';

/**
 * Wymagane scenariusze Adaptive Training Engine v2.
 * Każdy test sprawdza nie tylko wygenerowany trening, ale też uzasadnienie decyzji.
 */

const done = (w: CompletedWorkout): HistoryEntry => ({ kind: 'completed', date: w.date, workout: w });
const skip = (date: string, id = `s-${date}`): HistoryEntry => ({ kind: 'skipped', date, id });

function plan(a: Assessment | null, i: ClimberIntake, ws: CompletedWorkout[] = [], testGrade: string | null = null) {
  const profiles = assessAbilities({ intake: i, assessment: a, workouts: ws });
  return prescribe({ profiles, intake: i, assessment: a, testGrade, prev: structuredClone(P0), recentWorkouts: ws, returningAfterBreak: false, ts: '2026-03-05T10:00:00Z' });
}

/** Wszystkie parametry poza wskazanym polem obwodu są identyczne */
function onlyChanged(a: TrainingParams, b: TrainingParams, field: keyof TrainingParams['powerEndurance']) {
  const strip = (p: TrainingParams) => ({ ...p, powerEndurance: { ...p.powerEndurance, [field]: null, protocol: null } });
  expect(strip(b)).toEqual(strip(a));
}

describe('Scenariusz 1: 3 × 3 na 5c – wymaga progresji', () => {
  const p = peParams('rope_3x3', '5c', '6a');
  const hist = [done(circuit('2026-01-03', p, { rpe: 7, pump: 6 })), done(circuit('2026-01-10', p, { rpe: 7, pump: 6 }))];
  const d = evaluateProgression('pe', hist, p);

  it('zwiększa wyłącznie trudność 5c → 5c+ (bez skoku do 4 × 4)', () => {
    expect(d.action).toBe('progress');
    expect(d.params.powerEndurance.grade).toBe('5c+');
    expect(d.params.powerEndurance.sets).toBe(3);
    expect(d.params.powerEndurance.routesPerSet).toBe(3);
    expect(protocolOf(d.params.powerEndurance)).toBe('rope_3x3');
    onlyChanged(p, d.params, 'grade');
  });

  it('uzasadnienie: dwie dobre sesje, jeden parametr, kolejny krok', () => {
    expect(d.reason).toContain('dwie kolejne dobre sesje');
    expect(d.reason).toContain('5c → 5c+');
    expect(d.reason).toContain('Pozostałe parametry bez zmian');
    expect(d.blockers).toEqual([]);
    expect(d.nextStep).toContain('Aby przejść dalej');
    expect(d.nextStep).toContain('5c+ → 6a');
  });

  it('samo zaliczenie treningu nie wystarcza – jedna dobra sesja to utrzymanie', () => {
    const one = evaluateProgression('pe', hist.slice(0, 1), p);
    expect(one.action).toBe('hold');
    expect(one.reason).toContain('1 z 2 wymaganych');
  });
});

describe('Scenariusz 2: 3 × 3 na 6b z wysokim RPE', () => {
  const p = peParams('rope_3x3', '6b', '6c');

  it('ukończone przy RPE 9 → brak progresji, z wyjaśnieniem dlaczego', () => {
    const d = evaluateProgression('pe', [done(circuit('2026-01-03', p)), done(circuit('2026-01-10', p, { rpe: 9, pump: 8 }))], p);
    expect(d.action).toBe('hold');
    expect(d.params).toEqual(p);
    expect(d.reason).toContain('RPE 9 > 8');
    expect(d.blockers.join(' ')).toContain('RPE 9 > 8');
  });

  it('nieukończone przy RPE 9 i zachowanej technice → mniejsza objętość, trudność bez zmian', () => {
    const d = evaluateProgression('pe', [done(circuit('2026-01-10', p, { rpe: 9, pump: 9, completedRoutes: 6 }))], p);
    expect(d.action).toBe('reduce');
    expect(d.params.powerEndurance.sets).toBe(2);
    expect(d.params.powerEndurance.grade).toBe('6b');
    expect(protocolOf(d.params.powerEndurance)).toBe('rope_2x3');
    expect(d.reason).toContain('zmęczenie przy zachowanej technice');
  });

  it('nieukończone z rozpadem techniki → niższa trudność, objętość bez zmian', () => {
    const d = evaluateProgression('pe', [done(circuit('2026-01-10', p, { rpe: 9, pump: 9, completedRoutes: 6, technique: 2 }))], p);
    expect(d.action).toBe('reduce');
    expect(d.params.powerEndurance.grade).toBe('6a+');
    expect(d.params.powerEndurance.sets).toBe(3);
    expect(d.reason).toContain('rozpad techniki');
  });
});

describe('Scenariusz 3: 3 × 3 na 6c bez nadmiernego zmęczenia', () => {
  const p = peParams('rope_3x3', '6c', '7a');
  const d = evaluateProgression('pe', [done(circuit('2026-01-03', p, { rpe: 6, pump: 5 })), done(circuit('2026-01-10', p, { rpe: 6, pump: 5 }))], p);

  it('progresja trudności powyżej dawnego limitu 6a+ (6c → 6c+)', () => {
    expect(d.action).toBe('progress');
    expect(d.params.powerEndurance.grade).toBe('6c+');
    expect(d.params.powerEndurance.sets).toBe(3);
    expect(d.reason).toContain('6c → 6c+');
  });

  it('na górnej granicy z profilu – utrzymanie z wyjaśnieniem zamiast dalszego zwiększania', () => {
    const top = peParams('rope_3x3', '7a', '7a');
    const t = evaluateProgression('pe', [done(circuit('2026-01-03', top, { rpe: 6, pump: 5 })), done(circuit('2026-01-10', top, { rpe: 6, pump: 5 }))], top);
    expect(t.action).toBe('progress');
    expect(t.parameter).toBe('Przerwa między seriami');
    expect(t.params.powerEndurance.grade).toBe('7a');
  });
});

describe('Scenariusz 4: wysoka siła palców, słaba wytrzymałość', () => {
  const a = baseline({
    mass: 70, fingerAddedKg: 35,
    climbing: climbingTest('6b', [{ done: true, rpe: 7, pump: 5 }, { done: true, rpe: 8, pump: 7 }, { done: false, rpe: 10, pump: 9 }, { done: false, rpe: 10, pump: 9 }]),
  });
  const i = intake({ rpGrade: '6c', repeatableGrade: '6b' });
  const { report, params } = plan(a, i);

  it('profile niezależne: palce zaawansowane, wytrzymałość siłowa słabsza', () => {
    expect(report.profiles.finger.status).toBe('advanced');
    expect(['underdeveloped', 'developing']).toContain(report.profiles.powerEndurance.status);
    expect(report.strongest).toBe('finger');
    expect(report.mainLimitation).toBe('powerEndurance');
    expect(report.profiles.finger.evidence.join(' ')).toContain('150% masy ciała');
    expect(report.profiles.powerEndurance.evidence.join(' ')).toContain('ukończone 2/4');
  });

  it('priorytet: wytrzymałość siłowa, siła palców w dawce podtrzymującej', () => {
    expect(report.priority).toContain('Priorytetem jest wytrzymałość siłowa');
    expect(report.priority).toContain('Utrzymuj siłę palców');
    expect(params.hangboard.sets).toBe(3);
    expect(params.hangboard.addedKg).toBe(14); // 80% z 105 kg − 70 kg
    expect(report.reasons.join(' ')).toContain('dawce podtrzymującej');
  });

  it('nie dodaje Repeaters automatycznie mimo słabej wytrzymałości', () => {
    expect(params.hangboard.protocol).toBe('max_hangs');
    expect(report.fingerProtocol).toBe('max_hangs');
    expect(report.reasons.join(' ')).toContain('Repeaters nie są dodawane automatycznie');
  });

  it('protokół wytrzymałości siłowej dobrany do ograniczenia', () => {
    expect(['rope_2x3', 'rope_3x3']).toContain(report.recommendedProtocol);
    expect(params.powerEndurance.grade).toBe('6a+');
  });
});

describe('Scenariusz 5: słaba siła palców, dobra wytrzymałość', () => {
  const a = baseline({
    mass: 70, fingerAssistKg: 7,
    climbing: climbingTest('6a+', [{ done: true, rpe: 5, pump: 3 }, { done: true, rpe: 6, pump: 4 }, { done: true, rpe: 7, pump: 5 }, { done: true, rpe: 7, pump: 5 }], [5, 2, 1, 0]),
  });
  const i = intake({ rpGrade: '6c', repeatableGrade: '6a+' });
  const { report, params } = plan(a, i, [], '6a+');

  it('palce są głównym ograniczeniem, wytrzymałość mocną stroną', () => {
    expect(report.profiles.finger.status).toBe('underdeveloped');
    expect(['established', 'advanced']).toContain(report.profiles.powerEndurance.status);
    expect(report.mainLimitation).toBe('finger');
    expect(report.priority).toBe('Priorytetem jest progres siły palców.');
  });

  it('Max Hangs z odciążeniem: 4 serie, 85% własnego maksimum', () => {
    expect(params.hangboard.sets).toBe(4);
    expect(params.hangboard.assistKg).toBe(16); // 85% z 63 kg ≈ 53,6 kg → 70 − 16
    expect(params.hangboard.addedKg).toBe(0);
    expect(report.reasons.join(' ')).toContain('85%');
    expect(report.reasons.join(' ')).toContain('główne ograniczenie');
  });
});

describe('Scenariusz 6: użytkownik nie wykonuje treningu', () => {
  const p = peParams('rope_3x3', '6a', '6b');

  it('jedna pominięta jednostka → utrzymanie, bez nadrabiania', () => {
    const d = evaluateProgression('pe', [done(circuit('2026-01-03', p)), skip('2026-01-10')], p);
    expect(d.action).toBe('hold');
    expect(d.params).toEqual(p);
    expect(d.reason).toContain('nie nadrabiamy');
  });

  it('kilka pominiętych z rzędu → powrót z mniejszą objętością, trudność bez zmian', () => {
    const d = evaluateProgression('pe', [done(circuit('2026-01-03', p)), skip('2026-01-10'), skip('2026-01-17')], p);
    expect(d.action).toBe('reduce');
    expect(d.params.powerEndurance.sets).toBe(2);
    expect(d.params.powerEndurance.grade).toBe('6a');
    expect(d.reason).toContain('2 kolejne jednostki pominięte');
    expect(d.reason).toContain('mniejszą objętością');
  });

  it('dobra sesja po długiej przerwie tylko potwierdza poziom', () => {
    const d = evaluateProgression('pe', [done(circuit('2026-01-03', p)), done(circuit('2026-02-10', p))], p);
    expect(d.action).toBe('hold');
    expect(d.reason).toContain('dniach przerwy');
  });

  it('dobór protokołu przy powrocie: Rope 2 × 3', () => {
    const a = baseline({ mass: 70, fingerAddedKg: 10, climbing: climbingTest('6a', Array(4).fill({ done: true, rpe: 7, pump: 6 })) });
    const i = intake();
    const profiles = assessAbilities({ intake: i, assessment: a, workouts: [] });
    const c = selectPeProtocol(profiles, { intake: i, stableCircuitSessions: 0, returningAfterBreak: true });
    expect(c.protocol).toBe('rope_2x3');
    expect(c.reasons[0]).toContain('Powrót po przerwie');
  });
});

describe('Scenariusz 7: ból palców', () => {
  it('ból podczas zwisów → mniejsze obciążenie (nie liczba serii) i wyjaśnienie', () => {
    const p = structuredClone(P0);
    p.hangboard.addedKg = 4;
    const w = workout('B', '2026-01-05', p);
    w.hangs = [hang({ setsPlanned: 3, setsDone: 3, addedKg: 4, pain: true })];
    const d = evaluateProgression('hang', [done(w)], p);
    expect(d.action).toBe('reduce');
    expect(d.params.hangboard.addedKg).toBe(2);
    expect(d.params.hangboard.sets).toBe(p.hangboard.sets);
    expect(d.reason).toContain('ból');
    expect(d.reason).toContain('zmniejszamy obciążenie');
  });

  it('ból zgłoszony w ocenie gotowości blokuje progresję mimo dobrych sesji', () => {
    const p = peParams('rope_3x3', '6a', '6b');
    const d = evaluateProgression('pe', [done(circuit('2026-01-03', p)), done(circuit('2026-01-10', p))], p, {
      recovery: { ok: false, reason: 'zgłoszony ból palców' },
    });
    expect(d.action).toBe('hold');
    expect(d.params).toEqual(p);
    expect(d.reason).toContain('brak odpowiedniej regeneracji');
    expect(d.blockers.join(' ')).toContain('ból palców');
  });

  it('historia bólu obniża intensywność startową zwisów w nowym planie', () => {
    const a = baseline({ mass: 70, fingerAddedKg: 20 });
    const w = workout('B', '2026-02-20', P0);
    w.hangs = [hang({ pain: true })];
    const { params, report } = plan(a, intake(), [w]);
    // 75% z 90 kg = 67,5 kg → 2 kg odciążenia (zamiast 80% przy braku bólu: 72 kg → +2 kg)
    expect(params.hangboard.addedKg).toBe(0);
    expect(params.hangboard.assistKg).toBe(2);
    expect(report.reasons.join(' ')).toContain('z bólem');
  });
});

describe('Scenariusz 8: powrót po deloadzie', () => {
  const p = peParams('rope_3x3', '6a', '6b');
  const before = done(circuit('2026-01-03', p));
  const deload = done(circuit('2026-01-24', p, { deload: true }));

  it('pierwsza dobra sesja po deloadzie potwierdza poziom (bez progresji)', () => {
    const d = evaluateProgression('pe', [before, deload, done(circuit('2026-01-31', p))], p);
    expect(d.action).toBe('hold');
    expect(d.params).toEqual(p);
    expect(d.reason).toContain('pierwsza sesja po deloadzie');
    expect(d.blockers.join(' ')).toContain('po deloadzie');
  });

  it('druga dobra sesja po deloadzie → progresja jednego parametru', () => {
    const d = evaluateProgression('pe', [before, deload, done(circuit('2026-01-31', p)), done(circuit('2026-02-07', p))], p);
    expect(d.action).toBe('progress');
    expect(d.params.powerEndurance.grade).toBe('6a+');
    expect(levelKey('pe', d.params)).not.toBe(levelKey('pe', p));
  });
});

describe('Scenariusz 9: poziom zaawansowany – odpowiednio trudniejszy plan', () => {
  const a = baseline({
    mass: 65, fingerAddedKg: 35,
    climbing: climbingTest('7a', [{ done: true, rpe: 6, pump: 4 }, { done: true, rpe: 6, pump: 5 }, { done: true, rpe: 7, pump: 5 }, { done: true, rpe: 7, pump: 6 }], [4, 2, 1, 0]),
  });
  const p3 = peParams('rope_3x3', '6c+', '7a+');
  const history = [circuit('2026-02-14', p3, { rpe: 6, pump: 6 }), circuit('2026-02-21', p3, { rpe: 7, pump: 6 })];
  const i = intake({ rpGrade: '7b+', osGrade: '7a+', repeatableGrade: '7a', routesPerSession: 14 });
  const { report, params } = plan(a, i, history, '7a');

  it('wybiera bardziej wymagający bodziec – nie automatyczne 4 × 4', () => {
    expect(report.profiles.finger.status).toBe('advanced');
    expect(report.recommendedProtocol).toBe('linked_routes');
    expect(report.recommendedProtocol).not.toBe('rope_4x4');
    expect(report.reasons.join(' ')).toContain('stabilne sesje 3 × 3');
    expect(report.reasons.join(' ')).toContain('zamiast automatycznego 4 × 4');
  });

  it('trudność wynika z pomiarów (7a) – wyraźnie wyżej niż u początkującego', () => {
    expect(params.powerEndurance.grade).toBe('6c+');
    expect(params.powerEndurance.gradeCap).toBe('7a+');
    const beginner = plan(baseline({ mass: 70, fingerAssistKg: 10, climbing: climbingTest('5c', Array(4).fill({ done: true, rpe: 7, pump: 6 })) }), intake({ rpGrade: '6a', osGrade: '5c+', repeatableGrade: '5c' }), [], '5c');
    expect(gradeIndex(params.powerEndurance.grade)).toBeGreaterThan(gradeIndex(beginner.params.powerEndurance.grade) + 4);
    expect(gradeIndex(params.aerobic.grade)).toBeGreaterThan(gradeIndex(beginner.params.aerobic.grade) + 4);
  });

  it('nie zwiększa liczby treningów w tygodniu', () => {
    expect(report.reasons.join(' ')).toContain('Liczba treningów w tygodniu bez zmian (3 jednostki)');
  });

  it('styl boulderowy z deklarowanym poziomem → Boulder 4 × 4 w skali Font', () => {
    const b = plan(a, { ...i, style: 'bouldery', boulderGrade: '7B' }, history, '7a');
    expect(b.report.recommendedProtocol).toBe('boulder_4x4');
    expect(b.params.powerEndurance.grade).toBe('6C');
  });
});
