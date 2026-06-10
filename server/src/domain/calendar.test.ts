import { describe, expect, test } from "bun:test";
import { expandRecurrence, weekdayOf } from "./calendar";

// July 2026 starts on a Wednesday, so its Wednesdays are 1, 8, 15, 22, 29.
describe("expandRecurrence", () => {
  test("picks every Wednesday of the month, sorted", () => {
    expect(expandRecurrence("2026-07", [3])).toEqual([
      "2026-07-01",
      "2026-07-08",
      "2026-07-15",
      "2026-07-22",
      "2026-07-29",
    ]);
  });

  test("never returns dates outside the month", () => {
    const dates = expandRecurrence("2026-07", [0, 3, 6]);
    expect(dates.every((d) => d.startsWith("2026-07-"))).toBe(true);
  });

  test("supports multiple weekdays, ascending and only the requested days", () => {
    const dates = expandRecurrence("2026-07", [1, 5]); // Mondays + Fridays
    expect(dates.every((d) => [1, 5].includes(weekdayOf(d)))).toBe(true);
    expect([...dates]).toEqual([...dates].sort());
    expect(dates.length).toBeGreaterThan(0);
  });

  test("empty weekdays yields an empty list", () => {
    expect(expandRecurrence("2026-07", [])).toEqual([]);
  });
});
