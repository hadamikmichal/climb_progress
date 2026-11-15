import { formatClock, pauseTimer, resumeTimer, startTimer, timerDone, timerElapsed, timerEndMs, timerRemaining } from './timer';

const T0 = Date.parse('2026-01-05T10:00:00.000Z');
const iso = (ms: number) => new Date(T0 + ms).toISOString();

describe('timer faz (znaczniki czasu)', () => {
  it('liczy upływ i pozostały czas z zegara, nie z licznika', () => {
    const t = startTimer('work', 'Zwis', 10, iso(0));
    expect(timerElapsed(t, T0 + 4000)).toBe(4);
    expect(timerRemaining(t, T0 + 4000)).toBe(6);
    expect(timerDone(t, T0 + 9999)).toBe(false);
    expect(timerDone(t, T0 + 10000)).toBe(true);
    expect(timerRemaining(t, T0 + 60_000)).toBe(0);
  });

  it('odtwarza stan po „odświeżeniu” – ten sam obiekt, późniejszy zegar', () => {
    const t = JSON.parse(JSON.stringify(startTimer('rest', 'Przerwa', 180, iso(0))));
    expect(timerRemaining(t, T0 + 78_000)).toBe(102);
  });

  it('pauza zatrzymuje czas, wznowienie dolicza pauzę', () => {
    let t = startTimer('rest', 'Przerwa', 60, iso(0));
    t = pauseTimer(t, iso(20_000));
    expect(timerRemaining(t, T0 + 50_000)).toBe(40);
    expect(timerDone(t, T0 + 500_000)).toBe(false);
    t = resumeTimer(t, iso(50_000));
    expect(timerRemaining(t, T0 + 50_000)).toBe(40);
    expect(timerEndMs(t)).toBe(T0 + 90_000);
    expect(timerDone(t, T0 + 90_000)).toBe(true);
  });

  it('podwójna pauza / wznowienie są idempotentne', () => {
    const t = pauseTimer(startTimer('work', 'Zwis', 10, iso(0)), iso(1000));
    expect(pauseTimer(t, iso(5000))).toBe(t);
    const r = resumeTimer(t, iso(3000));
    expect(resumeTimer(r, iso(9000))).toBe(r);
  });

  it('formatuje mm:ss', () => {
    expect(formatClock(102)).toBe('01:42');
    expect(formatClock(0.2)).toBe('00:01');
    expect(formatClock(0)).toBe('00:00');
  });
});
