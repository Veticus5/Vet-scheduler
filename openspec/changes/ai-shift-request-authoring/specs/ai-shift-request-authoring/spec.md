## ADDED Requirements

### Requirement: Tworzenie wersji roboczej prośby z opisu tekstowego

System SHALL udostępniać endpoint `POST /api/requests/draft-from-text` przyjmujący `{ text: string, month: string }`, który za pomocą AI (tool-use, wymuszone narzędzie `propose_requests`) zamienia opis w języku naturalnym na tablicę typowanych wersji roboczych próśb (`ScheduleRequestInput[]`). Endpoint MUST NOT zapisywać żadnej prośby do bazy danych — zwraca wyłącznie propozycje do przeglądu.

#### Scenario: Pojedyncza prośba z opisu

- **WHEN** użytkownik wysyła `POST /api/requests/draft-from-text` z tekstem opisującym jedną prośbę (np. „Daria prosi o wolne 5 i 6 lipca") oraz `month`
- **THEN** system zwraca tablicę z jednym `ScheduleRequestInput`, którego `employeeId` wskazuje Darię, `type` to `time-off`, a `dates` zawiera daty z miesiąca
- **AND** żadna prośba nie zostaje zapisana w bazie

#### Scenario: Wiele próśb z jednego tekstu

- **WHEN** przesłany tekst (np. zawartość pliku `.txt`) opisuje kilka odrębnych próśb
- **THEN** system zwraca tablicę `ScheduleRequestInput` z jedną pozycją na każdą rozpoznaną prośbę

#### Scenario: Pusty tekst

- **WHEN** żądanie zawiera pusty lub składający się wyłącznie z białych znaków `text`
- **THEN** system odpowiada błędem 400 z czytelnym komunikatem po polsku
- **AND** nie wykonuje wywołania AI

### Requirement: Prośba powtarzalna przez wzorzec dni tygodnia

System SHALL rozszerzać model `ScheduleRequest`/`ScheduleRequestInput` o opcjonalne pole `recurrence: { weekdays: Weekday[] }`, pozwalające wyrazić prośbę powtarzalną (np. „każda środa") zamiast wypisywania pojedynczych dat. Pole `recurrence` MUST być opcjonalne i wstecznie zgodne — prośby bez niego (sama lista `dates`) działają bez zmian.

#### Scenario: Wyrażenie „każda środa"

- **WHEN** użytkownik tworzy prośbę z `recurrence.weekdays = [3]` (środa) dla danego miesiąca
- **THEN** prośba zostaje zapisana z tym `recurrence`
- **AND** prośby z samą listą `dates` (bez `recurrence`) nadal są obsługiwane bez zmian

#### Scenario: Wiele dni tygodnia

- **WHEN** `recurrence.weekdays` zawiera kilka dni (np. poniedziałek i piątek)
- **THEN** prośba obejmuje wszystkie te dni tygodnia w miesiącu

#### Scenario: Pora dnia przez shiftDefIds

- **WHEN** prośba powtarzalna dotyczy konkretnej pory dnia (np. „na rano")
- **THEN** pora jest wyrażona przez `shiftDefIds` wskazujące właściwe definicje zmian, a nie przez nowe pole modelu

### Requirement: Rozwijanie rekurencji na konkretne daty miesiąca

System SHALL przy zapisie prośby (`POST`/`PUT /requests`) deterministycznie rozwijać `recurrence.weekdays` na wszystkie pasujące daty `YYYY-MM-DD` w obrębie `month` i zapisywać zarówno `recurrence`, jak i wynikowe `dates`. Rozwijanie MUST ograniczać się do dni należących do wskazanego miesiąca.

#### Scenario: Środy danego miesiąca

- **WHEN** prośba ma `recurrence.weekdays = [3]` i `month` zawierający np. 5 środ
- **THEN** zapisane `dates` zawierają dokładnie te 5 dat (wszystkie środy tego miesiąca) w formacie `YYYY-MM-DD`

#### Scenario: Tylko dni z miesiąca

- **WHEN** rekurencja jest rozwijana dla danego miesiąca
- **THEN** wynikowe `dates` nie zawierają żadnej daty spoza tego miesiąca

#### Scenario: Spójność po edycji

- **WHEN** użytkownik aktualizuje `recurrence` istniejącej prośby
- **THEN** `dates` są regenerowane z nowego `recurrence`, tak aby pozostały spójne z intencją

#### Scenario: Niezmieniony odczyt przez walidator i generację

- **WHEN** walidator lub generacja przetwarza prośbę utworzoną z rekurencji
- **THEN** czyta rozwinięte `dates` tak samo jak dla prośby z ręcznie wpisanymi datami (bez specjalnej obsługi rekurencji)

### Requirement: Mapowanie nazw na identyfikatory w kontekście AI

System SHALL przekazywać do AI katalog kontekstowy: aktywnych pracowników (id, imię, grupa), definicje zmian (id, nazwa, grupa, godziny, dni tygodnia) oraz wybrany `month`. System MUST instruować AI, aby mapowała nazwiska z opisu na `employeeId`, pory dnia/nazwy zmian na `shiftDefIds`, a wyrażenia powtarzalne na `recurrence.weekdays`.

#### Scenario: Nazwisko mapowane na employeeId

- **WHEN** opis wymienia pracownika z imienia (np. „Daria") odpowiadającego istniejącemu pracownikowi
- **THEN** wynikowy `ScheduleRequestInput` używa `id` tego pracownika w `employeeId`, a nie surowego tekstu imienia

#### Scenario: „Każda środa na rano" mapowane na rekurencję i zmiany

- **WHEN** opis brzmi „każda środa na rano"
- **THEN** wynikowy `ScheduleRequestInput` ma `recurrence.weekdays = [3]` oraz `shiftDefIds` wskazujące poranne definicje zmian

### Requirement: Defensywna normalizacja odpowiedzi AI do ScheduleRequestInput

System SHALL normalizować surową odpowiedź narzędzia `propose_requests` do poprawnego `ScheduleRequestInput` po stronie serwera: walidować `type` względem `RequestType`, mapować wyłącznie istniejące id pracowników i zmian, przyjmować `dates` albo `recurrence.weekdays` (wartości 0–6, unikalne), odrzucać daty spoza `month` oraz nieznane pola. Pozycje bez poprawnego pracownika MUST być pomijane.

#### Scenario: Nieznany pracownik jest odrzucany

- **WHEN** AI zwróci prośbę z `employeeId`, który nie odpowiada żadnemu istniejącemu pracownikowi
- **THEN** ta pozycja jest pomijana w wyniku (nie powoduje awarii całego żądania)

#### Scenario: Niepoprawny dzień tygodnia jest odrzucany

- **WHEN** AI zwróci `recurrence.weekdays` z wartością spoza zakresu 0–6
- **THEN** normalizator usuwa niepoprawne wartości, pozostawiając poprawny zestaw dni

#### Scenario: freeform wymaga tekstu

- **WHEN** AI zwróci prośbę typu `freeform` bez tekstu
- **THEN** pozycja jest pomijana lub uzupełniona w sposób spójny (typ `freeform` MUST mieć niepusty `text`)

#### Scenario: Brak poprawnych próśb

- **WHEN** żadna pozycja zwrócona przez AI nie daje poprawnego `ScheduleRequestInput`
- **THEN** system odpowiada czytelnym błędem, a nic nie zostaje zapisane

### Requirement: Obowiązkowy przegląd przed zapisem

System SHALL wymagać, aby zaproponowana prośba została wczytana do istniejącego formularza próśb, gdzie użytkownik może ją przejrzeć i edytować, a zapis następuje wyłącznie przez istniejące `POST /requests`. System MUST NOT zapisywać zaproponowanej prośby automatycznie.

#### Scenario: Wczytanie pojedynczej propozycji do formularza

- **WHEN** AI zwróci dokładnie jedną propozycję
- **THEN** UI wczytuje ją do istniejącego formularza próśb, gotową do edycji i ręcznego zapisu

#### Scenario: Lista wielu propozycji do osobnej akceptacji

- **WHEN** AI zwróci wiele propozycji
- **THEN** UI wyświetla listę wszystkich propozycji z podsumowaniem każdej, gdzie każdą pozycję można osobno przejrzeć/edytować i zaakceptować (zapisać przez `POST /requests`) lub odrzucić

#### Scenario: Akceptacja jednej propozycji nie usuwa pozostałych

- **WHEN** użytkownik akceptuje (zapisuje) lub odrzuca jedną propozycję z listy wielu
- **THEN** pozostałe propozycje nadal są widoczne na liście i gotowe do osobnego przejrzenia
- **AND** lista zmniejsza się dopiero o obsłużoną pozycję, aż wszystkie zostaną zaakceptowane lub odrzucone

### Requirement: Wejście tekstowe oraz plik .txt

System SHALL akceptować dwa sposoby wprowadzenia opisu prośby: pole tekstowe (textarea) oraz przesłanie pliku `.txt`. Plik MUST być odczytywany po stronie UI, a do API przekazywany jest wyłącznie jego tekst.

#### Scenario: Wprowadzenie przez textarea

- **WHEN** użytkownik wpisuje lub wkleja opis w polu tekstowym i uruchamia generowanie
- **THEN** tekst zostaje wysłany do `POST /api/requests/draft-from-text`

#### Scenario: Wprowadzenie przez plik .txt

- **WHEN** użytkownik wybiera plik `.txt`
- **THEN** UI odczytuje zawartość pliku i wstawia ją jako tekst opisu, który następnie trafia do API

### Requirement: Wybór trybu daty lub powtarzalności w formularzu

System SHALL udostępniać w formularzu próśb wybór trybu: „konkretne daty" (lista dat) albo „powtarzalnie" (wybór dni tygodnia odwzorowany na `recurrence.weekdays`). UI MUST pozwalać edytować propozycję AI niezależnie od tego, czy zawiera `dates`, czy `recurrence`.

#### Scenario: Tryb powtarzalny w formularzu

- **WHEN** użytkownik wybiera tryb „powtarzalnie" i zaznacza dni tygodnia
- **THEN** zapisywana prośba zawiera `recurrence.weekdays` z zaznaczonymi dniami

#### Scenario: Edycja propozycji powtarzalnej z AI

- **WHEN** propozycja AI zawiera `recurrence`
- **THEN** formularz wczytuje ją w trybie „powtarzalnie" z zaznaczonymi dniami, gotową do edycji przed zapisem

### Requirement: Wymagany klucz API i łagodna obsługa błędów

System SHALL wymagać skonfigurowanego klucza API Anthropic do działania funkcji „prośba z opisu". Bez klucza system MUST zablokować tę funkcję z czytelnym komunikatem po polsku, nie blokując przy tym ręcznego tworzenia próśb (w tym powtarzalnych). Błędy AI lub sieci MUST być obsłużone łagodnie, bez modyfikowania zapisanych danych.

#### Scenario: Brak klucza API

- **WHEN** użytkownik uruchamia „prośbę z opisu" bez skonfigurowanego klucza API
- **THEN** system odpowiada błędem z czytelnym komunikatem kierującym do Ustawień
- **AND** nie wykonuje wywołania sieciowego do AI
- **AND** ręczne tworzenie próśb (daty oraz powtarzalność) pozostaje dostępne

#### Scenario: Błąd połączenia z AI

- **WHEN** wywołanie AI kończy się błędem sieci lub dostawcy
- **THEN** system zwraca czytelny komunikat o błędzie, a UI wyświetla go bez utraty wpisanego tekstu
