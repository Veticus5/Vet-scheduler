/**
 * End-to-end of the data flow WITHOUT the AI call (which needs a real API key):
 * define staff + shifts + rules + requests, build & validate a schedule, save,
 * reload, and confirm an over-constrained month surfaces flagged violations.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";

const DB = join(tmpdir(), "vet-integration-test.db");
process.env.VET_DB_PATH = DB;
process.env.VET_NO_OPEN = "1";

// Import AFTER setting the env so getDb() opens the temp database.
const { createEmployee } = await import("./repos/employees");
const { createShift } = await import("./repos/shifts");
const { createRule } = await import("./repos/rules");
const { createRequest } = await import("./repos/requests");
const { saveSchedule, getSchedule } = await import("./repos/schedules");
const { listEnabledRules } = await import("./repos/rules");
const { listEmployees } = await import("./repos/employees");
const { listShifts } = await import("./repos/shifts");
const { listRequests } = await import("./repos/requests");
const { validate } = await import("./domain/validator");
const { expandInstances } = await import("./domain/calendar");
const { closeDb } = await import("./db");

function cleanup() {
  closeDb();
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      rmSync(DB + ext, { force: true });
    } catch {
      /* file may be briefly locked on Windows; harmless for a temp file */
    }
  }
}

beforeAll(cleanup);
afterAll(cleanup);

test("full data flow: define, validate, save, reload", () => {
  const a = createEmployee({ name: "A Senior", staffGroup: "reception", qualificationLevel: 3, contractHours: 160, defaultAvailability: {}, active: true });
  const b = createEmployee({ name: "B Junior", staffGroup: "reception", qualificationLevel: 1, contractHours: 160, defaultAvailability: {}, active: true });

  const morning = createShift({ staffGroup: "reception", name: "Poranna", startTime: "07:30", endTime: "15:30", weekdays: [3], requiredMin: 2, requiredMax: 4 });

  createRule({
    name: "Min 1 doświadczony",
    kind: "qualification-coverage",
    hard: true,
    scope: { type: "group", group: "reception" },
    params: { kind: "qualification-coverage", minQualificationLevel: 3, minCount: 1 },
    description: "Na każdej zmianie ktoś doświadczony",
    enabled: true,
  });

  createRequest({ month: "2026-07", employeeId: b.id, type: "preferred", dates: ["2026-07-01"] });

  const month = "2026-07";
  const instances = expandInstances(listShifts(), month);
  expect(instances.length).toBeGreaterThan(0);

  // Staff the first Wednesday correctly (senior + junior = 2, includes a senior).
  const first = instances[0]!;
  const assignments = [
    { date: first.date, shiftDefId: morning.id, employeeId: a.id },
    { date: first.date, shiftDefId: morning.id, employeeId: b.id },
  ];

  const validation = validate({
    month,
    employees: listEmployees(),
    shiftDefs: listShifts(),
    rules: listEnabledRules(),
    requests: listRequests(month),
    assignments,
  });
  // Other Wednesdays are empty → coverage violations expected, but the first is clean.
  expect(validation.violations.some((v) => v.date === first.date && v.kind !== undefined)).toBe(false);

  const saved = saveSchedule(month, assignments, validation.valid ? "valid" : "has-conflicts", validation.violations);
  expect(saved.assignments.length).toBe(2);

  const reloaded = getSchedule(month)!;
  expect(reloaded.assignments.length).toBe(2);
  expect(reloaded.month).toBe(month);
});

test("over-constrained month flags violations instead of hiding them", () => {
  const only = createEmployee({ name: "Tylko Jeden", staffGroup: "technicians", qualificationLevel: 2, contractHours: 160, defaultAvailability: {}, active: true });
  createShift({ staffGroup: "technicians", name: "Dyżur", startTime: "08:00", endTime: "20:00", weekdays: [1], requiredMin: 3, requiredMax: 3 });

  const month = "2026-07";
  const validation = validate({
    month,
    employees: [only],
    shiftDefs: listShifts().filter((s) => s.staffGroup === "technicians"),
    rules: [],
    requests: [],
    assignments: [],
  });
  expect(validation.valid).toBe(false);
  expect(validation.violations.length).toBeGreaterThan(0);
});
