import { describe, expect, test } from "bun:test";
import type { Employee, Rule, ShiftDefinition, ScheduleRequest, Assignment } from "@vet/shared";
import { validate, type ValidationContext } from "./validator";

// ---- builders ------------------------------------------------------------

function emp(id: string, over: Partial<Employee> = {}): Employee {
  return {
    id,
    name: id,
    staffGroup: "reception",
    qualificationLevel: 1,
    contractHours: 160,
    defaultAvailability: {},
    active: true,
    ...over,
  };
}

// A shift that runs every weekday and weekend, min/max configurable.
function shift(id: string, min: number, max: number, over: Partial<ShiftDefinition> = {}): ShiftDefinition {
  return {
    id,
    staffGroup: "reception",
    name: id,
    startTime: "08:00",
    endTime: "16:00",
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    requiredMin: min,
    requiredMax: max,
    ...over,
  };
}

function ctx(over: Partial<ValidationContext>): ValidationContext {
  return {
    month: "2026-07",
    employees: [],
    shiftDefs: [],
    rules: [],
    requests: [],
    assignments: [],
    ...over,
  };
}

const A = (date: string, shiftDefId: string, employeeId: string): Assignment => ({ date, shiftDefId, employeeId });

// ---- coverage ------------------------------------------------------------

describe("coverage", () => {
  test("under minimum is a violation", () => {
    const res = validate(
      ctx({
        employees: [emp("e1")],
        shiftDefs: [shift("morning", 2, 4)],
        assignments: [A("2026-07-01", "morning", "e1")], // only 1, needs 2
      }),
    );
    expect(res.valid).toBe(false);
    expect(res.violations.some((v) => v.kind === "coverage" && v.date === "2026-07-01")).toBe(true);
  });

  test("a properly-staffed instance is not flagged", () => {
    const res = validate(
      ctx({
        employees: [emp("e1"), emp("e2")],
        shiftDefs: [shift("morning", 2, 4, { weekdays: [3] })], // Wednesdays
        assignments: [A("2026-07-01", "morning", "e1"), A("2026-07-01", "morning", "e2")],
      }),
    );
    // The 2026-07-01 instance has 2 (within 2–4) → no coverage violation for that date.
    expect(res.violations.some((v) => v.kind === "coverage" && v.date === "2026-07-01")).toBe(false);
  });
});

// ---- pairing -------------------------------------------------------------

describe("pairing", () => {
  const rule: Rule = {
    id: "r1",
    name: "X z technikiem",
    kind: "pairing",
    hard: true,
    scope: { type: "cross-group", groups: ["reception", "technicians"] },
    params: { kind: "pairing", employeeId: "x", withGroup: ["technicians"] },
    description: "",
    enabled: true,
  };

  test("subject without partner is a violation", () => {
    const res = validate(
      ctx({
        employees: [emp("x"), emp("t", { staffGroup: "technicians" })],
        shiftDefs: [shift("s", 0, 5, { weekdays: [3] })],
        rules: [rule],
        assignments: [A("2026-07-01", "s", "x")], // x alone, no technician
      }),
    );
    expect(res.violations.some((v) => v.kind === "pairing")).toBe(true);
  });

  test("subject with partner passes pairing", () => {
    const res = validate(
      ctx({
        employees: [emp("x"), emp("t", { staffGroup: "technicians" })],
        shiftDefs: [shift("s", 0, 5, { weekdays: [3] })],
        rules: [rule],
        assignments: [A("2026-07-01", "s", "x"), A("2026-07-01", "s", "t")],
      }),
    );
    expect(res.violations.some((v) => v.kind === "pairing")).toBe(false);
  });
});

// ---- qualification coverage ---------------------------------------------

describe("qualification-coverage", () => {
  const rule: Rule = {
    id: "r2",
    name: "Min 1 doświadczony",
    kind: "qualification-coverage",
    hard: true,
    scope: { type: "group", group: "reception" },
    params: { kind: "qualification-coverage", minQualificationLevel: 3, minCount: 1 },
    description: "",
    enabled: true,
  };

  test("no qualified employee is a violation", () => {
    const res = validate(
      ctx({
        employees: [emp("junior", { qualificationLevel: 1 })],
        shiftDefs: [shift("s", 0, 5, { weekdays: [3] })],
        rules: [rule],
        assignments: [A("2026-07-01", "s", "junior")],
      }),
    );
    expect(res.violations.some((v) => v.kind === "qualification-coverage")).toBe(true);
  });

  test("soft variant reports a preference, not a violation", () => {
    const res = validate(
      ctx({
        employees: [emp("junior", { qualificationLevel: 1 })],
        shiftDefs: [shift("s", 0, 5, { weekdays: [3] })],
        rules: [{ ...rule, hard: false }],
        assignments: [A("2026-07-01", "s", "junior")],
      }),
    );
    expect(res.valid).toBe(true);
    expect(res.unmetPreferences.length).toBeGreaterThan(0);
  });
});

// ---- max consecutive days ------------------------------------------------

describe("max-consecutive-days", () => {
  const rule: Rule = {
    id: "r3",
    name: "Max 7 dni",
    kind: "max-consecutive-days",
    hard: true,
    scope: { type: "group", group: "reception" },
    params: { kind: "max-consecutive-days", maxDays: 7 },
    description: "",
    enabled: true,
  };

  test("8 consecutive days violates a 7-day limit", () => {
    const assignments = Array.from({ length: 8 }, (_, i) =>
      A(`2026-07-0${i + 1}`, "s", "e1"),
    );
    const res = validate(
      ctx({
        employees: [emp("e1")],
        shiftDefs: [shift("s", 0, 5)],
        rules: [rule],
        assignments,
      }),
    );
    expect(res.violations.some((v) => v.kind === "max-consecutive-days")).toBe(true);
  });

  test("cross-month carry-in counts previous days", () => {
    // Works the last 5 days of June + first 3 of July = 8 in a row.
    const res = validate(
      ctx({
        employees: [emp("e1")],
        shiftDefs: [shift("s", 0, 5)],
        rules: [rule],
        assignments: [A("2026-07-01", "s", "e1"), A("2026-07-02", "s", "e1"), A("2026-07-03", "s", "e1")],
        prevMonthWorkedDates: ["2026-06-26", "2026-06-27", "2026-06-28", "2026-06-29", "2026-06-30"],
      }),
    );
    expect(res.violations.some((v) => v.kind === "max-consecutive-days")).toBe(true);
  });

  test("exempt employee is skipped", () => {
    const assignments = Array.from({ length: 8 }, (_, i) => A(`2026-07-0${i + 1}`, "s", "e1"));
    const res = validate(
      ctx({
        employees: [emp("e1")],
        shiftDefs: [shift("s", 0, 5)],
        rules: [{ ...rule, params: { kind: "max-consecutive-days", maxDays: 7, exemptEmployeeIds: ["e1"] } }],
        assignments,
      }),
    );
    expect(res.violations.some((v) => v.kind === "max-consecutive-days")).toBe(false);
  });
});

// ---- requests ------------------------------------------------------------

describe("requests", () => {
  test("assigning on a time-off day is a violation", () => {
    const req: ScheduleRequest = {
      id: "q1",
      month: "2026-07",
      employeeId: "e1",
      type: "time-off",
      dates: ["2026-07-01"],
    };
    const res = validate(
      ctx({
        employees: [emp("e1")],
        shiftDefs: [shift("s", 0, 5, { weekdays: [3] })],
        requests: [req],
        assignments: [A("2026-07-01", "s", "e1")],
      }),
    );
    expect(res.violations.some((v) => v.kind === "time-off")).toBe(true);
  });

  test("preferred day unmet is a soft preference", () => {
    const req: ScheduleRequest = {
      id: "q2",
      month: "2026-07",
      employeeId: "e1",
      type: "preferred",
      dates: ["2026-07-10"],
    };
    const res = validate(
      ctx({
        employees: [emp("e1")],
        shiftDefs: [shift("s", 0, 5, { weekdays: [3] })],
        requests: [req],
        assignments: [],
      }),
    );
    expect(res.valid).toBe(true);
    expect(res.unmetPreferences.length).toBeGreaterThan(0);
  });
});

// ---- over-constrained sanity (task 10.2) --------------------------------

describe("over-constrained", () => {
  test("an impossible coverage requirement surfaces as a flagged violation", () => {
    // Need 3 on a shift but only 1 employee exists and is on time-off.
    const res = validate(
      ctx({
        employees: [emp("only")],
        shiftDefs: [shift("s", 3, 3, { weekdays: [3] })],
        requests: [{ id: "q", month: "2026-07", employeeId: "only", type: "time-off", dates: ["2026-07-01"] }],
        assignments: [],
      }),
    );
    expect(res.valid).toBe(false);
    expect(res.violations.length).toBeGreaterThan(0);
  });
});
