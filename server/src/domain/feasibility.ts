import type {
  CoverageGap,
  Employee,
  FeasibilityReport,
  Rule,
  ScheduleRequest,
  ShiftDefinition,
} from "@vet/shared";
import { expandInstances, weekdayOf } from "./calendar";
import { effectiveCoverage } from "./validator";

export interface FeasibilityInput {
  month: string;
  employees: Employee[];
  shiftDefs: ShiftDefinition[];
  rules: Rule[];
  requests: ScheduleRequest[];
}

/**
 * Deterministic capacity check, run BEFORE AI generation. For each
 * reception-staffing shift instance it counts how many employees are both
 * eligible (active, correct staff group, available that weekday by their
 * default availability) and not blocked by a time-off / unavailable request.
 * When that count is below the shift's required minimum, no schedule can fill
 * it — it is a structural gap (too few people), not an AI failure.
 *
 * Office-duty shifts (`staffsReception === false`) are excluded, mirroring the
 * validator: they do not staff the desk, so they carry no coverage minimum.
 *
 * Qualification/pairing constraints are intentionally NOT modelled here — this
 * is a headcount floor, the cheapest signal that distinguishes "not enough
 * staff" from "AI placed people badly".
 */
export function computeFeasibility(input: FeasibilityInput): FeasibilityReport {
  const instances = expandInstances(input.shiftDefs, input.month);
  const defById = new Map(input.shiftDefs.map((d) => [d.id, d]));
  const coverageRules = input.rules.filter((r) => r.enabled && r.kind === "coverage");
  const active = input.employees.filter((e) => e.active);

  // Requests that remove an employee from a date (whole day) or a specific shift.
  const blockedDate = new Set<string>(); // `${employeeId}|${date}`
  const blockedShift = new Set<string>(); // `${employeeId}|${date}|${shiftDefId}`
  for (const req of input.requests) {
    if (req.type !== "time-off" && req.type !== "unavailable") continue;
    for (const date of req.dates ?? []) {
      if (req.shiftDefIds?.length) {
        for (const sid of req.shiftDefIds) blockedShift.add(`${req.employeeId}|${date}|${sid}`);
      } else {
        blockedDate.add(`${req.employeeId}|${date}`);
      }
    }
  }

  const gaps: CoverageGap[] = [];
  for (const inst of instances) {
    const def = defById.get(inst.shiftDefId);
    if (!def || def.staffsReception === false) continue;
    const { min } = effectiveCoverage(inst, def, coverageRules);
    if (min <= 0) continue;

    const wd = weekdayOf(inst.date);
    let available = 0;
    for (const e of active) {
      if (e.staffGroup !== inst.staffGroup) continue;
      // Default availability: a present weekday key restricts the employee to
      // the listed shift defs (empty array = unavailable that weekday).
      const avail = e.defaultAvailability[wd];
      if (avail !== undefined && !avail.includes(inst.shiftDefId)) continue;
      if (blockedDate.has(`${e.id}|${inst.date}`)) continue;
      if (blockedShift.has(`${e.id}|${inst.date}|${inst.shiftDefId}`)) continue;
      available++;
    }

    if (available < min) {
      gaps.push({ date: inst.date, shiftDefId: inst.shiftDefId, shiftName: def.name, required: min, available });
    }
  }

  return { feasible: gaps.length === 0, gaps };
}
