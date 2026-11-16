import { Assessment, ClimbingAssessment } from '../../models/assessment';
import { AbilityKey, AbilityProfile, AbilityStatus, ClimberIntake, CompletedWorkout } from '../../models/models';
import { climbingResults, validAttempts } from '../assessment/climbing';
import { strengthResults } from '../assessment/scoring';
import { gradeIndex } from '../grades';
import { sessionAvgPump, sessionMaxPump, sessionRpe } from '../progression';

/**
 * Profile zdolności treningowych – trzy niezależne oceny: Finger Strength, Power Endurance, Aerobic Endurance.
 *
 * Status to wewnętrzna klasyfikacja programu (nie ocena sportowa). Nie wynika z punktów 9c – liczony jest
 * z surowych pomiarów (% masy ciała z korektą na głębokość krawądki, powtarzalność względem RP, krzywa
 * regeneracji, historia treningów). Każde kryterium ma jawną punktację; wynik jest normalizowany do
 * dostępnych danych, a brak danych obniża pewność oceny (confidence), nie status.
 */

export const STATUS_ORDER: AbilityStatus[] = ['underdeveloped', 'developing', 'established', 'advanced'];
export const STATUS_LABELS: Record<AbilityStatus, string> = {
  underdeveloped: 'do zbudowania',
  developing: 'w rozwoju',
  established: 'ugruntowany',
  advanced: 'zaawansowany',
};
export const ABILITY_LABELS: Record<AbilityKey, string> = {
  finger: 'Finger Strength',
  powerEndurance: 'Power Endurance',
  aerobic: 'Aerobic Endurance',
};
export const ABILITY_PL: Record<AbilityKey, string> = {
  finger: 'siła palców',
  powerEndurance: 'wytrzymałość siłowa',
  aerobic: 'wytrzymałość tlenowa',
};

export const statusRank = (s: AbilityStatus) => STATUS_ORDER.indexOf(s);

interface Criterion {
  pts: number;
  max: number;
  text: string;
}

/** Progi znormalizowanego wyniku 0–1 → status */
const STATUS_CUTS = { developing: 0.35, established: 0.55, advanced: 0.75 } as const;

function statusFromScore(score: number): AbilityStatus {
  if (score >= STATUS_CUTS.advanced) return 'advanced';
  if (score >= STATUS_CUTS.established) return 'established';
  if (score >= STATUS_CUTS.developing) return 'developing';
  return 'underdeveloped';
}

function fromCriteria(key: AbilityKey, cs: Criterion[], missing: string[], fullMax: number): AbilityProfile {
  const max = cs.reduce((a, c) => a + c.max, 0);
  const pts = cs.reduce((a, c) => a + c.pts, 0);
  const score = max ? Math.round((pts / max) * 100) / 100 : 0;
  const coverage = max / fullMax;
  return {
    key,
    status: max ? statusFromScore(score) : 'developing',
    score,
    confidence: coverage >= 0.75 ? 'high' : coverage >= 0.4 ? 'medium' : 'low',
    evidence: cs.map((c) => c.text),
    missing,
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export interface AbilityInputs {
  intake: ClimberIntake;
  /** Ukończony (lub częściowo ukończony) Baseline / Retest – źródło pomiarów */
  assessment: Assessment | null;
  /** Historia wykonanych treningów (dowolny zakres – brane są ostatnie 8 tygodni) */
  workouts: CompletedWorkout[];
}

const recent = (ws: CompletedWorkout[], days = 56) => {
  if (!ws.length) return [];
  const last = ws.reduce((m, w) => (w.date > m ? w.date : m), ws[0].date);
  const cutoff = new Date(Date.parse(last) - days * 86_400_000).toISOString().slice(0, 10);
  return ws.filter((w) => w.date >= cutoff && !w.deload).sort((a, b) => (a.date < b.date ? -1 : 1));
};

/* ---------------- Finger Strength ---------------- */

/** Korekta na głębokość krawądki: wynik na mniejszej krawądce jest „wart” więcej niż na 20 mm */
export function edgeFactor(depthMm: number | null): number {
  if (depthMm == null) return 1;
  return Math.min(1.3, Math.max(0.8, 1 + 0.02 * (20 - depthMm)));
}

/** Progi % masy ciała (5 s, odpowiednik 20 mm) dla klasyfikacji siły palców */
export const FINGER_RATIO_CUTS = { developing: 100, established: 118, advanced: 140 } as const;

/** Odwzorowanie % masy ciała na znormalizowany wynik zgodny z progami STATUS_CUTS */
function fingerScore(ratio: number): number {
  const pts: [number, number][] = [[80, 0], [FINGER_RATIO_CUTS.developing, STATUS_CUTS.developing], [FINGER_RATIO_CUTS.established, STATUS_CUTS.established], [FINGER_RATIO_CUTS.advanced, STATUS_CUTS.advanced], [175, 1]];
  if (ratio <= pts[0][0]) return 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    if (ratio <= x1) return Math.round((y0 + ((ratio - x0) / (x1 - x0)) * (y1 - y0)) * 100) / 100;
  }
  return 1;
}

export function fingerProfile(inp: AbilityInputs): AbilityProfile {
  const evidence: string[] = [];
  const missing: string[] = [];
  const s = inp.assessment?.strength;
  const hangs = recent(inp.workouts).flatMap((w) => w.hangs);
  let ratio: number | null = null;
  let confidence: AbilityProfile['confidence'] = 'low';

  if (s && s.maxFingerStrength.status !== 'not_tested') {
    const res = strengthResults(s).finger;
    const depth = s.maxFingerStrength.edgeDepthMm;
    if (res.bodyMassRatioPercent != null && res.totalLoadKg != null) {
      const f = edgeFactor(depth);
      ratio = res.bodyMassRatioPercent * f;
      const load = res.addedWeightKg! - (res.assistanceKg ?? 0);
      evidence.push(
        `Max Hang 5 s: obciążenie całkowite ${r1(res.totalLoadKg)} kg (${load >= 0 ? '+' : '−'}${Math.abs(r1(load))} kg) przy masie ${res.bodyMassKg} kg = ${r1(res.bodyMassRatioPercent)}% masy ciała`,
      );
      evidence.push(depth != null ? `krawądka ${depth} mm, ${s.maxFingerStrength.gripType === 'half_crimp' ? 'half crimp' : s.maxFingerStrength.gripType}${f !== 1 ? ` → odpowiednik 20 mm: ${r1(ratio)}%` : ''}` : 'głębokość krawądki nieznana – bez korekty');
      if (depth == null) missing.push('rzeczywista głębokość krawądki');
      confidence = depth != null ? 'high' : 'medium';
    } else if (res.status === 'failed') {
      ratio = 80;
      evidence.push('Max Hang 5 s: żadna próba nie spełniła kryteriów (poprawny zwis 5 s)');
      confidence = 'medium';
    }
  } else {
    missing.push('test Max Hang 5 s');
  }

  // Historia: zwisy treningowe (10 s ≈ 90% maksimum 5 s) uzupełniają brak testu i pokazują tolerancję obciążenia
  if (hangs.length) {
    const pain = hangs.filter((h) => h.pain).length;
    evidence.push(`historia: ${hangs.length} sesji zwisów w ostatnich 8 tygodniach${pain ? `, w tym ${pain} z bólem` : ', bez bólu'}`);
    if (ratio == null) {
      const mass = inp.assessment?.strength?.readiness.bodyMassKg ?? null;
      const best = hangs.reduce((m, h) => Math.max(m, h.addedKg - h.assistKg), -Infinity);
      if (mass) {
        const est = (((mass + best) / mass) * 100 * edgeFactor(hangs[hangs.length - 1].edgeSizeMm)) / 0.9;
        ratio = est;
        evidence.push(`szacunek z treningu: zwis ${hangs[hangs.length - 1].hangSec} s z ${best >= 0 ? '+' : '−'}${Math.abs(best)} kg ≈ ${r1(est)}% masy ciała (5 s)`);
        confidence = 'low';
      }
    }
  } else {
    missing.push('historia zwisów');
  }

  if (ratio == null) {
    // Brak pomiaru – wyłącznie orientacyjny szacunek z deklarowanego RP, niska pewność
    const rp = gradeIndex(inp.intake.rpGrade);
    ratio = rp < 0 ? 105 : rp <= gradeIndex('5c+') ? 92 : rp <= gradeIndex('6b') ? 108 : rp <= gradeIndex('7a') ? 125 : 145;
    evidence.push(`brak pomiaru siły palców – orientacyjny szacunek z deklarowanego RP ${inp.intake.rpGrade ?? '–'}`);
    confidence = 'low';
  }

  const score = fingerScore(ratio);
  return { key: 'finger', status: statusFromScore(score), score, confidence, evidence, missing };
}

/* ---------------- Power Endurance ---------------- */

export function powerEnduranceProfile(inp: AbilityInputs): AbilityProfile {
  const cs: Criterion[] = [];
  const missing: string[] = [];
  const c: ClimbingAssessment | null = inp.assessment?.climbing ?? null;
  const rp = gradeIndex(inp.intake.rpGrade);

  if (c && validAttempts(c.attempts).length) {
    const { time, recovery } = climbingResults(c);
    const valid = validAttempts(c.attempts);
    const last = valid[valid.length - 1];
    const g = c.route.frenchGrade;
    const n = time.completedRoutes;
    const N = c.plannedAttempts;
    cs.push({ pts: n >= N ? 3 : n === N - 1 ? 1.5 : 0, max: 3, text: `test powtarzalności ${N} × ${g}: ukończone ${n}/${N}` });
    if (last?.rpe != null) cs.push({ pts: last.rpe <= 7 ? 2 : last.rpe <= 8 ? 1.5 : last.rpe <= 9 ? 0.5 : 0, max: 2, text: `RPE ostatniej próby ${last.rpe}/10` });
    else missing.push('RPE ostatniej próby');
    const lp = recovery.pumpAfterLastRoute;
    if (lp != null) cs.push({ pts: lp <= 5 ? 1.5 : lp <= 7 ? 1 : lp <= 8 ? 0.5 : 0, max: 1.5, text: `pompowanie po ostatniej próbie ${lp}/10` });
    if (time.timeChangePercent != null) {
      cs.push({ pts: time.timeChangePercent <= 5 ? 1 : time.timeChangePercent <= 12 ? 0.5 : 0, max: 1, text: `czas przejścia: ${time.timeChangePercent > 0 ? '+' : ''}${time.timeChangePercent}% między pierwszą a ostatnią ukończoną drogą` });
    } else missing.push('czasy przejść');
    const degraded = valid.filter((a) => a.techniqueDegraded).length;
    cs.push({ pts: degraded <= 1 ? 1 : degraded <= 2 ? 0.5 : 0, max: 1, text: `technika pogorszona w ${degraded} z ${valid.length} prób` });
    if (rp >= 0 && gradeIndex(g) >= 0) {
      const gap = rp - gradeIndex(g);
      cs.push({ pts: gap <= 2 ? 1.5 : gap <= 4 ? 1 : gap <= 6 ? 0.5 : 0, max: 1.5, text: `trudność testu ${g} to ${gap} ${gap === 1 ? 'stopień' : 'stopni'} poniżej RP ${inp.intake.rpGrade}` });
    } else missing.push('RP do porównania trudności testu');
  } else {
    missing.push('test powtarzalności dróg');
    // Bez testu: deklarowana trudność powtarzalna względem RP (niska pewność)
    const rep = gradeIndex(inp.intake.repeatableGrade);
    if (rep >= 0 && rp >= 0) {
      const gap = rp - rep;
      cs.push({ pts: gap <= 2 ? 4 : gap <= 4 ? 3 : gap <= 6 ? 2 : 1, max: 5, text: `deklarowana trudność powtarzalna ${inp.intake.repeatableGrade} – ${gap} stopni poniżej RP` });
    }
  }

  // Historia treningów C: stabilność ukończeń przy akceptowalnym RPE
  const cw = recent(inp.workouts).filter((w) => w.type === 'C');
  if (cw.length) {
    const stable = cw.filter((w) => {
      const pe = w.prescription.powerEndurance;
      const done = w.routes.filter((r) => r.completed).length;
      const rpe = sessionRpe(w);
      return done >= pe.sets * pe.routesPerSet && (rpe == null || rpe <= 8);
    }).length;
    cs.push({ pts: (stable / cw.length) * 2, max: 2, text: `historia: ${stable} z ${cw.length} ostatnich sesji wytrzymałości siłowej ukończonych w całości przy RPE ≤ 8` });
  } else missing.push('historia treningów wytrzymałości siłowej');

  return fromCriteria('powerEndurance', cs, missing, 12);
}

/* ---------------- Aerobic Endurance ---------------- */

export function aerobicProfile(inp: AbilityInputs): AbilityProfile {
  const cs: Criterion[] = [];
  const missing: string[] = [];
  const c = inp.assessment?.climbing ?? null;

  if (c && c.recoveryCurve.some((m) => m.forearmPump != null)) {
    const rec = climbingResults(c).recovery;
    if (rec.halfRecovery === 'not_applicable') cs.push({ pts: 2.5, max: 2.5, text: 'Recovery Curve: brak istotnego pompowania po teście' });
    else {
      const t = rec.halfRecoverySeconds;
      cs.push({
        pts: t != null && t <= 60 ? 2.5 : t === 120 ? 1.5 : t === 180 ? 0.75 : 0, max: 2.5,
        text: t != null ? `Recovery Curve: spadek pompowania o 50% po ${t / 60} min` : 'Recovery Curve: brak spadku pompowania o 50% w ciągu 3 min',
      });
    }
    if (rec.pumpRiseFirstToLast != null) cs.push({ pts: rec.pumpRiseFirstToLast <= 2 ? 1.5 : rec.pumpRiseFirstToLast <= 4 ? 0.75 : 0, max: 1.5, text: `narastanie pompowania w teście: +${rec.pumpRiseFirstToLast}` });
    if (rec.pumpAfterFirstRoute != null) cs.push({ pts: rec.pumpAfterFirstRoute <= 3 ? 1 : rec.pumpAfterFirstRoute <= 5 ? 0.5 : 0, max: 1, text: `pompowanie po pierwszej drodze ${rec.pumpAfterFirstRoute}/10` });
  } else missing.push('Recovery Curve');

  // Objętość, długość dróg, przerwy i pompowanie na treningach tlenowych (B)
  const bw = recent(inp.workouts).filter((w) => w.type === 'B' && w.routes.length);
  if (bw.length) {
    const pumps = bw.map((w) => sessionAvgPump(w)).filter((p): p is number => p != null);
    const ap = avg(pumps);
    if (ap != null) cs.push({ pts: ap <= 4 ? 2 : ap <= 5 ? 1 : 0, max: 2, text: `treningi tlenowe: średnie pompowanie ${r1(ap)}/10 (${bw.length} sesji)` });
    const routes = avg(bw.map((w) => w.routes.filter((r) => r.completed).length))!;
    const len = avg(bw.flatMap((w) => w.routes.map((r) => r.lengthM)))!;
    cs.push({ pts: routes >= 6 ? 1.5 : routes >= 4 ? 0.75 : 0, max: 1.5, text: `objętość: średnio ${r1(routes)} ukończonych dróg tlenowych na sesję (ok. ${Math.round(routes * len)} m)` });
    const minutes = avg(bw.map((w) => w.durationMin))!;
    cs.push({ pts: minutes >= 60 ? 0.5 : 0, max: 0.5, text: `czas aktywności: średnio ${Math.round(minutes)} min na sesję` });
    const rest = avg(bw.map((w) => w.prescription.aerobic.restMin))!;
    const maxPump = Math.max(...bw.map((w) => sessionMaxPump(w) ?? 0));
    cs.push({ pts: rest <= 3 && maxPump <= 5 ? 0.5 : 0, max: 0.5, text: `przerwy ok. ${r1(rest)} min, maks. pompowanie ${maxPump}/10` });
  } else missing.push('historia treningów tlenowych');

  const rps = inp.intake.routesPerSession;
  if (rps != null) cs.push({ pts: rps >= 10 ? 1 : rps >= 6 ? 0.5 : 0, max: 1, text: `deklarowana objętość: ok. ${rps} dróg w typowej sesji` });
  else missing.push('typowa liczba dróg w sesji');

  return fromCriteria('aerobic', cs, missing, 10);
}

export function assessAbilities(inp: AbilityInputs): Record<AbilityKey, AbilityProfile> {
  return { finger: fingerProfile(inp), powerEndurance: powerEnduranceProfile(inp), aerobic: aerobicProfile(inp) };
}
