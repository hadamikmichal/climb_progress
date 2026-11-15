import { demoAssessments } from './assessment/demo';
import { evaluateReadiness } from './readiness';
import { ReadinessCheck, TestResult, AdaptationEvent } from '../models/models';
import { compareTests, generateWeeklyReport, summarizeTest } from './reports';
import { createCycle } from './plan';
import { P0, plannedItem, workout } from './testing/fixtures';
import { parseImport, buildExport } from '../data/backup';
import { hangSeries, regularityByWeek } from './stats';
import { hang } from './testing/fixtures';

const rc = (o: Partial<ReadinessCheck> = {}): ReadinessCheck => ({
  id: 'r', date: '2026-01-05', timestamp: '', wellbeing: 4, fatigue: 2, sleep: 4, fingerPain: false, elbowShoulderPain: false, unusualFatigue: false, notes: '', ...o,
});

describe('evaluateReadiness', () => {
  it('normalna gotowość → trening zgodnie z planem', () => {
    const a = evaluateReadiness(rc());
    expect(a.level).toBe('go');
    expect(a.allowHangboard).toBe(true);
  });
  it('ból palców → brak chwytotablicy i zalecany odpoczynek', () => {
    const a = evaluateReadiness(rc({ fingerPain: true }));
    expect(a.level).toBe('rest');
    expect(a.allowHangboard).toBe(false);
  });
  it('ból łokci/barków → brak chwytotablicy', () => {
    expect(evaluateReadiness(rc({ elbowShoulderPain: true })).allowHangboard).toBe(false);
  });
  it('nietypowe zmęczenie → odpoczynek', () => {
    expect(evaluateReadiness(rc({ unusualFatigue: true })).level).toBe('rest');
  });
  it('słaby sen / duże zmęczenie → lżejsza wersja', () => {
    const a = evaluateReadiness(rc({ sleep: 2 }));
    expect(a.level).toBe('easy');
    expect(a.allowHeavy).toBe(false);
  });
  it('nie diagnozuje – komunikaty nie zawierają nazw schorzeń', () => {
    const a = evaluateReadiness(rc({ fingerPain: true, elbowShoulderPain: true }));
    expect(a.messages.join(' ')).not.toMatch(/zapalenie|naderwanie|kontuzja/i);
  });
});

const test = (kind: 'BASELINE' | 'FINAL', pumps: number[], rpes: number[], completed = [true, true, true]): TestResult => ({
  id: kind, kind, cycleId: 'c1', plannedWorkoutId: null, date: '2026-01-01', createdAt: '', updatedAt: '', reserve: kind === 'BASELINE' ? 1 : 3, notes: '',
  routes: pumps.map((p, i) => ({ order: i + 1, grade: '6a', completed: completed[i], rpe: rpes[i], pump: p, techniqueDegraded: i === 2, notes: '' })),
});

describe('raport testu', () => {
  it('podsumowuje test bez sztucznej punktacji', () => {
    const s = summarizeTest(test('BASELINE', [5, 7, 9], [6, 8, 10], [true, true, false]));
    expect(s.completed).toBe(2);
    expect(s.maxPump).toBe(9);
    expect(s.avgRpe).toBe(8);
    expect(s.techniqueDegradedFrom).toBe(3);
  });
  it('porównuje testy bezpośrednio', () => {
    const { rows, lines } = compareTests(test('BASELINE', [5, 7, 9], [6, 8, 10]), test('FINAL', [4, 5, 6], [5, 6, 7]));
    expect(rows.find((r) => r.label === 'Maks. pompowanie')!.trend).toBe('better');
    expect(lines.join(' ')).toContain('9/10 → 6/10');
  });
});

describe('raport tygodniowy', () => {
  it('generuje komunikat na podstawie danych (wykonane, pompowanie vs poprzedni tydzień)', () => {
    const cycle = { ...createCycle('Cykl 1', '2026-01-01', P0, ''), id: 'c1', planStart: '2026-01-05' };
    const prevB = workout('B', '2026-01-07');
    prevB.routes.forEach((r) => (r.pump = 6));
    const b = workout('B', '2026-01-14');
    b.routes.forEach((r) => (r.pump = 4));
    const planned = [
      plannedItem('A', '2026-01-12', { status: 'done' }),
      plannedItem('B', '2026-01-14', { status: 'done' }),
      plannedItem('C', '2026-01-17', { status: 'done' }),
    ];
    const ev: AdaptationEvent = { id: 'e', cycleId: 'c1', timestamp: '2026-01-17T12:00:00Z', kind: 'hold', workoutType: 'C', reason: '', sourceIds: [] };
    const r = generateWeeklyReport({ cycle, week: 2, weekStart: '2026-01-12', planned, completed: [prevB, b, workout('C', '2026-01-17')], events: [ev], ts: '' });
    expect(r.done).toBe(3);
    expect(r.lines[0]).toContain('3 z 3');
    expect(r.lines.join(' ')).toContain('średnie pompowanie 4/10');
    expect(r.lines.join(' ')).toContain('W poprzednim tygodniu było to 6/10');
    expect(r.nextWeek.join(' ')).toContain('Utrzymujemy obecny poziom');
  });
});

describe('statystyki', () => {
  it('nie łączy wyników z różnych krawądek', () => {
    const s = hangSeries([hang({ edge: '20 mm', addedKg: 5 }), hang({ edge: '15 mm', assistKg: 5 }), hang({ edge: '20 mm', addedKg: 7, date: '2026-01-12' })]);
    expect(s.length).toBe(2);
    const e20 = s.find((x) => x.label.startsWith('20 mm'))!;
    expect(e20.first).toBe(5);
    expect(e20.last).toBe(7);
  });
  it('regularność: częściowe liczone jako połowa', () => {
    const r = regularityByWeek([plannedItem('A', '2026-01-05', { status: 'done' }), plannedItem('B', '2026-01-07', { status: 'partial' })], '2026-01-20');
    expect(r[0].rate).toBe(75);
  });
});

describe('kopia zapasowa', () => {
  it('eksport → import zachowuje dane', () => {
    const { baseline } = demoAssessments();
    const data = { profile: [], cycles: [], planned: [plannedItem('A', '2026-01-05')], completed: [], readiness: [], tests: [], events: [], reports: [], drafts: [], assessments: [baseline] };
    const back = parseImport(JSON.stringify(buildExport(data, 'x')));
    expect(back.planned.length).toBe(1);
    expect(back.assessments[0]).toEqual(baseline);
  });
  it('import starszej kopii (bez testów Baseline) → pusta lista testów', () => {
    const old = { app: 'ClimbProgress', version: 1, exportedAt: 'x', data: { planned: [] } };
    expect(parseImport(JSON.stringify(old)).assessments).toEqual([]);
  });
  it('odrzuca obce pliki', () => {
    expect(() => parseImport('{"foo":1}')).toThrow();
    expect(() => parseImport('nie json')).toThrow();
  });
});
