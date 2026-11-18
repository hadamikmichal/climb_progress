import { describe, expect, it } from 'vitest';
import { AdaptationEvent, AppData, ReadinessCheck, TestResult } from '../models/models';
import { defaultProfile } from '../logic/templates';
import { createCycle } from '../logic/plan';
import { hang, P0, plannedItem, route, workout } from '../logic/testing/fixtures';
import { baseline, climbingTest } from '../logic/testing/adaptive-fixtures';
import {
  assessmentToRows, cycleToRow, eventToRow, legacyTestToRow, plannedToRow, profileToRow, readinessToRow, rowsToWorkout, rowToAssessment, rowToCycle, rowToEvent,
  rowToLegacyTest, rowToPlanned, rowToProfile, rowToReadiness, workoutToRows,
} from './mappers';
import { buildMergeOps, RemoteSnapshot } from './merge';
import { pushOrder } from './sync.service';
import { OutboxEntry } from '../data/db';
import { toAuthFailure } from '../auth/auth-errors';
import { safeReturnUrl } from '../auth/auth.guard';
import { summarizeLegacy } from '../session/legacy-import';

const TS = '2026-03-02T09:15:30.123Z';
const UID = 'user-a';

/**
 * Symulacja odpowiedzi Neon Data API: baza dokłada user_id i kolumny generowane,
 * a znaczniki czasu wracają w formacie Postgresa (+00:00, mikrosekundy).
 */
function asDb<T extends object, E extends object = object>(row: T, extra?: E): T & E & { user_id: string } {
  const out: Record<string, unknown> = { user_id: UID, ...extra };
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(v) ? v.replace(/(\.\d{3})Z$/, '$1456+00:00') : v;
  }
  return JSON.parse(JSON.stringify(out));
}

const jsonEq = (a: unknown) => JSON.parse(JSON.stringify(a));

describe('mapowanie model ↔ wiersze Neon', () => {
  it('trening B z drogami i zwisem: zapis i odczyt bez utraty danych', () => {
    const w = workout('B', '2026-03-05', P0, {
      startedAt: TS, finishedAt: '2026-03-05T11:30:00.000Z', createdAt: TS, updatedAt: TS, notes: 'Mocne pompowanie',
      routes: [route({ timestamp: TS, rpe: 7, pump: 6, cruxSent: null, techniqueDegraded: true, ascent: null }), route({ timestamp: TS, completed: false, cruxSent: null, techniqueDegraded: null, ascent: null })],
      hangs: [hang({ timestamp: TS, addedKg: 5, assistKg: 0, bodyMassKg: 71, pain: false })],
    });
    const rows = workoutToRows(w);
    expect(rows.session).not.toHaveProperty('user_id');
    expect(rows.session.duration_seconds).toBe(90 * 60);
    expect(rows.hangs[0].protocol).toBe('max_hangs');
    expect(rows.routes.map((r) => r.attempt_number)).toEqual([1, 2]);
    const back = rowsToWorkout(
      asDb(rows.session),
      rows.routes.map((r) => asDb(r)),
      rows.hangs.map((h) => asDb(h, { total_load_kg: 76, successful: true })),
    );
    expect(back).toEqual(jsonEq(w));
  });

  it('cykl z kalibracją i benchmarkiem', () => {
    const c = { ...createCycle('Cykl 1', '2026-03-02', P0, TS), planStart: '2026-03-09', status: 'active' as const, goalGrade: '6c+' };
    c.calibration = { status: 'confirmed', level: 'intermediate', grade: '6a+', candidateReasons: ['x'], runs: [] };
    const row = cycleToRow(c);
    expect(row.end_date).toBe('2026-04-19');
    expect(rowToCycle(asDb(row))).toEqual(jsonEq(c));
  });

  it('jednostka planu z przesunięciem i pominięciem', () => {
    const p = plannedItem('C', '2026-03-12', {
      cycleId: 'c1', status: 'skipped', skipReason: 'fatigue', skipNote: 'zmęczony', createdAt: TS, updatedAt: TS,
      moves: [{ from: '2026-03-11', to: '2026-03-12', at: TS, reason: 'brak czasu' }], completedWorkoutId: undefined,
    });
    expect(rowToPlanned(asDb(plannedToRow(p)))).toEqual(jsonEq(p));
    const t = plannedItem('BASELINE', '2026-03-02', { part: 'strength', createdAt: TS, updatedAt: TS, completedWorkoutId: 'a1', status: 'done' });
    expect(rowToPlanned(asDb(plannedToRow(t)))).toEqual(jsonEq(t));
  });

  it('profil z wywiadem; id lokalne zawsze "me"', () => {
    const p = { ...defaultProfile(TS), name: 'Ala', intake: { rpGrade: '7a', osGrade: '6b+', repeatableGrade: '6b', style: 'crimpy' as const, routesPerSession: 8, boulderGrade: null } };
    const row = profileToRow(p);
    expect(row).not.toHaveProperty('id');
    expect(rowToProfile(asDb({ ...row, id: '00000000-0000-4000-8000-000000000001' }))).toEqual(jsonEq(p));
  });

  it('ocena gotowości i zdarzenie adaptacji', () => {
    const r: ReadinessCheck = { id: 'r1', date: '2026-03-04', timestamp: TS, wellbeing: 4, fatigue: 2, sleep: 3, fingerPain: true, elbowShoulderPain: false, unusualFatigue: false, notes: '' };
    expect(rowToReadiness(asDb(readinessToRow(r), { pain_present: true }))).toEqual(r);
    const e: AdaptationEvent = { id: 'e1', cycleId: 'c1', timestamp: TS, kind: 'progress', workoutType: 'B', parameter: 'hangboard.sets', from: '3', to: '4', reason: 'Dwie dobre sesje', sourceIds: ['w1', 'w2'] };
    expect(rowToEvent(asDb(eventToRow(e)))).toEqual(e);
    const minimal: AdaptationEvent = { id: 'e2', cycleId: 'c1', timestamp: TS, kind: 'plan', reason: 'Plan', sourceIds: [] };
    expect(rowToEvent(asDb(eventToRow(minimal)))).toEqual(minimal);
  });

  it('Baseline Test: pełny dokument + wyniki (9c, próby) i krzywa regeneracji', () => {
    const climbing = climbingTest('6a+', [
      { done: true, time: 300, rpe: 6, pump: 5 }, { done: true, time: 320, rpe: 7, pump: 6 },
      { done: true, time: 345, rpe: 8, pump: 7 }, { done: false, time: 200, rpe: 9, pump: 8 },
    ]);
    const a = baseline({ mass: 70, fingerAddedKg: 10, climbing });
    a.updatedAt = TS;
    const rows = assessmentToRows(a);
    expect(rowToAssessment(asDb(rows.session))).toEqual(jsonEq(a));
    const keys = rows.results.map((r) => `${r.category}|${r.metric_key}|${r.attempt_number}`);
    expect(new Set(keys).size).toBe(keys.length); // zgodne z UNIQUE (sesja, kategoria, metryka, próba)
    expect(keys).toContain('score|nine_c.total|null');
    expect(keys).toContain('strength|finger.added_weight_kg|1');
    expect(rows.results.find((r) => r.metric_key === 'finger.total_load_kg')?.value_numeric).toBe(80);
    expect(rows.results.filter((r) => r.metric_key === 'route.ascent_time_seconds')).toHaveLength(4);
    expect(rows.recovery.map((m) => m.elapsed_seconds)).toEqual([0, 60, 120, 180]);
    expect(rows.recovery.map((m) => m.forearm_pump)).toEqual([6, 4, 2, 1]);
  });

  it('test w starym formacie 3 × 6a', () => {
    const t: TestResult = {
      id: 't1', cycleId: 'c1', plannedWorkoutId: null, date: '2026-01-10', createdAt: TS, updatedAt: TS, kind: 'BASELINE',
      routes: [{ order: 1, grade: '6a', completed: true, rpe: 7, pump: 6, techniqueDegraded: false, notes: '' }], reserve: 3, notes: '',
    };
    const row = legacyTestToRow(t);
    expect(row.protocol_version).toBe('legacy-3x6a');
    expect(rowToLegacyTest(asDb(row))).toEqual(t);
  });
});

describe('scalanie serwer → lokalnie', () => {
  const empty: AppData = { profile: [], cycles: [], planned: [], completed: [], readiness: [], tests: [], events: [], reports: [], drafts: [], assessments: [] };
  const remote = (o: Partial<RemoteSnapshot>): RemoteSnapshot => ({ profile: null, cycles: [], planned: [], completed: [], assessments: [], tests: [], readiness: [], events: [], ...o });

  it('nowe rekordy z innego urządzenia są zapisywane, usunięte – usuwane', () => {
    const w1 = workout('A', '2026-03-01');
    const w2 = workout('B', '2026-03-03');
    const ops = buildMergeOps(remote({ completed: [w2] }), { ...empty, completed: [w1] }, new Set());
    expect(ops).toEqual([{ store: 'completed', put: [w2], del: [w1.id] }]);
  });

  it('rekordy z niewysłanymi zmianami nie są nadpisywane ani usuwane', () => {
    const local = workout('A', '2026-03-01', P0, { notes: 'lokalna edycja' });
    const server = { ...local, notes: 'stara wersja' };
    const fresh = workout('C', '2026-03-02');
    const ops = buildMergeOps(remote({ completed: [server] }), { ...empty, completed: [local, fresh] }, new Set([`completed:${local.id}`, `completed:${fresh.id}`]));
    expect(ops).toEqual([]);
  });

  it('profil z serwera dostaje lokalne id "me"; brak profilu na serwerze nie usuwa lokalnego', () => {
    const p = { ...defaultProfile(TS), name: 'Serwer' };
    expect(buildMergeOps(remote({ profile: p }), empty, new Set())).toEqual([{ store: 'profile', put: [{ ...p, id: 'me' }] }]);
    expect(buildMergeOps(remote({}), { ...empty, profile: [defaultProfile(TS)] }, new Set())).toEqual([]);
    expect(buildMergeOps(remote({ profile: p }), empty, new Set(['profile:me']))).toEqual([]);
  });
});

describe('kolejka synchronizacji', () => {
  const e = (store: OutboxEntry['store'], op: OutboxEntry['op'], q = TS): OutboxEntry => ({ key: `${store}:${op}`, store, entityId: op, op, rev: 1, queuedAt: q, attempts: 0, lastError: null });

  it('zapisy w kolejności kluczy obcych, usunięcia na końcu (dzieci przed rodzicami)', () => {
    const order = pushOrder([e('completed', 'put'), e('events', 'put'), e('cycles', 'del'), e('planned', 'put'), e('cycles', 'put'), e('completed', 'del'), e('profile', 'put')]);
    expect(order.map((x) => `${x.store}:${x.op}`)).toEqual([
      'profile:put', 'cycles:put', 'planned:put', 'completed:put', 'events:put', 'completed:del', 'cycles:del',
    ]);
  });
});

describe('konto', () => {
  it('błędy Neon Auth po polsku', () => {
    expect(toAuthFailure({ code: 'INVALID_EMAIL_OR_PASSWORD', status: 401, message: 'Invalid' }).message).toBe('Nieprawidłowy email lub hasło.');
    expect(toAuthFailure({ status: 429, message: 'Too many' }).message).toMatch(/Za dużo prób/);
    expect(toAuthFailure(new TypeError('Failed to fetch')).code).toBe('NETWORK');
    expect(toAuthFailure({ message: 'Coś innego' }).message).toBe('Coś innego');
  });

  it('powrót po zalogowaniu tylko na ścieżki wewnętrzne', () => {
    expect(safeReturnUrl('/progress')).toBe('/progress');
    expect(safeReturnUrl('//evil.example')).toBe('/');
    expect(safeReturnUrl('https://evil.example')).toBe('/');
    expect(safeReturnUrl('/login')).toBe('/');
    expect(safeReturnUrl(undefined)).toBe('/');
  });

  it('podsumowanie danych sprzed kont', () => {
    const data: AppData = {
      profile: [defaultProfile(TS)], cycles: [createCycle('C', '2026-01-01', P0, TS)], planned: [plannedItem('A', '2026-01-02')], completed: [workout('A', '2026-01-02')],
      readiness: [], tests: [], events: [], reports: [], drafts: [], assessments: [baseline({ climbing: climbingTest('6a', []) })],
    };
    expect(summarizeLegacy(data)).toEqual({ workouts: 1, assessments: 1, cycles: 1, readiness: 0, total: 4 });
    expect(summarizeLegacy({ ...data, cycles: [], planned: [], completed: [], assessments: [] }).total).toBe(0);
  });
});
