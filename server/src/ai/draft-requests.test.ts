import { describe, expect, test } from "bun:test";
import { normalizeDraftRequest, type DraftContext } from "./draft-requests";

const ctx: DraftContext = {
  employees: [
    { id: "emp-daria", name: "Daria", staffGroup: "reception" },
    { id: "emp-beata", name: "Beata", staffGroup: "doctors" },
  ],
  shiftDefs: [
    { id: "shift-morning", name: "Poranna", staffGroup: "reception", startTime: "07:30", endTime: "15:30", weekdays: [1, 3] },
    { id: "shift-evening", name: "Wieczorna", staffGroup: "reception", startTime: "13:30", endTime: "21:30", weekdays: [1, 3] },
  ],
};
const MONTH = "2026-07";

describe("normalizeDraftRequest", () => {
  test("maps a known name to employeeId and keeps in-month dates", () => {
    const r = normalizeDraftRequest(
      { employeeId: "emp-daria", type: "time-off", dates: ["2026-07-05", "2026-07-06"] },
      ctx,
      MONTH,
    );
    expect(r).not.toBeNull();
    expect(r!.employeeId).toBe("emp-daria");
    expect(r!.type).toBe("time-off");
    expect(r!.dates).toEqual(["2026-07-05", "2026-07-06"]);
    expect(r!.recurrence).toBeUndefined();
  });

  test("'every Wednesday morning' → recurrence weekdays + morning shift", () => {
    const r = normalizeDraftRequest(
      { employeeId: "emp-daria", type: "preferred", weekdays: [3], shiftDefIds: ["shift-morning"], text: "każda środa na rano" },
      ctx,
      MONTH,
    );
    expect(r!.recurrence).toEqual({ weekdays: [3] });
    expect(r!.shiftDefIds).toEqual(["shift-morning"]);
    expect(r!.dates).toBeUndefined(); // recurrence takes precedence
  });

  test("recurrence wins when both weekdays and dates are present", () => {
    const r = normalizeDraftRequest(
      { employeeId: "emp-daria", type: "preferred", weekdays: [3], dates: ["2026-07-01"] },
      ctx,
      MONTH,
    );
    expect(r!.recurrence).toEqual({ weekdays: [3] });
    expect(r!.dates).toBeUndefined();
  });

  test("unknown employee is dropped (returns null)", () => {
    expect(normalizeDraftRequest({ employeeId: "ghost", type: "time-off", dates: ["2026-07-01"] }, ctx, MONTH)).toBeNull();
  });

  test("invalid weekdays are removed, valid ones kept", () => {
    const r = normalizeDraftRequest(
      { employeeId: "emp-beata", type: "preferred", weekdays: [3, 9, -1, 3] },
      ctx,
      MONTH,
    );
    expect(r!.recurrence).toEqual({ weekdays: [3] });
  });

  test("dates outside the month are dropped", () => {
    const r = normalizeDraftRequest(
      { employeeId: "emp-daria", type: "time-off", dates: ["2026-07-05", "2026-08-01"] },
      ctx,
      MONTH,
    );
    expect(r!.dates).toEqual(["2026-07-05"]);
  });

  test("unknown shiftDefIds are dropped", () => {
    const r = normalizeDraftRequest(
      { employeeId: "emp-daria", type: "preferred", weekdays: [1], shiftDefIds: ["shift-morning", "nope"] },
      ctx,
      MONTH,
    );
    expect(r!.shiftDefIds).toEqual(["shift-morning"]);
  });

  test("freeform without text is dropped", () => {
    expect(normalizeDraftRequest({ employeeId: "emp-daria", type: "freeform" }, ctx, MONTH)).toBeNull();
    const ok = normalizeDraftRequest({ employeeId: "emp-daria", type: "freeform", text: "elastyczne godziny" }, ctx, MONTH);
    expect(ok!.text).toBe("elastyczne godziny");
  });

  test("unknown type falls back to 'preferred'", () => {
    const r = normalizeDraftRequest({ employeeId: "emp-daria", type: "nonsense", dates: ["2026-07-01"] }, ctx, MONTH);
    expect(r!.type).toBe("preferred");
  });

  test("non-object input returns null", () => {
    expect(normalizeDraftRequest(null, ctx, MONTH)).toBeNull();
    expect(normalizeDraftRequest("nope", ctx, MONTH)).toBeNull();
  });
});
