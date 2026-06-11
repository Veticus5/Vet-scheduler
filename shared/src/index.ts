// Shared domain types — the contract between the server API and the UI.
// Foundation layer: generic and group-agnostic. Department specifics
// (reception/doctors/technicians) are layered on later via their own changes.

// ---------------------------------------------------------------------------
// Staff groups — first-class, referenceable concept (tasks 3.3, 3.4).
// ---------------------------------------------------------------------------

export type StaffGroupKey = "reception" | "technicians" | "doctors";

export interface StaffGroup {
  key: StaffGroupKey;
  label: string;
}

export const STAFF_GROUPS: StaffGroup[] = [
  { key: "reception", label: "Recepcja" },
  { key: "technicians", label: "Technicy" },
  { key: "doctors", label: "Lekarze" },
];

// ---------------------------------------------------------------------------
// Qualification tiers — named, ordered, defined per staff group.
// Each group has its own breakdown; `rank` orders tiers by seniority
// (higher = more qualified) and is what scheduling rules compare against.
// ---------------------------------------------------------------------------

export interface QualificationTier {
  /** Stable key, unique within its group. */
  key: string;
  label: string;
  /** Seniority order within the group; higher = more qualified. */
  rank: number;
}

/**
 * The qualification breakdown per group. Reception is modelled in full;
 * technicians and doctors carry a single placeholder tier until their own
 * breakdowns are defined in dedicated changes.
 */
export const QUALIFICATION_TIERS: Record<StaffGroupKey, QualificationTier[]> = {
  reception: [
    { key: "niedoswiadczony", label: "Niedoświadczony", rank: 1 },
    { key: "doswiadczony", label: "Doświadczony", rank: 2 },
    { key: "zastepca-kierownika", label: "Zastępca kierownika", rank: 3 },
    { key: "kierownik", label: "Kierownik", rank: 4 },
  ],
  technicians: [{ key: "podstawowy", label: "Podstawowy", rank: 1 }],
  doctors: [{ key: "podstawowy", label: "Podstawowy", rank: 1 }],
};

/** Resolve a tier key to its rank within a group; undefined if unknown. */
export function tierRank(group: StaffGroupKey, tierKey: string): number | undefined {
  return QUALIFICATION_TIERS[group].find((t) => t.key === tierKey)?.rank;
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday ... 6 = Saturday

/**
 * Default weekly availability. A weekday maps to the set of shift-definition
 * ids the employee can normally work that day. Absence of a weekday key means
 * "available by default"; an explicit empty array means "unavailable that day".
 */
export type DefaultAvailability = Partial<Record<Weekday, string[]>>;

export interface Employee {
  id: string;
  name: string;
  staffGroup: StaffGroupKey;
  /** Qualification tier key; must belong to this employee's `staffGroup`. */
  qualificationTier: string;
  /** Target hours for the planning period (used as a soft target by generation). */
  contractHours: number;
  defaultAvailability: DefaultAvailability;
  active: boolean;
}

export type EmployeeInput = Omit<Employee, "id">;

// ---------------------------------------------------------------------------
// Shift definitions — scoped to a staff group (different structures per group).
// ---------------------------------------------------------------------------

export interface ShiftDefinition {
  id: string;
  staffGroup: StaffGroupKey;
  name: string;
  /** "HH:MM" 24h. */
  startTime: string;
  endTime: string;
  /** Weekdays this shift runs on. */
  weekdays: Weekday[];
  /** Required coverage (used by the `coverage` rule + generation). */
  requiredMin: number;
  requiredMax: number;
  /**
   * Whether this shift staffs the reception desk. `false` = office duty:
   * administrative work in the office that counts as worked hours but does NOT
   * fill reception-desk coverage. Defaults to `true` (staffs the desk).
   */
  staffsReception: boolean;
}

/** `staffsReception` is optional on input and defaults to `true` server-side. */
export type ShiftDefinitionInput = Omit<ShiftDefinition, "id" | "staffsReception"> & {
  staffsReception?: boolean;
};

/** A concrete shift on a concrete date, derived from a definition for a month. */
export interface ShiftInstance {
  date: string; // YYYY-MM-DD
  shiftDefId: string;
  staffGroup: StaffGroupKey;
}

// ---------------------------------------------------------------------------
// Scheduling rules — permanent, typed, hard/soft, group-scoped or cross-group.
// ---------------------------------------------------------------------------

export type RuleKind =
  | "pairing"
  | "qualification-coverage"
  | "max-consecutive-days"
  | "coverage"
  | "freeform";

/** Single group, or a list of groups for cross-group rules. */
export type RuleScope =
  | { type: "group"; group: StaffGroupKey }
  | { type: "cross-group"; groups: StaffGroupKey[] };

export interface RuleParamsPairing {
  /** Employee that must be paired, OR any employee at/above a qualification tier. */
  employeeId?: string;
  /** Minimum tier **rank** (within the rule's group) that makes an employee a subject. */
  minQualificationLevel?: number;
  /** Must share each shift with at least one employee from this set. */
  withGroup: StaffGroupKey[];
}

export interface RuleParamsQualificationCoverage {
  /** Minimum tier **rank** (within the rule's group) an employee must have to qualify. */
  minQualificationLevel: number;
  /** At least this many qualifying employees per shift instance. */
  minCount: number;
}

export interface RuleParamsMaxConsecutiveDays {
  maxDays: number;
  /** Optional per-employee overrides (e.g. Daria/Beata). */
  exemptEmployeeIds?: string[];
}

export interface RuleParamsCoverage {
  /** Override required staff for matching shifts; falls back to the definition. */
  min?: number;
  max?: number;
  weekdays?: Weekday[];
  shiftDefIds?: string[];
}

export type RuleParams =
  | ({ kind: "pairing" } & RuleParamsPairing)
  | ({ kind: "qualification-coverage" } & RuleParamsQualificationCoverage)
  | ({ kind: "max-consecutive-days" } & RuleParamsMaxConsecutiveDays)
  | ({ kind: "coverage" } & RuleParamsCoverage)
  | { kind: "freeform" };

export interface Rule {
  id: string;
  name: string;
  kind: RuleKind;
  /** Hard rules are enforced by the validator; soft rules are preferences. */
  hard: boolean;
  scope: RuleScope;
  params: RuleParams;
  /** Natural-language intent — always sent to the AI as guidance. */
  description: string;
  enabled: boolean;
}

export type RuleInput = Omit<Rule, "id">;

/** True when a rule has no machine-enforceable check (UI labels it). */
export function isMachineValidated(rule: Pick<Rule, "kind">): boolean {
  return rule.kind !== "freeform";
}

// ---------------------------------------------------------------------------
// Per-month requests
// ---------------------------------------------------------------------------

export type RequestType = "time-off" | "unavailable" | "preferred" | "freeform";

export interface ScheduleRequest {
  id: string;
  month: string; // YYYY-MM
  employeeId: string;
  type: RequestType;
  /** Affected dates (YYYY-MM-DD), for time-off/unavailable/preferred. */
  dates?: string[];
  /**
   * Recurring pattern by weekday (e.g. `{ weekdays: [3] }` = "every Wednesday").
   * When present, the server expands it into concrete `dates` within `month` on
   * save, so the validator/generation keep reading `dates` unchanged. Time of day
   * (e.g. "mornings") is expressed via `shiftDefIds`, not here.
   */
  recurrence?: { weekdays: Weekday[] };
  /** Affected shift-definition ids, optional refinement. */
  shiftDefIds?: string[];
  /** Free-form preference text (always passed to the AI). */
  text?: string;
}

export type ScheduleRequestInput = Omit<ScheduleRequest, "id">;

// ---------------------------------------------------------------------------
// Schedules & assignments
// ---------------------------------------------------------------------------

export interface Assignment {
  date: string; // YYYY-MM-DD
  shiftDefId: string;
  employeeId: string;
}

export type ScheduleStatus = "valid" | "has-conflicts" | "draft";

export interface Schedule {
  id: string;
  month: string; // YYYY-MM
  status: ScheduleStatus;
  assignments: Assignment[];
  /** Hard-rule violations still present when the schedule was saved. */
  violations: Violation[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface Violation {
  ruleId?: string;
  ruleName: string;
  /** `rest-period`, `double-booking` and `free-weekend` are built-in, always-on
   *  labour-law / sanity checks, not configurable rules. */
  kind: RuleKind | "time-off" | "rest-period" | "double-booking" | "free-weekend";
  message: string;
  /** Where it occurred, for UI highlighting. */
  date?: string;
  shiftDefId?: string;
  employeeId?: string;
}

export interface PreferenceReport {
  ruleId?: string;
  ruleName: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  violations: Violation[];
  /** Unmet soft preferences — informational, do not affect validity. */
  unmetPreferences: PreferenceReport[];
}

// ---------------------------------------------------------------------------
// Feasibility — deterministic capacity check run before AI generation.
// ---------------------------------------------------------------------------

/**
 * A reception-staffing shift instance whose required minimum cannot be met
 * because too few eligible employees are available that day. This is a
 * structural gap (not enough people) — no schedule can fill it, so it is
 * reported separately from AI conflicts.
 */
export interface CoverageGap {
  date: string; // YYYY-MM-DD
  shiftDefId: string;
  shiftName: string;
  /** Required minimum coverage for the instance. */
  required: number;
  /** Eligible + available employees — the most that could ever be assigned. */
  available: number;
}

export interface FeasibilityReport {
  /** True when every shift instance can in principle reach its minimum. */
  feasible: boolean;
  gaps: CoverageGap[];
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface Settings {
  /** Whether an Anthropic API key is stored (the key itself is never returned). */
  hasApiKey: boolean;
  aiModel: string;
  maxRepairAttempts: number;
}

export const DEFAULT_AI_MODEL = "claude-opus-4-8";
export const DEFAULT_MAX_REPAIR_ATTEMPTS = 3;

export const AI_MODELS: { id: string; label: string }[] = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8 (najlepsza jakość)" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (tańszy/szybszy)" },
];
