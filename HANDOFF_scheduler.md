# Handoff — generator grafiku recepcji (dla kolejnego agenta)

Log najważniejszych ustaleń z sesji pracy nad generacją/walidacją grafiku. Czytaj
to zanim ruszysz cokolwiek w `server/src/ai/generate.ts` lub `server/src/domain/validator.ts`.

---

## 1. Czym jest system i jedna żelazna zasada

Lokalna aplikacja webowa (Bun → pojedynczy `.exe`) do układania miesięcznych
grafików recepcji kliniki weterynaryjnej. Dwie warstwy:

1. **Model AI** dostaje ustrukturyzowany kontekst i proponuje cały grafik miesięczny
   przez wywołanie narzędzia `submit_schedule` (lista przypisań `{date, shiftDefId, employeeId}`).
2. **Deterministyczny walidator** (`domain/validator.ts`) jest **JEDYNYM źródłem prawdy**
   o poprawności. Etykieta „Brak konfliktów" = „walidator nic nie znalazł".

**Żelazna zasada architektury:** model i walidator MUSZĄ patrzeć na te same efektywne
liczby. Każda reguła, której walidator nie sprawdza, jest tylko sugestią w prompcie.
Nie każ modelowi scalać reguł — policz wszystko deterministycznie przed wysłaniem.

---

## 2. Build & run (KRYTYCZNE operacyjnie)

Zmiany w server/UI nie są widoczne po samym restarcie — trzeba **przebudować exe**:

```
# 1. ubij działający proces (blokuje plik .exe → EPERM przy buildzie)
Stop-Process -Name vet-scheduler -Force
# 2. build (UI + exe)
bun run build:exe
# 3. relaunch
Start-Process dist/vet-scheduler.exe
```

- Testy: `bun test` (z roota). Typecheck: `bunx tsc --noEmit -p ui` / `-p server`
  (server zawsze zgłasza błędy `ui-assets.generated.ts` — to artefakt builda, ignoruj).
- **Baza:** `dist/data/vet-scheduler.db` (SQLite). Odpyt przez `bun -e` + `bun:sqlite`
  (`readonly: true` do odczytu). Migracje w `db/migrate.ts` (append-only, raz każda).

---

## 3. Co walidator EGZEKWUJE (twarde, sprawdzane w kodzie)

Wbudowane, zawsze włączone (nie da się wyłączyć — prawo/sanity):
- **`double-booking`** — >1 przypisanie tej samej osoby w dniu.
- **`rest-period`** (doba pracownicza) — kolejny dzień pracy nie może zaczynać się
  WCZEŚNIEJ niż poprzedni (start-do-startu ≥24h dla dni sąsiednich). Odtwarza tabelę
  P→R/P→M/M→R = naruszenie; R→R/R→P/R→M/M→M/M→P/P→P OK. **Liczy przełom miesiąca**
  (składa ostatni dzień poprzedniego miesiąca z `prevMonthAssignments`) i **dyżur biurowy**
  (B startuje 07:30 → P→B też narusza). Bez wyjątków.
- **`free-weekend`** (H7) — każdy aktywny pracownik musi mieć ≥1 CAŁY wolny weekend
  (sobota+niedziela, oba dni w miesiącu — pary, nie „jakaś sobota + jakaś niedziela").
  Uniwersalne (wszystkie grupy).

Konfigurowalne reguły (typowane, z DB):
- **`coverage`** — nadpisuje `requiredMin/Max` per instancja (filtry `weekdays`,`shiftDefIds`).
  Tak wyraża się H1/H2/H3. Liczy tylko zmiany recepcyjne (`staffsReception != false`).
  UWAGA: `effectiveCoverage` stosuje WSZYSTKIE reguły coverage niezależnie od flagi
  `hard`, a `validateCoverage` zawsze pcha twarde naruszenie.
- **`qualification-coverage`** — min N osób rangi ≥ próg. **Pomija pustą OPCJONALNĄ
  instancję** (0 przypisań i efektywne min=0) — inaczej globalna reguła krzyczy na
  każdą pustą międzyzmianę.
- **`pairing`** — wskazana osoba/ranga musi mieć partnera z grupy.
- **`max-consecutive-days`** — limit dni z rzędu. Carry-in liczony **per osoba**
  (nie „ktokolwiek pracował"), `maxRun` startuje od 0 (seria żyjąca tylko w poprzednim
  miesiącu nie jest tu zgłaszana). Obejmuje dyżur biurowy. Wyjątki: `exemptEmployeeIds`.

`Violation.kind` = `RuleKind | "time-off" | "rest-period" | "double-booking" | "free-weekend"`.

## 3b. Co NIE jest egzekwowane (tylko-AI / miękkie)
- **H8 norma godzin** — świadomie miękka. Widoczna jako tabela „Godziny vs norma"
  w `SchedulePage` (odejmuje urlopy `time-off`: −8h/dzień; niedostępność nie).
- Heurystyki dni biurowych Darii/Justyny (sekcja E md) — freeform, nie do walidacji.
- Reguły `freeform` — `machineValidated=false`, tylko wskazówka.
- `B/2` (pół dnia) NIE jest modelowane — gdyby dodać jako osobną zmianę, double-booking
  fałszywie oznaczy osobę z B/2 + inną zmianą tego samego dnia.

---

## 4. Generacja (`ai/generate.ts`)

- **Kontekst (`buildContextPayload`):** employees mają `targetShifts`/`targetHours`
  (norma − 8h/dzień urlopu); `shiftDefinitions` BEZ min/max; **`shiftInstances`
  z EFEKTYWNYM `requiredMin/Max`** per dzień (override coverage już scalony; dyżur
  biurowy → min 0). To realizuje żelazną zasadę z sekcji 1.
- **SYSTEM_PROMPT** zawiera m.in.: zakaz double-bookingu, doba pracownicza,
  **planowanie blokowe** (kilka dni tego samego typu, zmiana tylko wcześniejsza→późniejsza
  lub po dniu wolnym — tnie P→R u źródła), wolny weekend, autorytatywne per-instancja
  min/max, „wiele wpisów = wiele osób na zmianie", **bilans ±2 zmiany od targetShifts**.
- **Pętla naprawcza:** waliduje, odsyła `buildRepairMessage` = lista naruszeń
  + adnotacje luk kadrowych + **szablony naprawcze per typ** (P3) + tabela odchyleń godzin.
  Maks. prób = `settings.maxRepairAttempts + 1` (domyślnie 4).
- **Bezpiecznik `looksSystemic()`** — pętla pomija naprawę TYLKO gdy wzorzec jest
  systemowy: jedna reguła/kind > 50% konfliktów i ≥ połowa dni miesiąca (smród
  konfiguracji), albo > 80 konfliktów. Konflikty rozproszone naprawia normalnie
  nawet przy ~25. Wynik niesie flagę `systemic` → UI pokazuje komunikat „konfiguracja".
- **Pre-check wykonalności (`feasibility.ts`):** przed generacją liczy, ile osób
  uprawnionych+dostępnych jest na każdą zmianę vs efektywne min. Niedobór = „Luka
  kadrowa" (za mało ludzi, nie wina AI). Pokazywane osobno w UI.

---

## 5. Historia / trajektoria (kontekst, czemu kod wygląda jak wygląda)

Konflikty lipca 2026 spadały: **83 → 45 → 25 (surowe) / 8 (po naprawie)**. Kolejne
przyczyny i fixy:
1. **83:** definicje zmian miały `requiredMin/Max = 1/1`, a reguły coverage osobno →
   model dostawał sprzeczne sygnały i dawał 1 os./zmianę. Fix: efektywne min/max
   per instancja w kontekście.
2. **45→25 fantomy:** seedowana reguła D3 (`qualification-coverage`) odpalała się na
   pustych opcjonalnych międzyzmianach (31×). Fix: pomijanie pustych opcjonalnych.
3. **Doba nie naprawiana:** stary bezpiecznik (próg 15) przerywał pętlę przy 45.
   Fix: klasyfikacja wzorca zamiast progu.
4. **`max-consecutive` raportował ~30 dla wszystkich:** carry-in z GLOBALNYCH dni
   poprzedniego miesiąca + `maxRun` seedowany carry-in. Fix: per-osoba + seed 0.
5. **Zagłodzenie Julity (8–24h) / przeciążenie (240h):** H8 miękkie. Fix: jawne
   `targetShifts` w kontekście + bilans ±2 w prompcie + tabela odchyleń w pętli.
6. **16× P→R:** model uparcie wstawiał poranną po popołudniówce. Fix: zasada
   planowania blokowego w prompcie (atak u źródła) + szablony naprawcze.

---

## 6. Stan konfiguracji w bazie (ważne — to dane użytkownika, nie kod)

- **Grupy:** recepcja (4 rangi: niedoswiadczony=1, doswiadczony=2, zastepca=3, kierownik=4),
  technicy, lekarze (placeholder). 11 pracowników recepcji.
- **Zmiany:** Poranna 07:30–15:30, Popołudniowa 14:30–22:30 (obie `required_min/max = 1/1`
  w definicji — DEFENSYWNIE warto podbić do 3/4, NIE zrobione; efektywne i tak nadpisują
  reguły coverage), Międzyzmiana 10:00–18:00 (0–1, opcjonalna).
- **Reguły coverage:** dni robocze [wt,śr,pt] 3–4; weekend [sob,ndz] 2–2; pon/czw 4–4
  (ta jest `hard=0` mimo że md mówi twarda — do ewentualnego flipa).
- **ZMIENIONE W TEJ SESJI ręcznym UPDATE w DB:** reguła `max-consecutive-days`
  (`id 4e8ba2dd…`) ustawiona `hard=1` + `exemptEmployeeIds=[Daria 7a713c28…, Beata 6ca23567…]`
  (md H6 je zwalnia — bez wyjątków twarda reguła fałszywie by je oznaczała).
- **Seed (migracja v5):** reguła „Min. 1 doświadczony na zmianie recepcji"
  (`qualification-coverage`, rank≥2, count≥1, hard, włączona). Domyślnie ON, klinika
  może wyłączyć — migracja raz, nie wskrzesza po usunięciu.
- **Grafiki zapisane:** czerwiec 2026 (182 przypisania) i lipiec 2026 (188), oba `has-conflicts`.
  Czerwiec jest źródłem `prevMonthAssignments` dla lipca (carry-in doby i dni z rzędu).

---

## 7. Otwarte sprawy / co obserwować

- **Następny krok:** wygenerować lipiec po ostatnim buildzie i sprawdzić: czy godziny
  ścisnęły się do ~18–22 zmian/os., czy doba zniknęła u źródła (bloki), czy twarda
  `max-consecutive` z wyjątkami działa, czy pętla naprawia rozproszone konflikty.
- Próg systemowy: 50% + połowa dni; sufit 80. Do strojenia, jeśli za czuły/za luźny.
- Tabela godzin nie odejmuje niedostępności (tylko `time-off`) — świadome.
- Rozważyć defensywną poprawę definicji Poranna/Popołudniowa 1/1 → 3/4 (gdyby ktoś
  usunął reguły coverage, system nie zdegraduje).

---

## 8. Kluczowe pliki

- `server/src/domain/validator.ts` — źródło prawdy; wszystkie checki.
- `server/src/domain/feasibility.ts` — pre-check wykonalności.
- `server/src/ai/generate.ts` — kontekst, prompt, pętla naprawcza, bezpiecznik.
- `server/src/db/migrate.ts` — migracje + seed reguł.
- `server/src/api/schedules.ts` — endpointy generacji/walidacji/zapisu.
- `ui/src/pages/SchedulePage.tsx` — grafik, luki kadrowe, tabela godzin, komunikaty.
- `shared/src/index.ts` — kontrakt typów (Employee, ShiftDefinition, Rule, Violation,
  FeasibilityReport…).
- `zasady_grafiku_recepcja.md` — dokument zasad domenowych (intencja; źródło H1–H8, S1–S4).

77 testów przechodzi (`bun test`). Walidator i feasibility mają pełne pokrycie edge-case'ów
(przełom miesiąca, dyżur biurowy w dobie, para weekendu, pusta opcjonalna zmiana, carry-in per osoba).
