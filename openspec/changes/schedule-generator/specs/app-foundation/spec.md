## ADDED Requirements

### Requirement: Local server with browser UI
The system SHALL run as a local server process on the clinic machine that serves a browser-based UI and a local JSON HTTP API. The application SHALL persist all data locally and require no developer tooling (IDE, language runtime) to be installed separately.

#### Scenario: Starting the app
- **WHEN** the user runs the application's start entry point
- **THEN** a local server starts, the default browser opens the UI, and the app is usable without any additional installation step

#### Scenario: Data survives restart
- **WHEN** the user enters data, stops the app, and starts it again
- **THEN** all previously entered data is present

### Requirement: Local data persistence
The system SHALL store all application data in a single local database file on the clinic machine. No application data SHALL be sent to any third party except the AI provider during schedule generation.

#### Scenario: Backup by file copy
- **WHEN** the user copies the database file while the app is stopped
- **THEN** the copy is a complete, restorable backup of all app data

### Requirement: Anthropic API key configuration
The system SHALL let the user enter and store a single Anthropic API key locally, and SHALL use it for all AI requests. The system SHALL allow the user to update (rotate) the key.

#### Scenario: First-run key entry
- **WHEN** no API key is configured and the user opens settings
- **THEN** the system prompts for an API key and stores it locally once entered

#### Scenario: Generation blocked without key
- **WHEN** the user attempts to generate a schedule and no API key is configured
- **THEN** the system blocks generation and directs the user to enter a key in settings

#### Scenario: Rotating the key
- **WHEN** the user enters a new API key in settings
- **THEN** the system replaces the stored key and uses the new key for subsequent requests

### Requirement: Clinic settings
The system SHALL store clinic-wide settings, including the configurable AI model and the maximum number of AI repair attempts.

#### Scenario: Changing the model
- **WHEN** the user selects a different AI model in settings
- **THEN** subsequent schedule generations use the selected model
