# Grafik kliniki — instrukcja uruchomienia (dla personelu)

Aplikacja to jeden plik `vet-scheduler.exe`. Nie wymaga instalowania żadnych
dodatkowych programów.

## Pierwsze uruchomienie

1. Skopiuj `vet-scheduler.exe` do wybranego folderu na komputerze kliniki
   (np. `C:\GrafikKliniki\`).
2. Kliknij dwukrotnie `vet-scheduler.exe`.
   - Otworzy się okno konsoli (zostaw je otwarte — to działający program).
   - Automatycznie otworzy się przeglądarka pod adresem `http://localhost:8787`.
   - Jeśli przeglądarka się nie otworzy, wpisz ten adres ręcznie.
3. Wejdź w **Ustawienia** i wklej **klucz API Anthropic** kliniki.
   - Klucz zapisuje się lokalnie; wpisujesz go tylko raz.
   - Bez klucza działa wszystko oprócz generowania grafiku przez AI.

## Codzienne użycie

1. **Pracownicy** — dodaj osoby, ich grupę (recepcja/technicy/lekarze),
   poziom kwalifikacji i godziny na miesiąc.
2. **Zmiany** — zdefiniuj zmiany dla każdej grupy (godziny, dni, obsada min/max).
3. **Reguły stałe** — reguły obowiązujące zawsze (twarde = pilnowane, miękkie = preferencje).
4. **Prośby (miesiąc)** — wybierz miesiąc i wpisz prośby pracowników.
5. **Grafik** — wybierz miesiąc i kliknij **Wygeneruj grafik (AI)**.
   - Program sprawdza wynik względem twardych reguł i sam prosi AI o poprawki.
   - Jeśli zostaną konflikty (np. za dużo próśb), będą wyraźnie oznaczone — popraw ręcznie.
   - Edycje są od razu sprawdzane. Na końcu kliknij **Zapisz zmiany**.
   - **Eksport CSV** otwiera plik w Excelu.

## Kopia zapasowa danych

Wszystkie dane są w pliku **`data\vet-scheduler.db`** obok programu.
Aby zrobić kopię: zamknij program i skopiuj cały folder `data\` w bezpieczne miejsce.

## Zatrzymanie programu

Zamknij okno konsoli (lub naciśnij `Ctrl+C` w tym oknie).

## Uwagi

- Generowanie grafiku wymaga internetu (połączenie z AI). Reszta działa offline.
- Klucz API i dane pracowników są przechowywane tylko lokalnie, na tym komputerze.
