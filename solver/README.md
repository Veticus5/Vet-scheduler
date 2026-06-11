# CP-SAT solver sidecar — krok 1 migracji LLM → solver

Zastępuje LLM w roli **generatora** grafiku. Dostaje te same efektywne dane co
LLM (budowane przez [`server/src/solver/payload.ts`](../server/src/solver/payload.ts)),
zwraca `assignments` w formacie `submit_schedule`, a istniejący walidator TS
ocenia wynik niezależnie. Walidator i ścieżka LLM pozostają nietknięte.

## Zakres (kroki 1–2 — zrobione)

- **Krok 1:** twarde constrainty C1–C6, cel = sama odchyłka godzin (`W_hours`).
- **Krok 2:**
  - **slack na C1** (obsada) z karą `W_slack=10000` — niewykonalny miesiąc zwraca
    grafik + listę luk (`slacks`), nie gołe INFEASIBLE; zastępuje pre-check,
  - pełny cel: `W_pref` (prośby preferowane), `W_weekend` (~2 weekendy/os.),
    `W_shiftBalance` (poranne≈popołudniowe), `W_mid` (międzyzmiana oszczędnie),
    `W_tue` (kierownik+zastępca nie na tej samej wtorkowej zmianie).
- Wagi: `DEFAULT_WEIGHTS` w `server/src/solver/payload.ts` (hours 10, pref 8,
  weekend 4, shiftBalance 2, mid 1, tue 1, slack 10000; `balance` = opcjonalna
  sprawiedliwość max-nadwyżki godzin, domyślnie 0).
- Norma godzin: dynamiczna, art. 130 KP (`norm.py`), nie stała 160.

- **Krok 3 (dni biurowe):** dwufazowo. Faza 1 — `server/src/solver/office.ts`
  (`proposeOfficeDays`) wyznacza dni biurowe kierownika/zastępcy z heurystyki §5
  zasad. Faza 2 — solver nagradza je (`W_office`) i układa desk wokół; oddaje
  proponowany dzień tylko, gdy inaczej padłaby obsada. Dyżur biurowy `B` to
  realna zmiana `staffsReception=0` (liczy się do godzin/doby/dni-z-rzędu, nie do
  obsady desku). **Uwaga:** migracji produkcyjnej `B` jeszcze NIE ma — na krok 3
  seedujemy `B` tylko w kopii roboczej (patrz niżej); migracja wejdzie w kroku 4.

- **Krok 4 (wpięcie w aplikację):** zrobione.
  - Migracja v6 seeduje `B` w produkcji (`server/src/db/migrate.ts`).
  - `server/src/solver/run.ts` woła solver jako child process; endpoint generacji
    wybiera silnik wg `settings.generatorEngine` (`solver` domyślnie / `llm` za
    flagą). Przełącznik w Ustawieniach UI.
  - Solver pakowany PyInstallerem do `dist/solver/solver.exe` (one-folder),
    wysyłany obok `dist/vet-scheduler.exe`; serwer w trybie skompilowanym woła
    `dist/solver/solver.exe`, w dev — `solve.py` (patrz `VET_SOLVER_PYTHON`).

Mapowanie constraintów na walidator — patrz docstring w [`solve.py`](solve.py).

## Build produkcyjny

```bash
# wymaga venv z zależnościami (patrz Setup) + PyInstaller:
solver/.venv/Scripts/python.exe -m pip install pyinstaller

bun run build:dist     # = build:exe (aplikacja Bun) + build:solver (solver.exe)
# wynik: dist/vet-scheduler.exe  +  dist/solver/solver.exe  (~165 MB przez ortools)
```

`dist/` jest w `.gitignore` — bundla nie commitujemy. Start solver.exe ~3 s
(bootloader + import ortools), rozwiązanie <1 s. Override komendy solvera:
`VET_SOLVER_CMD` (JSON argv), w dev interpreter: `VET_SOLVER_PYTHON`.

## Setup (jednorazowo)

```bash
cd solver
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements.txt   # Windows
# (POSIX: .venv/bin/python -m pip install -r requirements.txt)
```

## Uruchomienie sidecara (architektura docelowa)

```bash
./.venv/Scripts/python.exe -m uvicorn solve:app --port 8899
# POST /solve  body: {"payload": <SolverPayload>}   →  {assignments, status, solveTimeMs, objective, hoursPerEmployee}
# GET  /health →  {"ok": true}
```

## Run porównawczy (krok 1, pkt 3–4)

Działa na **kopii roboczej** bazy, żeby nie dotykać produkcji:

```bash
# 1. skopiuj produkcyjną bazę (z plikami WAL!) do kopii roboczej
cp dist/data/vet-scheduler.db*  solver/.work/      # work.db, work.db-wal, work.db-shm

# 1b. (krok 3) zaseeduj dyżur biurowy B w kopii roboczej — produkcja bez zmian
bun -e 'import {Database} from "bun:sqlite"; const db=new Database("solver/.work/work.db"); \
  if(!db.query("SELECT 1 FROM shift_definitions WHERE id=?").get("office-duty-b")) \
  db.query(`INSERT INTO shift_definitions (id,staff_group,name,start_time,end_time,weekdays,required_min,required_max,staffs_reception) \
  VALUES (?,?,?,?,?,?,?,?,?)`).run("office-duty-b","reception","Dyżur biurowy","07:30","15:30","[1,2,3,4,5,6,0]",0,2,0);'

# 2. uruchom solver (tryb CLI/stdin) + walidację istniejącym walidatorem
VET_DB_PATH="solver/.work/work.db" \
PYTHON="solver/.venv/Scripts/python.exe" \
bun run server/scripts/cpsat-run.ts 2026-07
```

`cpsat-run.ts` woła `solve.py` jako child process (stdin→stdout JSON), więc do
porównania nie trzeba zarządzać serwerem. `cpsat-diagnose.ts` drukuje same
statystyki payloadu + wykonalność + baseline.

## Wynik (lipiec 2026)

| | LLM (baseline) | CP-SAT |
|---|---|---|
| Konflikty twarde (walidator) | **12** | **0** |
| Czas | ~minuty (model + pętla) | **~100 ms** |

Szczegóły i ograniczenia samego `W_hours` — w `HANDOFF_scheduler.md` / raporcie kroku 1.
