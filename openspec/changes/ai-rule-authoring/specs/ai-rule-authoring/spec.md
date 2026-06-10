## ADDED Requirements

### Requirement: Tworzenie wersji roboczej reguły z opisu tekstowego

System SHALL udostępniać endpoint `POST /api/rules/draft-from-text` przyjmujący `{ text: string }`, który za pomocą AI (tool-use, wymuszone narzędzie `propose_rules`) zamienia opis w języku naturalnym na tablicę typowanych wersji roboczych reguł (`RuleInput[]`). Endpoint MUST NOT zapisywać żadnej reguły do bazy danych — zwraca wyłącznie propozycje do przeglądu.

#### Scenario: Pojedyncza reguła z opisu

- **WHEN** użytkownik wysyła `POST /api/rules/draft-from-text` z tekstem opisującym jedną zasadę (np. „technicy mogą pracować maksymalnie 5 dni z rzędu")
- **THEN** system zwraca tablicę z jednym `RuleInput`, którego `kind` to `max-consecutive-days`, `params` zawiera `maxDays: 5`, a `scope` wskazuje grupę `technicians`
- **AND** żadna reguła nie zostaje zapisana w bazie

#### Scenario: Wiele reguł z jednego tekstu

- **WHEN** przesłany tekst (np. zawartość pliku `.txt`) opisuje kilka odrębnych zasad
- **THEN** system zwraca tablicę `RuleInput` z jedną pozycją na każdą rozpoznaną zasadę

#### Scenario: Pusty tekst

- **WHEN** żądanie zawiera pusty lub składający się wyłącznie z białych znaków `text`
- **THEN** system odpowiada błędem 400 z czytelnym komunikatem po polsku
- **AND** nie wykonuje wywołania AI

### Requirement: Mapowanie nazw na identyfikatory w kontekście AI

System SHALL przekazywać do AI katalog kontekstowy: grupy personelu (`STAFF_GROUPS`), aktywnych pracowników (id, imię, grupa, poziom kwalifikacji) oraz definicje zmian (id, nazwa, grupa). System MUST instruować AI, aby mapowała nazwiska i nazwy zmian z opisu na odpowiednie identyfikatory w polach `employeeId`, `withGroup`, `exemptEmployeeIds` oraz `shiftDefIds`.

#### Scenario: Nazwisko mapowane na employeeId

- **WHEN** opis wymienia pracownika z imienia (np. „Daria"), które odpowiada istniejącemu pracownikowi
- **THEN** wynikowy `RuleInput` używa `id` tego pracownika w odpowiednim polu (`employeeId` lub `exemptEmployeeIds`), a nie surowego tekstu imienia

#### Scenario: Nazwa zmiany mapowana na shiftDefId

- **WHEN** opis odnosi się do nazwanej zmiany odpowiadającej istniejącej definicji
- **THEN** wynikowy `RuleInput` używa `id` tej definicji zmiany w `shiftDefIds`

### Requirement: Defensywna normalizacja odpowiedzi AI do RuleInput

System SHALL normalizować surową odpowiedź narzędzia `propose_rules` do poprawnego `RuleInput` po stronie serwera: budować poprawny `scope` (`group` lub `cross-group`), tagować `params` właściwym `kind`, ustawiać sensowne wartości domyślne dla brakujących pól oraz odrzucać nieznane typy reguł i nieznane pola. Wynik MUST być zgodny z istniejącym kontacttem typów współdzielonych bez modyfikowania go.

#### Scenario: Pełny, poprawny RuleInput dla każdego typu

- **WHEN** AI proponuje regułę dowolnego z typów (`pairing`, `qualification-coverage`, `max-consecutive-days`, `coverage`, `freeform`)
- **THEN** znormalizowany `RuleInput` ma `params.kind` zgodny z `kind` reguły oraz `scope` o poprawnym kształcie

#### Scenario: Nieznany typ reguły jest odrzucany

- **WHEN** AI zwróci regułę z `kind`, który nie należy do katalogu `RuleKind`
- **THEN** ta pozycja jest pomijana w wyniku (nie powoduje awarii całego żądania)

#### Scenario: Brakujące pola otrzymują wartości domyślne

- **WHEN** AI pominie pola wymagane przez typ reguły (np. `withGroup` dla `pairing`)
- **THEN** normalizator wstawia bezpieczną wartość domyślną (np. pustą tablicę), aby `RuleInput` był spójny i edytowalny w formularzu

### Requirement: Obowiązkowy przegląd przed zapisem

System SHALL wymagać, aby zaproponowana reguła została wczytana do istniejącego formularza reguł, gdzie użytkownik może ją przejrzeć i edytować, a zapis następuje wyłącznie przez istniejące `POST /rules`. System MUST NOT zapisywać zaproponowanej reguły automatycznie.

#### Scenario: Wczytanie pojedynczej propozycji do formularza

- **WHEN** AI zwróci dokładnie jedną propozycję
- **THEN** UI wczytuje ją do istniejącego formularza reguł, gotową do edycji i ręcznego zapisu

#### Scenario: Wybór spośród wielu propozycji

- **WHEN** AI zwróci wiele propozycji
- **THEN** UI wyświetla listę kart z podsumowaniem i akcją „Wczytaj do formularza" przy każdej
- **AND** dopiero wybranie karty wczytuje daną propozycję do formularza

#### Scenario: Wczytanie jednej propozycji nie usuwa pozostałych

- **WHEN** użytkownik wczytuje jedną propozycję z listy wielu do formularza
- **THEN** wczytana pozycja znika z listy, a wszystkie pozostałe propozycje nadal są na niej widoczne i gotowe do osobnego wczytania
- **AND** lista zmniejsza się wyłącznie o wczytaną pozycję, aż wszystkie zostaną obsłużone

### Requirement: Wejście tekstowe oraz plik .txt

System SHALL akceptować dwa sposoby wprowadzenia opisu: pole tekstowe (textarea) oraz przesłanie pliku `.txt`. Plik MUST być odczytywany po stronie UI, a do API przekazywany jest wyłącznie jego tekst.

#### Scenario: Wprowadzenie przez textarea

- **WHEN** użytkownik wpisuje lub wkleja opis w polu tekstowym i uruchamia generowanie
- **THEN** tekst zostaje wysłany do `POST /api/rules/draft-from-text`

#### Scenario: Wprowadzenie przez plik .txt

- **WHEN** użytkownik wybiera plik `.txt`
- **THEN** UI odczytuje zawartość pliku i wstawia ją jako tekst opisu, który następnie trafia do API

### Requirement: Wymagany klucz API i łagodna obsługa błędów

System SHALL wymagać skonfigurowanego klucza API Anthropic do działania funkcji. Bez klucza system MUST zablokować funkcję z czytelnym komunikatem po polsku. Błędy AI lub sieci MUST być obsłużone łagodnie, bez modyfikowania zapisanych danych.

#### Scenario: Brak klucza API

- **WHEN** użytkownik uruchamia generowanie reguły bez skonfigurowanego klucza API
- **THEN** system odpowiada błędem z czytelnym komunikatem kierującym do Ustawień
- **AND** nie wykonuje wywołania sieciowego do AI

#### Scenario: Błąd połączenia z AI

- **WHEN** wywołanie AI kończy się błędem sieci lub dostawcy
- **THEN** system zwraca czytelny komunikat o błędzie, a UI wyświetla go bez utraty wpisanego tekstu
