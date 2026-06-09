## ADDED Requirements

### Requirement: Permanent rule library
The system SHALL maintain a library of permanent scheduling rules that apply to every generated schedule until changed. The user SHALL be able to create, edit, enable/disable, and remove rules.

#### Scenario: Add a permanent rule
- **WHEN** the user creates a rule and saves it
- **THEN** the rule is persisted and applied to all future schedule generations

#### Scenario: Disable a rule without deleting it
- **WHEN** the user disables a rule
- **THEN** the rule is retained but not applied to future generations until re-enabled

### Requirement: Hard and soft rules
Each rule SHALL be classified as either **hard** (must never be violated) or **soft** (preferred but may be traded off). The system SHALL enforce hard rules through validation and SHALL treat soft rules as preferences during generation.

#### Scenario: Hard rule is enforced
- **WHEN** a generated schedule violates a hard rule
- **THEN** validation reports the schedule as invalid and the violation is surfaced

#### Scenario: Soft rule is a preference
- **WHEN** a generated schedule does not satisfy a soft rule
- **THEN** the schedule is still considered valid but the unmet preference may be reported

### Requirement: Enforceable rule types
The system SHALL support a defined set of machine-enforceable rule types that the validator can check, including at minimum:
- **Pairing**: a specified employee (or any employee of a qualification level) must share every shift with at least one employee from a specified group.
- **Qualification coverage**: each shift must include at least N employees of a given qualification level.
- **Max consecutive days**: an employee must not work more than N consecutive days.
- **Coverage**: each shift instance must have at least its required number of employees.

#### Scenario: Pairing rule
- **WHEN** a pairing rule requires employee X to always work with someone from group G, and a generated shift contains X but no member of G
- **THEN** validation flags a pairing violation for that shift

#### Scenario: Qualification coverage rule
- **WHEN** a rule requires at least one highly-qualified employee per shift, and a shift has none
- **THEN** validation flags a qualification-coverage violation for that shift

#### Scenario: Max consecutive days rule
- **WHEN** a rule limits consecutive working days to N, and an employee is assigned N+1 consecutive days
- **THEN** validation flags a max-consecutive-days violation for that employee

### Requirement: Rule scope by staff group
The system SHALL allow each rule to be scoped to a single staff group or to span multiple staff groups (cross-group). The validator SHALL evaluate cross-group rules against the combined assignments of all involved groups for the month.

#### Scenario: Group-scoped rule
- **WHEN** a rule is scoped to the doctors group
- **THEN** the rule is evaluated only against doctors' assignments

#### Scenario: Cross-group rule
- **WHEN** a rule spans two staff groups (e.g. requires overlap between a doctor and a technician)
- **THEN** the validator evaluates it against both groups' assignments together for the month

### Requirement: Free-form guidance rules
The system SHALL allow rules expressed only in natural language with no enforceable type. Such rules SHALL be provided to the AI as guidance and SHALL be clearly labeled as not machine-validated.

#### Scenario: Free-form rule labeled
- **WHEN** the user creates a rule with only a natural-language description and no enforceable type
- **THEN** the rule is sent to the AI as guidance and is displayed as "AI-guided, not machine-validated"
