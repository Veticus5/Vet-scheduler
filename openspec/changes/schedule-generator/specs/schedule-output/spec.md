## ADDED Requirements

### Requirement: View the generated schedule
The system SHALL display a generated month's schedule in a calendar/grid showing which employees are assigned to which shifts on which dates.

#### Scenario: Display schedule grid
- **WHEN** the user opens a generated month
- **THEN** the system shows a grid of dates and shifts with assigned employees

#### Scenario: Conflicts visible
- **WHEN** a presented schedule has flagged hard-rule violations
- **THEN** the affected cells/rules are visually marked as conflicts

### Requirement: Manual editing with live re-validation
The system SHALL allow the user to manually change assignments in the schedule, and SHALL re-validate hard rules after each change, updating the displayed conflicts.

#### Scenario: Edit removes a conflict
- **WHEN** the user manually reassigns shifts so that a previously violated hard rule is satisfied
- **THEN** the system re-validates and the conflict marker is removed

#### Scenario: Edit introduces a conflict
- **WHEN** the user makes a manual change that violates a hard rule
- **THEN** the system re-validates and marks the new conflict

### Requirement: Save the schedule
The system SHALL persist the generated and edited schedule for the month so it can be reopened later.

#### Scenario: Reopen a saved schedule
- **WHEN** the user reopens a previously saved month
- **THEN** the schedule is shown exactly as last saved, including manual edits

### Requirement: Export the schedule
The system SHALL allow the user to export a month's schedule to a printable/spreadsheet-friendly format.

#### Scenario: Export to file
- **WHEN** the user exports a month's schedule
- **THEN** the system produces a file containing the dates, shifts, and assigned employees
