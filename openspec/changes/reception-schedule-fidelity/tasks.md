## 1. Model współdzielony (shared)

- [x] 1.1 Dodać pole `staffsReception: boolean` do `ShiftDefinition` w [shared/src/index.ts](shared/src/index.ts) (komentarz: `false` = dyżur biurowy, nie liczy się do obsady recepcji).
- [x] 1.2 W `ShiftDefinitionInput` pozostawić pole opcjonalnym/ze sensownym domyślnym `true` (wsteczna zgodność wejścia API).

## 2. Migracja DB

- [x] 2.1 Dodać migrację wersji 4 w [migrate.ts](server/src/db/migrate.ts): `ALTER TABLE shift_definitions ADD COLUMN staffs_reception INTEGER NOT NULL DEFAULT 1;` (1 = obsada recepcji).
- [x] 2.2 Test migracji ([migrate.test.ts](server/src/db/migrate.test.ts)): po migracji kolumna istnieje, a istniejące definicje czytane są jako `staffsReception=true`.

## 3. Repozytorium i API definicji zmian

- [x] 3.1 W [repos/shifts.ts](server/src/repos/shifts.ts): rozszerzyć `Row` o `staffs_reception`, `toShift` o mapowanie `staffsReception: r.staffs_reception !== 0`.
- [x] 3.2 `createShift`/`updateShift`: zapisywać kolumnę `staffs_reception` (domyślnie 1, gdy wejście nie podaje pola).
- [x] 3.3 W [api/shifts.ts](server/src/api/shifts.ts): zweryfikować, że pole przechodzi przez walidację wejścia bez utraty (z domyślną wartością `true`).

## 4. Walidator — obsada tylko dla zmian recepcyjnych

- [x] 4.1 W [validator.ts](server/src/domain/validator.ts) `validateCoverage`: pomijać instancje, których definicja ma `staffsReception=false` (użyć istniejącej mapy `defById`).
- [x] 4.2 `checkQualificationCoverage` i `checkPairing`: liczyć obecność tylko na instancjach zmian recepcyjnych (filtr po fladze definicji).
- [x] 4.3 Pozostawić bez zmian `checkMaxConsecutive` (dyżur biurowy to wciąż dzień pracy).
- [x] 4.4 Testy walidatora ([validator.test.ts](server/src/domain/validator.test.ts)): (a) dyżur biurowy nie zaspokaja `requiredMin` recepcji; (b) `qualification-coverage`/`pairing` ignorują dyżur biurowy; (c) dyżur biurowy wlicza się do `max-consecutive-days`.

## 5. Kontekst i prompt AI

- [x] 5.1 W [generate.ts](server/src/ai/generate.ts) `buildContextPayload`: dodać `staffsReception` do mapowanych `shiftDefinitions`.
- [x] 5.2 Rozszerzyć `SYSTEM_PROMPT` o wytyczną: zmiany biurowe (`staffsReception=false`) NIE liczą się do obsady recepcji i nie wolno nimi „łatać" wymaganej obsady stanowiska.

## 6. UI — typ zmiany

- [x] 6.1 W [ShiftsPage.tsx](ui/src/pages/ShiftsPage.tsx): przełącznik „Obsada recepcji / Dyżur biurowy" w formularzu definicji zmiany; lista zmian pokazuje typ (kolumna „Typ").
- [x] 6.2 W [SchedulePage.tsx](ui/src/pages/SchedulePage.tsx): oznaczyć zmianę dyżuru biurowego odróżnialnie od obsady recepcji (badge „Biuro").

## 7. Weryfikacja końcowa

- [x] 7.1 `bun test` (server) — wszystkie testy zielone (migracja, walidator).
- [x] 7.2 Typecheck server + UI bez nowych błędów.
- [x] 7.3 Przebudować exe (`bun run build:exe`) i sprawdzić ręcznie: definicja zmiany biurowej, generacja nie łata obsady dyżurem.
