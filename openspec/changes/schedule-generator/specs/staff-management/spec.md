## ADDED Requirements

### Requirement: Manage employees
The system SHALL allow the user to create, edit, and remove employees. Each employee SHALL have at least a name, a staff group, and a qualification level.

#### Scenario: Add an employee
- **WHEN** the user fills in the employee form with a name, staff group, and qualification level and saves
- **THEN** the employee appears in the staff list and is available for scheduling

### Requirement: Staff groups
The system SHALL represent a first-class **staff group** for each employee (e.g. reception, technicians, doctors). Staff groups SHALL be referenceable by shift definitions, scheduling rules, and schedule generation so that scheduling can be scoped per group.

#### Scenario: Assign an employee to a group
- **WHEN** the user assigns an employee to a staff group
- **THEN** the employee is included in that group for group-scoped shifts, rules, and generation

#### Scenario: Group-scoped scheduling
- **WHEN** scheduling is performed for a specific staff group
- **THEN** only employees of that group are considered for that group's shift instances

#### Scenario: Edit an employee
- **WHEN** the user changes an employee's attributes and saves
- **THEN** the updated attributes are persisted and used in future generations

#### Scenario: Remove an employee
- **WHEN** the user removes an employee
- **THEN** the employee no longer appears in the staff list and is excluded from future generations

### Requirement: Employee scheduling attributes
The system SHALL store per-employee scheduling attributes including contract hours (target hours/shifts per period) and default weekly availability (which weekdays/shifts the employee can normally work).

#### Scenario: Set contract hours
- **WHEN** the user sets an employee's contract hours
- **THEN** the value is persisted and provided to schedule generation and validation as a target

#### Scenario: Set default availability
- **WHEN** the user marks an employee as unavailable on a given weekday or shift by default
- **THEN** that default availability is provided to schedule generation

### Requirement: Qualification levels usable in rules
The system SHALL represent qualification level in a way that can be referenced by scheduling rules (e.g. "highly qualified").

#### Scenario: Qualification referenced by a rule
- **WHEN** a scheduling rule references a qualification level
- **THEN** the rule applies to all employees that have that qualification level
