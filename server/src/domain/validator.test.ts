import { describe, expect, test } from "bun:test";
import type { Employee, Rule, ShiftDefinition, ScheduleRequest, Assignment, StaffGroupKey } from "@vet/shared";
import { QUALIFICATION_TIERS } from "@vet/shared";
import { validate, type ValidationContext } from "./validator";

// ---- builders ------------------------------------------------------------

// Tier ranks for every group, mirroring what the qualifications repo provides.
const TIER_RANKS = new Map<StaffGroupKey, Map<string, number>>(
  (Object.keys(QUALIFICATION_TIERS) as StaffGroupKey[]).map((g) => [
    g,
    new Map(QUALIFICATION_TIERS[g].map((t) => [t.key, t.rank])),
  ]),
);

function emp(id: string, over: Partial<Employee> = {}): Employee {
  return {
    id,
    name: id,
    staffGroup: "reception",
    qualificationTier: "niedoswiadczony",
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
    staffsReception: true,
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
    tierRanks: TIER_RANKS,
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

// ---- office duty (staffsReception=false) ---------------------------------

describe("office duty", () => {
  test("office-duty assignment does not fill reception-desk coverage", () => {
    const res = validate(
      ctx({
        employees: [emp("e1")],
        shiftDefs: [
          shift("desk", 1, 1, { weekdays: [3] }),
          shift("office", 1, 1, { weekdays: [3], staffsReception: false }),
        ],
        // e1 is on office duty only — the desk stays unstaffed.
        assignments: [A("2026-07-01", "office", "e1")],
      }),
    );
    expect(res.violations.some((v) => v.kind === "coverage" && v.shiftDefId === "desk")).toBe(true);
    // The office shift itself is never coverage-checked.
    expect(res.violations.some((v) => v.kind === "coverage" && v.shiftDefId === "office")).toBe(false);
  });

  test("qualification-coverage ignores employees on office duty", () => {
    const rule: Rule = {
      id: "rq",
      name: "Min 1 zastępca/kierownik",
      kind: "qualification-coverage",
      hard: true,
      scope: { type: "group", group: "reception" },
      params: { kind: "qualification-coverage", minQualificationLevel: 3, minCount: 1 },
      description: "",
      enabled: true,
    };
    const res = validate(
      ctx({
        employees: [
          emp("junior", { qualificationTier: "niedoswiadczony" }),
          emp("boss", { qualificationTier: "kierownik" }),
        ],
        shiftDefs: [
          shift("desk", 0, 5, { weekdays: [3] }),
          shift("office", 0, 5, { weekdays: [3], staffsReception: false }),
        ],
        rules: [rule],
        // Boss is on office duty, only a junior is on the desk → desk unqualified.
        assignments: [A("2026-07-01", "desk", "junior"), A("2026-07-01", "office", "boss")],
      }),
    );
    expect(res.violations.some((v) => v.kind === "qualification-coverage")).toBe(true);
  });

  test("office duty counts toward consecutive-days limit", () => {
    const rule: Rule = {
      id: "rc",
      name: "Max 7 dni",
      kind: "max-consecutive-days",
      hard: true,
      scope: { type: "group", group: "reception" },
      params: { kind: "max-consecutive-days", maxDays: 7 },
      description: "",
      enabled: true,
    };
    // 8 consecutive office-duty days — still 8 worked days in a row.
    const assignments = Array.from({ length: 8 }, (_, i) => A(`2026-07-0${i + 1}`, "office", "e1"));
    const res = validate(
      ctx({
        employees: [emp("e1")],
        shiftDefs: [shift("office", 0, 5, { staffsReception: false })],
        rules: [rule],
        assignments,
      }),
    );
    expect(res.violations.some((v) => v.kind === "max-consecutive-days")).toBe(true);
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
        employees: [emp("junior", { qualificationTier: "niedoswiadczony" })],
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
        employees: [emp("junior", { qualificationTier: "niedoswiadczony" })],
        shiftDefs: [shift("s", 0, 5, { weekdays: [3] })],
        rules: [{ ...rule, hard: false }],
        assignments: [A("2026-07-01", "s", "junior")],
      }),
    );
    expect(res.valid).toBe(true);
    expect(res.unmetPreferences.length).toBeGreaterThan(0);
  });

  test("an empty OPTIONAL shift (min 0, nobody assigned) is not flagged", () => {
    // The classic phantom: a global qualification rule must not fire on an
    // unstaffed optional shift — there is no one to qualify.
    const res = validate(
      ctx({
        employees: [emp("senior", { qualificationTier: "kierownik" })],
        shiftDefs: [shift("optional", 0, 1)],
        rules: [rule],
        assignments: [], // nothing scheduled anywhere
      }),
    );
    expect(res.violations.some((v) => v.kind === "qualification-coverage")).toBe(false);
  });

  test("a REQUIRED but empty shift is still flagged", () => {
    const res = validate(
      ctx({
        employees: [emp("senior", { qualificationTier: "kierownik" })],
        shiftDefs: [shift("needed", 1, 2, { weekdays: [3] })],
        rules: [rule],
        assignments: [],
      }),
    );
    expect(res.violations.some((v) => v.kind === "qualification-coverage")).toBe(true);
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
        prevMonthAssignments: ["2026-06-26", "2026-06-27", "2026-06-28", "2026-06-29", "2026-06-30"].map((d) =>
          A(d, "s", "e1"),
        ),
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

  test("working every other day all month is a streak of 1, not the span", () => {
    // Odd days of July → 16 scattered shifts, longest run = 1. A span-based bug
    // would report ~31. Limit 7 → no violation.
    const assignments = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31].map((d) =>
      A(`2026-07-${String(d).padStart(2, "0")}`, "s", "e1"),
    );
    const res = validate(
      ctx({ employees: [emp("e1")], shiftDefs: [shift("s", 0, 5)], rules: [rule], assignments }),
    );
    expect(res.violations.some((v) => v.kind === "max-consecutive-days")).toBe(false);
  });

  test("a one-day gap resets the run", () => {
    // Two 7-day runs split by a day off → max run 7, not 15. Limit 7 → no violation.
    const days = [1, 2, 3, 4, 5, 6, 7, /* gap 8 */ 9, 10, 11, 12, 13, 14, 15];
    const assignments = days.map((d) => A(`2026-07-${String(d).padStart(2, "0")}`, "s", "e1"));
    const res = validate(
      ctx({ employees: [emp("e1")], shiftDefs: [shift("s", 0, 5)], rules: [rule], assignments }),
    );
    expect(res.violations.some((v) => v.kind === "max-consecutive-days")).toBe(false);
  });

  test("cross-month run reports the true streak length (3 + 5 = 8)", () => {
    const res = validate(
      ctx({
        employees: [emp("e1")],
        shiftDefs: [shift("s", 0, 5)],
        rules: [rule],
        assignments: ["01", "02", "03", "04", "05"].map((d) => A(`2026-07-${d}`, "s", "e1")),
        prevMonthAssignments: ["2026-06-28", "2026-06-29", "2026-06-30"].map((d) => A(d, "s", "e1")),
      }),
    );
    const v = res.violations.find((x) => x.kind === "max-consecutive-days");
    expect(v?.message).toContain("8 dni");
  });

  test("carry-in is per employee — another person's previous month does not count", () => {
    // e2 worked all of June; e1 worked nothing in June and a short July run.
    // e1's carry-in must be 0 (not inflated by e2's June).
    const juneAll = Array.from({ length: 30 }, (_, i) =>
      A(`2026-06-${String(i + 1).padStart(2, "0")}`, "s", "e2"),
    );
    const res = validate(
      ctx({
        employees: [emp("e1"), emp("e2")],
        shiftDefs: [shift("s", 0, 5)],
        rules: [rule],
        assignments: ["01", "02", "03"].map((d) => A(`2026-07-${d}`, "s", "e1")),
        prevMonthAssignments: juneAll,
      }),
    );
    expect(res.violations.some((v) => v.kind === "max-consecutive-days" && v.employeeId === "e1")).toBe(false);
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

// ---- double-booking (built-in) -------------------------------------------

describe("double-booking", () => {
  test("two shifts for one person on the same day is a violation", () => {
    const res = validate(
      ctx({
        employees: [emp("e1"), emp("e2"), emp("e3"), emp("e4")],
        shiftDefs: [shift("morning", 1, 4), shift("afternoon", 1, 4, { startTime: "14:30", endTime: "22:30" })],
        assignments: [
          A("2026-07-01", "morning", "e1"),
          A("2026-07-01", "afternoon", "e1"), // same person, same day
        ],
      }),
    );
    const dbl = res.violations.filter((v) => v.kind === "double-booking");
    expect(dbl).toHaveLength(1);
    expect(dbl[0]!.employeeId).toBe("e1");
    expect(dbl[0]!.date).toBe("2026-07-01");
  });

  test("same person on different days is fine", () => {
    const res = validate(
      ctx({
        employees: [emp("e1")],
        shiftDefs: [shift("morning", 1, 4)],
        assignments: [A("2026-07-01", "morning", "e1"), A("2026-07-02", "morning", "e1")],
      }),
    );
    expect(res.violations.filter((v) => v.kind === "double-booking")).toHaveLength(0);
  });
});

// ---- rest-period / doba pracownicza (built-in) ---------------------------

describe("rest-period", () => {
  const R = shift("R", 1, 4, { startTime: "07:30", endTime: "15:30" });
  const P = shift("P", 1, 4, { startTime: "14:30", endTime: "22:30" });

  test("afternoon then next-day morning (P→R) is a violation", () => {
    const res = validate(
      ctx({
        employees: [emp("e1")],
        shiftDefs: [R, P],
        assignments: [A("2026-07-01", "P", "e1"), A("2026-07-02", "R", "e1")],
      }),
    );
    const rp = res.violations.filter((v) => v.kind === "rest-period");
    expect(rp).toHaveLength(1);
    expect(rp[0]!.date).toBe("2026-07-02");
  });

  test("morning then next-day afternoon (R→P) is allowed", () => {
    const res = validate(
      ctx({
        employees: [emp("e1")],
        shiftDefs: [R, P],
        assignments: [A("2026-07-01", "R", "e1"), A("2026-07-02", "P", "e1")],
      }),
    );
    expect(res.violations.filter((v) => v.kind === "rest-period")).toHaveLength(0);
  });

  test("same shift two days running (P→P) is allowed", () => {
    const res = validate(
      ctx({
        employees: [emp("e1")],
        shiftDefs: [R, P],
        assignments: [A("2026-07-01", "P", "e1"), A("2026-07-02", "P", "e1")],
      }),
    );
    expect(res.violations.filter((v) => v.kind === "rest-period")).toHaveLength(0);
  });

  test("a gap day between late and early shift is allowed", () => {
    const res = validate(
      ctx({
        employees: [emp("e1")],
        shiftDefs: [R, P],
        // P on the 1st, day off the 2nd, R on the 3rd → not adjacent, fine.
        assignments: [A("2026-07-01", "P", "e1"), A("2026-07-03", "R", "e1")],
      }),
    );
    expect(res.violations.filter((v) => v.kind === "rest-period")).toHaveLength(0);
  });

  test("crosses the month boundary: P on the 30th, R on the 1st is a violation", () => {
    const res = validate(
      ctx({
        employees: [emp("e1")],
        shiftDefs: [R, P],
        assignments: [A("2026-07-01", "R", "e1")],
        prevMonthAssignments: [A("2026-06-30", "P", "e1")],
      }),
    );
    const rp = res.violations.filter((v) => v.kind === "rest-period");
    expect(rp).toHaveLength(1);
    expect(rp[0]!.date).toBe("2026-07-01");
  });

  test("office duty counts in the comparison: P→B (B starts 07:30) is a violation", () => {
    const B = shift("B", 1, 4, { startTime: "07:30", endTime: "15:30", staffsReception: false });
    const res = validate(
      ctx({
        employees: [emp("e1")],
        shiftDefs: [R, P, B],
        assignments: [A("2026-07-01", "P", "e1"), A("2026-07-02", "B", "e1")],
      }),
    );
    expect(res.violations.filter((v) => v.kind === "rest-period")).toHaveLength(1);
  });
});

// ---- free weekend / H7 (built-in) ----------------------------------------

describe("free-weekend", () => {
  // July 2026 full in-month weekends: (4,5), (11,12), (18,19), (25,26).
  test("a free Saturday on one weekend + free Sunday on another is NOT enough", () => {
    const res = validate(
      ctx({
        employees: [emp("e1")],
        shiftDefs: [shift("s", 1, 4)],
        // Works one day of every weekend → no whole weekend ever free.
        assignments: [
          A("2026-07-04", "s", "e1"), // Sat of w1
          A("2026-07-12", "s", "e1"), // Sun of w2
          A("2026-07-18", "s", "e1"), // Sat of w3
          A("2026-07-26", "s", "e1"), // Sun of w4
        ],
      }),
    );
    const fw = res.violations.filter((v) => v.kind === "free-weekend");
    expect(fw).toHaveLength(1);
    expect(fw[0]!.employeeId).toBe("e1");
  });

  test("one whole free weekend satisfies it", () => {
    const res = validate(
      ctx({
        employees: [emp("e1")],
        shiftDefs: [shift("s", 1, 4)],
        // Works w1 fully but leaves w2/w3/w4 free → has a whole free weekend.
        assignments: [A("2026-07-04", "s", "e1"), A("2026-07-05", "s", "e1")],
      }),
    );
    expect(res.violations.filter((v) => v.kind === "free-weekend")).toHaveLength(0);
  });

  test("inactive employees are not required to have a free weekend", () => {
    const res = validate(
      ctx({
        employees: [emp("e1", { active: false })],
        shiftDefs: [shift("s", 1, 4)],
        assignments: [
          A("2026-07-04", "s", "e1"),
          A("2026-07-05", "s", "e1"),
          A("2026-07-11", "s", "e1"),
          A("2026-07-12", "s", "e1"),
          A("2026-07-18", "s", "e1"),
          A("2026-07-19", "s", "e1"),
          A("2026-07-25", "s", "e1"),
          A("2026-07-26", "s", "e1"),
        ],
      }),
    );
    expect(res.violations.filter((v) => v.kind === "free-weekend")).toHaveLength(0);
  });
});
