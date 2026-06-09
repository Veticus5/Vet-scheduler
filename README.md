# Vet Scheduler

AI-assisted monthly scheduling for a veterinary clinic. Local web app: a Bun
server runs on the clinic machine and serves a React UI in the browser. Claude
(Anthropic API) generates the schedule; a deterministic validator enforces hard
rules and drives a repair loop so a rule-breaking schedule is never shown as valid.

Built per the OpenSpec change `schedule-generator` (see `openspec/`).

## Stack

- **Bun + TypeScript** server, compiled to a single Windows `.exe` (`bun build --compile`).
- **React + Vite** UI, embedded into the executable.
- **SQLite** (`bun:sqlite`) single-file local storage.
- **@anthropic-ai/sdk** with structured tool-use output.

## Layout

```
shared/   shared domain types (the server/UI contract)
server/   Bun server: API, SQLite, validator, AI generation
ui/       Vite + React front-end
docs/     INSTALL.md (clinic-facing) + department rule drafts
```

## Development

```bash
bun install

# Terminal 1 — API server on :8787
bun run dev:server

# Terminal 2 — UI dev server on :5173 (proxies /api to :8787)
bun run dev:ui
```

Open http://localhost:5173. Enter an Anthropic API key under **Settings** to enable generation.

Local data lives in `./data/vet-scheduler.db` (gitignored). Override with `VET_DB_PATH`.

## Tests

```bash
bun test
```

Covers the validator (each rule type, hard vs soft, cross-month carry-over,
time-off) and the data flow (define → validate → save → reload, over-constrained).
The live AI generation path needs a real API key and is not exercised by tests.

## Production build (single .exe)

```bash
bun run build:exe   # builds UI, embeds it, compiles dist/vet-scheduler.exe
```

Ship `dist/vet-scheduler.exe`. On first run it creates `data/` next to itself and
opens the browser. See `docs/INSTALL.md` for the clinic-facing guide.

## Environment variables

- `VET_PORT` — server port (default `8787`).
- `VET_DB_PATH` — SQLite file path (default `data/vet-scheduler.db`).
- `VET_NO_OPEN` — set to skip auto-opening the browser.
