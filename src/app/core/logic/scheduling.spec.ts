import { decideMissed, proposeReschedule, slotViolations } from './scheduling';
import { plannedItem } from './testing/fixtures';
import { generateCyclePlan, createCycle, validateTrainingDays, deloadParams, cycleWeek, suggestPlanStart, baselinePlanned, migrateLegacyPlanned } from './plan';
import { defaultProfile } from './templates';
import { P0 } from './testing/fixtures';
import { weekdayOf, addDays } from './dates';
import { isHeavy } from './templates';

// Tydzień: pn 2026-01-05, śr 01-07, sob 01-10
const week = () => [plannedItem('A', '2026-01-05'), plannedItem('B', '2026-01-07'), plannedItem('C', '2026-01-10')];

describe('slotViolations', () => {
  it('blokuje dwie ciężkie jednostki dzień po dniu', () => {
    const items = week();
    const v = slotViolations(items, 'C', '2026-01-06');
    expect(v.some((m) => m.includes('Ciężka jednostka'))).toBe(true);
  });

  it('B (Max Hangs + tlenowa) jest ciężką jednostką – nie dzień po A', () => {
    const items = [plannedItem('A', '2026-01-05')];
    expect(slotViolations(items, 'B', '2026-01-06').some((m) => m.includes('Ciężka jednostka'))).toBe(true);
    expect(slotViolations(items, 'B', '2026-01-07')).toEqual([]);
  });

  it('nie pozwala na dwa treningi tego samego dnia', () => {
    expect(slotViolations(week(), 'B', '2026-01-05').length).toBeGreaterThan(0);
  });

  it('pominięte jednostki nie zajmują terminu', () => {
    const items = [plannedItem('A', '2026-01-05', { status: 'skipped' })];
    expect(slotViolations(items, 'C', '2026-01-06')).toEqual([]);
  });

  it('limit 3 dni treningowych z rzędu', () => {
    const items = [plannedItem('B', '2026-01-05'), plannedItem('B', '2026-01-06'), plannedItem('B', '2026-01-07')];
    expect(slotViolations(items, 'B', '2026-01-08').some((m) => m.includes('z rzędu'))).toBe(true);
  });
});

describe('proposeReschedule / decideMissed', () => {
  it('brak czasu: przenosi C z soboty na niedzielę? nie – niedziela jest OK tylko bez ciężkiego w pn', () => {
    const items = week();
    const c = items[2];
    // pn następnego tygodnia nie jest w tym tygodniu, więc niedziela 01-11 jest dozwolona
    expect(proposeReschedule(items, c, '2026-01-10')).toBe('2026-01-11');
  });

  it('brak czasu na A w poniedziałek przy układzie pn/śr/sob → brak bezpiecznego terminu w tygodniu', () => {
    const items = week();
    const a = items[0];
    // wt 06 i czw 08 sąsiadują z ciężkim B (śr), pt 09 i nd 11 z C (sob)
    expect(proposeReschedule(items, a, '2026-01-05')).toBeNull();
  });

  it('brak czasu na A → termin z przerwą od ciężkich jednostek', () => {
    const items = [plannedItem('A', '2026-01-05'), plannedItem('B', '2026-01-08'), plannedItem('C', '2026-01-10')];
    // wt 06: sąsiaduje z pn (sam A – wykluczony) i śr (pusta) → OK
    expect(proposeReschedule(items, items[0], '2026-01-05')).toBe('2026-01-06');
  });

  it('nie proponuje terminu dzień przed/po ciężkiej jednostce', () => {
    const items = [plannedItem('A', '2026-01-05'), plannedItem('C', '2026-01-08'), plannedItem('B', '2026-01-10')];
    const a = items[0];
    // 06 ok? sąsiaduje z 05 (sam A – wykluczony) i 07 (pusty) → OK
    expect(proposeReschedule(items, a, '2026-01-05')).toBe('2026-01-06');
    // gdy 06 zajęty przez B (ciężki), 07 sąsiaduje z B i C → nie; 09 z C i B(10) → nie; 10 zajęty; 11 sąsiaduje z B(10) → nie
    items.push(plannedItem('B', '2026-01-06'));
    expect(proposeReschedule(items, a, '2026-01-05')).toBeNull();
  });

  it('brak bezpiecznego terminu → pominięcie z powodem no_slot', () => {
    const items = week();
    const c = items[2];
    items.push(plannedItem('B', '2026-01-11'));
    const d = decideMissed(items, c, 'time', '2026-01-10');
    expect(d.action).toBe('skip');
    if (d.action === 'skip') expect(d.reason).toBe('no_slot');
  });

  it('ból / choroba / zmęczenie → pominięcie bez nadrabiania', () => {
    const items = week();
    for (const r of ['pain', 'illness', 'fatigue'] as const) {
      const d = decideMissed(items, items[0], r, '2026-01-05');
      expect(d.action).toBe('skip');
    }
  });

  it('nie przenosi treningu do kolejnego tygodnia', () => {
    const items = week();
    const c = items[2];
    const p = proposeReschedule(items, c, '2026-01-12');
    expect(p).toBeNull();
  });

  it('zaległy trening może być przełożony na dziś', () => {
    const items = [plannedItem('A', '2026-01-05'), plannedItem('B', '2026-01-08'), plannedItem('C', '2026-01-10')];
    const a = items[0];
    // dzisiaj wtorek 06, A zaległy z poniedziałku
    expect(proposeReschedule(items, a, '2026-01-06')).toBe('2026-01-06');
  });
});

describe('plan', () => {
  const profile = defaultProfile('2026-01-01T00:00:00Z');
  const cycle = createCycle('Cykl 1', '2026-01-01', P0, '2026-01-01T00:00:00Z');

  it('generuje 6 tygodni × 3 jednostki + test kontrolny + test końcowy', () => {
    const plan = generateCyclePlan(cycle, profile, '2026-01-05', '');
    expect(plan.filter((p) => ['A', 'B', 'C'].includes(p.type)).length).toBe(18);
    expect(plan.filter((p) => p.type === 'CONTROL').length).toBe(1);
    // test końcowy = pełny Baseline Test: dzień siłowy + dzień dróg 2 dni później
    const fin = plan.filter((p) => p.type === 'FINAL');
    expect(fin.map((p) => p.part)).toEqual(['strength', 'climbing']);
    expect(addDays(fin[0].date, 2)).toBe(fin[1].date);
    expect(plan.find((p) => p.type === 'CONTROL')!.part).toBe('climbing');
    expect(plan.find((p) => p.type === 'CONTROL')!.week).toBe(4);
    expect(weekdayOf(plan.find((p) => p.type === 'A')!.date)).toBe(1);
  });

  it('wygenerowany plan nie ma ciężkich jednostek dzień po dniu', () => {
    const plan = generateCyclePlan(cycle, profile, '2026-01-05', '');
    const heavyDates = new Set(plan.filter((p) => isHeavy(p.type)).map((p) => p.date));
    for (const d of heavyDates) expect(heavyDates.has(addDays(d, 1))).toBe(false);
  });

  it('walidacja dni: A i C dzień po dniu jest niedozwolone (także nd → pn)', () => {
    expect(validateTrainingDays({ A: 1, B: 3, C: 6 })).toEqual([]);
    expect(validateTrainingDays({ A: 1, B: 3, C: 2 }).length).toBe(1);
    expect(validateTrainingDays({ A: 1, B: 3, C: 7 }).length).toBe(1);
  });

  it('deload zmniejsza objętość, nie trudność', () => {
    const d = deloadParams(P0);
    expect(d.hangboard.sets).toBe(2);
    expect(d.powerEndurance.sets).toBe(1);
    expect(d.aerobic.grade).toBe(P0.aerobic.grade);
    expect(d.hangboard.addedKg).toBe(P0.hangboard.addedKg);
  });

  it('tydzień cyklu liczony od planStart', () => {
    const c = { ...cycle, planStart: '2026-01-05' };
    expect(cycleWeek(c, '2026-01-04')).toBe(0);
    expect(cycleWeek(c, '2026-01-05')).toBe(1);
    expect(cycleWeek(c, '2026-01-26')).toBe(4);
    expect(cycleWeek(c, '2026-03-01')).toBe(7);
  });

  it('start planu po teście – co najmniej 1 dzień odpoczynku, zawsze poniedziałek', () => {
    expect(suggestPlanStart('2026-01-03')).toBe('2026-01-05'); // sobota → pn
    expect(suggestPlanStart('2026-01-04')).toBe('2026-01-12'); // niedziela → kolejny pn (dzień przerwy)
    expect(weekdayOf(suggestPlanStart('2026-01-07'))).toBe(1);
  });
});

describe('Baseline Test v1.0 – plan', () => {
  const cycle = createCycle('Cykl 1', '2026-01-05', P0, '2026-01-01T00:00:00Z');

  it('test początkowy = dwie sesje w odstępie 48 h', () => {
    const [s, c] = baselinePlanned(cycle, '');
    expect(s.part).toBe('strength');
    expect(c.part).toBe('climbing');
    expect(s.date).toBe('2026-01-05');
    expect(c.date).toBe('2026-01-07');
  });

  it('migracja: niezrealizowane testy w starym formacie → nowy protokół, zrealizowane bez zmian', () => {
    const items = [
      plannedItem('BASELINE', '2026-01-05'),
      plannedItem('CONTROL', '2026-02-04'),
      plannedItem('FINAL', '2026-02-23', { status: 'moved' }),
      plannedItem('BASELINE', '2025-11-01', { status: 'done' }),
    ];
    const m = migrateLegacyPlanned(items, 'ts');
    expect(m.length).toBe(5);
    expect(m.filter((p) => p.type === 'BASELINE').map((p) => [p.part, p.date])).toEqual([['strength', '2026-01-05'], ['climbing', '2026-01-07']]);
    expect(m.find((p) => p.type === 'CONTROL')!.part).toBe('climbing');
    expect(migrateLegacyPlanned(m, 'ts')).toEqual([]);
  });
});
