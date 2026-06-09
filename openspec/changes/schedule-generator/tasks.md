## 1. Project scaffold & packaging spike

- [x] 1.1 Initialize a Bun + TypeScript project (server) and a Vite + React project (UI) in one repo, with a shared types package/folder
- [x] 1.2 Add `@anthropic-ai/sdk` and set up the project structure (server, ui, shared, db)
- [x] 1.3 Spike `bun build --compile` to a single Windows `.exe` that serves a static "hello" page and embeds the Vite build; verify it runs on a clean Windows machine (fall back to Node SEA if blocked)
- [x] 1.4 Implement the start flow: running the exe starts the local server and opens the default browser to the UI

## 2. Local persistence & app foundation

- [x] 2.1 Set up SQLite via `bun:sqlite` with a single local DB file and a startup migration runner
- [x] 2.2 Define and migrate the schema: employees, qualification levels, shift definitions, rules, monthly requests, schedules, assignments, settings
- [x] 2.3 Implement settings storage: Anthropic API key (read/update), AI model, max repair attempts
- [x] 2.4 Build the settings UI: first-run key entry, key rotation, model and repair-attempt selection
- [x] 2.5 Block schedule generation with a clear message when no API key is configured

## 3. Staff management

- [x] 3.1 Server API: CRUD for employees (name, staff group, qualification level, contract hours, default weekly availability)
- [x] 3.2 UI: staff list + add/edit/remove employee forms, including staff group selection
- [x] 3.3 Define staff groups (reception / technicians / doctors) as a first-class, referenceable concept
- [x] 3.4 Ensure qualification levels and staff groups are referenceable by rules (shared enum/lookup)

## 4. Shift definitions

- [x] 4.1 Server API: CRUD for named shift templates scoped to a staff group (times, required coverage per weekday)
- [x] 4.2 UI: manage shift definitions per staff group
- [x] 4.3 Generate the month's shift instances (dates × shifts) from definitions for a selected month, per staff group

## 5. Permanent scheduling rules

- [x] 5.1 Define the typed rule model: `kind` (pairing, qualification-coverage, max-consecutive-days, coverage), hard/soft flag, params, scope (single group or cross-group), natural-language description, enabled flag
- [x] 5.2 Server API: CRUD + enable/disable for rules
- [x] 5.3 UI: rule library with type-specific forms; free-form rules labeled "AI-guided, not machine-validated"

## 6. Per-month schedule requests

- [x] 6.1 Server API: CRUD for requests scoped to a specific month (time-off/unavailable, preferred days/shifts, free-form text)
- [x] 6.2 UI: month selector + request entry/edit/remove, showing only the selected month's requests

## 7. Deterministic validator

- [x] 7.1 Implement the validator: given a schedule + active hard rules + hard requests, return a list of specific violations
- [x] 7.2 Implement each enforceable rule check (pairing, qualification-coverage, max-consecutive-days, coverage, time-off)
- [x] 7.3 Implement soft-rule/preference scoring and reporting (valid but reports unmet preferences)
- [x] 7.4 Unit tests covering each rule type from the specs' scenarios (valid + violating cases)

## 8. AI schedule generation

- [x] 8.1 Build the generation payload from staff + enabled rules + month requests + shift instances, parameterized by staff group
- [x] 8.2 Call Claude with a strict structured-output schema (tool-use) and parse assignments reliably
- [x] 8.3 Implement the repair loop: validate the combined month (all groups, incl. cross-group rules) → on hard violations, send violations + current schedule back to Claude → repeat up to max attempts
- [x] 8.4 On exceeding max attempts, return the best schedule with remaining violations flagged (never labeled valid)
- [x] 8.5 Handle AI/network errors gracefully without mutating stored data; surface a clear message

## 9. Schedule output

- [x] 9.1 UI: calendar/grid view of a month's assignments
- [x] 9.2 Visually mark cells/rules with flagged hard-rule violations
- [x] 9.3 Manual edit of assignments with live re-validation updating conflict markers
- [x] 9.4 Persist generated + edited schedules per month and reopen exactly as saved
- [x] 9.5 Export a month's schedule to a printable/spreadsheet-friendly file (e.g. CSV/XLSX)

## 10. End-to-end & delivery

- [x] 10.1 End-to-end test: define staff + rules, enter a month's requests, generate, validate, edit, export
- [x] 10.2 Test an over-constrained month: confirm unresolved conflicts are flagged, not hidden
- [x] 10.3 Write a short install/run guide for clinic staff (start the app, enter API key, back up the DB file)
- [x] 10.4 Produce the distributable Windows artifact and verify the full flow on a clean machine
