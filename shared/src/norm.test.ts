import { test, expect } from "bun:test";
import { monthlyNormHours, monthlyTargetHours, countWorkdayVacationDays } from "./norm";

// art. 130 KP norm for every month of 2026 (hours). This table is the contract
// that keeps the TS norm and solver/norm.py in lockstep — it is the same table
// asserted in solver/test_norm.py. June 2026 = 168h is independently confirmed
// by Daria's real schedule (PDF header); July 2026 = 184h is the value the app
// must use instead of the old hardcoded 160.
const NORM_2026: Record<number, number> = {
  1: 160, 2: 160, 3: 176, 4: 168, 5: 160, 6: 168,
  7: 184, 8: 160, 9: 176, 10: 176, 11: 160, 12: 160,
};

test("monthly norm matches the art.130 table for all of 2026", () => {
  for (const [month, expected] of Object.entries(NORM_2026)) {
    expect(monthlyNormHours(2026, Number(month))).toBe(expected);
  }
});

test("June 2026 = 168h (matches the real schedule header)", () => {
  expect(monthlyNormHours(2026, 6)).toBe(168);
});

test("July 2026 = 184h, not the old hardcoded 160", () => {
  expect(monthlyNormHours(2026, 7)).toBe(184);
});

test("target subtracts only Mon–Fri vacation, scales by FTE", () => {
  expect(monthlyTargetHours(2026, 7, 1.0, 0)).toBe(184);
  expect(monthlyTargetHours(2026, 7, 1.0, 3)).toBe(160); // 184 − 24
  expect(monthlyTargetHours(2026, 7, 0.5, 0)).toBe(92);
});

test("countWorkdayVacationDays ignores weekends", () => {
  // 2026-07-04 Sat, 05 Sun (ignored); 06 Mon, 07 Tue (counted).
  expect(countWorkdayVacationDays(["2026-07-04", "2026-07-05", "2026-07-06", "2026-07-07"])).toBe(2);
});
