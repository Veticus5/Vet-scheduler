## ADDED Requirements

### Requirement: Generate a monthly schedule with AI
The system SHALL generate a complete schedule for a selected month by sending the active staff, enabled rules, the month's requests, and the shift definitions to the AI, and receiving assignments of employees to shift instances. The AI response SHALL be structured (machine-readable), not free-form prose.

#### Scenario: Successful generation
- **WHEN** the user triggers generation for a month with valid staff, rules, requests, and a configured API key
- **THEN** the system returns a schedule assigning employees to the month's shift instances

#### Scenario: Structured output parsed
- **WHEN** the AI returns its schedule
- **THEN** the system parses it into structured assignments without relying on free-text parsing

### Requirement: Deterministic hard-rule validation
The system SHALL validate every generated schedule against all enabled hard rules and hard requests (time-off) using deterministic code that is the source of truth for correctness. The system SHALL NOT present a schedule as valid if it violates any hard rule.

#### Scenario: Valid schedule passes
- **WHEN** a generated schedule violates no hard rules or hard requests
- **THEN** validation reports it as valid

#### Scenario: Invalid schedule detected
- **WHEN** a generated schedule violates one or more hard rules
- **THEN** validation reports it as invalid and lists each specific violation

### Requirement: Repair loop
When validation finds hard violations, the system SHALL send the violations and the current schedule back to the AI and request a corrected schedule, repeating up to a configurable maximum number of attempts.

#### Scenario: Violation repaired within limit
- **WHEN** a generated schedule has hard violations and a corrected schedule produced within the attempt limit passes validation
- **THEN** the system presents the corrected, valid schedule

#### Scenario: Unresolved after max attempts
- **WHEN** the schedule still has hard violations after the maximum number of attempts
- **THEN** the system presents the best schedule with all remaining violations explicitly flagged, and does not label it as valid

### Requirement: Graceful failure on AI/network errors
The system SHALL handle AI provider and network errors during generation without losing existing data, and SHALL inform the user clearly.

#### Scenario: Network unavailable during generation
- **WHEN** the AI request fails due to a network or provider error
- **THEN** the system shows a clear error message and leaves previously stored data unchanged
