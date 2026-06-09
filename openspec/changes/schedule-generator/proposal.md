## Why

Building monthly staff schedules for a veterinary clinic is done by hand today. The scheduler must juggle permanent rules (e.g. a highly-qualified vet must share every shift with a specific colleague), per-month requests ("I can't work Fridays", "I'd like 12–15 off"), and basic coverage needs — and redo it from scratch every month. This is slow, error-prone, and the constraints live only in one person's head.

This change introduces the foundation of an application that captures those rules once, collects each month's requests, and uses AI to generate a complete, rule-respecting schedule that a human can then review and adjust.

## What Changes

- Introduce a **local web application** (server runs on the clinic's own computer, UI in the browser) with a simple installer/start script — no IDE or developer tooling required on site.
- Add **staff management**: define employees and their attributes (staff group, qualification level, contract hours, default availability). Staff groups (reception / technicians / doctors) are first-class, with shift definitions scoped per group since the groups have different shift structures.
- Add a **permanent rules** library: hard and soft constraints that always apply across every month (e.g. pairing requirements, qualification coverage, max consecutive days).
- Add **per-month schedule requests**: time-off requests, preferred/unavailable days, and free-form preferences entered through forms for the month being planned.
- Add **AI schedule generation**: Claude (via the Anthropic API) generates the full monthly schedule from staff, rules, and requests. A **validation layer** then checks the output against all hard rules and feeds violations back to the AI for repair until the schedule is valid (or surfaces unresolved conflicts to the user).
- Add **schedule output**: view the generated schedule in a calendar/grid, manually edit cells (with live re-validation), and export to a printable/spreadsheet format.
- Add **app configuration**: store the clinic's single Anthropic API key and clinic-wide settings locally.

## Capabilities

### New Capabilities
- `app-foundation`: Local web app skeleton — local server, browser UI shell, local data persistence, and storage of the Anthropic API key and clinic settings.
- `staff-management`: Create, edit, and remove employees and their scheduling-relevant attributes (role, qualification level, contract hours, default availability).
- `scheduling-rules`: Define and manage permanent hard/soft constraints that apply to every generated schedule.
- `schedule-requests`: Capture per-month employee requests and preferences for the month being planned.
- `ai-schedule-generation`: Generate a monthly schedule with Claude from staff + rules + requests, validate the output against hard rules, and repair violations via a feedback loop.
- `schedule-output`: Display, manually edit (with re-validation), and export the generated schedule.

### Modified Capabilities
<!-- None — greenfield project, no existing specs. -->

## Impact

- **New codebase** (greenfield): local web server + browser front-end + local data store. Stack chosen in design.md.
- **External dependency**: Anthropic API (Claude) — requires one production API key paid for by the clinic; per-use billing. Network access required at generation time.
- **Data**: employee data and schedules stored locally on the clinic machine (no cloud). Privacy-relevant — handled locally only.
- **Operational**: clinic staff must run a start script and enter the API key once; documented in tasks.
