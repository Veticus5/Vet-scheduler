## Why

Tworzenie reguł stałych wymaga dziś znajomości typów reguł (`RuleKind`), kształtu ich parametrów oraz ręcznego mapowania nazwisk pracowników i nazw zmian na identyfikatory w formularzu. Kierownik kliniki myśli jednak zdaniami w stylu „Daria zawsze musi pracować z kimś z recepcji" albo ma gotowy plik z listą zasad. Funkcja, w której AI zamienia taki opis na typowaną wersję roboczą reguły do przejrzenia i edycji, drastycznie skraca drogę od intencji do poprawnej, zwalidowanej reguły — bez zgadywania, którego typu i parametrów użyć.

## What Changes

- Nowa możliwość „reguła z tekstu przez AI": użytkownik wpisuje/wkleja opis po ludzku **albo** wrzuca plik `.txt`, a Claude proponuje jedną lub wiele typowanych wersji roboczych reguł (`RuleInput`: `kind` + `params` + `scope` + `hard/soft` + `name` + `description`).
- Nowy endpoint `POST /api/rules/draft-from-text` przyjmujący `{ text }` i zwracający `RuleInput[]` — **bez zapisu do bazy**.
- Wywołanie Claude przez tool-use (wzorzec z [generate.ts](server/src/ai/generate.ts)) z wymuszonym narzędziem `propose_rules`; w kontekście dla AI: grupy (`STAFF_GROUPS`), pracownicy (id/imię/grupa/poziom kwalifikacji) i definicje zmian (id/nazwa/grupa) do mapowania na `employeeId`/`withGroup`/`exemptEmployeeIds`/`shiftDefIds`, plus katalog `RuleKind` i kształt parametrów.
- Defensywna normalizacja odpowiedzi AI po stronie serwera do poprawnego `RuleInput` (budowa `scope`, tagowanie `params.kind`, odrzucanie nieznanych pól/typów).
- **Obowiązkowy krok przeglądu**: AI tylko proponuje wersję roboczą; użytkownik weryfikuje i edytuje ją w istniejącym formularzu reguł, a zapis następuje przez istniejące `POST /rules`. Nic nie zapisuje się automatycznie.
- UI w [RulesPage.tsx](ui/src/pages/RulesPage.tsx): panel „Utwórz regułę z opisu (AI)" (textarea + input pliku `.txt` + przycisk). Jedna reguła → wczytanie do istniejącego formularza; wiele reguł → lista kart z podsumowaniem i „Wczytaj do formularza" przy każdej.
- Wymaga klucza API Anthropic (jak generacja grafiku); bez klucza funkcja zablokowana z jasnym komunikatem, błędy AI/sieci obsłużone łagodnie.

## Capabilities

### New Capabilities
- `ai-rule-authoring`: zamiana opisu reguły w języku naturalnym (tekst lub plik `.txt`) na typowane wersje robocze reguł przez AI, z obowiązkowym krokiem przeglądu/edycji przed zapisem.

### Modified Capabilities
<!-- Brak. Capability scheduling-rules nie jest jeszcze zarchiwizowana (zmiana schedule-generator wciąż aktywna), więc nie zmieniamy jej wymagań. Zapis reguł korzysta z istniejącego, niezmienionego POST /rules. -->

## Impact

- **Server**: nowy moduł AI (np. `server/src/ai/draft-rules.ts`) z narzędziem `propose_rules` i normalizatorem `RuleInput`; nowa trasa w [rules.ts](server/src/api/rules.ts). Reużywa `getApiKey`/wzorca klienta i obsługi błędów z [generate.ts](server/src/ai/generate.ts).
- **UI**: rozszerzenie [RulesPage.tsx](ui/src/pages/RulesPage.tsx) o panel AI; nowa metoda w [api.ts](ui/src/api.ts) (`draftRulesFromText`). Odczyt pliku `.txt` po stronie przeglądarki — do API leci sam tekst.
- **Shared**: bez zmian w kontrakcie typów — wykorzystujemy istniejące `RuleInput`, `RuleKind`, `RuleParams`, `RuleScope`, `STAFF_GROUPS`.
- **Zależności**: brak nowych; istniejący `@anthropic-ai/sdk`.
- **Testy**: test jednostkowy normalizatora (tekst→`RuleInput`) dla każdego `RuleKind`.
