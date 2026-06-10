## Context

Aplikacja generuje miesięczny grafik recepcji przez AI, a deterministyczny walidator pilnuje twardych reguł (pokrycie zmian, kwalifikacje, pary, dni z rzędu, prośby o wolne). Model: `ShiftDefinition` (okno czasu + wymagana obsada `requiredMin/requiredMax` + dni tygodnia), `Assignment` (data + zmiana + pracownik), `validate()` liczący obsadę per instancja zmiany ([validator.ts](server/src/domain/validator.ts)).

Luka merytoryczna: każde przypisanie do zmiany liczy się jako obsada stanowiska — nie ma pojęcia **dyżuru w biurze** (praca administracyjna, w budynku, ale poza recepcją). Przez to dyżur biurowy fałszywie zaspokaja wymaganą obsadę recepcji.

Ograniczenia: lokalna aplikacja Bun→exe, SQLite z prostą migracją wersjonowaną, współdzielone typy w `@vet/shared`. Zmiana musi być wstecznie zgodna (istniejące zmiany = obsada recepcji) i nie psuć dotychczasowej walidacji.

## Goals / Non-Goals

**Goals:**
- Rozróżnić w modelu i walidacji „obsadę recepcji" od „dyżuru w biurze": dyżur biurowy NIE liczy się do pokrycia stanowiska, ale liczy się do limitu dni z rzędu (to wciąż dzień pracy).
- Przekazać AI informację o typie zmiany i wytyczną, że dyżur biurowy nie zastępuje obsady.
- Zachować wsteczną zgodność: brak flagi / stare wiersze = obsada recepcji.

**Non-Goals:**
- Wygląd/wydruk grafiku — układ pivot osoba × dzień, kolory zmian, kody W/U, suma godzin, eksport siatki, widok do druku. Świadomie odłożone na później.
- Automatyczne seedowanie domyślnych okien zmian recepcji (użytkownik ma je już zdefiniowane).
- Zmiana algorytmu generacji ani pętli naprawczej AI (tylko wzbogacenie kontekstu/wytycznych).
- Nowa twarda reguła „kierownik/zastępca musi mieć dni biurowe" — egzekwowanie pozostaje w istniejących zasadach aplikacji.

## Decisions

### D1: Dyżur biurowy = flaga `staffsReception` na `ShiftDefinition` (nie nowy typ Assignment)
`ShiftDefinition` zyskuje `staffsReception: boolean` (domyślnie `true`). Zmiana biurowa to po prostu definicja z `staffsReception=false` (np. „Biuro/Administracja 7:30–15:30").

- **Dlaczego:** obsada jest już liczona per instancja zmiany z definicji; flaga na definicji pozwala walidatorowi i generatorowi rozróżniać typy bez zmiany modelu `Assignment`, repozytoriów przypisań, zapisu grafiku ani UI gridu edycji. Godziny i „dni pracy" naturalnie nadal wynikają z przypisań.
- **Odrzucone alternatywy:**
  - *Nowy `Assignment.kind`* — inwazyjne: dotyka modelu przypisań, zapisu, walidatora, gridu i AI tool-schema; więcej powierzchni błędu.
  - *Tylko reguła freeform* — brak twardej kontroli; walidator dalej fałszywie liczyłby dyżur do obsady.

### D2: Walidacja — filtr „tylko zmiany recepcyjne" w obsadzie; dni z rzędu bez zmian
Tam, gdzie liczone jest **pokrycie stanowiska**, pomijamy instancje zmian z `staffsReception=false`:
- `validateCoverage` (wbudowane `requiredMin/requiredMax` + nadpisania reguł `coverage`),
- reguły `qualification-coverage` i `pairing` (dotyczą obecności na stanowisku).

Bez zmian (dyżur biurowy nadal się liczy):
- `max-consecutive-days` (to wciąż dzień pracy).

- **Dlaczego:** rozróżnienie dotyczy wyłącznie „kto stoi na recepcji", a nie „kto pracuje". Realizacja: w `validate()` budujemy listę instancji recepcyjnych (`deskInstances`) filtrowaną po fladze definicji i podajemy ją do reguł obsady; we wbudowanym pokryciu pomijamy zmiany biurowe bezpośrednio.

### D3: Kontekst AI — `staffsReception` per zmiana + zdanie w prompcie
`buildContextPayload` dodaje `staffsReception` do `shiftDefinitions`; `SYSTEM_PROMPT` zyskuje regułę: „Zmiany oznaczone jako dyżur biurowy NIE liczą się do obsady recepcji — nie używaj ich do spełnienia wymaganej obsady stanowiska; służą pracy administracyjnej."

- **Dlaczego:** generator musi unikać „łatania" pokrycia recepcji dyżurem biurowym; inaczej walidator zgłosi braki obsady i pętla naprawcza będzie marnować próby.

## Risks / Trade-offs

- **[Migracja kolumny w SQLite]** → Dodanie `staffs_reception` z domyślną wartością `1` (obsada recepcji); istniejące definicje pozostają niezmienione. Test migracji potwierdza odczyt starych wierszy.
- **[AI ignoruje wytyczną o dyżurze biurowym]** → Walidator i tak nie zaliczy dyżuru do obsady, więc braki ujawnią się jako twarde naruszenia pokrycia i pętla naprawcza je skoryguje; wytyczna w prompcie zmniejsza liczbę iteracji, ale nie jest jedyną linią obrony.

## Migration Plan

1. Dodać `staffsReception` do typów `@vet/shared` (opcjonalne w `Input`, domyślnie `true`).
2. Migracja DB: nowa kolumna z domyślną `1`; bump wersji migracji do 4.
3. Repo/API zmian: odczyt/zapis pola (domyślnie `true`, gdy brak).
4. Walidator: filtr instancji recepcyjnych w obsadzie; pozostawić dni z rzędu.
5. Kontekst AI + prompt.
6. UI: przełącznik typu zmiany, oznaczenie dyżuru w gridzie.

Rollback: kolumna jest addytywna i opcjonalna; cofnięcie kodu przywraca dotychczasowe zachowanie (wszystkie zmiany traktowane jako obsada), dane pozostają poprawne.
