## ADDED Requirements

### Requirement: Shift definitions distinguish reception desk from office duty
A shift definition SHALL carry a flag indicating whether it staffs the reception desk. The flag SHALL default to "staffs reception" so existing and newly created definitions retain current behavior unless explicitly marked as office duty. A shift marked as office duty represents administrative work performed in the office, away from the reception desk.

#### Scenario: Existing shift defaults to reception desk
- **WHEN** a shift definition has no explicit reception/office-duty flag (e.g. created before this change)
- **THEN** the system treats it as staffing the reception desk

#### Scenario: Define an office-duty shift
- **WHEN** the user marks a shift definition as office duty
- **THEN** the system persists it as not staffing the reception desk
- **AND** assignments to it represent administrative work, not desk coverage

#### Scenario: Flag is editable per definition
- **WHEN** the user edits a shift definition and toggles between reception desk and office duty
- **THEN** the system saves the chosen type and reflects it wherever shifts are listed

### Requirement: Coverage counts only reception-desk shifts
Reception-desk coverage checks SHALL count only assignments to shifts that staff the reception desk. The built-in coverage check (`requiredMin`/`requiredMax`), the `coverage` rule overrides, and the desk-presence rules (`qualification-coverage`, `pairing`) SHALL ignore assignments to office-duty shifts. Office-duty assignments SHALL NOT satisfy any reception-desk coverage requirement.

#### Scenario: Office-duty assignment does not fill desk coverage
- **WHEN** a shift instance requires at least one person on the reception desk and only an office-duty assignment exists for that requirement
- **THEN** the coverage check reports the desk as under-staffed (the office-duty assignment does not count)

#### Scenario: Qualification and pairing apply to desk shifts only
- **WHEN** a `qualification-coverage` or `pairing` rule evaluates coverage
- **THEN** it considers assignments to reception-desk shifts and ignores office-duty shifts

#### Scenario: Reception-desk coverage met by desk shifts
- **WHEN** reception-desk shifts have enough assigned employees to meet their required minimum
- **THEN** the coverage check passes regardless of how many office-duty assignments exist that day

### Requirement: Office duty counts as worked time and a worked day
Assignments to office-duty shifts SHALL count toward an employee's worked hours and SHALL count as a worked day for the consecutive-days limit, because office duty is still a day of work.

#### Scenario: Office duty counts toward consecutive days
- **WHEN** an employee works several reception-desk days followed by an office-duty day with no day off in between
- **THEN** the `max-consecutive-days` check counts the office-duty day as part of the consecutive run

#### Scenario: Office-duty hours included in totals
- **WHEN** worked hours are summed for an employee
- **THEN** hours from office-duty assignments are included in the total

### Requirement: AI context distinguishes office duty from reception desk
When the system builds context for AI schedule generation, it SHALL indicate for each shift whether it staffs the reception desk or is office duty, and SHALL instruct the model that office-duty shifts do not satisfy reception-desk coverage.

#### Scenario: Generation context marks shift type
- **WHEN** the system prepares AI generation context that lists shift definitions
- **THEN** each shift definition includes whether it staffs the reception desk
- **AND** the model is instructed not to use office-duty shifts to meet reception-desk coverage
