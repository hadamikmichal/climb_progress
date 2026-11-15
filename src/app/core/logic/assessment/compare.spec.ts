import { compareBaselineResults, compareConditions } from './compare';
import { demoAssessments } from './demo';
import { generateConclusions } from './conclusions';
import { emptyReadiness, evaluateTestReadiness, readinessAllowsStart, assessmentStatus, newAssessment, newClimbingSession, newStrengthSession } from './factory';
import { strengthResults } from './scoring';

describe('compareBaselineResults', () => {
  const { baseline, retest } = demoAssessments();
  const { rows, conditions } = compareBaselineResults(baseline, retest);
  const row = (k: string) => rows.find((r) => r.key === k)!;

  it('Max Hang: +10 kg → +15 kg = +5 kg; zmiana % tylko dla obciążenia całkowitego', () => {
    expect(row('finger_added').initialValue).toBe(10);
    expect(row('finger_added').currentValue).toBe(15);
    expect(row('finger_added').absoluteChange).toBe(5);
    expect(row('finger_added').percentageChange).toBeNull();
    expect(row('finger_total').percentageChange).toBe(6.1);
    expect(row('finger_added').interpretation).toBe('improved');
  });

  it('ukończone drogi 3/4 → 4/4', () => {
    expect(row('routes_done').initialValue).toBe(3);
    expect(row('routes_done').currentValue).toBe(4);
    expect(row('routes_done').unit).toBe('/4');
  });

  it('krzywa regeneracji – niższe pompowanie = poprawa, bez zmiany % na skali porządkowej', () => {
    expect(row('rec_60').initialValue).toBe(6);
    expect(row('rec_60').currentValue).toBe(4);
    expect(row('rec_60').interpretation).toBe('improved');
    expect(row('rec_60').percentageChange).toBeNull();
  });

  it('czas: krótszy = lepszy', () => {
    expect(row('avg_time').interpretation).toBe('improved');
    expect(row('avg_time').percentageChange).not.toBeNull();
  });

  it('identyczne warunki → porównanie pełne', () => {
    expect(conditions.limited).toBe(false);
  });

  it('brak wartości → not_comparable, a nie zero', () => {
    const b = structuredClone(baseline);
    b.strength!.deadHang.status = 'not_tested';
    const r = compareBaselineResults(b, retest).rows.find((x) => x.key === 'hang_sec')!;
    expect(r.interpretation).toBe('not_comparable');
    expect(r.absoluteChange).toBeNull();
  });

  it('różne warianty core → czas nieporównywalny', () => {
    const b = structuredClone(retest);
    b.strength!.coreStrength.attempts = [{ exercise: 'front_lever', holdSeconds: 6, technicallyValid: true, notes: '' }];
    const res = compareBaselineResults(baseline, b);
    expect(res.rows.find((x) => x.key === 'core_sec')!.interpretation).toBe('not_comparable');
    expect(res.rows.find((x) => x.key === 'core_score')!.interpretation).toBe('improved');
    expect(res.conditions.limited).toBe(true);
  });
});

describe('compareConditions', () => {
  const { baseline, retest } = demoAssessments();
  it('inna krawądka, drążek i droga → porównanie ograniczone', () => {
    const b = structuredClone(retest);
    b.strength!.maxFingerStrength.edgeDepthMm = 18;
    b.strength!.deadHang.barDiameterMm = 35;
    b.climbing!.route.routeId = 'X-1';
    const c = compareConditions(baseline, b);
    expect(c.limited).toBe(true);
    expect(c.reasons.length).toBe(3);
  });

  it('różnica masy ciała > 3%', () => {
    const b = structuredClone(retest);
    b.strength!.readiness.bodyMassKg = 75;
    expect(compareConditions(baseline, b).reasons.some((r) => r.includes('Masa ciała'))).toBe(true);
  });
});

describe('generateConclusions', () => {
  it('wskazuje obszary wg priorytetu i nie diagnozuje', () => {
    const { baseline } = demoAssessments();
    const c = generateConclusions(baseline);
    // 3/4 drogi, test przerwany ze zmęczenia
    expect(c.focus.map((f) => f.area)).toContain('repeatability');
    expect(c.focus[0].area).not.toBe('core');
    expect(c.lines.every((l) => !/uraz|kontuzj|zapalen/i.test(l.text))).toBe(true);
  });

  it('słaba siła palców względem przyciągania', () => {
    const { baseline } = demoAssessments();
    const a = structuredClone(baseline);
    a.strength!.maxFingerStrength.attempts = [{ addedWeightKg: 0, assistanceKg: 0, holdSeconds: 5, successful: true, technicallyValid: true, rpe: 9, notes: '' }];
    a.strength!.weightedPullUp.attempts = [{ addedWeightKg: 30, reps: 1, successful: true, techniqueValid: true, rpe: 9, notes: '' }];
    const s = strengthResults(a.strength!);
    expect(s.finger.score).toBe(1);
    expect(s.pullUp.score).toBe(5);
    const c = generateConclusions(a);
    expect(c.focus[0].area).toBe('finger');
    expect(c.lines.some((l) => l.text.includes('Relatywnie słaba siła palców'))).toBe(true);
  });

  it('brak spadku pompowania o 50% → wolniejsza regeneracja', () => {
    const { baseline } = demoAssessments();
    const a = structuredClone(baseline);
    a.climbing!.recoveryCurve = a.climbing!.recoveryCurve.map((m, i) => ({ ...m, forearmPump: [9, 8, 7, 6][i] }));
    expect(generateConclusions(a).focus.map((f) => f.area)).toContain('recovery');
  });

  it('wypisuje brakujące pomiary', () => {
    const { baseline } = demoAssessments();
    const a = structuredClone(baseline);
    a.strength!.weightedPullUp.status = 'not_tested';
    expect(generateConclusions(a).missing).toContain('Weighted Pull-up');
  });
});

describe('evaluateTestReadiness', () => {
  const ok = () => ({
    ...emptyReadiness('2026-01-05T10:00:00Z', 72), sleepHours: 8, wellbeing: 4, fatigue: 2,
    fingerPain: false, elbowPain: false, shoulderPain: false, illness: false, recentHardTraining: false,
  });

  it('komplet danych, brak problemów → można zaczynać', () => {
    const r = ok();
    const v = evaluateTestReadiness(r);
    expect(v.complete && !v.blocked && !v.warnings.length).toBe(true);
    expect(readinessAllowsStart(r, v)).toBe(true);
  });

  it('ból blokuje próby maksymalne', () => {
    const r = { ...ok(), elbowPain: true };
    const v = evaluateTestReadiness(r);
    expect(v.blocked).toBe(true);
    expect(readinessAllowsStart({ ...r, acknowledgedWarnings: true }, v)).toBe(false);
  });

  it('trening w ostatnich 48 h / < 48 h od dnia 1 → ostrzeżenie wymagające potwierdzenia', () => {
    const r = { ...ok(), recentHardTraining: true };
    const v = evaluateTestReadiness(r, 30);
    expect(v.warnings.length).toBe(2);
    expect(readinessAllowsStart(r, v)).toBe(false);
    expect(readinessAllowsStart({ ...r, acknowledgedWarnings: true }, v)).toBe(true);
  });

  it('brak masy ciała → formularz niekompletny', () => {
    const v = evaluateTestReadiness({ ...ok(), bodyMassKg: null });
    expect(v.missing).toContain('masa ciała');
  });
});

describe('assessmentStatus', () => {
  it('Baseline wymaga obu sesji, test pośredni tylko dróg', () => {
    const a = newAssessment('a', 'c', 'BASELINE', 't');
    expect(assessmentStatus(a)).toBe('scheduled');
    a.strength = newStrengthSession('2026-01-05', 't', 70, null, '', 20);
    a.strength.status = 'completed';
    expect(assessmentStatus(a)).toBe('in_progress');
    a.climbing = newClimbingSession('2026-01-07', 't', 70, 4, null);
    a.climbing.status = 'completed';
    expect(assessmentStatus(a)).toBe('completed');
    const k = newAssessment('k', 'c', 'CONTROL', 't');
    k.climbing = newClimbingSession('2026-01-07', 't', 70, 3, null);
    k.climbing.status = 'completed';
    expect(assessmentStatus(k)).toBe('completed');
  });
});
