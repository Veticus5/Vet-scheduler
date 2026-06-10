/**
 * Recurrence is expanded into concrete `dates` at the repo layer, and stays the
 * source of truth: updating it regenerates the dates.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";

const DB = join(tmpdir(), "vet-requests-test.db");
process.env.VET_DB_PATH = DB;
process.env.VET_NO_OPEN = "1";

const { createEmployee } = await import("./employees");
const { createRequest, updateRequest } = await import("./requests");
const { closeDb } = await import("../db");

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

test("recurrence expands to the matching dates of the month", () => {
  const e = createEmployee({ name: "Daria", staffGroup: "reception", qualificationTier: "doswiadczony", contractHours: 160, defaultAvailability: {}, active: true });

  // July 2026 Wednesdays: 1, 8, 15, 22, 29.
  const r = createRequest({ month: "2026-07", employeeId: e.id, type: "preferred", recurrence: { weekdays: [3] } });
  expect(r.recurrence).toEqual({ weekdays: [3] });
  expect(r.dates).toEqual(["2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22", "2026-07-29"]);

  // Updating the pattern regenerates the dates (Mondays of July 2026).
  const updated = updateRequest(r.id, { month: "2026-07", employeeId: e.id, type: "preferred", recurrence: { weekdays: [1] } })!;
  expect(updated.recurrence).toEqual({ weekdays: [1] });
  expect(updated.dates).toEqual(["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27"]);
});

test("without recurrence, explicit dates are kept as-is", () => {
  const e = createEmployee({ name: "Ala", staffGroup: "reception", qualificationTier: "doswiadczony", contractHours: 160, defaultAvailability: {}, active: true });
  const r = createRequest({ month: "2026-07", employeeId: e.id, type: "time-off", dates: ["2026-07-02"] });
  expect(r.recurrence).toBeUndefined();
  expect(r.dates).toEqual(["2026-07-02"]);
});
