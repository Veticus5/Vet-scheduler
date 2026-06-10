## 1. Server — moduł AI i normalizator

- [x] 1.1 Utwórz `server/src/ai/draft-rules.ts` z `getClient()`/obsługą klucza i błędów wzorowaną na [generate.ts](server/src/ai/generate.ts) (HttpError 400 bez klucza, 502 przy błędzie sieci/dostawcy)
- [x] 1.2 Zdefiniuj narzędzie `propose_rules` (Anthropic.Tool) z opisowym `input_schema` (lista reguł: kind, hard, scope-grupy, name, description, płaskie parametry) i system promptem opisującym katalog `RuleKind` oraz kształt parametrów każdego typu
- [x] 1.3 Zbuduj kontekst dla AI: `STAFF_GROUPS`, aktywni pracownicy (id/imię/grupa/poziom kwalifikacji), definicje zmian (id/nazwa/grupa) — z instrukcją mapowania nazw na `employeeId`/`withGroup`/`exemptEmployeeIds`/`shiftDefIds`
- [x] 1.4 Zaimplementuj `normalizeDraftRule(raw, ctx)` → `RuleInput | null`: budowa `scope` (group/cross-group, odfiltrowanie nieznanych grup z fallbackiem), tagowanie `params.kind`, wartości domyślne per-kind (jak `defaultParams`), sanityzacja pól id względem kontekstu, pominięcie nieznanego `kind`
- [x] 1.5 Zaimplementuj `draftRulesFromText(text)`: walidacja niepustego tekstu, wywołanie Claude z wymuszonym `tool_choice: propose_rules`, parsowanie bloku `tool_use` (brak → HttpError 502), mapowanie przez normalizator i odfiltrowanie `null`

## 2. Server — endpoint

- [x] 2.1 Dodaj trasę `POST /rules/draft-from-text` do `ruleRoutes` w [rules.ts](server/src/api/rules.ts): odczyt `{ text }` przez `readJson`, walidacja, delegacja do `draftRulesFromText`, zwrot `RuleInput[]` jako JSON (bez zapisu do bazy)

## 3. UI — klient API i formularz

- [x] 3.1 Dodaj `draftRulesFromText(text)` do [api.ts](ui/src/api.ts) (`POST /rules/draft-from-text`, zwraca `RuleInput[]`)
- [x] 3.2 Dodaj panel „Utwórz regułę z opisu (AI)" w [RulesPage.tsx](ui/src/pages/RulesPage.tsx): textarea, input `type="file" accept=".txt"` (odczyt zawartości po stronie UI do textarea), przycisk generowania, stan ładowania/błędu
- [x] 3.3 Obsłuż wynik: 1 propozycja → `setForm(proposal)` (nowa reguła, `editingId=null`); wiele → lista kart z podsumowaniem (typ/rygor/zasięg/opis) i przyciskiem „Wczytaj do formularza" per karta
- [x] 3.4 Obsłuż brak klucza API i błędy AI/sieci łagodnie (komunikat w Banner, zachowanie wpisanego tekstu); zapis wyłącznie przez istniejący `submit()` → `POST /rules`

## 4. Testy i weryfikacja

- [x] 4.1 Dodaj test jednostkowy normalizatora (`normalizeDraftRule`) pokrywający każdy `RuleKind` (pairing, qualification-coverage, max-consecutive-days, coverage, freeform) + przypadki: nieznany kind pomijany, brakujące pola → domyślne, nieznane id odfiltrowane, scope group vs cross-group
- [x] 4.2 Uruchom `bun test` — zielone
- [x] 4.3 Uruchom typecheck `bunx tsc --noEmit` dla `server` i `ui` — zielone (UI czysto; w `server` tylko 3 preegzystujące błędy w autogenerowanym `ui-assets.generated.ts`, niezwiązane z tą zmianą)
