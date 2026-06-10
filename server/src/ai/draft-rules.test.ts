import { describe, expect, test } from "bun:test";
import { normalizeDraftRule, type DraftContext } from "./draft-rules";

const ctx: DraftContext = {
  employees: [
    { id: "emp-daria", name: "Daria", staffGroup: "reception", qualificationTier: "zastepca-kierownika" },
    { id: "emp-beata", name: "Beata", staffGroup: "doctors", qualificationTier: "podstawowy" },
  ],
  shiftDefs: [
    { id: "shift-morning", name: "Poranna", staffGroup: "reception" },
    { id: "shift-evening", name: "Wieczorna", staffGroup: "doctors" },
  ],
};

describe("normalizeDraftRule — each RuleKind", () => {
  test("pairing: maps known employeeId and groups, defaults withGroup", () => {
    const r = normalizeDraftRule(
      { name: "Daria z recepcją", kind: "pairing", hard: true, groups: ["reception"], employeeId: "emp-daria", withGroup: ["reception"] },
      ctx,
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("pairing");
    expect(r!.scope).toEqual({ type: "group", group: "reception" });
    expect(r!.params).toMatchObject({ kind: "pairing", employeeId: "emp-daria", withGroup: ["reception"] });
  });

  test("qualification-coverage: keeps provided numbers", () => {
    const r = normalizeDraftRule(
      { name: "Min 2 doświadczonych", kind: "qualification-coverage", hard: true, groups: ["doctors"], minQualificationLevel: 4, minCount: 2 },
      ctx,
    );
    expect(r!.params).toEqual({ kind: "qualification-coverage", minQualificationLevel: 4, minCount: 2 });
  });

  test("max-consecutive-days: keeps maxDays and sanitizes exempt ids", () => {
    const r = normalizeDraftRule(
      { name: "Max 5 dni", kind: "max-consecutive-days", hard: true, groups: ["technicians"], maxDays: 5, exemptEmployeeIds: ["emp-beata", "ghost"] },
      ctx,
    );
    expect(r!.params).toEqual({ kind: "max-consecutive-days", maxDays: 5, exemptEmployeeIds: ["emp-beata"] });
  });

  test("coverage: keeps min/max and sanitizes shiftDefIds", () => {
    const r = normalizeDraftRule(
      { name: "Obsada poranna", kind: "coverage", hard: false, groups: ["reception"], min: 2, max: 4, shiftDefIds: ["shift-morning", "nope"] },
      ctx,
    );
    expect(r!.hard).toBe(false);
    expect(r!.params).toEqual({ kind: "coverage", min: 2, max: 4, shiftDefIds: ["shift-morning"] });
  });

  test("freeform: params are just the kind tag", () => {
    const r = normalizeDraftRule(
      { name: "Wskazówka", kind: "freeform", hard: false, groups: ["doctors"], description: "rób co możesz" },
      ctx,
    );
    expect(r!.params).toEqual({ kind: "freeform" });
    expect(r!.description).toBe("rób co możesz");
  });
});

describe("normalizeDraftRule — defensive behavior", () => {
  test("unknown kind is dropped (returns null)", () => {
    expect(normalizeDraftRule({ name: "x", kind: "nonsense", hard: true, groups: ["reception"] }, ctx)).toBeNull();
  });

  test("non-object input returns null", () => {
    expect(normalizeDraftRule(null, ctx)).toBeNull();
    expect(normalizeDraftRule("nope", ctx)).toBeNull();
  });

  test("missing fields fall back to defaults", () => {
    const r = normalizeDraftRule({ kind: "pairing", groups: [] }, ctx);
    expect(r).not.toBeNull();
    expect(r!.name).toBe("Parowanie"); // default name from kind label
    expect(r!.hard).toBe(true); // defaults to hard
    expect(r!.params).toEqual({ kind: "pairing", withGroup: [] }); // withGroup defaults to []
  });

  test("qualification-coverage missing numbers fall back to defaults", () => {
    const r = normalizeDraftRule({ kind: "qualification-coverage", groups: ["reception"] }, ctx);
    expect(r!.params).toEqual({ kind: "qualification-coverage", minQualificationLevel: 3, minCount: 1 });
  });

  test("unknown employeeId is dropped from pairing", () => {
    const r = normalizeDraftRule(
      { name: "x", kind: "pairing", hard: true, groups: ["reception"], employeeId: "ghost", withGroup: ["reception"] },
      ctx,
    );
    expect((r!.params as any).employeeId).toBeUndefined();
  });

  test("scope: single group → group, multiple → cross-group", () => {
    const single = normalizeDraftRule({ kind: "freeform", groups: ["reception"] }, ctx);
    expect(single!.scope).toEqual({ type: "group", group: "reception" });

    const cross = normalizeDraftRule({ kind: "freeform", groups: ["reception", "doctors"] }, ctx);
    expect(cross!.scope).toEqual({ type: "cross-group", groups: ["reception", "doctors"] });
  });

  test("scope: unknown/empty groups fall back to a valid single group", () => {
    const r = normalizeDraftRule({ kind: "freeform", groups: ["mars", 42] }, ctx);
    expect(r!.scope).toEqual({ type: "group", group: "reception" });
  });
});
