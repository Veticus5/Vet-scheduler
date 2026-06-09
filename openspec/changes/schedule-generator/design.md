## Context

Greenfield project. The clinic schedules staff monthly by hand. We are building a local web application (per the proposal) that the clinic runs on its own Windows machine: a local server process serves a browser UI, all data stays on the machine, and schedule generation calls the Anthropic API using one clinic-owned key.

Key constraints from product decisions:
- **No developer tooling on site.** The clinic must not need to install Node, Python, or an IDE. Delivery should ideally be a single runnable artifact plus a start script.
- **AI generates the schedule directly** (not a deterministic solver). Because an LLM can violate hard constraints, the system must validate generated output in code and repair it via a feedback loop before trusting it.
- **Single Anthropic API key**, entered once, stored locally. Per-use billing.
- **Forms-based input.** Non-technical users enter staff, rules, and requests through UI forms.

## Goals / Non-Goals

**Goals:**
- A clinic staffer can install/start the app, enter the API key once, define staff and permanent rules, enter a month's requests, and get a complete schedule that respects all hard rules.
- Generated schedules are *guaranteed* not to violate hard rules at the moment they are presented (validation gate), or the unresolved conflicts are shown explicitly.
- Manual edits to the schedule are re-validated live.
- Data is persisted locally and survives restarts.

**Non-Goals:**
- Multi-clinic / multi-tenant, cloud hosting, user accounts and roles (single trusted local user for the MVP).
- Payroll, time tracking, or integration with external HR systems.
- Mobile app. Real-time collaboration.
- A deterministic constraint solver (explicitly chose AI generation + validation instead).
- The full multi-group scheduling **workflow** — choosing independent vs combined generation strategy, per-group views/exports, and a catalog of cross-group rule kinds. This foundation only makes staff groups and per-group shifts first-class and keeps validation whole-month so that workflow can be added later as a separate change.
- Authentication/authorization beyond protecting the local API key.

## Decisions

### D1 — Runtime & packaging: Bun, compiled to a single Windows executable
Use **Bun** + **TypeScript** for the server, and `bun build --compile` to produce a standalone `.exe` that embeds the runtime, the bundled web UI, and server code. The clinic gets one file plus a `start` shortcut; no Node/Bun install needed.
- *Why:* directly satisfies "easy to install, no dev tooling." Bun has a built-in HTTP server, a native SQLite driver (`bun:sqlite`), and a bundler — fewer moving parts than Node + separate deps.
- *Alternatives:* **Node + pkg/SEA** (heavier, more fragile packaging); **Electron/Tauri desktop app** (heavier, but we chose local-web per product decision); **Python + PyInstaller** (weaker fit with the TS Anthropic SDK and our team). Trade-off: Bun is younger than Node, but its packaging story is the cleanest for this exact goal.

### D2 — Front-end: React + Vite SPA, served as static assets by the Bun server
Build the UI with React + Vite; the production build is bundled into the executable and served by the local server. The SPA talks to the local server over a small JSON HTTP API.
- *Why:* form-heavy CRUD UI (staff, rules, requests) and an editable calendar grid benefit from a component model. Vite output is just static files — trivial to embed.
- *Alternative:* server-rendered HTML (simpler, but the editable, live-validated schedule grid is genuinely interactive and better as a SPA).

### D3 — Local persistence: SQLite via `bun:sqlite`
Single SQLite database file on the clinic machine holds staff, rules, monthly requests, and generated schedules. Schema migrations run on startup.
- *Why:* zero-config, single-file, embedded, transactional; fits a single-machine local app. Easy to back up (copy the file).
- *Alternative:* JSON files (no integrity/relations, harder to query); a server DB (overkill, needs install).

### D4 — AI integration: Anthropic TypeScript SDK with structured JSON output
Use `@anthropic-ai/sdk`. The generation request sends a structured payload (staff, hard + soft rules, the month's requests, shift definitions, calendar) and instructs Claude to return the schedule as **structured JSON** (via tool-use / a strict output schema), not prose.
- *Model:* configurable; default to a strong model and allow switching. Scheduling is a hard reasoning task run ~once/month, so a top-tier model is justified; expose the choice in settings to manage cost.
- *Why structured output:* the validator and UI need machine-readable assignments, not text. Tool-use enforces the shape so we parse reliably.
- *Alternative:* free-form text + parsing (brittle); deterministic solver (rejected per product decision).

### D5 — Validation + repair loop (the core reliability mechanism)
A **deterministic validator** in code is the source of truth for hard rules. Flow:
1. Build the generation prompt from current data.
2. Call Claude → parse structured schedule.
3. Run the validator: check every hard rule (coverage, pairing, qualification, contract hours, requested time-off, max consecutive days, etc.). Soft rules are scored, not enforced.
4. If hard violations exist, send them back to Claude (with the current schedule and a precise list of what's broken) and ask for a corrected schedule. Repeat up to **N attempts** (configurable, e.g. 3).
5. If still invalid after N attempts, present the best schedule with the **remaining conflicts flagged** so the user can resolve them manually — never silently ship a rule-breaking schedule as "valid."
- *Why:* an LLM may break hard constraints; code-level validation is the guarantee. The repair loop lets the AI fix its own mistakes while keeping correctness deterministic.
- *Rule representation:* each rule is a typed object with a `kind` (so the validator can enforce it) plus a natural-language description (so the AI understands intent). Hard vs soft is a flag. Free-form rules with no enforceable `kind` are passed to the AI as guidance and surfaced as "not machine-validated."

### D6 — Shift model: configurable shift templates per weekday, scoped to a staff group
The clinic defines named shifts (e.g. morning/afternoon) with times and required coverage per weekday. **Each shift definition belongs to a staff group** (reception / technicians / doctors), because the groups have different shift structures (different hours and number of shifts per day). A month's schedule assigns employees to shift instances on dates. Kept data-driven so different clinics/opening hours and per-group structures work without code changes.

### D8 — Staff groups & per-group generation with whole-month validation
Employees belong to a first-class **staff group**. Generation is **parameterized by group**: the app can generate each group's schedule in its own AI run (since shift structures differ per group). The **validator always runs over the combined month** (all groups' assignments together), so:
- *Group-scoped rules* are checked within a group.
- *Cross-group rules* (e.g. "a doctor's shift must overlap a technician's") are checkable as soon as they exist, without re-architecting.
- *Why this split:* the user is undecided whether the three schedules are independent or interrelated. Per-group generation keeps each run focused and cheap; whole-month validation keeps the door open to cross-group rules. We avoid baking in either a single combined schedule or three fully-isolated schedules.
- *Deferred:* the full multi-group workflow (independent vs combined generation strategy, per-group views/exports, a catalog of cross-group rule kinds) is a **separate future change** layered on this foundation — not built here. This change only ensures the data model and validation don't preclude it.

### D7 — API key storage
Store the key in the local SQLite/config, readable only by the server process. Document that the machine is single-user/trusted and the key file must not be committed or shared; provide a settings screen to rotate it. (No OS keychain dependency for the MVP to keep packaging simple — noted as a future hardening item.)

## Risks / Trade-offs

- **AI can't satisfy all hard rules (over-constrained month)** → Validator detects it; after N repair attempts the app shows exactly which rules conflict, so the human resolves it instead of getting a silently-wrong schedule.
- **LLM non-determinism / cost / latency** → Generation is monthly, not interactive; structured output + bounded retry loop caps cost. Model is configurable to trade quality vs price.
- **API/network unavailable** → Generation requires the network; the app must fail gracefully with a clear message. All other features (editing, viewing, data entry) work offline.
- **Free-form rules aren't enforceable in code** → Clearly label them "AI-guided, not machine-validated" so users don't assume a guarantee the validator can't give.
- **Bun maturity / Windows packaging quirks** → Validate `bun build --compile` on a clean Windows machine early (first task); fall back to Node SEA if blocked.
- **Plaintext local API key** → Acceptable for a single trusted machine in the MVP; flagged for future OS-keychain hardening.
- **Local data, no cloud backup** → Single SQLite file; document a "copy this file to back up" step. Easy export of schedules also mitigates data loss.

## Open Questions

- Exact default model and whether to expose a per-generation model toggle vs a global setting (lean: global setting in MVP).
- Concrete catalog of enforceable hard-rule `kind`s for v1 (resolved in the `scheduling-rules` spec).
- Whether the start experience is a double-clickable `.exe` or a tiny tray helper that opens the browser automatically (lean: `.exe` that starts the server and opens the default browser).
