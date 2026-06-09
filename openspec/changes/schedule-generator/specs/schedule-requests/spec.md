## ADDED Requirements

### Requirement: Per-month request collection
The system SHALL allow the user to enter employee requests for a specific month being planned, separately from permanent rules. Requests for one month SHALL NOT affect other months.

#### Scenario: Add a request for a month
- **WHEN** the user selects a month and adds a request for an employee
- **THEN** the request is associated with that month and applied only to that month's generation

#### Scenario: Requests isolated per month
- **WHEN** the user views a different month
- **THEN** only that month's requests are shown

### Requirement: Request types
The system SHALL support at least the following request types: time-off / unavailable on specific dates or shifts, preferred days or shifts, and free-form preference text.

#### Scenario: Time-off request honored as hard constraint
- **WHEN** an employee has an approved time-off request for a date and the schedule assigns them on that date
- **THEN** validation flags a time-off violation

#### Scenario: Preference request treated as soft
- **WHEN** an employee has a preferred-day request that is not met
- **THEN** the schedule is still valid but the unmet preference may be reported

#### Scenario: Free-form request passed to AI
- **WHEN** the user enters a free-form preference for an employee
- **THEN** the text is provided to the AI as guidance for that month's generation

### Requirement: Edit and remove requests
The system SHALL allow the user to edit and remove requests for a month before generation.

#### Scenario: Remove a request
- **WHEN** the user removes a request for the selected month
- **THEN** the request is no longer applied to that month's generation
