## Why

Wprowadzanie próśb grafikowych wymaga dziś ręcznego wybrania pracownika, typu prośby i wypisania **konkretnych dat** po przecinku. Kierownik kliniki dostaje jednak prośby zdaniami w stylu „Daria prosi o każdą środę na rano w lipcu" albo ma od zespołu gotowy plik z listą próśb. Po pierwsze nie ma jak wpisać prośby powtarzalnej (np. co tydzień ten sam dzień) bez przepisywania każdej daty z osobna; po drugie zamiana opisu na typowaną prośbę jest żmudna. Ta zmiana daje prośbom to samo, co reguły dostały od AI: wpisanie/wklejenie tekstu lub pliku → typowana wersja robocza do przejrzenia, oraz dodaje wyrażanie powtarzalności (dzień tygodnia + pora) zamiast wyłącznie pojedynczych dat.

## What Changes

- Nowa możliwość „prośba z tekstu przez AI": użytkownik wpisuje/wkleja opis po ludzku **albo** wrzuca plik `.txt`, a Claude proponuje jedną lub wiele typowanych wersji roboczych próśb (`ScheduleRequestInput`: `employeeId` + `type` + `dates`/`recurrence` + `shiftDefIds` + `text`).
- Nowy endpoint `POST /api/requests/draft-from-text` przyjmujący `{ text, month }` i zwracający `ScheduleRequestInput[]` — **bez zapisu do bazy**.
- Wywołanie Claude przez tool-use (wzorzec z [draft-rules.ts](server/src/ai/draft-rules.ts)) z wymuszonym narzędziem `propose_requests`; w kontekście dla AI: pracownicy (id/imię/grupa), definicje zmian (id/nazwa/grupa/godziny/dni tygodnia — by zmapować „rano" na właściwe `shiftDefIds`) oraz wybrany miesiąc (do osadzenia rekurencji i interpretacji dat względnych).
- **Powtarzalność próśb**: rozszerzenie modelu `ScheduleRequest` o opcjonalne pole `recurrence: { weekdays: Weekday[] }`. Pozwala wyrazić „każda środa", „poniedziałki i piątki" itd. zamiast wypisywania każdej daty. Pora dnia („na rano") jest wyrażana przez istniejące `shiftDefIds` (mapowane na zmiany poranne).
- Serwer **rozwija rekurencję na konkretne daty** wybranego miesiąca przy zapisie (deterministycznie, w ramach `month`), zapisując zarówno `recurrence`, jak i wynikowe `dates`. Dzięki temu walidator i generacja czytają niezmienione `dates`, a UI nadal pokazuje „każda środa" do edycji.
- Defensywna normalizacja odpowiedzi AI po stronie serwera do poprawnego `ScheduleRequestInput` (mapowanie nazwisk→id, dni tygodnia, odrzucanie nieznanych pól/dat spoza miesiąca).
- **Obowiązkowy krok przeglądu**: AI tylko proponuje wersję roboczą; użytkownik weryfikuje i edytuje ją w istniejącym formularzu próśb, a zapis następuje przez istniejące `POST /requests`. Nic nie zapisuje się automatycznie.
- UI w [RequestsPage.tsx](ui/src/pages/RequestsPage.tsx): panel „Utwórz prośbę z opisu (AI)" (textarea + input pliku `.txt` + przycisk) oraz w formularzu próśb przełącznik „konkretne daty / powtarzalnie (dni tygodnia)". Jedna prośba → wczytanie do formularza. Wiele próśb → **lista propozycji do akceptacji**: każdą pozycję przeglądam i akceptuję (zapisuję) lub odrzucam **osobno**, a zaakceptowanie/odrzucenie jednej **nie usuwa pozostałych** — przechodzę przez wszystkie po kolei, aż lista się wyczerpie.
- Wymaga klucza API Anthropic (jak generacja grafiku i reguły z tekstu); bez klucza funkcja AI zablokowana z jasnym komunikatem, błędy AI/sieci obsłużone łagodnie. Powtarzalność działa bez AI.

## Capabilities

### New Capabilities
- `ai-shift-request-authoring`: tworzenie próśb grafikowych z opisu w języku naturalnym (tekst lub plik `.txt`) przez AI oraz wyrażanie próśb powtarzalnych przez wzorzec dni tygodnia (z porą dnia przez `shiftDefIds`), z obowiązkowym krokiem przeglądu/edycji przed zapisem i deterministycznym rozwinięciem rekurencji na daty miesiąca.

### Modified Capabilities
<!-- Brak delty. Capability schedule-requests nie jest jeszcze zarchiwizowana (zmiana schedule-generator wciąż aktywna), więc nie tworzymy delty jej wymagań. Pole `recurrence` rozszerza istniejący kontrakt w sposób opcjonalny i wstecznie zgodny; zapis korzysta z istniejącego, niezmienionego POST /requests, który czyta rozwinięte `dates`. -->

## Impact

- **Server**: nowy moduł AI `server/src/ai/draft-requests.ts` z narzędziem `propose_requests` i normalizatorem `ScheduleRequestInput`; nowa trasa w [requests.ts](server/src/api/requests.ts); funkcja rozwijania rekurencji na daty miesiąca (czysta, testowalna). Rozszerzenie [repos/requests.ts](server/src/repos/requests.ts) i `validate()` o `recurrence`. Reużywa `getApiKey`/wzorca klienta i obsługi błędów z [draft-rules.ts](server/src/ai/draft-rules.ts).
- **DB**: migracja (wersja 3) dodająca kolumnę `recurrence TEXT` do tabeli `requests` (patrz [migrate.ts](server/src/db/migrate.ts)); istniejące wiersze pozostają poprawne (`NULL`).
- **UI**: rozszerzenie [RequestsPage.tsx](ui/src/pages/RequestsPage.tsx) o panel AI i przełącznik dat/powtarzalności; nowa metoda w [api.ts](ui/src/api.ts) (`draftRequestsFromText`). Odczyt pliku `.txt` po stronie przeglądarki — do API leci sam tekst.
- **Shared**: rozszerzenie `ScheduleRequest`/`ScheduleRequestInput` w [shared/src/index.ts](shared/src/index.ts) o opcjonalne `recurrence: { weekdays: Weekday[] }` (`Weekday` już istnieje).
- **Zależności**: brak nowych; istniejący `@anthropic-ai/sdk`.
- **Testy**: test jednostkowy normalizatora (tekst→`ScheduleRequestInput`) oraz test rozwijania rekurencji na daty miesiąca (m.in. dobór właściwych środ w danym miesiącu, pominięcie dat spoza miesiąca); test migracji 3 (kolumna istnieje, stare wiersze czytane poprawnie).
