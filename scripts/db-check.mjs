// Weryfikacja konfiguracji Neon dla ClimbProgress (tylko odczyt).
//   npm run db:check
// Wymaga DATABASE_URL w .env.local. Nie wypisuje żadnych sekretów.
import { config } from 'dotenv';
import { neon } from '@neondatabase/serverless';
import { deriveDataApiUrl } from './neon-env.mjs';

config({ path: '.env.local', quiet: true });
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
const authUrl = (process.env.NEON_AUTH_URL || process.env.VITE_NEON_AUTH_URL || '').replace(/\/+$/, '');
const dataApi = (process.env.NEON_DATA_API_URL || deriveDataApiUrl(authUrl) || '').replace(/\/+$/, '');

let failed = 0;
const line = (ok, label, hint = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '✔' : '✘'} ${label}${!ok && hint ? `\n    → ${hint}` : ''}`);
};

if (!url) {
  line(false, 'DATABASE_URL w .env.local', 'Skopiuj connection string z Neon Console → Connect (patrz docs/NEON_SETUP.md).');
  process.exit(1);
}
const sql = neon(url);
const one = async (q) => (await q)[0] ?? {};

const v = await one(sql`select current_setting('server_version_num')::int as v, current_database() as db`);
line(v.v >= 150000, `PostgreSQL ${Math.floor(v.v / 10000)} (baza ${v.db})`, 'Wymagany PostgreSQL 15+ (UNIQUE NULLS NOT DISTINCT).');

const ns = await sql`select nspname from pg_namespace where nspname in ('neon_auth','auth')`;
const has = (n) => ns.some((r) => r.nspname === n);
line(has('neon_auth'), 'Neon Auth: schemat neon_auth', 'Włącz Neon Auth: Neon Console → projekt → Auth → Enable.');
line(has('auth'), 'Data API: schemat auth (pg_session_jwt)', 'Włącz Data API: Neon Console → Data API → Enable (z opcją „Use Neon Auth”).');

const fn = await one(sql`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='auth' and p.proname='user_id'`);
line(fn.n > 0, 'Funkcja auth.user_id()', 'Pojawia się po włączeniu Data API.');

const roles = (await sql`select rolname from pg_roles where rolname in ('authenticated','anonymous')`).map((r) => r.rolname);
line(roles.includes('authenticated'), 'Rola authenticated', 'Pojawia się po włączeniu Data API.');
line(roles.includes('anonymous'), 'Rola anonymous', 'Pojawia się po włączeniu Data API.');

const tables = ['profiles', 'training_cycles', 'planned_workouts', 'workout_sessions', 'route_logs', 'hangboard_logs', 'assessment_sessions', 'assessment_results', 'recovery_measurements', 'readiness_checks', 'adaptation_events'];
const t = await sql`
  select c.relname, c.relrowsecurity as rls, count(p.polname)::int as policies,
         has_table_privilege('authenticated', c.oid, 'select,insert,update,delete') as granted
  from pg_class c join pg_namespace n on n.oid=c.relnamespace left join pg_policy p on p.polrelid=c.oid
  where n.nspname='public' and c.relkind='r' and c.relname = any(${tables}) group by 1,2,c.oid`.catch(() => []);
const byName = new Map(t.map((r) => [r.relname, r]));
for (const name of tables) {
  const r = byName.get(name);
  line(!!r && r.rls && r.policies === 4 && r.granted, `Tabela ${name}: RLS + 4 polityki + uprawnienia authenticated`, r ? `rls=${r.rls}, polityki=${r.policies}, grant=${r.granted}` : 'Brak tabeli – uruchom npm run db:migrate.');
}

if (dataApi) {
  try {
    const r = await fetch(`${dataApi}/training_cycles?select=id&limit=1`);
    // bez JWT: 401 (wymagany token) albo pusta lista (rola anonymous bez wierszy) – nigdy dane
    const body = r.status === 200 ? await r.json() : [];
    line(r.status !== 404 && (!Array.isArray(body) || body.length === 0), `Data API odpowiada (${r.status}) i bez tokenu nie zwraca danych`, r.status === 404 ? 'Data API nie jest włączone dla tej gałęzi/bazy.' : 'Rola anonymous widzi dane – sprawdź uprawnienia.');
  } catch (e) {
    line(false, 'Data API osiągalne', String(e));
  }
} else {
  line(false, 'Adres Data API', 'Ustaw NEON_AUTH_URL (lub NEON_DATA_API_URL) w .env.local.');
}

console.log(failed ? `\n${failed} problem(ów) do naprawienia.` : '\nKonfiguracja Neon kompletna.');
process.exit(failed ? 1 : 0);
