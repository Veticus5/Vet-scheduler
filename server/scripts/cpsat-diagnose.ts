/**
 * Step-1 diagnosis: build the solver payload for a month, run the existing
 * feasibility check, and validate the currently-saved schedule (the LLM
 * baseline). Prints numbers only — mutates nothing. Run against a WORKING COPY
 * of the DB (set VET_DB_PATH) so production data is never touched.
 *
 *   VET_DB_PATH=solver/.work/work.db bun run server/scripts/cpsat-diagnose.ts 2026-07
 */
import { listEmployees } from "../src/repos/employees";
import { listShifts } from "../src/repos/shifts";
import { listEnabledRules } from "../src/repos/rules";
import { listRequests } from "../src/repos/requests";
import { rankMap } from "../src/repos/qualifications";
import { assignmentsOf, getSchedule } from "../src/repos/schedules";
import { computeFeasibility } from "../src/domain/feasibility";
import { validate } from "../src/domain/validator";
import { buildSolverPayload } from "../src/solver/payload";

const month = process.argv[2] ?? "2026-07";
const [y, m] = month.split("-").map(Number) as [number, number];
const prevMonth = (() => {
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
})();

const employees = listEmployees();
const shiftDefs = listShifts();
const rules = listEnabledRules();
const requests = listRequests(month);
const prevMonthAssignments = assignmentsOf(prevMonth);

const payload = buildSolverPayload(
  { month, employees, shiftDefs, rules, requests, prevMonthAssignments },
  rankMap(),
);

console.log(`\n=== PAYLOAD STATS ${month} ===`);
console.log(`employees: ${payload.employees.length}, instances: ${payload.instances.length}, days: ${payload.days.length}`);
console.log(`prevMonth(${prevMonth}) assignments: ${prevMonthAssignments.length}`);
console.log(`forbiddenPairs: ${JSON.stringify(payload.forbiddenPairs.map(([a, b]) => `${a.slice(0, 4)}>${b.slice(0, 4)}`))}`);
console.log(`consecutive: maxDays=${payload.consecutive.maxDays}, exempt=${payload.consecutive.exemptEmployeeIds.length}, carryIn=${JSON.stringify(payload.consecutive.carryIn)}`);
console.log(`weekends: ${payload.weekends.length}`);
console.log(`qualification: ${JSON.stringify(payload.qualification)}`);
console.log(`boundary(${payload.boundary.date}): ${JSON.stringify(payload.boundary.perEmployeeStartMin)}`);

const totalMin = payload.instances.reduce((s, i) => s + i.effMin, 0);
console.log(`\nΣ effMin = ${totalMin} shift-slots (target computed in sidecar from art.130 norm)`);
console.log("Per-employee (fte, Mon–Fri vacation days):");
for (const e of payload.employees)
  console.log(`  ${e.name}: fte ${e.fte}, vacWorkdays ${e.workdayVacationDays}, rank ${e.rank}`);

// Instances where eligible < effMin → structural gaps (no schedule can fill).
const tight = payload.instances.filter((i) => i.eligible.length < i.effMin);
console.log(`\nInstances with eligible < effMin (structural gaps): ${tight.length}`);
const defName = new Map(payload.shiftDefs.map((d) => [d.id, d.name]));
for (const i of tight) console.log(`  ${i.date} ${defName.get(i.shiftDefId)}: eligible ${i.eligible.length} < min ${i.effMin}`);

// Existing feasibility report (same the app shows).
const feas = computeFeasibility({ month, employees, shiftDefs, rules, requests });
console.log(`\ncomputeFeasibility: feasible=${feas.feasible}, gaps=${feas.gaps.length}`);
for (const g of feas.gaps) console.log(`  GAP ${g.date} ${g.shiftName}: required ${g.required}, available ${g.available}`);

// Baseline: validate the currently-saved schedule (the last LLM result).
const saved = getSchedule(month);
if (saved) {
  const v = validate({
    month,
    employees,
    shiftDefs,
    rules,
    requests,
    assignments: saved.assignments,
    tierRanks: rankMap(),
    prevMonthAssignments,
  });
  console.log(`\n=== BASELINE (saved LLM schedule, ${saved.assignments.length} assignments) ===`);
  console.log(`status=${saved.status}, validator violations=${v.violations.length}`);
  const byKind = new Map<string, number>();
  for (const vi of v.violations) byKind.set(vi.kind, (byKind.get(vi.kind) ?? 0) + 1);
  console.log(`by kind: ${JSON.stringify(Object.fromEntries(byKind))}`);
} else {
  console.log(`\nNo saved schedule for ${month}.`);
}
