import { describe, expect, it } from 'vitest';
import { assessAbilities, edgeFactor, fingerProfile } from './abilities';
import { baseline, climbingTest, intake } from '../testing/adaptive-fixtures';
import { priorityText, rankAbilities } from './prescription';
import { P0, workout } from '../testing/fixtures';

describe('Profile zdolności', () => {
  it('siła palców z % masy ciała, nie z punktów 9c', () => {
    const p = fingerProfile({ intake: intake(), assessment: baseline({ mass: 70, fingerAddedKg: 21 }), workouts: [] });
    expect(p.status).toBe('established'); // 130% masy ciała
    expect(p.evidence.join(' ')).toContain('130% masy ciała');
    expect(p.confidence).toBe('high');
  });

  it('mniejsza krawądka podnosi odpowiednik 20 mm', () => {
    expect(edgeFactor(15)).toBeGreaterThan(1);
    expect(edgeFactor(25)).toBeLessThan(1);
    const p = fingerProfile({ intake: intake(), assessment: baseline({ mass: 70, fingerAddedKg: 21, edgeMm: 14 }), workouts: [] });
    expect(p.status).toBe('advanced');
    expect(p.evidence.join(' ')).toContain('odpowiednik 20 mm');
  });

  it('nieznana głębokość krawądki obniża pewność oceny', () => {
    const a = baseline({ mass: 70, fingerAddedKg: 21 });
    a.strength!.maxFingerStrength.edgeDepthMm = null;
    const p = fingerProfile({ intake: intake(), assessment: a, workouts: [] });
    expect(p.confidence).toBe('medium');
    expect(p.missing).toContain('rzeczywista głębokość krawądki');
  });

  it('bez pomiaru: tylko orientacyjny szacunek z RP i niska pewność', () => {
    const p = fingerProfile({ intake: intake({ rpGrade: '7b' }), assessment: null, workouts: [] });
    expect(p.confidence).toBe('low');
    expect(p.evidence.join(' ')).toContain('orientacyjny szacunek');
  });

  it('trzy profile są niezależne – brak jednego globalnego poziomu', () => {
    const a = baseline({
      mass: 70, fingerAddedKg: 35,
      climbing: climbingTest('6b', [{ done: true, rpe: 7, pump: 5 }, { done: true, rpe: 8, pump: 7 }, { done: false, rpe: 10, pump: 9 }, { done: false, rpe: 10, pump: 9 }], [8, 7, 6, 5]),
    });
    const p = assessAbilities({ intake: intake({ routesPerSession: 4 }), assessment: a, workouts: [] });
    const statuses = new Set([p.finger.status, p.powerEndurance.status, p.aerobic.status]);
    expect(statuses.size).toBeGreaterThan(1);
    expect(rankAbilities(p)[2]).toBe('finger');
  });

  it('profile wyrównane: priorytet opisany jako względny, nie „główne ograniczenie”', () => {
    const mk = (score: number) => ({ status: 'advanced' as const, score, confidence: 'high' as const, evidence: [], missing: [] });
    const t = priorityText({ finger: { key: 'finger', ...mk(0.8) }, powerEndurance: { key: 'powerEndurance', ...mk(0.9) }, aerobic: { key: 'aerobic', ...mk(0.76) } });
    expect(t).toContain('Profile są wyrównane (wszystkie: zaawansowany)');
    expect(t).toContain('względnie najsłabszy: wytrzymałość tlenowa');
  });

  it('wytrzymałość tlenowa uwzględnia objętość i pompowanie z treningów', () => {
    const ws = [workout('B', '2026-02-02', P0), workout('B', '2026-02-09', P0), workout('B', '2026-02-16', P0)];
    const p = assessAbilities({ intake: intake(), assessment: null, workouts: ws }).aerobic;
    expect(p.evidence.join(' ')).toContain('treningi tlenowe: średnie pompowanie 3/10 (3 sesji)');
    expect(p.evidence.join(' ')).toContain('ukończonych dróg tlenowych na sesję');
  });
});
