## ADDED Requirements

### Requirement: Per-group qualification tiers
The system SHALL define qualification categories ("tiers") **separately for each staff group**. Each tier SHALL have a stable key, a human-readable label, and an integer rank that orders tiers by seniority within its group (higher rank = more qualified). Tier keys SHALL be unique within a group.

#### Scenario: Reception tiers are defined
- **WHEN** the application is initialized
- **THEN** the reception group has the ordered tiers (lowest to highest rank): niedoświadczony, doświadczony, zastępca kierownika, kierownik

#### Scenario: Other groups have their own tiers
- **WHEN** the application is initialized
- **THEN** technicians and doctors each have their own qualification tiers, independent of reception's tiers
- **AND** until their dedicated breakdown is defined, each has a single default tier

#### Scenario: Tiers are available to the UI per group
- **WHEN** the UI requests qualification tiers
- **THEN** the system returns the tiers grouped by staff group, including label and rank for each

### Requirement: Employee carries a group-valid qualification tier
Each employee SHALL be assigned exactly one qualification tier, and that tier MUST belong to the employee's staff group. The system SHALL replace the former free numeric qualification level with this tier assignment.

#### Scenario: Assign a tier when creating an employee
- **WHEN** the user creates an employee in the reception group and selects a tier
- **THEN** the employee is saved with that tier and it appears in the staff list

#### Scenario: Tier choices follow the selected group
- **WHEN** the user changes an employee's staff group in the form
- **THEN** the selectable tiers update to those of the newly selected group

#### Scenario: Reject a tier from another group
- **WHEN** a request assigns an employee a tier that does not belong to that employee's staff group
- **THEN** the system rejects the request as invalid

### Requirement: Rules reference qualification by rank
Scheduling rules that depend on qualification (`qualification-coverage` and `pairing`) SHALL express their threshold as a minimum tier **rank** within the rule's group. The validator SHALL resolve each assigned employee's tier to its rank and compare it against the threshold, preserving the prior "at or above level" semantics.

#### Scenario: Qualification-coverage counts employees at or above the rank
- **WHEN** a `qualification-coverage` rule requires at least N employees of rank ≥ R on a shift
- **THEN** the validator counts assigned employees whose tier rank is ≥ R and flags a violation if fewer than N are present

#### Scenario: Pairing applies to employees at or above the rank
- **WHEN** a `pairing` rule targets employees of rank ≥ R
- **THEN** the validator treats every assigned employee whose tier rank is ≥ R as a subject requiring the configured partner

### Requirement: Migrate existing qualification data
The system SHALL migrate existing employees from the former numeric qualification level to a group-valid tier without data loss. Reception employees SHALL be mapped by rank (1→niedoświadczony, 2→doświadczony, 3→zastępca kierownika, 4 or higher→kierownik); employees in other groups SHALL be mapped to their group's default tier.

#### Scenario: Existing reception employee is migrated
- **WHEN** the qualification migration runs for a reception employee whose former level was 2
- **THEN** the employee's tier becomes doświadczony

#### Scenario: Existing non-reception employee is migrated
- **WHEN** the qualification migration runs for a technician or doctor
- **THEN** the employee is assigned that group's default tier

### Requirement: AI receives named tiers as context
When the system builds context for AI schedule generation or AI rule drafting, it SHALL provide each group's qualification tiers as labelled, ranked entries so the AI can map natural-language descriptions (e.g. "doświadczeni", "kierownik") to the correct tier or rank.

#### Scenario: Tier names sent to AI
- **WHEN** the system prepares AI context that includes employees and rules
- **THEN** the context lists qualification tiers per group with their labels and ranks, and each employee's assigned tier
