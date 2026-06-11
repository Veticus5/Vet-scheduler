# CP-SAT solver sidecar — krok 1 migracji LLM → solver

Zastępuje LLM w roli **generatora** grafiku. Dostaje te same efektywne dane co
LLM (budowane przez [`server/src/solver/payload.ts`](../server/src/solver/payload.ts)),
zwraca `assignments` w formacie `submit_schedule`, a istniejący walidator TS
ocenia wynik niezależnie. Walidator i ścieżka LLM pozostają nietknięte.

## Zakres kroku 1

- twarde constrainty **C1–C6, bez slacków**,
- funkcja celu: **wyłącznie odchyłka godzin od normy** (`W_hours`),
- bez miękkich preferencji, próśb `preferred`, dni biurowych (kroki 2–4).

Mapowanie constraintów na walidator — patrz docstring w [`solve.py`](solve.py).

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
