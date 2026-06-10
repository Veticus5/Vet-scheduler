## 1. Shared contract (types + tier definitions)

- [x] 1.1 W [shared/src/index.ts](shared/src/index.ts) dodać typ `QualificationTier { key: string; label: string; rank: number }` i stałą `QUALIFICATION_TIERS: Record<StaffGroupKey, QualificationTier[]>` z tierami recepcji (niedoświadczony=1, doświadczony=2, zastępca kierownika=3, kierownik=4) oraz domyślnym tierem `podstawowy`=1 dla techników i lekarzy
- [x] 1.2 Zastąpić `Employee.qualificationLevel: QualificationLevel` polem `qualificationTier: string` (klucz tieru); usunąć/oznaczyć jako przestarzały typ `QualificationLevel`
- [x] 1.3 Doprecyzować komentarzami w `RuleParamsPairing.minQualificationLevel` i `RuleParamsQualificationCoverage.minQualificationLevel`, że to **rank** tieru w obrębie grupy reguły (bez zmiany typu/nazwy pola)
- [x] 1.4 Dodać helper `tierRank(group, tierKey): number | undefined` (rozwiązanie klucz→rank ze stałej) do użycia po stronie serwera

## 2. Baza danych (migracja + seed)

- [x] 2.1 W [server/src/db/migrate.ts](server/src/db/migrate.ts) dodać nową migrację (version 2): `CREATE TABLE qualification_tiers (...)` — kolumnę nazwano `staff_group` zamiast zarezerwowanego słowa `group`
- [x] 2.2 W tej samej migracji: `ALTER TABLE employees ADD COLUMN qualification_tier TEXT`
- [x] 2.3 Backfill `qualification_tier` z `qualification_level` — przeniesiony do funkcji `backfillQualificationTiers` (JS, idempotentny po `IS NULL`) z czystym, testowalnym helperem `legacyLevelToTier`; kolumna `qualification_level` zostaje (bez DROP)
- [x] 2.4 Dodać idempotentny seed tierów ze stałej `QUALIFICATION_TIERS` (wzór `seedStaffGroups`, upsert ON CONFLICT)

## 3. Warstwa danych serwera (repo + API)

- [x] 3.1 Utworzyć `server/src/repos/qualifications.ts`: `listTiers(): Record<StaffGroupKey, QualificationTier[]>` oraz `rankMap(): Map<group, Map<tierKey, rank>>` na potrzeby walidatora
- [x] 3.2 W [server/src/repos/employees.ts](server/src/repos/employees.ts) zamienić odczyt/zapis `qualification_level` na `qualification_tier` (Row, `toEmployee`, INSERT, UPDATE)
- [x] 3.3 W [server/src/api/employees.ts](server/src/api/employees.ts) walidować, że `qualificationTier` należy do grupy pracownika (odrzucić 400 przy niezgodności); zastąpić obecne `Number(body.qualificationLevel ?? 1)`
- [x] 3.4 Dodać endpoint `GET /api/qualifications` zwracający tiery per grupa (label + rank); zarejestrować trasę

## 4. Walidator

- [x] 4.1 Rozszerzyć `ValidationContext` o mapę rang tierów (np. `tierRanks`) przekazywaną przez wywołującego (jak `employees`/`shiftDefs`)
- [x] 4.2 W [validator.ts](server/src/domain/validator.ts) zamienić `e.qualificationLevel >= p.minQualificationLevel` w `checkPairing` i `checkQualificationCoverage` na porównanie rozwiązanego ranku tieru pracownika (`tierRanks.get(group)?.get(e.qualificationTier) ?? 0`) z progiem
- [x] 4.3 Zaktualizować wszystkich wywołujących `validate(...)`, by przekazywali mapę rang (ścieżka generacji/zapisu grafiku)

## 5. UI

- [x] 5.1 W [ui/src/api.ts](ui/src/api.ts) dodać `qualifications()` (GET `/api/qualifications`)
- [x] 5.2 W [ui/src/pages/StaffPage.tsx](ui/src/pages/StaffPage.tsx) wczytać tiery; zamienić pole liczbowe „Poziom kwalifikacji" na listę wyboru tierów zależną od `form.staffGroup`; przy zmianie grupy zresetować wybór do pierwszego/poprawnego tieru tej grupy
- [x] 5.3 W tabeli pracowników wyświetlać etykietę tieru zamiast liczby; zaktualizować `EMPTY` (domyślny tier recepcji)

## 6. AI

- [x] 6.1 W [server/src/ai/generate.ts](server/src/ai/generate.ts) przekazywać w kontekście tier pracownika (etykieta) oraz listę tierów grupy z rankiem zamiast surowej liczby
- [x] 6.2 W [server/src/ai/draft-rules.ts](server/src/ai/draft-rules.ts) dodać do kontekstu pary nazwa↔rank tierów per grupa; doprecyzować opis, że `minQualificationLevel` to rank

## 7. Testy i weryfikacja

- [x] 7.1 Zaktualizować [validator.test.ts](server/src/domain/validator.test.ts): `qualification-coverage`/`pairing` oparte na tierach/rankach (helper `emp` przyjmuje tier, kontekst dostaje mapę rang)
- [x] 7.2 Zaktualizować [integration.test.ts](server/src/integration.test.ts) i [draft-rules.test.ts](server/src/ai/draft-rules.test.ts): pracownicy z tierami zamiast `qualificationLevel`
- [x] 7.3 Dodać test migracji/backfill (recepcja level→tier, pozostałe→`podstawowy`)
- [x] 7.4 Uruchomić pełny zestaw testów (`bun test`) i poprawić ewentualne pozostałe odwołania do `qualificationLevel`
- [x] 7.5 Przebudować exe (`bun run build:exe`) i zweryfikować w aplikacji: dodanie pracownika recepcji z tierem, lista wyboru zależna od grupy, walidacja reguły kwalifikacyjnej
