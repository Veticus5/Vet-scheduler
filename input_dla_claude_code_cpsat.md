# ZADANIE: Migracja generatora grafiku z LLM na solver CP-SAT — krok 1

## Decyzja i uzasadnienie

Po 4 generacjach LLM (Opus 4.8) z trajektorią konfliktów 83 → 45 → 25 → 12 wzorzec porażki jest stabilny i strukturalny, nie naprawialny promptami:

- skrajne niezbalansowanie godzin (ta sama osoba 4× z rzędu zagłodzona: Julita Groblica 16h/24h/56h/48h przy normie 160; inne osoby 216–240h),
- nawracające naruszenia doby pracowniczej (P→R) mimo podpowiedzi naprawczych,
- naruszane twarde prośby o wolne mimo ich obecności w kontekście.

Przyczyna: układanie grafiku to constraint satisfaction + optymalizacja globalna (~190 współzależnych przypisań), czego LLM strukturalnie nie robi — generuje sekwencyjnie, bez backtrackingu i bez funkcji celu. Przechodzimy na OR-Tools CP-SAT jako generator. LLM zostaje w systemie do zadań językowych (parsowanie próśb freeform, wyjaśnianie luk kadrowych).

## Zakres TEGO zadania — tylko krok 1, nic więcej

1. Otaguj obecny stan repo (np. `llm-generator-v1`) — baseline do porównania: 12 konfliktów na danych lipca 2026.
2. Na branchu `cpsat-generator` zbuduj **sidecar Python**: FastAPI, jeden endpoint `POST /solve`, wewnątrz model CP-SAT wg specyfikacji poniżej, ale w wersji minimalnej:
   - twarde constrainty C1–C6 (bez slacków na razie),
   - funkcja celu: WYŁĄCZNIE odchyłka godzin od normy (W_hours),
   - wejście: ten sam JSON-kontekst, który dziś dostaje LLM (employees, shiftDefinitions, shiftInstances z efektywnymi min/max, rules, twarde requesty rozwinięte do dat, końcówka poprzedniego miesiąca),
   - wyjście: `{ assignments: [{date, shiftDefId, employeeId}] }` — identyczny format jak submit_schedule.
3. Uruchom `/solve` na danych lipca 2026 (tych samych, co ostatnia generacja LLM) i przepuść wynik przez ISTNIEJĄCY walidator.
4. Zaraportuj porównanie: liczba konfliktów solver vs 12 (LLM), tabela godzin vs norma per pracownik, czas generacji.

## Czego NIE robić w tym kroku

- NIE ruszaj ścieżki LLM, walidatora, UI, pre-checku ani pętli naprawczej — wszystko zostaje bez zmian i działa równolegle.
- NIE implementuj jeszcze: slacków, wag miękkich preferencji, próśb `preferred`, dni biurowych, przełącznika w UI. To kroki 2–4 planu migracji (sekcja 8 specyfikacji) — wejdą dopiero po zielonym wyniku porównania.
- NIE usuwaj żadnego istniejącego kodu.

## Kryterium sukcesu kroku 1

Walidator zwraca 0 konfliktów twardych na wyniku solvera, każdy pracownik ma godziny w rozsądnym pasmie wokół normy (w szczególności Julita Groblica ≈ pełny wymiar), czas rozwiązywania < 10 s. Jeśli solver zwróci INFEASIBLE — zaraportuj, których constraintów dotyczy (w kroku 2 rozwiążemy to slackami), nie rozluźniaj nic samodzielnie.

---
---

# SPECYFIKACJA MODELU (pełny dokument referencyjny — implementuj krok 1 z powyższego zakresu)

# Model CP-SAT dla grafiku recepcji — szkic implementacyjny

Cel: zastąpić generację LLM solverem OR-Tools CP-SAT. LLM zostaje w rolach: parsowanie próśb freeform → struktury, tłumaczenie raportów niewykonalności na język ludzki, propozycja dni biurowych (heurystyki ról). Walidator i UI bez zmian — solver produkuje `assignments` w tym samym formacie co `submit_schedule`.

## 0. Dane wejściowe (te same co dziś)

`employees`, `shiftDefinitions`, `shiftInstances` (z **efektywnymi** min/max po nałożeniu reguł coverage — liczone w kodzie przed budową modelu), `rules`, `requests` (twarde już rozwinięte do dat), `month`, końcówka poprzedniego miesiąca jako lista stałych przypisań.

## 1. Zmienne decyzyjne

```
x[e, d, s] ∈ {0,1}   # pracownik e przypisany do instancji (data d, zmiana s)
```

Zmienną tworzymy TYLKO gdy przypisanie jest w ogóle legalne. Filtrowanie na etapie budowy modelu (nie constraintami):
- istnieje instancja (d, s) w `shiftInstances`,
- `defaultAvailability[e]` dopuszcza s w dzień tygodnia d,
- brak twardej prośby `time-off`/`unavailable` pokrywającej (e, d) lub (e, d, s),
- `staffGroup == "reception"`.

To od razu eliminuje całą klasę naruszeń "Wolne (prośba)" — nie da się przypisać czegoś, co nie ma zmiennej.

Pomocniczo:
```
work[e, d] = Σ_s x[e, d, s]          # czy e pracuje w dniu d (zmiana lub biuro)
hours[e]   = Σ_{d,s} x[e,d,s] · duration(s)
```

Końcówka poprzedniego miesiąca: dni sprzed `month` wchodzą jako **stałe** (work i typ zmiany znane), używane w C3 i C4.

## 2. Twarde constrainty (mapowanie 1:1 z Waszych reguł)

**C1 — Obsada (coverage):** dla każdej instancji recepcyjnej (staffsReception=true):
```
effMin(d,s) ≤ Σ_e x[e,d,s] ≤ effMax(d,s)
```
Międzyzmiana ma effMin=0 — solver użyje jej tylko, gdy pomaga funkcji celu.

**C2 — Jedna zmiana dziennie (double-booking):**
```
Σ_s x[e,d,s] ≤ 1    dla każdego (e,d)
```

**C3 — Doba pracownicza:** dla każdej pary sąsiednich dni (d, d+1) i każdej pary zmian (s1, s2), gdzie start(s2) < start(s1):
```
x[e,d,s1] + x[e,d+1,s2] ≤ 1
```
Generowane z `startTime` definicji — automatycznie obejmuje dyżury biurowe i przyszłe nowe definicje. Dla d=1 para z ostatnim dniem poprzedniego miesiąca (stała → jeśli e miał popołudniówkę 30.06, zmienne poranne 1.07 dostają constraint x=0).

**C4 — Max dni z rzędu:** dla każdego okna (maxDays+1) kolejnych dni (okno może zaczynać się w końcówce poprzedniego miesiąca):
```
Σ_{d w oknie} work[e,d] ≤ maxDays
```
Pomijane dla `exemptEmployeeIds`.

**C5 — Wolny weekend:** dla każdego weekendu w = (sob, ndz) w miesiącu:
```
freeW[e,w] ∈ {0,1}
freeW[e,w] ≤ 1 − work[e,sob]
freeW[e,w] ≤ 1 − work[e,ndz]
Σ_w freeW[e,w] ≥ 1        dla każdego e (pomijając osoby na urlopie cały miesiąc)
```

**C6 — Kwalifikacje (niedoświadczony nigdy bez doświadczonego):** dla każdej instancji recepcyjnej:
```
Σ_{e: tier=1} x[e,d,s] ≤ effMax(d,s) · Σ_{e: tier≥2} x[e,d,s]
```
Jeśli jest ktokolwiek rangi 1, wymusza ≥1 osobę rangi ≥2. Pusta zmiana spełnia trywialnie — znika problem "0 os. na pustej międzyzmianie" z definicji, bez warunków specjalnych.

## 3. Funkcja celu (miękkie reguły jako kary ważone)

Minimalizujemy sumę ważoną:

```
minimize:
  W_hours   · Σ_e |hours[e] − target[e]|              # norma godzin (target = contractHours − urlopy·8)
+ W_weekend · Σ_e |weekendyPracujące[e] − 2|           # cel 2–2,5 weekendu, wyrównanie
+ W_balance · Σ_{e ∉ wyjątki} |countR[e] − countP[e]|  # równowaga poranne/popołudniowe
+ W_pref    · Σ niespełnione prośby `preferred`
+ W_mid     · Σ użyte sloty międzyzmiany               # "stosuj oszczędnie"
+ W_tue     · Σ wtorki, gdy kierownik i zastępca na tej samej zmianie
```

Wartości bezwzględne standardowo przez zmienne odchyłek (dev⁺, dev⁻ ≥ 0, hours − target = dev⁺ − dev⁻, minimalizuj dev⁺+dev⁻).

Startowe wagi (do strojenia): W_hours=10, W_pref=8, W_weekend=4, W_balance=2, W_mid=1, W_tue=1. Kluczowa relacja: W_hours najwyżej — to leczy "Wiktorię z 8h" strukturalnie, bo każda godzina odchyłki boli solver bardziej niż cokolwiek innego.

## 4. Dni biurowe — rekomendacja: dwufazowo

Heurystyki "pierwszy/ostatni tydzień zastępcy, kierownik po grafiku lekarskim" są miękkie i opisowe — nie warto ich wciskać w constrainty. Prościej:

**Faza 1 (kod lub LLM):** wyznacz proponowane dni biurowe kierownika i zastępcy z heurystyk (deterministyczna funkcja: tygodnie z dat + reguły z sekcji E dokumentu zasad). 
**Faza 2 (solver):** dostaje je jako przypisania preferowane z wysoką nagrodą (lub zafiksowane, jeśli Daria je zatwierdziła w UI przed generacją). Solver układa resztę wokół nich, respektując C2–C4 (dzień biurowy liczy się jako praca).

Bonus produktowy: w UI "Daria klika swoje dni biurowe → generuj" — kontrola tam, gdzie człowiek ma wiedzę, automat tam, gdzie jest rachunek.

## 5. Niewykonalność — slack zamiast INFEASIBLE

Zamiast gołego INFEASIBLE (bezużyteczne dla użytkownika): do C1 dodaj zmienne luzu z ogromną karą:
```
effMin(d,s) − slack[d,s] ≤ Σ_e x[e,d,s],   slack ≥ 0,   kara: W_slack=10000 · Σ slack
```
Solver zawsze zwróci rozwiązanie, a `slack > 0` wskazuje dokładnie, gdzie brakuje ludzi: "2026-07-14 Poranna: −1 osoba". To zastępuje pre-check wykonalności i daje LLM-owi gotowy materiał do ludzkiego wyjaśnienia ("w drugim tygodniu nakładają się urlopy X i Y..."). Analogiczny slack można dać na C5 (wolny weekend), jeśli miesiąc z urlopami jest zbyt ciasny — z niższą karą niż obsada.

## 6. Integracja

- **Sidecar Python** (FastAPI/Flask): `POST /solve` przyjmuje ten sam JSON-kontekst, zwraca `{assignments: [...], slacks: [...], objectiveBreakdown: {...}}`. Node woła HTTP lub child process.
- `pip install ortools`, model ~200–300 linii.
- `solver.parameters.max_time_in_seconds = 10` (przy tej skali znajdzie optimum w <1s; limit to bezpiecznik).
- `solver.parameters.random_seed = stały` → reprodukowalność; zmiana seeda = alternatywny wariant grafiku ("wygeneruj inną propozycję" za darmo).
- Walidator zostaje bez zmian jako niezależny double-check wyniku solvera (zaufanie przez weryfikację — przyda się też przy ręcznych edycjach Darii).

## 7. Podział ról po zmianie

| Zadanie | Kto |
|---|---|
| Parsowanie próśb freeform → typy/daty/constrainty | LLM |
| Propozycja dni biurowych z heurystyk ról | kod lub LLM (faza 1) |
| Ułożenie grafiku | CP-SAT |
| Walidacja wyniku + ręcznych edycji | walidator (bez zmian) |
| Wyjaśnienie luk kadrowych i kompromisów po ludzku | LLM (na bazie slacks + objectiveBreakdown) |

## 8. Plan migracji (niskie ryzyko)

1. Sidecar z modelem C1–C6 + cel z samym W_hours. Porównaj wynik z generacją LLM na tych samych danych lipca — walidator jako sędzia.
2. Dołóż pozostałe wagi celu i slacki.
3. Podepnij fazę dni biurowych i prośby preferred.
4. Przełącz przycisk "Wygeneruj (AI)" na solver; ścieżkę LLM zostaw za feature flagą na miesiąc jako porównanie.

## 9. Szkielet (fragment, dla zobrazowania zwięzłości)

```python
from ortools.sat.python import cp_model

m = cp_model.CpModel()
x = {}
for e in employees:
    for (d, s) in instances:
        if legal(e, d, s):                      # availability + twarde prośby
            x[e, d, s] = m.NewBoolVar(f"x_{e}_{d}_{s}")

# C1 z slackiem
for (d, s) in reception_instances:
    staff = sum(x[e, d, s] for e in employees if (e, d, s) in x)
    slack = m.NewIntVar(0, eff_min[d, s], f"slack_{d}_{s}")
    m.Add(staff + slack >= eff_min[d, s])
    m.Add(staff <= eff_max[d, s])

# C3 — doba
for e in employees:
    for d in days[:-1]:
        for s1, s2 in forbidden_pairs:          # start(s2) < start(s1)
            if (e, d, s1) in x and (e, d + 1, s2) in x:
                m.Add(x[e, d, s1] + x[e, d + 1, s2] <= 1)
```

Reszta constraintów w tym samym duchu — całość to jeden czytelny plik.
