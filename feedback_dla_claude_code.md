# Feedback po generacji 2026-07 (8 konfliktów po 4 próbach) — problemy i proponowane fixy

## P1 — `max-consecutive-days` liczy rozpiętość, nie serię (BUG, priorytet 1)

**Objaw:** sekcja "Niespełnione preferencje" pokazuje 30–39 dni pracy z rzędu dla WSZYSTKICH 11 pracowników, w tym osób z 13 zmianami w miesiącu (np. Justyna Fraszczyk: 104h = 13 zmian rozrzuconych po miesiącu → raportowane "30 dni z rzędu").

**Diagnoza (z liczb):** wartości odpowiadają `ostatni_dzień_z_przypisaniem − pierwszy_dzień_z_przypisaniem + 1`, a nie najdłuższej nieprzerwanej serii. Dni wolne nie resetują licznika. Kaja Carter: 39 przy 31-dniowym miesiącu = span liczony od końcówki czerwca (poprzedni miesiąc) do 31.07 — czyli sklejanie z poprzednim miesiącem działa, ale na spanie, nie na streaku.

**Fix:** iteracja po dniach kalendarzowych chronologicznie (począwszy od końcówki poprzedniego miesiąca): dzień z ≥1 przypisaniem → `streak++`, dzień bez przypisania → `streak = 0`; wynik = max(streak). Dni biurowe (`staffsReception:false`) liczą się jako dni pracy.

**Testy do dodania:**
1. Osoba pracująca co drugi dzień przez cały miesiąc → streak = 1 (obecny kod dałby ~30).
2. Końcówka poprzedniego miesiąca: 3 dni pracy 28–30.06 + praca 1–5.07 → streak = 8.
3. Przerwa jednodniowa w środku długiej serii → streak resetuje się poprawnie.

**Dodatkowo:** ta kontrola figuruje teraz w sekcji miękkich, a w kontrakcie była twardą regułą typowaną. Podejrzewam, że została zdegradowana, bo z obecnym bugiem krzyczała na wszystkich i blokowała generacje. Po naprawie liczenia MUSI wrócić do twardych — limit dni pracy z rzędu to wymóg prawa pracy (system równoważny), nie preferencja.

## P2 — Systematyczne zagłodzenie jednego pracownika (Julita Groblica)

**Objaw:** druga generacja z rzędu, w której Julita dostaje skrajnie mało godzin (poprzednio 16h, teraz 24h przy normie 160). Ta sama osoba w obu przebiegach — to wzorzec, nie losowość.

**Krok 1 — wyklucz problem danych (zanim ruszysz prompt):** sprawdź rekord Julity: `defaultAvailability` (czy nie ma pustych list na większość dni tygodnia), prośby `unavailable`/`time-off` z recurrence, poprawność `staffGroup` i `contractHours`. Jeśli model "nie może" jej obsadzać, to balansowanie nic nie da.

**Krok 2 — jeśli dane czyste, dwa mechanizmy:**
1. **Kwoty per osoba w kontekście generacji.** Przed wysłaniem do modelu policz deterministycznie i dodaj do promptu gotową tabelę: `imię → cel zmian w tym miesiącu` (contractHours minus urlopy, podzielone przez 8, np. "Julita Groblica: cel ~20 zmian, urlopy: 0"). Modele balansują radykalnie lepiej z jawnym licznikiem do trafienia niż z ogólnym "wyrównuj godziny".
2. **Tabela odchyleń w feedbacku pętli naprawczej.** Do listy naruszeń dołączaj sekcję informacyjną: `odchylenia od normy: Julita −136h, Kaja +80h, ...` z instrukcją "przesuń zmiany od osób z nadwyżką do osób z niedoborem tam, gdzie nie łamie to twardych reguł". To nie jest naruszenie (norma zostaje miękka), ale model dostaje sygnał do korekty w iteracji.

## P3 — Pętla naprawcza nie umie naprawiać doby pracowniczej

**Objaw:** 6 z 8 pozostałych konfliktów po 4 próbach to `rest-period`. Wykrywanie działa, naprawa nie — model dostaje opis naruszenia i nie wie, jak je ruszyć (albo rusza i tworzy nowe).

**Fix — podpowiedź kierunkowa per typ naruszenia.** Do każdego naruszenia w komunikacie naprawczym dołącz szablonową instrukcję naprawy:
- `rest-period`: "Osoba X ma za krótki odpoczynek D→D+1. Napraw JEDNYM z ruchów: (a) zamień zmianę poranną osoby X w dniu D+1 na popołudniową lub międzyzmianę, (b) przypisz zmianę poranną z D+1 innej osobie, która w dniu D nie pracowała po południu, (c) zdejmij osobę X z dnia D+1, jeśli obsada na to pozwala. Po zmianie sprawdź, czy nie powstało nowe naruszenie doby w dniach sąsiednich."
- `hard request` (jak Monika 31.07): "Osoba ma twardą prośbę o wolne — zdejmij ją z tej zmiany i obsadź kimś dostępnym; NIE wybieraj osoby, której to złamie dobę lub limit dni."
- analogiczne szablony dla coverage i wolnego weekendu.

Uzasadnienie: suchy opis błędu wymaga od modelu samodzielnego wymyślenia strategii naprawy w każdej iteracji; szablon zamienia to w wybór z 2–3 legalnych ruchów. To powinno domykać większość naruszeń doby w jednej iteracji zamiast przepalać 4 próby.

## Kolejność wdrożenia

1. P1 (bug liczenia + powrót do twardych) — zniekształca obraz każdej generacji i blokuje legalność grafiku.
2. P3 (podpowiedzi naprawcze) — najtańszy duży zysk jakości końcowej.
3. P2 (kwoty godzinowe) — wymaga najpierw weryfikacji danych Julity.

## Co działa i ma zostać bez zmian

Pre-check wykonalności, bezpiecznik liczby prób z komunikatem "popraw ręcznie", walidacja wolnego weekendu (złapała Zuzannę Wojnę), rest-period detection, odejmowanie urlopów w tabeli godzin, banner konfiguracyjny przy dużej liczbie konfliktów. Trajektoria 83 → 45 → 8 konfliktów potwierdza, że architektura jest właściwa.
