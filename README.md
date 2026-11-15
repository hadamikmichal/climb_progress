# ClimbProgress

Osobisty system planowania, realizacji i analizy treningu wspinaczkowego. Działa lokalnie w przeglądarce (bez konta i backendu), jest PWA – można go zainstalować na telefonie i używać na ścianie.

## Uruchomienie

```bash
npm install        # .npmrc ustawia legacy-peer-deps (npm 10.9)
npm start          # http://localhost:4200
npm test           # testy jednostkowe (Vitest)
npm run build      # build produkcyjny z service workerem → dist/climb_progress/browser
```

Service worker działa tylko w buildzie produkcyjnym. Do testów widoków z inną datą: `?today=RRRR-MM-DD` w adresie.

## Stack

Angular 21 (standalone components, sygnały, zoneless), TypeScript, SCSS (własne komponenty UI), Chart.js (ładowany leniwie), IndexedDB (własny wrapper bez zależności), `@angular/service-worker` + manifest PWA.

## Architektura

```
src/app/
  core/models/models.ts     modele: UserProfile, TrainingCycle, WorkoutTemplate, PlannedWorkout, CompletedWorkout,
                            Exercise, RouteLog, HangboardLog, ReadinessCheck, BaselineTest, ProgressTest, WeeklyReport…
  core/logic/               czysta logika treningowa (bez Angulara) + testy jednostkowe
    plan.ts                 cykl, plan 6 tygodni, deload, testy kontrolne
    scheduling.ts           przekładanie / pomijanie (Przypadek B), walidacja regeneracji
    progression.ts          ocena sesji i progresja (Przypadki A, C)
    readiness.ts            ocena gotowości (Przypadek D)
    reports.ts, stats.ts    raporty tygodniowe, porównanie testów, dane do wykresów
  core/data/                IndexedDB, store na sygnałach, eksport/import JSON
  features/                 dashboard, plan, session (aktywny trening), test, history, progress, profile, readiness
  shared/                   skala RPE/pompowania, tak/nie, timer, wykres, arkusz
```

Każda mutacja jest najpierw zapisywana w IndexedDB, potem aktualizuje sygnał. Aktywny trening/test zapisuje się jako szkic po każdym dotknięciu – odświeżenie strony lub zamknięcie telefonu nie gubi danych.

## Reguły adaptacji (deterministyczne, z wyjaśnieniem)

- **Progresja:** dwie kolejne *dobre* sesje danego typu na tym samym poziomie → zmiana **jednego** parametru (A: serie zwisów do 5, potem +2 kg; B: liczba dróg do 5, potem trudność; C: 2×3 → 3×3, potem trudność). Nigdy nie startuje od 4×4.
- **Brak progresji:** sesja częściowa, RPE powyżej progu, mocne pompowanie, odpadnięcie w obwodzie, słaba technika lub samopoczucie po treningu.
- **Zmniejszenie:** ból podczas zwisów albo nieukończenie przy RPE/pompowaniu ≥ 9; dwie częściowe sesje z rzędu.
- **Pominięcie** przerywa serię dobrych sesji – poziom zostaje, zaległości nie są nadrabiane.
- **Deload** (tydzień 4) i **lżejsze wersje** (przy obniżonej gotowości) nie wpływają na progresję.
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

Profil → Eksportuj JSON / Importuj JSON. Import zastępuje wszystkie dane, a plik jest walidowany przed zapisem.
