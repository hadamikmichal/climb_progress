// Generuje src/app/core/config/neon-env.generated.ts z publicznych adresów Neon Auth i Data API.
// Uruchamiany automatycznie przed `ng serve` / `ng build` / `ng test` (npm pre-skrypty).
//
// Źródła (pierwsza niepusta wartość):
//   auth:    NEON_AUTH_URL, VITE_NEON_AUTH_URL (tworzona przez integrację Neon ↔ Vercel)
//   dataApi: NEON_DATA_API_URL, VITE_NEON_DATA_API_URL, albo wyprowadzony z adresu auth
//            (…​.neonauth.…/<db>/auth → …​.apirest.…/<db>/rest/v1 – ta sama reguła co w @neon/neon-js)
//
// Do przeglądarki trafiają WYŁĄCZNIE te dwa publiczne adresy. DATABASE_URL i hasła nigdy nie są tu czytane.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: resolve(root, '.env.local'), quiet: true });

const pick = (...keys) => keys.map((k) => (process.env[k] ?? '').trim()).find((v) => v && v !== '[SENSITIVE]') ?? '';

function validUrl(v, name) {
  if (!v) return '';
  let u;
  try { u = new URL(v); } catch { throw new Error(`${name}: niepoprawny URL`); }
  if (u.protocol !== 'https:' && u.hostname !== 'localhost') throw new Error(`${name}: wymagany https`);
  if (u.username || u.password || u.search) throw new Error(`${name}: URL nie może zawierać danych logowania ani parametrów`);
  return v.replace(/\/+$/, '');
}

export function deriveDataApiUrl(authUrl) {
  if (!authUrl) return '';
  const u = new URL(authUrl);
  const labels = u.hostname.split('.');
  if (labels[1] !== 'neonauth') return '';
  labels[1] = 'apirest';
  u.hostname = labels.join('.');
  u.pathname = u.pathname.replace(/\/+$/, '').replace(/\/auth$/, '') + '/rest/v1';
  return u.toString().replace(/\/+$/, '');
}

const authUrl = validUrl(pick('NEON_AUTH_URL', 'VITE_NEON_AUTH_URL'), 'NEON_AUTH_URL');
const dataApiUrl = validUrl(pick('NEON_DATA_API_URL', 'VITE_NEON_DATA_API_URL') || deriveDataApiUrl(authUrl), 'NEON_DATA_API_URL');

const out = resolve(root, 'src/app/core/config/neon-env.generated.ts');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `// Plik generowany przez scripts/neon-env.mjs – nie edytuj, nie commituj.
export const NEON_ENV = ${JSON.stringify({ authUrl, dataApiUrl }, null, 2)} as const;
`);
console.log(`[neon-env] auth: ${authUrl ? 'ustawiony' : 'BRAK'} · data API: ${dataApiUrl ? 'ustawiony' : 'BRAK'}`);
