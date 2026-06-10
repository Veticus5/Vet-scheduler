## Context

Projekt ma już działający wzorzec wywołania Claude przez tool-use w [generate.ts](server/src/ai/generate.ts): `getClient()` pobiera klucz przez `getApiKey()` i rzuca `HttpError(400)` przy jego braku, `client.messages.create(...)` z `tools` + `tool_choice: { type: "tool", name }`, a błędy sieci/dostawcy są opakowane w `HttpError(502)`. Reguły są typowane w [shared/src/index.ts](shared/src/index.ts) (`RuleKind`, `RuleParams` jako unia dyskryminowana po `kind`, `RuleScope`, `RuleInput`). CRUD reguł i walidacja `RuleInput` żyją w [rules.ts](server/src/api/rules.ts) + [repos/rules.ts](server/src/repos/rules.ts). Formularz reguł w [RulesPage.tsx](ui/src/pages/RulesPage.tsx) ma już `defaultParams(kind)`, `emptyRule()` i pełną edycję każdego typu — chcemy do niego *wczytywać* propozycje AI, a nie budować osobnego edytora.

Capability `scheduling-rules` (ze zmiany `schedule-generator`) nie jest jeszcze zarchiwizowana, więc nie istnieje w `openspec/specs/`. Aby uniknąć zależności „modified capability", realizujemy to jako nową capability `ai-rule-authoring`, a zapis korzysta z niezmienionego `POST /rules`.

## Goals / Non-Goals

**Goals:**
- Zamiana opisu w języku naturalnym (tekst lub plik `.txt`) na jedną lub wiele typowanych wersji roboczych `RuleInput`, bez zapisu.
- Wierne reużycie wzorca klienta AI, obsługi klucza i błędów z `generate.ts`.
- Defensywna normalizacja odpowiedzi AI do `RuleInput` zgodnego z istniejącym kontraktem typów — bez zmian w `shared`.
- Obowiązkowy przegląd: propozycja wczytywana do istniejącego formularza, zapis ręczny przez `POST /rules`.
- Test jednostkowy normalizatora dla każdego `RuleKind`.

**Non-Goals:**
- Brak automatycznego zapisu reguł.
- Brak zmian w typach współdzielonych ani w schemacie bazy.
- Brak modyfikacji capability `scheduling-rules`.
- Brak nowego, samodzielnego edytora reguł w UI (reużywamy obecny formularz).
- Brak walidacji semantycznej reguł poza tym, co robi już istniejący walidator/`POST /rules`.

## Decisions

### D1: Nowa capability zamiast modyfikacji scheduling-rules
Realizujemy jako `ai-rule-authoring`. **Dlaczego:** `scheduling-rules` nie jest w `openspec/specs/` (zmiana wciąż aktywna), więc delta „modified" nie miałaby bazy do porównania przy archiwizacji. Alternatywa (archiwizacja `schedule-generator` najpierw) jest możliwa, ale poszerza zakres tej zmiany — odrzucona domyślnie.

### D2: Endpoint `POST /api/rules/draft-from-text` zwraca `RuleInput[]`
Jeden plik/opis może zawierać wiele zasad, więc zwracamy tablicę zawsze (nawet dla jednej reguły). Endpoint NIE zapisuje. **Dlaczego tablica:** ujednolica obsługę „jedna vs. wiele" po stronie UI; serwer nie musi zgadywać intencji. Trasa dołączona do `ruleRoutes` w [rules.ts](server/src/api/rules.ts), zgodnie z istniejącym stylem `Route[]`.

### D3: Osobny moduł `server/src/ai/draft-rules.ts`
Logika AI (narzędzie `propose_rules`, budowa kontekstu, normalizacja) w osobnym pliku, analogicznie do `generate.ts`. **Dlaczego:** trzyma `rules.ts` cienkim (CRUD + delegacja), reużywa wzorca i ułatwia testowanie normalizatora w izolacji. `getClient()`/obsługa błędów skopiowane wzorcowo (ten sam kształt `HttpError` 400/502).

### D4: Wymuszone narzędzie `propose_rules` z payloadem „luźnym", normalizacja po stronie serwera
Schemat narzędzia opisuje pola reguły opisowo (kind, hard, scope jako grupa/grupy, name, description oraz „płaskie" parametry), ale serwer NIE ufa strukturze i normalizuje defensywnie. **Dlaczego:** modele bywają niespójne w zagnieżdżeniu `params`/`scope`; pojedynczy, deterministyczny normalizator (`normalizeDraftRule`) daje przewidywalny `RuleInput` i jest jednostkowo testowalny. Kontekst dla AI zawiera: `STAFF_GROUPS`, aktywnych pracowników (id/imię/grupa/poziom) i definicje zmian (id/nazwa/grupa) oraz opis katalogu `RuleKind` i kształtu parametrów każdego typu — by AI mapowała nazwy na id.

### D5: Normalizacja per-kind z wartościami domyślnymi z `defaultParams`
Normalizator odwzorowuje logikę `defaultParams(kind)` z UI: dla `pairing` → `{ withGroup: [] }`, `qualification-coverage` → `{ minQualificationLevel, minCount }`, `max-consecutive-days` → `{ maxDays }`, `coverage` → `{}`, `freeform` → `{}`. Nieznany `kind` → pozycja pomijana. Pola id (`employeeId`, `exemptEmployeeIds`, `shiftDefIds`, `withGroup`) sanityzowane do znanych wartości (odfiltrowanie nieistniejących). **Dlaczego:** wynik od razu pasuje do formularza i nie wymaga ręcznego naprawiania kształtu.

### D6: Scope budowany defensywnie
Jeśli AI poda jedną grupę → `{ type: "group", group }`; jeśli wiele → `{ type: "cross-group", groups }`. Nieznane klucze grup odfiltrowane; brak poprawnej grupy → bezpieczny fallback (`{ type: "group", group: <grupa z kontekstu reguły lub pierwsza sensowna> }`). **Dlaczego:** `RuleScope` jest unią — UI i walidator zakładają poprawny kształt.

### D7: Odczyt pliku `.txt` po stronie UI
Input `type="file" accept=".txt"` → `FileReader`/`file.text()`, zawartość wstawiana do textarea (stan formularza AI). Do API leci tylko tekst. **Dlaczego:** brak potrzeby multipart/upload na serwerze; spójne z prostotą API JSON.

### D8: Wczytanie propozycji do istniejącego formularza
Jedna propozycja → `setForm(proposal)` + ewentualnie `setEditingId(null)` (nowa reguła). Wiele → lista kart; klik „Wczytaj do formularza" robi `setForm(proposal)` i przewija/fokusuje formularz. Zapis przez istniejący `submit()` → `api.createRule`. **Dlaczego:** jedno źródło prawdy dla edycji i walidacji; brak duplikacji logiki formularza.

## Risks / Trade-offs

- **AI zwraca niespójny kształt `params`/`scope`** → normalizator defensywny z testami per-kind; nieznane typy pomijane, brakujące pola domyślne.
- **AI halucynuje nieistniejące id pracowników/zmian** → sanityzacja pól id względem kontekstu (odfiltrowanie nieznanych); użytkownik i tak przegląda regułę przed zapisem.
- **Model zwróci 0 reguł lub prozę zamiast narzędzia** → wymuszone `tool_choice`; brak bloku `tool_use` → `HttpError(502)` z czytelnym komunikatem, tekst użytkownika zachowany w UI.
- **Duży plik `.txt`** → wejście to zwykły tekst; przy bardzo długim wejściu polegamy na limicie `max_tokens` i komunikacie błędu (akceptowalne dla lokalnej apki jednoklinikowej).
- **Brak klucza API** → blokada przed wywołaniem sieci, komunikat kierujący do Ustawień (jak w `generate.ts`).
