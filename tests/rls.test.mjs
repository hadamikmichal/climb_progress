// Testy izolacji danych między użytkownikami (RLS).
//
//   npm run test:rls
//
// Część 1 – poziom SQL (wymaga DATABASE_URL w .env.local): w JEDNEJ transakcji wycofywanej na końcu
//   przełącza rolę na `authenticated` i podstawia claim `sub` tak, jak robi to Neon Data API,
//   a następnie sprawdza, że użytkownik B nie widzi / nie zmienia / nie usuwa danych użytkownika A.
//   Nic nie zostaje w bazie (ROLLBACK).
//
// Część 2 – end-to-end przez Neon Auth + Data API (opcjonalna, wymaga dwóch kont testowych z potwierdzonym
//   emailem): TEST_USER_A_EMAIL, TEST_USER_A_PASSWORD, TEST_USER_B_EMAIL, TEST_USER_B_PASSWORD oraz NEON_AUTH_URL.
//   Używa prawdziwych JWT wydanych przez Neon Auth. Tworzy rekordy na koncie A i usuwa je na końcu.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { Pool } from '@neondatabase/serverless';

config({ path: '.env.local', quiet: true });

const DB_URL = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
const TABLES = [
  'profiles', 'training_cycles', 'planned_workouts', 'workout_sessions', 'route_logs', 'hangboard_logs',
  'assessment_sessions', 'assessment_results', 'recovery_measurements', 'readiness_checks', 'adaptation_events',
];

describe('RLS – poziom SQL (rola authenticated + claim sub)', { skip: !DB_URL && 'brak DATABASE_URL w .env.local' }, () => {
  let pool;
  let c;
  const A = `rls-test-a-${randomUUID()}`;
  const B = `rls-test-b-${randomUUID()}`;
  const ids = { cycle: randomUUID(), session: randomUUID(), route: randomUUID(), hang: randomUUID(), assessment: randomUUID(), readiness: randomUUID(), planned: randomUUID(), event: randomUUID() };
  const TS = new Date().toISOString();
  const json = (v) => JSON.stringify(v);

  /** Tożsamość jak w Data API: rola authenticated + request.jwt.claims (pg_session_jwt → auth.user_id()) */
  async function as(sub) {
    await c.query('RESET ROLE');
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [json({ sub, role: 'authenticated' })]);
    await c.query('SET LOCAL ROLE authenticated');
  }

  /** Oczekiwany błąd bez psucia transakcji */
  async function rejects(sql, params, pattern) {
    await c.query('SAVEPOINT sp');
    try {
      await c.query(sql, params);
      assert.fail(`Zapytanie powinno zostać odrzucone: ${sql}`);
    } catch (e) {
      if (e.code === 'ERR_ASSERTION') throw e;
      if (pattern) assert.match(`${e.code} ${e.message}`, pattern);
    } finally {
      await c.query('ROLLBACK TO SAVEPOINT sp');
    }
  }

  before(async () => {
    pool = new Pool({ connectionString: DB_URL });
    c = await pool.connect();
    // pg_session_jwt inicjalizuje się przy pierwszym wywołaniu w sesji – wywołane od razu z roli
    // authenticated (przez funkcję SECURITY DEFINER) zwraca jednorazowo NULL. Rozgrzewka jako właściciel.
    await c.query('SELECT auth.user_id()');
    await c.query('BEGIN');
  });

  after(async () => {
    await c?.query('ROLLBACK').catch(() => {});
    c?.release();
    await pool?.end();
  });

  it('app.current_user_id() zwraca sub z tokenu', async () => {
    await as(A);
    const { rows } = await c.query('SELECT app.current_user_id() AS uid');
    assert.equal(rows[0].uid, A, 'pg_session_jwt nie odczytuje request.jwt.claims – sprawdź konfigurację Data API');
    await as(B);
    const r2 = await c.query('SELECT app.current_user_id() AS uid');
    assert.equal(r2.rows[0].uid, B);
  });

  it('A zapisuje własne dane – user_id nadaje baza, nie klient', async () => {
    await as(A);
    await c.query(
      `INSERT INTO training_cycles (id, name, start_date, weeks, status, protocol_version, deload_weeks, control_test_after_weeks, params, initial_params, created_at, updated_at)
       VALUES ($1, 'Cykl testowy', '2026-03-02', 6, 'active', '1.0', '[4]', '[3]', '{}', '{}', $2, $2)`,
      [ids.cycle, TS],
    );
    await c.query(
      `INSERT INTO planned_workouts (id, cycle_id, scheduled_date, original_date, week, workout_type, status, plan_data, created_at, updated_at)
       VALUES ($1, $2, '2026-03-05', '2026-03-05', 1, 'B', 'planned', '{}', $3, $3)`,
      [ids.planned, ids.cycle, TS],
    );
    await c.query(
      `INSERT INTO adaptation_events (id, cycle_id, occurred_at, kind, reason) VALUES ($1, $2, $3, 'plan', 'test RLS')`,
      [ids.event, ids.cycle, TS],
    );
    await c.query(
      `INSERT INTO workout_sessions (id, cycle_id, workout_type, week, session_date, started_at, completed_at, duration_seconds, status, prescription, exercises, sets, created_at, updated_at)
       VALUES ($1, $2, 'B', 1, '2026-03-05', $3, $3, 3600, 'full', '{}', '[]', '[]', $3, $3)`,
      [ids.session, ids.cycle, TS],
    );
    await c.query(
      `INSERT INTO route_logs (id, workout_session_id, route_order, grade, completed, logged_at) VALUES ($1, $2, 1, '6a', true, $3)`,
      [ids.route, ids.session, TS],
    );
    await c.query(
      `INSERT INTO hangboard_logs (id, workout_session_id, session_date, board, hold_type, edge_label, edge_depth_mm, grip_type, hold_duration_seconds, sets_planned, sets_done, added_weight_kg, body_mass_kg, created_at)
       VALUES ($1, $2, '2026-03-05', 'Beastmaker 2000', 'edge', '20 mm', 20, 'half_crimp', 10, 3, 3, 5, 70, $3)`,
      [ids.hang, ids.session, TS],
    );
    await c.query(
      `INSERT INTO assessment_sessions (id, cycle_id, assessment_type, protocol_version, status, started_at, payload, created_at, updated_at)
       VALUES ($1, $2, 'BASELINE', '1.0', 'completed', $3, '{}', $3, $3)`,
      [ids.assessment, ids.cycle, TS],
    );
    await c.query(`INSERT INTO assessment_results (assessment_session_id, category, metric_key, value_numeric, unit) VALUES ($1, 'score', 'nine_c.total', 24, 'pkt')`, [ids.assessment]);
    await c.query(`INSERT INTO recovery_measurements (assessment_session_id, elapsed_seconds, forearm_pump) VALUES ($1, 0, 7), ($1, 60, 5)`, [ids.assessment]);
    await c.query(
      `INSERT INTO readiness_checks (id, check_date, checked_at, sleep_quality, wellbeing, fatigue) VALUES ($1, '2026-03-05', $2, 4, 4, 2)`,
      [ids.readiness, TS],
    );
    await c.query(
      `INSERT INTO profiles (display_name, preferred_training_days, hangboard) VALUES ('A', '{"A":1,"B":3,"C":6}', '{}')`,
    );
    const { rows } = await c.query('SELECT user_id FROM training_cycles WHERE id = $1', [ids.cycle]);
    assert.equal(rows[0].user_id, A);
    const hang = await c.query('SELECT total_load_kg::float AS t, successful FROM hangboard_logs WHERE id = $1', [ids.hang]);
    assert.deepEqual(hang.rows[0], { t: 75, successful: true });
  });

  it('A widzi własne dane', async () => {
    await as(A);
    for (const t of TABLES) {
      const { rows } = await c.query(`SELECT count(*)::int AS n FROM ${t}`);
      assert.ok(rows[0].n >= 1, `A powinien widzieć swoje wiersze w ${t}`);
    }
  });

  it('B nie widzi żadnych danych A', async () => {
    await as(B);
    for (const t of TABLES) {
      const { rows } = await c.query(`SELECT count(*)::int AS n FROM ${t} WHERE user_id = $1`, [A]);
      assert.equal(rows[0].n, 0, `B widzi dane A w ${t}`);
    }
    const byId = await c.query('SELECT 1 FROM workout_sessions WHERE id = $1', [ids.session]);
    assert.equal(byId.rowCount, 0);
  });

  it('B nie może zmienić ani usunąć danych A', async () => {
    await as(B);
    const u = await c.query(`UPDATE workout_sessions SET notes = 'hack' WHERE id = $1`, [ids.session]);
    assert.equal(u.rowCount, 0);
    const u2 = await c.query(`UPDATE training_cycles SET user_id = $2 WHERE id = $1`, [ids.cycle, B]);
    assert.equal(u2.rowCount, 0);
    for (const [t, id] of [['route_logs', ids.route], ['hangboard_logs', ids.hang], ['assessment_sessions', ids.assessment], ['readiness_checks', ids.readiness], ['training_cycles', ids.cycle]]) {
      const d = await c.query(`DELETE FROM ${t} WHERE id = $1`, [id]);
      assert.equal(d.rowCount, 0, `B usunął wiersz A z ${t}`);
    }
    const d2 = await c.query('DELETE FROM assessment_results WHERE assessment_session_id = $1', [ids.assessment]);
    assert.equal(d2.rowCount, 0);
  });

  it('B nie może podszyć się pod A (user_id z klienta jest odrzucany)', async () => {
    await as(B);
    await rejects(
      `INSERT INTO readiness_checks (id, user_id, check_date, checked_at, sleep_quality, wellbeing, fatigue) VALUES ($1, $2, '2026-03-05', now(), 3, 3, 3)`,
      [randomUUID(), A],
      /row-level security|42501/,
    );
  });

  it('B nie może nadpisać rekordu A upsertem po id', async () => {
    await as(B);
    await rejects(
      `INSERT INTO readiness_checks (id, check_date, checked_at, sleep_quality, wellbeing, fatigue) VALUES ($1, '2026-03-06', now(), 1, 1, 1)
       ON CONFLICT (id) DO UPDATE SET notes = 'hack'`,
      [ids.readiness],
      /row-level security|duplicate key|42501|23505/,
    );
  });

  it('B nie może podpiąć swojego rekordu pod trening A (złożony klucz obcy)', async () => {
    await as(B);
    await rejects(
      `INSERT INTO route_logs (id, workout_session_id, route_order, grade, completed, logged_at) VALUES ($1, $2, 1, '6a', true, now())`,
      [randomUUID(), ids.session],
      /foreign key|23503/,
    );
  });

  it('A nadal ma komplet danych po próbach B', async () => {
    await as(A);
    const { rows } = await c.query(`SELECT notes FROM workout_sessions WHERE id = $1`, [ids.session]);
    assert.equal(rows[0].notes, '');
    const r = await c.query('SELECT count(*)::int AS n FROM recovery_measurements WHERE assessment_session_id = $1', [ids.assessment]);
    assert.equal(r.rows[0].n, 2);
  });

  it('rola anonymous nie ma dostępu do tabel', async () => {
    await c.query('RESET ROLE');
    await c.query('SAVEPOINT anon');
    try {
      await c.query('SET LOCAL ROLE anonymous');
      for (const t of TABLES) {
        await c.query('SAVEPOINT t');
        await assert.rejects(c.query(`SELECT 1 FROM ${t} LIMIT 1`), /permission denied/);
        await c.query('ROLLBACK TO SAVEPOINT t');
      }
    } finally {
      await c.query('ROLLBACK TO SAVEPOINT anon');
    }
  });

  it('wszystkie tabele mają włączone RLS i 4 polityki', async () => {
    await c.query('RESET ROLE');
    const { rows } = await c.query(
      `SELECT c.relname, c.relrowsecurity, count(p.polname)::int AS policies
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_policy p ON p.polrelid = c.oid
       WHERE n.nspname = 'public' AND c.relname = ANY($1) GROUP BY 1, 2 ORDER BY 1`,
      [TABLES],
    );
    assert.equal(rows.length, TABLES.length, 'brakuje tabel – uruchom npm run db:migrate');
    for (const r of rows) {
      assert.equal(r.relrowsecurity, true, `RLS wyłączone: ${r.relname}`);
      assert.equal(r.policies, 4, `${r.relname}: oczekiwano 4 polityk (SELECT/INSERT/UPDATE/DELETE)`);
    }
    // każda polityka porównuje user_id z app.current_user_id() (auth.* jest niedostępne dla authenticated)
    const pol = await c.query(
      `SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1)
         AND coalesce(qual, with_check) NOT LIKE '%app.current_user_id()%'`,
      [TABLES],
    );
    assert.deepEqual(pol.rows, [], 'polityki bez app.current_user_id()');
  });
});

/* ------------------------------------------------------------------------------------------------ */

const AUTH_URL = (process.env.NEON_AUTH_URL || process.env.VITE_NEON_AUTH_URL || '').replace(/\/+$/, '');
const E2E = ['TEST_USER_A_EMAIL', 'TEST_USER_A_PASSWORD', 'TEST_USER_B_EMAIL', 'TEST_USER_B_PASSWORD'].every((k) => process.env[k]) && AUTH_URL;

function dataApiUrl() {
  if (process.env.NEON_DATA_API_URL) return process.env.NEON_DATA_API_URL.replace(/\/+$/, '');
  const u = new URL(AUTH_URL);
  const l = u.hostname.split('.');
  l[1] = 'apirest';
  u.hostname = l.join('.');
  u.pathname = u.pathname.replace(/\/auth$/, '') + '/rest/v1';
  return u.toString().replace(/\/+$/, '');
}

/** Logowanie przez Neon Auth (Better Auth) → JWT dla Data API (nagłówek set-auth-jwt z get-session) */
async function jwtFor(email, password) {
  const origin = process.env.TEST_ORIGIN || 'http://localhost:4200';
  const r = await fetch(`${AUTH_URL}/sign-in/email`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ email, password }),
  });
  assert.equal(r.status, 200, `logowanie ${email}: ${r.status} ${await r.clone().text()}`);
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const s = await fetch(`${AUTH_URL}/get-session`, { headers: { cookie, origin } });
  const jwt = s.headers.get('set-auth-jwt') || r.headers.get('set-auth-jwt');
  assert.ok(jwt, 'Neon Auth nie zwrócił JWT (nagłówek set-auth-jwt)');
  return jwt;
}

describe('RLS – end-to-end przez Neon Auth i Data API', { skip: !E2E && 'brak kont testowych TEST_USER_A_*/TEST_USER_B_*' }, () => {
  let tokenA;
  let tokenB;
  const api = (token, path, init = {}) =>
    fetch(`${dataApiUrl()}/${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation', ...init.headers } });
  const id = randomUUID();

  before(async () => {
    tokenA = await jwtFor(process.env.TEST_USER_A_EMAIL, process.env.TEST_USER_A_PASSWORD);
    tokenB = await jwtFor(process.env.TEST_USER_B_EMAIL, process.env.TEST_USER_B_PASSWORD);
  });

  after(async () => {
    if (tokenA) await api(tokenA, `readiness_checks?id=eq.${id}`, { method: 'DELETE' });
  });

  it('A zapisuje ocenę gotowości (user_id z tokenu)', async () => {
    const r = await api(tokenA, 'readiness_checks', {
      method: 'POST', body: JSON.stringify({ id, check_date: '2026-03-05', checked_at: new Date().toISOString(), sleep_quality: 4, wellbeing: 4, fatigue: 2, notes: 'e2e' }),
    });
    assert.equal(r.status, 201, await r.text());
  });

  it('B nie widzi, nie zmienia i nie usuwa rekordu A', async () => {
    const g = await api(tokenB, `readiness_checks?id=eq.${id}`);
    assert.deepEqual(await g.json(), []);
    const u = await api(tokenB, `readiness_checks?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ notes: 'hack' }) });
    assert.deepEqual(await u.json(), []);
    const d = await api(tokenB, `readiness_checks?id=eq.${id}`, { method: 'DELETE' });
    assert.deepEqual(await d.json(), []);
  });

  it('A nadal widzi swój rekord bez zmian', async () => {
    const g = await api(tokenA, `readiness_checks?id=eq.${id}`);
    const rows = await g.json();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].notes, 'e2e');
  });

  it('bez tokenu brak dostępu', async () => {
    const r = await fetch(`${dataApiUrl()}/readiness_checks?select=id&limit=1`);
    assert.ok([401, 403].includes(r.status) || (await r.json()).length === 0);
  });
});
