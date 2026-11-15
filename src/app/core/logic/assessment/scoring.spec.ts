import {
  calculateNineCCoreScore, calculateNineCDeadHangScore, calculateNineCPullUpScore, calculateNineCStrengthScore, calculateNineCTotalScore,
  coreTrialPoints, nineCBenchmarkGrade, relativeLoadPercent, thresholdPoints, RELATIVE_LOAD_THRESHOLDS, DEAD_HANG_THRESHOLDS,
} from './scoring';
import { CoreStrengthResult, DeadHangResult, FingerStrengthTrial, MaxFingerStrengthResult, StrengthTrial, WeightedPullUpResult } from '../../models/assessment';

const pull = (attempts: Partial<StrengthTrial>[], status: WeightedPullUpResult['status'] = 'success'): WeightedPullUpResult => ({
  status, skipReason: '', notes: '',
  attempts: attempts.map((a) => ({ addedWeightKg: 0, reps: 1, successful: true, techniqueValid: true, rpe: null, notes: '', ...a })),
});
const finger = (attempts: Partial<FingerStrengthTrial>[], status: MaxFingerStrengthResult['status'] = 'success'): MaxFingerStrengthResult => ({
  status, edgeDepthMm: 20, edgeLabel: '', gripType: 'half_crimp', holdDurationTargetSec: 5, skipReason: '', notes: '',
  attempts: attempts.map((a) => ({ addedWeightKg: 0, assistanceKg: 0, holdSeconds: 5, successful: true, technicallyValid: true, rpe: null, notes: '', ...a })),
});
const hang = (holdSeconds: number | null, status: DeadHangResult['status'] = 'success'): DeadHangResult => ({
  status, holdSeconds, barDiameterMm: null, gripType: 'pronated', endReason: null, timerStartedAt: null, skipReason: '', notes: '',
});
const core = (attempts: CoreStrengthResult['attempts'], status: CoreStrengthResult['status'] = 'success'): CoreStrengthResult => ({ status, attempts, skipReason: '', notes: '' });

describe('relativeLoadPercent / thresholdPoints', () => {
  it('liczy % masy ciała z obciążeniem i odciążeniem', () => {
    expect(relativeLoadPercent(80, 20)).toBe(125);
    expect(relativeLoadPercent(80, 0, 8)).toBe(90);
  });

  it('przykład ze specyfikacji: 72 kg + 14,4 kg = 120% → 3 pkt (bez błędu zmiennoprzecinkowego)', () => {
    expect(thresholdPoints(relativeLoadPercent(72, 14.4), RELATIVE_LOAD_THRESHOLDS)).toBe(3);
  });

  it('punkty tylko za pełny próg – bez interpolacji i bez zaokrąglania w górę', () => {
    expect(thresholdPoints(119.99, RELATIVE_LOAD_THRESHOLDS)).toBe(2);
    expect(thresholdPoints(179.9, RELATIVE_LOAD_THRESHOLDS)).toBe(7);
    expect(thresholdPoints(180, RELATIVE_LOAD_THRESHOLDS)).toBe(8);
  });

  it('poniżej 100% = 0 pkt, maks. 10 pkt', () => {
    expect(thresholdPoints(95, RELATIVE_LOAD_THRESHOLDS)).toBe(0);
    expect(thresholdPoints(400, RELATIVE_LOAD_THRESHOLDS)).toBe(10);
    expect(thresholdPoints(10_000, DEAD_HANG_THRESHOLDS)).toBe(10);
  });
});

describe('calculateNineCPullUpScore', () => {
  it('wybiera największe obciążenie poprawnego technicznie powtórzenia', () => {
    const r = calculateNineCPullUpScore(pull([{ addedWeightKg: 10 }, { addedWeightKg: 15 }, { addedWeightKg: 20, successful: false }, { addedWeightKg: 18, techniqueValid: false }]), 75);
    expect(r.status).toBe('success');
    expect(r.addedWeightKg).toBe(15);
    expect(r.totalLoadKg).toBe(90);
    expect(r.bodyMassRatioPercent).toBe(120);
    expect(r.score).toBe(3);
    expect(r.bestIndex).toBe(1);
  });

  it('pominięta próba maksymalna = NOT TESTED, a nie 0', () => {
    const r = calculateNineCPullUpScore(pull([], 'not_tested'), 75);
    expect(r.status).toBe('not_tested');
    expect(r.score).toBeNull();
  });

  it('brak masy ciała → niezmierzony (nie można policzyć %)', () => {
    expect(calculateNineCPullUpScore(pull([{ addedWeightKg: 10 }]), null).score).toBeNull();
  });

  it('żadne poprawne powtórzenie → pomiar nieudany, 0 pkt', () => {
    const r = calculateNineCPullUpScore(pull([{ successful: false }]), 75);
    expect(r.status).toBe('failed');
    expect(r.score).toBe(0);
  });

  it('podciągnięcie z masą ciała = 100% = 1 pkt', () => {
    expect(calculateNineCPullUpScore(pull([{ addedWeightKg: 0 }]), 70).score).toBe(1);
  });
});

describe('calculateNineCStrengthScore (Max Finger Strength)', () => {
  it('liczy tylko zwisy utrzymane pełne 5 s, poprawne technicznie', () => {
    const r = calculateNineCStrengthScore(finger([
      { addedWeightKg: 10 },
      { addedWeightKg: 20, holdSeconds: 4.9 },
      { addedWeightKg: 18, technicallyValid: false },
      { addedWeightKg: 14 },
    ]), 70);
    expect(r.addedWeightKg).toBe(14);
    expect(r.totalLoadKg).toBe(84);
    expect(r.bodyMassRatioPercent).toBe(120);
    expect(r.score).toBe(3);
  });

  it('zapisuje osobno ciężar dodatkowy i całkowity, uwzględnia odciążenie', () => {
    const r = calculateNineCStrengthScore(finger([{ addedWeightKg: 0, assistanceKg: 7 }]), 70);
    expect(r.addedWeightKg).toBe(0);
    expect(r.assistanceKg).toBe(7);
    expect(r.totalLoadKg).toBe(63);
    expect(r.bodyMassRatioPercent).toBe(90);
    expect(r.score).toBe(0);
    expect(r.status).toBe('success');
  });

  it('odciążenie mniejsze jest lepsze niż większe', () => {
    const r = calculateNineCStrengthScore(finger([{ assistanceKg: 10 }, { assistanceKg: 5 }]), 70);
    expect(r.assistanceKg).toBe(5);
  });

  it('nie zaokrągla masy ciała przed obliczeniem', () => {
    // 71,6 kg + 14,3 kg = 85,9 kg = 119,97% → 2 pkt (zaokrąglenie masy do 72 dałoby inny wynik)
    expect(calculateNineCStrengthScore(finger([{ addedWeightKg: 14.3 }]), 71.6).score).toBe(2);
  });

  it('niezmierzony ≠ 0', () => {
    expect(calculateNineCStrengthScore(finger([], 'not_tested'), 70).score).toBeNull();
    expect(calculateNineCStrengthScore(finger([]), 70).status).toBe('not_tested');
  });
});

describe('calculateNineCCoreScore', () => {
  it('progi poziomów A/B/C', () => {
    expect(coreTrialPoints({ exercise: 'bent_knee_l_sit', holdSeconds: 9.9 })).toBe(0);
    expect(coreTrialPoints({ exercise: 'bent_knee_l_sit', holdSeconds: 10 })).toBe(1);
    expect(coreTrialPoints({ exercise: 'bent_knee_l_sit', holdSeconds: 45 })).toBe(3);
    expect(coreTrialPoints({ exercise: 'full_l_sit', holdSeconds: 15 })).toBe(5);
    expect(coreTrialPoints({ exercise: 'full_l_sit', holdSeconds: 19 })).toBe(5);
    expect(coreTrialPoints({ exercise: 'front_lever', holdSeconds: 5 })).toBe(7);
    expect(coreTrialPoints({ exercise: 'front_lever', holdSeconds: 30 })).toBe(10);
  });

  it('zapisuje najwyższy osiągnięty poziom, ignoruje próby niepoprawne technicznie', () => {
    const r = calculateNineCCoreScore(core([
      { exercise: 'bent_knee_l_sit', holdSeconds: 30, technicallyValid: true, notes: '' },
      { exercise: 'full_l_sit', holdSeconds: 12, technicallyValid: true, notes: '' },
      { exercise: 'front_lever', holdSeconds: 8, technicallyValid: false, notes: '' },
    ]));
    expect(r.exercise).toBe('full_l_sit');
    expect(r.score).toBe(4);
    expect(r.holdSeconds).toBe(12);
  });

  it('pominięty core = NOT TESTED', () => {
    expect(calculateNineCCoreScore(core([], 'not_tested')).score).toBeNull();
  });
});

describe('calculateNineCDeadHangScore', () => {
  it('progi czasu i limit 6 minut', () => {
    expect(calculateNineCDeadHangScore(hang(29)).score).toBe(0);
    expect(calculateNineCDeadHangScore(hang(30)).score).toBe(1);
    expect(calculateNineCDeadHangScore(hang(239)).score).toBe(7);
    expect(calculateNineCDeadHangScore(hang(299)).score).toBe(8);
    expect(calculateNineCDeadHangScore(hang(360)).score).toBe(10);
    expect(calculateNineCDeadHangScore(hang(400)).score).toBe(10);
  });

  it('brak pomiaru = NOT TESTED', () => {
    expect(calculateNineCDeadHangScore(hang(null)).status).toBe('not_tested');
    expect(calculateNineCDeadHangScore(hang(120, 'not_tested')).score).toBeNull();
  });
});

describe('calculateNineCTotalScore', () => {
  it('suma tylko przy komplecie pomiarów', () => {
    const s = calculateNineCTotalScore({ finger: 3, pulling: 4, core: 4, endurance: 3 });
    expect(s.isComplete).toBe(true);
    expect(s.totalPoints).toBe(14);
    expect(s.estimatedGrade).toBe('7b');
    expect(s.interpretation).toBe('complete');
  });

  it('niekompletny test → bez sumy 40-punktowej', () => {
    const s = calculateNineCTotalScore({ finger: 3, pulling: null, core: 4, endurance: 3 });
    expect(s.isComplete).toBe(false);
    expect(s.totalPoints).toBeNull();
    expect(s.estimatedGrade).toBeNull();
    expect(s.interpretation).toBe('incomplete');
    expect(calculateNineCTotalScore({ finger: null, pulling: null, core: null, endurance: null }).interpretation).toBe('not_available');
  });

  it('zmierzone 0 pkt to wynik, a nie brak pomiaru', () => {
    const s = calculateNineCTotalScore({ finger: 0, pulling: 1, core: 0, endurance: 1 });
    expect(s.isComplete).toBe(true);
    expect(s.totalPoints).toBe(2);
  });

  it('tabela benchmarku 9c', () => {
    expect(nineCBenchmarkGrade(0)).toBeNull();
    expect(nineCBenchmarkGrade(1)).toBe('6a');
    expect(nineCBenchmarkGrade(2)).toBe('6a');
    expect(nineCBenchmarkGrade(7)).toBe('6c+');
    expect(nineCBenchmarkGrade(10)).toBe('7a');
    expect(nineCBenchmarkGrade(21)).toBe('8a');
    expect(nineCBenchmarkGrade(38)).toBe('9b');
    expect(nineCBenchmarkGrade(39)).toBe('9b+');
    expect(nineCBenchmarkGrade(40)).toBe('9c');
  });
});
