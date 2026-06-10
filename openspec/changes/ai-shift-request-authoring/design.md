## Context

Prośby grafikowe (`ScheduleRequest`) są dziś modelem czysto „datowym": użytkownik wybiera pracownika, typ (`time-off` / `unavailable` / `preferred` / `freeform`) i wypisuje konkretne daty po przecinku, opcjonalnie z tekstem. Walidator ([validator.ts](server/src/domain/validator.ts)) i generacja ([generate.ts](server/src/ai/generate.ts)) czytają wyłącznie `req.dates` (oraz `text`/`shiftDefIds`). Reguły dostały już funkcję „z tekstu przez AI" ([draft-rules.ts](server/src/ai/draft-rules.ts) + `POST /rules/draft-from-text` + panel w [RulesPage.tsx](ui/src/pages/RulesPage.tsx)) z obowiązkowym krokiem przeglądu i defensywną normalizacją odpowiedzi modelu. Ta zmiana przenosi ten sam wzorzec na prośby i dokłada brakującą powtarzalność.

Ograniczenia: aplikacja to lokalny web-app na Bun spakowany do `.exe`, SQLite z migracjami wersjonowanymi ([migrate.ts](server/src/db/migrate.ts)), współdzielony kontrakt typów w [shared/src/index.ts](shared/src/index.ts). `Weekday` (0=niedziela…6=sobota) już istnieje.

## Goals / Non-Goals

**Goals:**
- Wprowadzanie próśb z opisu w języku naturalnym (textarea lub plik `.txt`) → typowane `ScheduleRequestInput[]` do przeglądu, bez automatycznego zapisu.
- Wyrażanie próśb powtarzalnych przez wzorzec dni tygodnia (np. „każda środa"), zamiast wypisywania każdej daty.
- Zachowanie niezmienionego odczytu przez walidator i generację (czytają `dates`).
- Wsteczna zgodność: istniejące prośby (sama lista dat) działają bez zmian.

**Non-Goals:**
- Powtarzalność międzymiesięczna — prośba pozostaje przypięta do jednego `month`; rekurencja rozwija się tylko w obrębie tego miesiąca.
- Nowy, samodzielny model „pory dnia". „Rano/popołudnie" wyrażamy istniejącym `shiftDefIds` (mapowanie na właściwe definicje zmian).
- Zmiana logiki walidatora/generacji ani delty capability `schedule-requests` (nie jest jeszcze zarchiwizowana).
- Automatyczny zapis propozycji AI.

## Decisions

### D1: Rekurencja jako `recurrence: { weekdays: Weekday[] }`, rozwijana na `dates` przy zapisie
Do `ScheduleRequest`/`ScheduleRequestInput` dodajemy opcjonalne `recurrence: { weekdays: Weekday[] }`. Serwer przy `create`/`update` rozwija je deterministycznie na wszystkie pasujące daty `YYYY-MM-DD` w obrębie `month` i zapisuje **zarówno** `recurrence`, **jak i** wynikowe `dates`.

- **Dlaczego rozwijać do `dates`, a nie zmieniać konsumentów?** Walidator i generacja już iterują po `req.dates`. Rozwijanie po stronie zapisu daje zerowy blast-radius w logice sprawdzania/generacji i utrzymuje jedno źródło prawdy do iterowania (konkretne daty), zachowując `recurrence` wyłącznie jako intencję do wyświetlenia/edycji.
- **Dlaczego pora dnia przez `shiftDefIds`, a nie nowy enum?** Definicje zmian mają już `name`/`startTime`/`weekdays`; „rano" to po prostu poranne zmiany. Reużycie istniejącego pola `shiftDefIds` unika nowego pojęcia w kontrakcie i w walidatorze.
- *Alternatywy:* (a) przechowywać tylko `recurrence` i rozwijać w locie w walidatorze/generacji — odrzucone: dotyka wielu konsumentów i utrudnia podgląd dat; (b) osobny model „pory dnia" (`morning`/`afternoon`) — odrzucone: dubluje informację już zawartą w definicjach zmian.

### D2: Endpoint `POST /requests/draft-from-text` zwracający `ScheduleRequestInput[]` (bez zapisu)
Lustrzane do `rules/draft-from-text`. Body: `{ text: string, month: string }`. `month` jest potrzebny, by (1) osadzić rekurencję w konkretnym miesiącu przy ewentualnym podglądzie dat i (2) zinterpretować daty względne. Endpoint zwraca propozycje; zapis wyłącznie przez istniejące `POST /requests`.

### D3: Tool-use `propose_requests` + defensywna normalizacja
Nowy moduł `server/src/ai/draft-requests.ts` wzorowany na [draft-rules.ts](server/src/ai/draft-rules.ts): wymuszone narzędzie `propose_requests`, kontekst = aktywni pracownicy (id/imię/grupa) + definicje zmian (id/nazwa/grupa/godziny/dni) + `month`. Model zwraca płaski kształt; serwer normalizuje do `ScheduleRequestInput`:
- mapuje nazwiska→`employeeId` (tylko istniejące id; pozycje bez poprawnego pracownika odrzucane),
- waliduje `type` względem `RequestType`,
- przyjmuje `dates` **albo** `recurrence.weekdays` (0–6, unikalne); odrzuca daty spoza `month`,
- mapuje „rano/popołudnie" na `shiftDefIds` z kontekstu (tylko istniejące id),
- `freeform` wymaga `text`.

Normalizator i funkcja rozwijania rekurencji są czystymi funkcjami nad przekazanym kontekstem → bezpośrednio testowalne, jak `normalizeDraftRule`.

### D4: UI — panel AI + przełącznik dat/powtarzalności
W [RequestsPage.tsx](ui/src/pages/RequestsPage.tsx): (1) panel „Utwórz prośbę z opisu (AI)" (textarea + input pliku `.txt`, plik czytany w przeglądarce, do API leci sam tekst); jedna propozycja → wczytanie do formularza, wiele → lista kart z „Wczytaj do formularza". (2) W formularzu próśb przełącznik trybu: „konkretne daty" (istniejące pole) lub „powtarzalnie" (multi-select dni tygodnia). Nowa metoda `api.draftRequestsFromText(text, month)`.

### D5: Migracja DB wersja 3 — kolumna `recurrence TEXT`
Dodanie `ALTER TABLE requests ADD COLUMN recurrence TEXT` jako migracja wersji 3 (wzorzec z [migrate.ts](server/src/db/migrate.ts)). `recurrence` serializowane jako JSON (`NULL` gdy brak). Stare wiersze pozostają poprawne.

## Risks / Trade-offs

- **Rozjazd `recurrence` ↔ `dates` po edycji** → rozwiązanie: `dates` zawsze regenerowane z `recurrence` przy każdym `create`/`update`, gdy `recurrence` jest obecne; nigdy nie edytujemy ich rozłącznie.
- **AI proponuje nieznanego pracownika / datę spoza miesiąca** → mitygacja: defensywna normalizacja odrzuca takie pozycje/pola (wzorzec `sanitizeIds`), pusta lista → czytelny błąd 502, bez zapisu.
- **Brak klucza API blokuje tylko AI** → mitygacja: powtarzalność (D1/D4) działa w pełni bez AI; tylko panel „z opisu" wymaga klucza, z jasnym komunikatem.
- **Zależność pory dnia od istnienia odpowiednich definicji zmian** → mitygacja: gdy brak pasującej zmiany porannej, `shiftDefIds` pozostaje puste, a prośba i tak jest poprawna (obejmuje cały dzień); intencja zachowana w `text`.

## Migration Plan

1. Rozszerzyć typ w `shared` o `recurrence` (opcjonalne, wstecznie zgodne).
2. Dodać migrację wersji 3 (kolumna `recurrence`); uruchamia się automatycznie przy starcie.
3. Rozszerzyć `repos/requests.ts` (odczyt/zapis `recurrence`) i `api/requests.ts` (`validate` + rozwijanie rekurencji na `dates`).
4. Dodać `ai/draft-requests.ts` + trasę `POST /requests/draft-from-text`.
5. Rozszerzyć UI i `api.ts`.
6. Przebudować `.exe` (`bun run build:exe`) i zrelaunchować — sam restart nie pokaże zmian.

Rollback: cofnięcie kodu; kolumna `recurrence` pozostaje nieużywana i nieszkodliwa (migracje tylko naprzód, brak destrukcji danych).

## Open Questions

- Czy w UI udostępnić również szybkie skróty pór dnia („rano"/„popołudnie") mapujące na zestawy `shiftDefIds`, czy zostawić wybór konkretnych zmian? (Domyślnie: wybór konkretnych zmian + mapowanie przez AI z tekstu.)
