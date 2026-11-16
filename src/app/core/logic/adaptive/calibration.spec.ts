import { describe, expect, it } from 'vitest';
import { applyCalibrationRun, candidateTest, evaluateCalibration, initialCalibration, levelForGrade, MAX_CALIBRATION_RUNS, resolveIntake, retestTooEasy } from './calibration';
import { climbingTest, intake, TrialSpec } from '../testing/adaptive-fixtures';
import { CalibrationRun } from '../../models/models';

const all = (s: TrialSpec): TrialSpec[] => Array(4).fill(s);
const run = (grade: string, outcome: CalibrationRun['outcome']): CalibrationRun => ({ date: '2026-03-04', grade, outcome, reasons: [], plannedId: null });

describe('Kandydacka trudność testu – nie tylko 6a', () => {
  it.each([
    ['5c', '5c', 'foundation'],
    ['6a', '6a', 'intermediate'],
    ['6b', '6b', 'intermediate_plus'],
    ['6c', '6c', 'advanced'],
    ['7a', '7a', 'performance'],
  ])('powtarzalna %s → test 4 × %s (%s)', (rep, grade, level) => {
    const c = candidateTest(intake({ rpGrade: '8a', osGrade: '7c', repeatableGrade: rep }));
    expect(c.grade).toBe(grade);
    expect(c.level).toBe(level);
    expect(c.reasons.join(' ')).toContain('To propozycja startowa');
  });

  it('nie przypisuje testu wyłącznie z RP – ograniczenie przez OS/flash', () => {
    const c = candidateTest(intake({ rpGrade: '7a', osGrade: '6b', repeatableGrade: '6c' }));
    expect(c.grade).toBe('6b');
    expect(c.reasons.join(' ')).toContain('nie trudniej niż OS/flash');
  });

  it('sam RP (bez wywiadu) → 3 stopnie niżej, z zastrzeżeniem kalibracji', () => {
    const c = candidateTest(resolveIntake({ grade: '6c' }));
    expect(c.grade).toBe('6a+');
    expect(c.reasons[0]).toContain('Podano tylko RP');
  });

  it('powtarzalna trudność nie może przekroczyć RP − 1', () => {
    expect(candidateTest(intake({ rpGrade: '6b', osGrade: null, repeatableGrade: '6b' })).grade).toBe('6a+');
  });

  it('poziomy kalibracyjne obejmują początkujących i bardzo zaawansowanych', () => {
    expect(levelForGrade('5a')).toBe('foundation');
    expect(levelForGrade('7c')).toBe('performance');
  });
});

describe('Kalibracja po sesji testu dróg', () => {
  it('wszystko bardzo łatwe (RPE ≤ 5, pompowanie ≤ 4) → podnieś trudność w kolejnej sesji', () => {
    const v = evaluateCalibration(climbingTest('6a', all({ done: true, rpe: 4, pump: 3 })));
    expect(v.outcome).toBe('raise');
    expect(v.reasons.join(' ')).toContain('W kolejnej sesji podnosimy');
  });

  it('nieukończone próby przy rozpadzie techniki → obniż trudność', () => {
    const v = evaluateCalibration(climbingTest('6b', [
      { done: true, rpe: 8, pump: 7 }, { done: false, rpe: 10, pump: 9, degraded: true }, { done: false, rpe: 10, pump: 10, degraded: true }, { done: false, rpe: 10, pump: 10 },
    ]));
    expect(v.outcome).toBe('lower');
    expect(v.reasons.join(' ')).toContain('bezpiecznej techniki');
  });

  it('ostatnia próba RPE 7–8 przy ukończeniu wszystkich → potwierdzona', () => {
    const v = evaluateCalibration(climbingTest('6a', [{ done: true, rpe: 5, pump: 3 }, { done: true, rpe: 6, pump: 5 }, { done: true, rpe: 7, pump: 6 }, { done: true, rpe: 8, pump: 7 }]));
    expect(v.outcome).toBe('confirmed');
  });

  it('wynik mieszany → utrzymaj trudność i zbierz dane', () => {
    const v = evaluateCalibration(climbingTest('6a', [{ done: true, rpe: 6, pump: 5 }, { done: true, rpe: 8, pump: 7 }, { done: true, rpe: 9, pump: 8 }, { done: false, rpe: 10, pump: 9 }]));
    expect(v.outcome).toBe('hold');
    expect(v.reasons.join(' ')).toContain('zbieramy dodatkowe dane');
  });

  it('Baseline oczekujący: podniesienie → kolejna sesja na wyższej trudności (jedna trudność na sesję)', () => {
    const s = applyCalibrationRun(initialCalibration(candidateTest(intake({ repeatableGrade: '6a' }))), run('6a', 'raise'));
    expect(s.status).toBe('pending');
    expect(s.grade).toBe('6a+');
    expect(s.runs).toHaveLength(1);
  });

  it('sesja ponad limit zawsze kończy kalibrację na wykonanej trudności', () => {
    let s = initialCalibration(candidateTest(intake({ repeatableGrade: '6a' })));
    for (const r of [run('6a', 'raise'), run('6a+', 'lower'), run('6a', 'lower'), run('6a', 'lower')]) s = applyCalibrationRun(s, r);
    expect(s.status).toBe('confirmed');
    expect(s.grade).toBe('6a');
  });

  it('dwa razy wynik mieszany na tej samej trudności → wystarczająco danych, potwierdzona', () => {
    let s = initialCalibration(candidateTest(intake({ repeatableGrade: '6a' })));
    s = applyCalibrationRun(s, run('6a', 'hold'));
    expect(s.status).toBe('pending');
    s = applyCalibrationRun(s, run('6a', 'hold'));
    expect(s.status).toBe('confirmed');
    expect(s.grade).toBe('6a');
  });

  it(`po ${MAX_CALIBRATION_RUNS} sesjach przyjmuje najtrudniejszą trudność bez konieczności obniżenia`, () => {
    let s = initialCalibration(candidateTest(intake({ repeatableGrade: '6a' })));
    s = applyCalibrationRun(s, run('6a', 'raise'));
    s = applyCalibrationRun(s, run('6a+', 'lower'));
    s = applyCalibrationRun(s, run('6a', 'raise'));
    expect(s.status).toBe('confirmed');
    expect(s.grade).toBe('6a');
  });
});

describe('Retest – test bazowy bez zmian', () => {
  it('zbyt łatwy retest → osobny benchmark wyżej, oryginał zostaje', () => {
    const r = retestTooEasy(climbingTest('6a', all({ done: true, rpe: 4, pump: 3 })));
    expect(r.tooEasy).toBe(true);
    expect(r.suggestedGrade).toBe('6a+');
    expect(r.reason).toContain('Zostaje bez zmian dla porównań');
  });

  it('retest w docelowym zakresie → bez dodatkowego benchmarku', () => {
    expect(retestTooEasy(climbingTest('6a', [{ done: true, rpe: 6, pump: 5 }, { done: true, rpe: 7, pump: 6 }, { done: true, rpe: 7, pump: 6 }, { done: true, rpe: 8, pump: 7 }])).tooEasy).toBe(false);
  });
});
