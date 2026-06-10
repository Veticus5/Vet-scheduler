## 1. Współdzielony kontrakt (shared)

- [x] 1.1 W [shared/src/index.ts](shared/src/index.ts) rozszerzyć `ScheduleRequest` o opcjonalne `recurrence?: { weekdays: Weekday[] }` (i tym samym `ScheduleRequestInput`)
- [x] 1.2 Dodać krótki komentarz przy `recurrence` opisujący semantykę (rozwijane na `dates` w obrębie `month`)

## 2. Baza danych (migracja)

- [x] 2.1 Dodać migrację wersji 3 w [migrate.ts](server/src/db/migrate.ts): `ALTER TABLE requests ADD COLUMN recurrence TEXT`
- [x] 2.2 Rozszerzyć test migracji [migrate.test.ts](server/src/db/migrate.test.ts): kolumna `recurrence` istnieje, a istniejące wiersze (bez `recurrence`) czytane są poprawnie

## 3. Rozwijanie rekurencji (czysta funkcja)

- [x] 3.1 Dodać czystą funkcję `expandRecurrence(month, weekdays): string[]` (np. w `server/src/domain/` lub w repo requests) zwracającą posortowane daty `YYYY-MM-DD` wszystkich wskazanych dni tygodnia w danym miesiącu
- [x] 3.2 Test jednostkowy `expandRecurrence`: poprawny dobór środ w przykładowym miesiącu, brak dat spoza miesiąca, wiele dni tygodnia, pusty `weekdays` → pusta lista

## 4. Repo i API próśb (recurrence)

- [x] 4.1 W [repos/requests.ts](server/src/repos/requests.ts) odczytywać/zapisywać kolumnę `recurrence` (JSON ↔ obiekt; `NULL` gdy brak) w `toRequest`, `createRequest`, `updateRequest`
- [x] 4.2 W [api/requests.ts](server/src/api/requests.ts) rozszerzyć `validate()` o `recurrence` (walidacja `weekdays`: liczby 0–6, unikalne)
- [x] 4.3 W `createRequest`/`updateRequest` (warstwa API lub repo): gdy `recurrence` obecne, rozwinąć je przez `expandRecurrence(month, weekdays)` i zapisać jako `dates`; zapisać też `recurrence`
- [x] 4.4 Test integracyjny/jednostkowy: zapis prośby z `recurrence` ustawia spójne `dates`; aktualizacja `recurrence` regeneruje `dates`

## 5. Moduł AI — draft-requests

- [x] 5.1 Utworzyć `server/src/ai/draft-requests.ts` wzorowany na [draft-rules.ts](server/src/ai/draft-rules.ts): `DraftContext` (pracownicy id/imię/grupa, zmiany id/nazwa/grupa/godziny/dni), klient z `getApiKey`, obsługa błędów sieci → `HttpError(502)`
- [x] 5.2 Zdefiniować narzędzie `propose_requests` (płaski kształt: `employeeId`, `type`, `dates`, `weekdays`, `shiftDefIds`, `text`) z `tool_choice` wymuszonym
- [x] 5.3 Napisać `SYSTEM_PROMPT`: mapowanie nazwisk→`employeeId`, „rano/popołudnie"→`shiftDefIds`, wyrażeń powtarzalnych→`weekdays`, interpretacja względem `month`; odpowiedzi po polsku w `text`
- [x] 5.4 Zaimplementować czysty `normalizeDraftRequest(raw, ctx, month): ScheduleRequestInput | null`: walidacja `type`, mapowanie istniejących id pracowników/zmian, `weekdays` 0–6 unikalne, odrzucanie dat spoza `month`, wymóg `text` dla `freeform`; pozycje bez poprawnego pracownika → `null`
- [x] 5.5 Zaimplementować `draftRequestsFromText(text, month): Promise<ScheduleRequestInput[]>`: walidacja wejścia (pusty tekst → 400), wywołanie modelu, normalizacja, pusta lista → czytelny 502; brak zapisu do bazy
- [x] 5.6 Testy jednostkowe normalizatora: nazwisko→`employeeId`, „każda środa na rano"→`recurrence.weekdays=[3]`+`shiftDefIds`, odrzucenie nieznanego pracownika, niepoprawny weekday usuwany, `freeform` bez tekstu pomijany

## 6. Trasa API draft-from-text

- [x] 6.1 Dodać trasę `POST /requests/draft-from-text` w [api/requests.ts](server/src/api/requests.ts) przyjmującą `{ text, month }`, walidującą `month` (RRRR-MM) i niepusty `text`, zwracającą `await draftRequestsFromText(text, month)` — bez zapisu

## 7. UI

- [x] 7.1 Dodać `draftRequestsFromText(text, month)` w [ui/src/api.ts](ui/src/api.ts) (`POST /requests/draft-from-text`)
- [x] 7.2 W [RequestsPage.tsx](ui/src/pages/RequestsPage.tsx) dodać panel „Utwórz prośbę z opisu (AI)": textarea + input pliku `.txt` (odczyt w przeglądarce, do API leci sam tekst) + przycisk; łagodna obsługa błędów i braku klucza API
- [x] 7.3 Jedna propozycja → wczytanie do formularza. Wiele → lista wszystkich propozycji z podsumowaniem; każdą pozycję można osobno przejrzeć/edytować i zaakceptować (zapis przez `POST /requests`) lub odrzucić. Stan listy trzymany w UI (np. tablica pending); obsłużenie jednej pozycji usuwa tylko ją, pozostałe zostają widoczne aż lista się wyczerpie
- [x] 7.4 W formularzu próśb dodać przełącznik trybu „konkretne daty" / „powtarzalnie"; tryb powtarzalny = multi-select dni tygodnia odwzorowany na `recurrence.weekdays`
- [x] 7.5 `edit()` i `submit()` obsługują `recurrence`: wczytanie propozycji/prośby z `recurrence` ustawia tryb powtarzalny; zapis wysyła `recurrence` zamiast ręcznej listy dat
- [x] 7.6 Tabela próśb pokazuje czytelnie powtarzalność (np. „każda środa") obok dat/tekstu

## 8. Weryfikacja

- [x] 8.1 Uruchomić testy serwera (`bun test`) — migracja, rozwijanie rekurencji, normalizator, repo/API
- [x] 8.2 Przebudować `.exe` (`bun run build:exe`) i zrelaunchować; ręcznie sprawdzić: prośba „każda środa na rano" z opisu AI oraz przez przełącznik powtarzalności, przegląd i zapis
  - Exe przebudowany i uruchomiony (port 8787). Powtarzalność zweryfikowana na żywym API: `recurrence {weekdays:[3]}` → daty 5 śród lipca 2026. Panel AI „z opisu" wymaga klucza API — do sprawdzenia w UI przez użytkownika.
