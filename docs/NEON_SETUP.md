# ClimbProgress – konfiguracja Neon (baza, Neon Auth, Data API)

## Stan zweryfikowany (18.11.2026)

| Element | Stan | Jak sprawdzono |
|---|---|---|
| Projekt Vercel `climb_progress` | istnieje, produkcja: https://climbprogress.vercel.app | `vercel project ls` |
| Baza Neon przez Vercel Marketplace | **podłączona** – zasób `neon-fulvous-prism` | `vercel integration list` |
| Zmienne `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `PG*`, `POSTGRES_*` | ustawione (Preview, Production) | `vercel env ls` |
| Neon Auth | **włączony** – są `NEON_AUTH_BASE_URL` i `VITE_NEON_AUTH_URL` | `vercel env ls` |
| Neon Data API | **prawdopodobnie wyłączone** – brak zmiennej z adresem Data API; potwierdzi `npm run db:check` | – |
| Wartości zmiennych | niedostępne lokalnie – Vercel oznacza je jako *Sensitive* (`vercel env pull` zwraca `[SENSITIVE]`) | `vercel env pull` |
| Środowisko Development w Vercel | brak zmiennych Neon | `vercel env ls` |

Aplikacja nie używa żadnego connection stringu w przeglądarce. Do Angulara trafiają wyłącznie dwa publiczne adresy:
adres Neon Auth (`VITE_NEON_AUTH_URL`) i adres Data API (wyprowadzany z adresu Auth tą samą regułą co w `@neon/neon-js`:
`…​.neonauth.…/<db>/auth` → `…​.apirest.…/<db>/rest/v1`, można nadpisać przez `NEON_DATA_API_URL`).

## 1. Neon Console – co trzeba włączyć

Otwórz projekt: Vercel → **Storage** → `neon-fulvous-prism` → **Open in Neon** (albo `vercel integration open neon`).

### 1.1 Data API (wymagane)

1. **Data API** w menu projektu → wybierz gałąź **produkcyjną** (tę, do której wskazuje `DATABASE_URL` w Vercel).
2. Zaznacz **Use Neon Auth**.
3. Zostaw zaznaczone **Grant public schema access** (migracja `0001_grants` i tak nadaje uprawnienia jawnie).
4. **Enable Data API**.

Po włączeniu w bazie pojawiają się role `authenticated` i `anonymous` oraz funkcja `auth.user_id()` – migracje ich wymagają.

> Schemat `auth` należy do Neon (`cloud_admin`), a rola `authenticated` nie ma do niego `USAGE`. Nie można tego zmienić,
> bo `neondb_owner` nie ma `GRANT OPTION`. Dlatego polityki RLS i domyślne `user_id` korzystają z
> `app.current_user_id()` (`SECURITY DEFINER`, właściciel bazy, zwraca tylko `sub` bieżącej sesji, migracja `0003`).
> Schemat `app` nie jest wystawiony przez Data API.

> Data API nie działa przy włączonym IP Allow / Private Networking.

### 1.2 Neon Auth – email i hasło

**Settings → Better Auth** (lub **Auth → Configuration**):

- **Sign-up with Email** – włączone.
- **Verify at Sign-up** – włączone (bez potwierdzenia emaila nie da się zalogować; aplikacja dodatkowo wymaga `emailVerified` w guardzie).
- Metoda weryfikacji: **Verification code** – działa ze współdzielonym dostawcą email Neon. Linki wymagają własnego dostawcy (SMTP);
  aplikacja obsługuje oba warianty (`/verify-email?token=…`, `/reset-password?token=…`).
- Odzyskiwanie hasła jest dostępne, gdy włączone jest logowanie emailem. Aplikacja najpierw prosi o **kod** resetu,
  a gdy projekt go nie obsługuje – o **link**.
- Usuwanie konta: aplikacja wywołuje `deleteUser`. Jeśli Neon Auth go odrzuci, dane treningowe i tak zostaną usunięte,
  a użytkownik dostanie komunikat, że konto logowania trzeba usunąć w **Auth → Users**.

### 1.3 Domeny (wymagane dla produkcji)

**Auth → Configuration → Domains → Add domain**: `https://climbprogress.vercel.app`
(i każdą inną domenę produkcyjną). `localhost` na dowolnym porcie jest dozwolony domyślnie.
Bez tego logowanie z Vercel kończy się błędem `INVALID_ORIGIN` (aplikacja pokaże czytelny komunikat).

Uwaga: losowe adresy *Preview Deployments* Vercel nie są na liście – logowanie na nich nie zadziała, dopóki ich nie dodasz.

## 2. Środowisko developerskie (migracje i testy RLS)

Migracje uruchamiamy lokalnie albo w CI – **nigdy z przeglądarki**.

1. Utwórz `.env.local` (jest w `.gitignore`):

   ```bash
   # Neon Console → Connect → wybierz gałąź produkcyjną, wyłącz „Connection pooling” → skopiuj
   DATABASE_URL_UNPOOLED="postgresql://…"
   # Neon Console → Auth → Configuration → Auth URL (ten sam, co VITE_NEON_AUTH_URL w Vercel)
   NEON_AUTH_URL="https://…​.neonauth.…/neondb/auth"
   ```

   Lepiej: utwórz w Neon osobną gałąź `dev` i użyj jej adresów lokalnie – Neon Auth ma osobne środowisko per gałąź.

2. Sprawdź konfigurację: `npm run db:check` – wypisze, czego brakuje (Neon Auth, Data API, role, tabele, RLS).
3. Zastosuj migracje: `npm run db:migrate` (`drizzle/0000_init.sql` – tabele, indeksy, ograniczenia, RLS i polityki;
   `drizzle/0001_grants.sql` – uprawnienia `authenticated`, brak dostępu dla `anonymous`;
   `0002` – bez efektu na Neon, zostaje w historii; `0003` – `app.current_user_id()`;
   `0004` – polityki i domyślne `user_id` przez `app.current_user_id()`;
   `0005` – Progressive Overload: `hangboard_logs.hold_times_seconds`, `hangboard_logs.technique_ok`,
   `workout_sessions.follow_up`, `adaptation_events.track`).
   **Migrację `0005` uruchom przed wdrożeniem frontendu z silnikiem progresji** – Data API odrzuca zapisy z nieznanymi kolumnami.
4. Ponownie `npm run db:check` – wszystko powinno być ✔.
5. Testy izolacji: `npm run test:rls`
   - część SQL (zawsze przy `DATABASE_URL`): wszystko w jednej transakcji z `ROLLBACK`, nic nie zostaje w bazie;
   - część end-to-end przez prawdziwe JWT Neon Auth + Data API – po dodaniu do `.env.local` dwóch kont testowych
     z potwierdzonym emailem: `TEST_USER_A_EMAIL`, `TEST_USER_A_PASSWORD`, `TEST_USER_B_EMAIL`, `TEST_USER_B_PASSWORD`.
6. `npm start` – `scripts/neon-env.mjs` wygeneruje `src/app/core/config/neon-env.generated.ts` z `NEON_AUTH_URL`.

Zmiana schematu: edytuj `db/schema.ts` → `npm run db:generate` → przejrzyj SQL w `drizzle/` → `npm run db:migrate`.

## 3. Vercel

- Build: `vercel.json` (`npm ci`, `npm run build`, katalog `dist/climb_progress/browser`, przekierowanie SPA na `index.html`).
- `npm run build` uruchamia najpierw `scripts/neon-env.mjs`, który czyta `VITE_NEON_AUTH_URL` (już ustawione przez integrację).
  Nowych zmiennych dodawać nie trzeba. `DATABASE_URL` nie jest czytany w buildzie frontendu.
- Jeśli `npm run db:check` pokaże inny adres Data API niż wyprowadzony – dodaj `NEON_DATA_API_URL` w Vercel (Production + Preview).

## 4. Lista odbioru

| # | Test | Jak sprawdzić |
|---|---|---|
| 1 | Rejestracja | `/register` → email + hasło ×2 → przekierowanie na `/verify-email` |
| 2 | Potwierdzenie emaila | kod z wiadomości → dashboard (albo logowanie z komunikatem „Email potwierdzony”) |
| 3 | Logowanie / wylogowanie | `/login`; Profil → Konto → Wyloguj → `/login`, żadnych danych w widokach |
| 4 | Przywrócenie sesji | zamknij kartę, otwórz ponownie → od razu dashboard |
| 5 | Zapis treningu | wykonaj trening → `select * from workout_sessions, route_logs, hangboard_logs` w SQL Editor |
| 6 | Zapis Baseline Test | `assessment_sessions` + `assessment_results` (9c, próby) + `recovery_measurements` (0/60/120/180 s) |
| 7 | Zapis Max Hang | `hangboard_logs` (krawądka, obciążenie, odciążenie, czas, `total_load_kg`) |
| 8 | Historia po ponownym logowaniu | wyloguj (lokalna kopia jest usuwana, gdy wszystko wysłane) → zaloguj → Historia / Progres z Neon |
| 9 | Izolacja | `npm run test:rls` + drugie konto w innej przeglądarce nie widzi danych pierwszego |
| 10 | Offline | DevTools → Network → Offline → wykonaj trening → status „Offline · N do wysłania” |
| 11 | Synchronizacja | przywróć sieć → status „Zsynchronizowano”, rekordy w Neon |
| 12 | Brak duplikatów | powtórz synchronizację / przerwij w trakcie → liczba wierszy bez zmian (upsert po UUID) |
| 13 | Vercel Production | po merge do `main`: rejestracja i trening na https://climbprogress.vercel.app |
