import { describe, expect, test } from "bun:test";
import type { Employee, Rule, ScheduleRequest, ShiftDefinition } from "@vet/shared";
import { computeFeasibility, type FeasibilityInput } from "./feasibility";

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

function input(over: Partial<FeasibilityInput>): FeasibilityInput {
  return { month: "2026-07", employees: [], shiftDefs: [], rules: [], requests: [], ...over };
}

describe("computeFeasibility", () => {
  test("feasible when enough eligible staff exist", () => {
    const r = computeFeasibility(
      input({ employees: [emp("e1"), emp("e2")], shiftDefs: [shift("m", 2, 4)] }),
    );
    expect(r.feasible).toBe(true);
    expect(r.gaps).toHaveLength(0);
  });

  test("flags a shift with too few employees in the group", () => {
    const r = computeFeasibility(
      input({ employees: [emp("e1")], shiftDefs: [shift("m", 2, 4)] }),
    );
    expect(r.feasible).toBe(false);
    // Every day of July (31) is short.
    expect(r.gaps).toHaveLength(31);
    expect(r.gaps[0]).toMatchObject({ shiftName: "m", required: 2, available: 1 });
  });

  test("time-off on a date lowers availability below the minimum", () => {
    const reqs: ScheduleRequest[] = [
      { id: "r1", month: "2026-07", employeeId: "e2", type: "time-off", dates: ["2026-07-03"] },
    ];
    const r = computeFeasibility(
      input({ employees: [emp("e1"), emp("e2")], shiftDefs: [shift("m", 2, 4)], requests: reqs }),
    );
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]).toMatchObject({ date: "2026-07-03", available: 1, required: 2 });
  });

  test("ignores office-duty shifts (no desk coverage minimum)", () => {
    const r = computeFeasibility(
      input({ employees: [emp("e1")], shiftDefs: [shift("office", 2, 4, { staffsReception: false })] }),
    );
    expect(r.feasible).toBe(true);
  });

  test("employees of another group do not count toward coverage", () => {
    const r = computeFeasibility(
      input({
        employees: [emp("e1"), emp("d1", { staffGroup: "doctors" })],
        shiftDefs: [shift("m", 2, 4)],
      }),
    );
    expect(r.feasible).toBe(false);
    expect(r.gaps[0]).toMatchObject({ available: 1, required: 2 });
  });

  test("default-availability restricting a weekday removes the employee that day", () => {
    // e2 is only available Mondays (weekday 1) and only for shift "other".
    const r = computeFeasibility(
      input({
        employees: [emp("e1"), emp("e2", { defaultAvailability: { 1: ["other"] } })],
        shiftDefs: [shift("m", 2, 4)],
      }),
    );
    // Mondays in July 2026: 6, 13, 20, 27 — e2 unavailable for "m" → short there.
    expect(r.gaps.map((g) => g.date).sort()).toEqual(["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27"]);
  });

  test("coverage rule override raises the required minimum", () => {
    const rules: Rule[] = [
      {
        id: "c1",
        name: "cov",
        kind: "coverage",
        hard: true,
        scope: { type: "group", group: "reception" },
        params: { kind: "coverage", min: 3 } as any,
        description: "",
        enabled: true,
      },
    ];
    const r = computeFeasibility(
      input({ employees: [emp("e1"), emp("e2")], shiftDefs: [shift("m", 2, 4)], rules }),
    );
    // 2 available, override raises min to 3 → every day short.
    expect(r.feasible).toBe(false);
    expect(r.gaps[0]).toMatchObject({ required: 3, available: 2 });
  });
});
