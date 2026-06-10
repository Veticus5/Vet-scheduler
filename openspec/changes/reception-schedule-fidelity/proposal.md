## Why

Część czasu pracy recepcji to **dyżur w biurze** — osoba jest w pracy i wykonuje zadania administracyjne, ale **nie stoi na recepcji**. Obecny model traktuje każde przypisanie do zmiany jako obsadę stanowiska, więc dyżur biurowy fałszywie zalicza się do pokrycia recepcji. Generator i walidator muszą rozróżniać „obsadę recepcji" od „pracy biurowej", żeby grafik nie udawał, że stanowisko jest obsadzone, gdy ktoś faktycznie robi papierkową robotę w biurze.

(Zakres wyglądu/wydruku grafiku — układ pivot, kolory, eksport siatki — został świadomie odłożony na później. Ta zmiana dotyczy wyłącznie logiki rozróżnienia pracy biurowej.)

## What Changes

- **Dyżur w biurze jako typ zmiany niewliczany do obsady recepcji.** Definicja zmiany (`ShiftDefinition`) zyskuje flagę (`staffsReception: boolean`, domyślnie `true`). Zmiany oznaczone jako biurowe (`false`) liczą się do **godzin pracy** osoby, ale **nie** do **pokrycia recepcji** (`requiredMin/requiredMax` oraz reguł `coverage`/`qualification-coverage`/`pairing` dotyczących stanowiska).
- **Walidator pokrycia liczy tylko zmiany obsadzające recepcję.** `validateCoverage` i reguły obsady pomijają zmiany biurowe; limit dni z rzędu (`max-consecutive-days`) nadal obejmuje dyżur biurowy, bo to wciąż dzień pracy.
- **Kontekst i wskazówki dla AI.** Generacja dostaje informację, które zmiany obsadzają recepcję, a które to dyżur biurowy, oraz wytyczną, że dyżuru biurowego nie wolno używać do spełnienia obsady stanowiska.
- **UI definicji zmian:** przełącznik „Obsada recepcji / Dyżur biurowy" w formularzu zmiany ([ShiftsPage.tsx](ui/src/pages/ShiftsPage.tsx)) oraz oznaczenie typu na liście zmian i w gridzie grafiku.

## Capabilities

### New Capabilities
- `reception-office-duty`: rozróżnienie pracy na recepcji od dyżuru w biurze — definicje zmian niosą flagę „obsada recepcji"; walidacja pokrycia i reguły obsady liczą wyłącznie zmiany recepcyjne, podczas gdy godziny pracy i limity dni z rzędu obejmują również dyżur biurowy; kontekst AI rozróżnia oba typy.

### Modified Capabilities
<!-- Brak delt. Zdolności dotykane przez tę zmianę (staff-management — ShiftDefinition, scheduling-rules — pokrycie, ai-schedule-generation — kontekst) należą do zmiany `schedule-generator`, która NIE jest jeszcze zarchiwizowana, więc zgodnie z przyjętą w repo praktyką (patrz `ai-shift-request-authoring`) nie tworzymy delt ich wymagań. Nowe zachowanie w całości opisuje nowa zdolność powyżej, a flaga `staffsReception` rozszerza kontrakt `ShiftDefinition` w sposób opcjonalny i wstecznie zgodny (domyślnie `true` = dotychczasowa semantyka). -->

## Impact

- **Shared** ([shared/src/index.ts](shared/src/index.ts)): pole `staffsReception: boolean` w `ShiftDefinition`; opcjonalne w `ShiftDefinitionInput` (domyślnie `true`).
- **DB** ([migrate.ts](server/src/db/migrate.ts)): migracja wersji 4 dodająca kolumnę `staffs_reception INTEGER NOT NULL DEFAULT 1`; istniejące wiersze pozostają obsadą recepcji.
- **Server**:
  - [validator.ts](server/src/domain/validator.ts): `validateCoverage` oraz reguły `coverage`/`qualification-coverage`/`pairing` pomijają zmiany z `staffsReception=false`; `max-consecutive-days` ich nie pomija.
  - [generate.ts](server/src/ai/generate.ts): `buildContextPayload` przekazuje `staffsReception` per zmiana + wytyczna w prompcie systemowym.
  - [repos/shifts.ts](server/src/repos/shifts.ts) i [api/shifts.ts](server/src/api/shifts.ts): odczyt/zapis nowego pola (domyślnie `true`).
- **UI**: przełącznik typu zmiany w formularzu definicji zmian; kolumna „Typ" na liście; oznaczenie „Biuro" w gridzie grafiku.
- **Zależności**: brak nowych.
- **Testy**: walidacja pokrycia ignorująca zmiany biurowe (a licząca dni z rzędu); migracja nowej kolumny (stare wiersze = obsada recepcji).
