import { ascentBreakdown, delta, gradeProjects, hardAttemptsByWeek, inRange, periodSummary, rangeBounds, aerobicRepeatability } from './analytics';
import { P0, route, workout, hang } from './testing/fixtures';

const hardW = (date: string, routes: Parameters<typeof route>[0][]) => workout('A', date, P0, { routes: routes.map((r) => route({ setIndex: 0, ...r })) });

describe('rangeBounds / inRange', () => {
  it('6 tyg. = 42 dni włącznie z dziś, poprzedni okres tej samej długości', () => {
    const r = rangeBounds('2026-03-01', '6w');
    expect(r.from).toBe('2026-01-19');
    expect(r.prevTo).toBe('2026-01-18');
    expect(r.prevFrom).toBe('2025-12-08');
  });
  it('całość nie ma okresu porównawczego', () => {
    const r = rangeBounds('2026-03-01', 'all');
    expect(r.from).toBeNull();
    expect(r.prevFrom).toBeNull();
  });
  it('filtruje po dacie włącznie', () => {
    const xs = [{ date: '2026-01-01' }, { date: '2026-01-10' }, { date: '2026-01-20' }];
    expect(inRange(xs, '2026-01-10', '2026-01-20').length).toBe(2);
    expect(inRange(xs, null, '2026-01-05').length).toBe(1);
  });
});

describe('periodSummary', () => {
  it('liczy drogi, objętość, skuteczność i najlepszy zwis', () => {
    const a = hardW('2026-01-05', [{ grade: '6b', completed: false }, { grade: '6b+', completed: true }]);
    const b = workout('B', '2026-01-07', P0, { hangs: [hang({ addedKg: 4 })] });
    const s = periodSummary([a, b]);
    expect(s.sessions).toBe(2);
    expect(s.routesTotal).toBe(2 + P0.aerobic.routes);
    expect(s.meters).toBe(13 * s.routesTotal);
    expect(s.hardAttempts).toBe(2);
    expect(s.hardSendRate).toBe(50);
    expect(s.hardestIndex).not.toBeNull();
    expect(s.bestHang?.load).toBe(4);
    expect(s.avgPumpB).toBe(3);
  });
  it('brak danych → null zamiast zer', () => {
    const s = periodSummary([]);
    expect(s.sendRate).toBeNull();
    expect(s.avgRpe).toBeNull();
    expect(s.bestHang).toBeNull();
  });
});

describe('delta', () => {
  it('kierunek zależy od tego, czy mniej znaczy lepiej', () => {
    expect(delta(5, 3).trend).toBe('improved');
    expect(delta(5, 3, true).trend).toBe('declined');
    expect(delta(3, 3).trend).toBe('same');
    expect(delta(null, 3).trend).toBe('na');
    expect(delta(4.2, 3.1).change).toBe(1.1);
  });
});

describe('trudne drogi', () => {
  const ws = [
    hardW('2026-01-05', [{ grade: '6c', completed: false }, { grade: '6c', completed: false }, { grade: '6b+', completed: true, ascent: 'flash' }]),
    hardW('2026-01-12', [{ grade: '6c', completed: true, ascent: 'redpoint' }, { grade: '6b', completed: true }]),
  ];
  it('projekty: próby do pierwszego przejścia, od najtrudniejszej wyceny', () => {
    const p = gradeProjects(ws);
    expect(p[0].grade).toBe('6c');
    expect(p[0].attempts).toBe(3);
    expect(p[0].firstSend).toBe('2026-01-12');
    expect(p[0].attemptsToFirstSend).toBe(3);
  });
  it('style przejść; brak stylu liczony osobno', () => {
    expect(ascentBreakdown(ws)).toEqual({ onsight: 0, flash: 1, redpoint: 1, unknown: 1, total: 3 });
  });
  it('skuteczność prób w tygodniach', () => {
    const w = hardAttemptsByWeek(ws);
    expect(w.map((x) => x.rate)).toEqual([33, 100]);
  });
  it('drogi obwodów C nie są trudnymi próbami', () => {
    expect(ascentBreakdown([workout('C', '2026-01-10')]).total).toBe(0);
  });
});

describe('aerobicRepeatability', () => {
  it('ukończone vs zaplanowane drogi w treningu B', () => {
    const w = workout('B', '2026-01-07');
    w.routes[0].completed = false;
    expect(aerobicRepeatability([w])[0]).toEqual({ date: '2026-01-07', done: P0.aerobic.routes - 1, planned: P0.aerobic.routes, avgPump: 3 });
  });
});
