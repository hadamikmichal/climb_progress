# ClimbProgress

System planowania, realizacji i analizy treningu wspinaczkowego. Konta email + hasło (Neon Auth), dane w bazie Neon Postgres z izolacją użytkowników (RLS), kopia w IndexedDB do pracy offline. PWA – można go zainstalować na telefonie i używać na ścianie.

## Uruchomienie

```bash
npm install        # .npmrc ustawia legacy-peer-deps (npm 10.9)
npm start          # http://localhost:4200
npm test           # testy jednostkowe (Vitest)
npm run build      # build produkcyjny z service workerem → dist/climb_progress/browser
npm run db:check   # weryfikacja Neon: Auth, Data API, tabele, RLS (wymaga .env.local)
npm run db:migrate # migracje Drizzle (tylko lokalnie / CI)
npm run test:rls   # testy izolacji danych między użytkownikami
```

Konfiguracja Neon (Data API, Neon Auth, domeny, `.env.local`): **[docs/NEON_SETUP.md](docs/NEON_SETUP.md)**.

Service worker działa tylko w buildzie produkcyjnym. Do testów widoków z inną datą: `?today=RRRR-MM-DD` w adresie.

## Stack

Angular 21 (standalone components, sygnały, zoneless), TypeScript, SCSS (własne komponenty UI), Chart.js (ładowany leniwie), IndexedDB (własny wrapper bez zależności), `@angular/service-worker` + manifest PWA. Neon Postgres + Neon Auth (zarządzany Better Auth) + Neon Data API przez `@neon/neon-js`, Drizzle ORM (schemat, migracje, typy), Vercel.

## Architektura

```
src/app/
  core/models/models.ts     modele: UserProfile, TrainingCycle, WorkoutTemplate, PlannedWorkout, CompletedWorkout,
                            Exercise, RouteLog, HangboardLog, ReadinessCheck, BaselineTest, ProgressTest, WeeklyReport…
  core/logic/               czysta logika treningowa (bez Angulara) + testy jednostkowe
    plan.ts                 cykl, plan 6 tygodni, deload, testy kontrolne
    scheduling.ts           przekładanie / pomijanie (Przypadek B), walidacja regeneracji
    progression.ts          wspólne narzędzia progresji (poziomy, opisy, zmiana jednego parametru)
    overload/               Progressive Overload Engine: ProgressiveOverloadService (wspólny algorytm, status, widok)
                            + HangboardProgressionService, AerobicProgressionService,
                              PowerEnduranceProgressionService, HardRoutesProgressionService
    readiness.ts            ocena gotowości (Przypadek D)
    reports.ts, stats.ts    raporty tygodniowe, porównanie testów, dane do wykresów
  core/data/                IndexedDB (osobna baza na konto + kolejka synchronizacji), store na sygnałach, eksport/import JSON
  core/auth/                Neon Auth: AuthService, AuthStore (sygnały), authGuard / guestGuard
  core/repositories/        Neon Data API: Profile, TrainingCycle, Workout, Route, Hangboard, Assessment, Readiness
  core/sync/                mapowanie model ↔ wiersze, scalanie, SyncService (outbox, offline, ponowienia)
  core/session/             cykl życia danych konta, import danych sprzed kont
db/schema.ts                schemat PostgreSQL (Drizzle) z politykami RLS; migracje SQL w drizzle/
  features/                 dashboard, plan, session (aktywny trening), test, history, progress, profile, readiness
  shared/                   skala RPE/pompowania, tak/nie, timer, wykres, arkusz
```

Każda mutacja jest najpierw zapisywana w IndexedDB (razem z wpisem w kolejce synchronizacji – w jednej transakcji), potem aktualizuje sygnał, a w tle trafia do Neon (upsert po UUID – bez duplikatów przy ponowieniach). Po zalogowaniu na nowym urządzeniu dane są pobierane z Neon; rekordy z niewysłanymi zmianami nie są nadpisywane. Aktywny trening/test zapisuje się jako szkic po każdym dotknięciu – odświeżenie strony lub zamknięcie telefonu nie gubi danych.

## Reguły adaptacji (deterministyczne, z wyjaśnieniem)

- **Progressive Overload:** progresja wynika z wykonanej pracy, techniki i regeneracji – nigdy z samego upływu tygodni. Dwie kolejne *udane* sesje na tym samym poziomie → zmiana **jednego** parametru. Każda decyzja (także „utrzymujemy”) trafia do historii z uzasadnieniem; wyniki sesji nie są nadpisywane. Widok **Progres → Progresja obciążeń** (`/load`): aktualne / poprzednie / następne obciążenie, udane sesje, warunki, historia zmian.
- **Max Hangs:** wynik testu (5 s, RPE 10) to maksimum, nie ciężar treningowy. Start: sesja kalibracyjna 4 × 7 s, 180 s, half crimp, ≈ 85% maksimum w dół do 1,25 kg (70 kg + 21,25 kg → +7,5 kg), cel RPE 7–8; ciężar zatwierdzany po sesji (za trudno → mniej / odciążenie, bardzo łatwo → ostrożnie więcej). Potem +1,25 kg tylko po dwóch udanych sesjach: wszystkie serie, pełny czas każdego zwisu, RPE ≤ 8, prawidłowa technika, bez bólu (także następnego dnia), ciężar zgodny z planem. Ból → koniec ciężkich zwisów, brak progresji, regeneracja i ocena gotowości przed kolejnymi zwisami. Po deloadzie wznowienie od ostatniego dobrze tolerowanego ciężaru. Retest po 6. tygodniu porównuje ciężar dodatkowy, całkowity, % masy ciała, czas i RPE.
- **Drogi tlenowe:** 4 × 5b, 3 min, pompowanie maks. 4/10 → najpierw 5, potem 6 dróg, dopiero potem trudność; nigdy oba naraz; przekroczone pompowanie = brak zwiększenia.
- **Wytrzymałość siłowa:** 2 × 3 na 5c+ (2 / 12 min); ścieżka indywidualna – sesje wyraźnie lekkie przy bardzo dobrej technice → trudność (2 × 3 na 6a), kontrolowane zmęczenie → objętość (3 × 3 na 5c+), dalej trudność i przerwy. 4 × 4 / zaawansowane obwody tylko jako propozycja przy górnej granicy, nie obowiązkowy etap.
- **Trudne drogi:** każda próba zapisana i oceniona (czyste przejście / z rozpadem techniki / crux / bez cruxa), poprawa sekwencji per projekt; zakres trudności rośnie po czystych przejściach na górnej granicy w dwóch kolejnych sesjach; liczba prób nigdy nie rośnie automatycznie.
- **Samopoczucie następnego dnia:** ból palców lub samopoczucie ≤ 2/5 po sesji, która dała progresję, cofa tę progresję.
- **Brak progresji:** sesja częściowa, RPE powyżej progu, mocne pompowanie, odpadnięcie w obwodzie, słaba technika lub samopoczucie po treningu.
- **Zmniejszenie:** nieukończenie przy RPE/pompowaniu ≥ 9 z analizą przyczyny (rozpad techniki → trudność / serie, zmęczenie → objętość); dwie nieudane sesje z rzędu → powrót o krok; dwie pominięte jednostki z rzędu → powrót z mniejszym obciążeniem.
- **Pominięcie** przerywa serię dobrych sesji – poziom zostaje, zaległości nie są nadrabiane.
- **Deload** (tydzień 4: objętość −40–50%, bez prób maksymalnych) i **lżejsze wersje** (przy obniżonej gotowości) nie wpływają na progresję.
- **Przełożenie** (brak czasu): szukany jest termin w tym samym tygodniu bez dwóch ciężkich jednostek dzień po dniu i maks. 3 dni treningowe z rzędu; brak bezpiecznego terminu → pominięcie. Zmiana daty nigdy nie zwiększa obciążenia.
- **Gotowość:** ból palców / łokci / barków, nietypowe zmęczenie → zalecany odpoczynek, chwytotablica zablokowana. Aplikacja nie diagnozuje.

Każda decyzja trafia do historii zmian planu z uzasadnieniem (Plan → „Historia zmian planu”, Dashboard → „Dlaczego plan się zmienił”).

## Decyzje projektowe (niejednoznaczności specyfikacji)

- **Testy kontrolne:** specyfikacja mówi o testach po 3. i 6. tygodniu. Test po 3. tygodniu to test kontrolny na początku treningu B w tygodniu 4 (deload), a test po 6. tygodniu to test końcowy 3 × 6a. Dzięki temu test nie zastępuje treningu i nie dokłada ciężkiej jednostki.
- **Wykonanie pełne vs częściowe:** trening jest pełny tylko wtedy, gdy wszystkie części zostały wykonane (rozgrzewka, komplet serii zwisów, wszystkie drogi wspinane). Odpadnięcie na drodze to wykonanie z wynikiem „nieukończona”, a nie brak wykonania.
- **Krawądki Beastmakera 2000:** aplikacja nie zakłada rozmiarów. Krawądka jest opisem tekstowym z opcjonalnym rozmiarem w mm, a wyniki są grupowane i porównywane tylko w obrębie tej samej krawądki i uchwytu.
- **Regularność:** trening częściowy liczy się jako ½, żeby nie nagradzać samej obecności.
- **Data wykonania** = dzień zapisania treningu (można ją poprawić w Historii).
- **Edycja historii** nie zmienia wstecz decyzji adaptacji, bo są one zapisane jako zdarzenia.
- Nowy cykl startuje od parametrów, na których zakończył się poprzedni.

## Kopia zapasowa

Profil → Eksportuj JSON / Importuj JSON. Import zastępuje wszystkie dane konta (także w Neon), a plik jest walidowany przed zapisem.
