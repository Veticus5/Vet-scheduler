/**
 * Step-1 comparison runner. Builds the solver payload for a month, runs the
 * CP-SAT sidecar (solve.py, via stdin/stdout child process), then judges the
 * result with the EXISTING validator and prints a comparison against the saved
 * LLM schedule. Reads only — never writes the DB or the schedule.
 *
 *   VET_DB_PATH=solver/.work/work.db bun run server/scripts/cpsat-run.ts 2026-07
 */
import { listEmployees } from "../src/repos/employees";
import { listShifts } from "../src/repos/shifts";
import { listEnabledRules } from "../src/repos/rules";
import { listRequests } from "../src/repos/requests";
import { rankMap } from "../src/repos/qualifications";
import { assignmentsOf, getSchedule } from "../src/repos/schedules";
import { validate, type ValidationContext } from "../src/domain/validator";
import { buildSolverPayload } from "../src/solver/payload";
import type { Assignment } from "@vet/shared";

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
const tierRanks = rankMap();
const empName = new Map(employees.map((e) => [e.id, e.name]));
const defName = new Map(shiftDefs.map((d) => [d.id, d.name]));

const balanceWeight = Number(process.argv[3] ?? 0);
const payload = buildSolverPayload(
  { month, employees, shiftDefs, rules, requests, prevMonthAssignments },
  tierRanks,
);
(payload.weights as { balance?: number }).balance = balanceWeight;
console.log(`weights: hours=${payload.weights.hours}, balance=${balanceWeight}`);

function ctx(assignments: Assignment[]): ValidationContext {
  return { month, employees, shiftDefs, rules, requests, assignments, tierRanks, prevMonthAssignments };
}

function summarize(label: string, assignments: Assignment[]) {
  const v = validate(ctx(assignments));
  const byKind = new Map<string, number>();
  for (const vi of v.violations) byKind.set(vi.kind, (byKind.get(vi.kind) ?? 0) + 1);
  console.log(`\n${label}: ${assignments.length} assignments, ${v.violations.length} HARD violations`);
  console.log(`  by kind: ${JSON.stringify(Object.fromEntries(byKind))}`);
  return v;
}

// ---- Run the Python solver as a child process (CLI/stdin mode) ----
console.log(`Running CP-SAT solver for ${month} (${payload.instances.length} instances, ${payload.employees.length} employees)...`);
const python = process.env.PYTHON ?? "python";
const proc = Bun.spawn([python, "solver/solve.py"], {
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
});
proc.stdin.write(JSON.stringify({ payload }));
proc.stdin.end();
const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
await proc.exited;
if (err.trim()) console.error("[solver stderr]", err.trim());
if (!out.trim()) {
  console.error("Solver returned no output. Aborting.");
  process.exit(1);
}
const result = JSON.parse(out) as {
  status: string;
  assignments: Assignment[];
  solveTimeMs: number;
  objective: number | null;
  hoursPerEmployee: Record<string, number>;
  targets: Record<string, number>;
  normHours: number;
  slacks: { date: string; shiftDefId: string; missing: number }[];
};

console.log(`\n=== SOLVER RESULT ===`);
console.log(`status: ${result.status} | solveTime: ${result.solveTimeMs}ms | objective: ${result.objective}`);
console.log(`monthly norm (art. 130 KP): ${result.normHours}h`);

if (result.status !== "OPTIMAL" && result.status !== "FEASIBLE") {
  console.log("\nSolver did not find a solution (per step-1 rules: no slack added).");
  console.log("This indicates which hard constraints are over-tight; step 2 introduces slack.");
  process.exit(0);
}

// ---- Judge both schedules with the SAME validator ----
const baseline = getSchedule(month);
const baseV = baseline ? summarize("BASELINE (saved LLM schedule)", baseline.assignments) : null;
const solverV = summarize("SOLVER (CP-SAT)", result.assignments);

// ---- Hours table vs target ----
console.log(`\n=== HOURS vs TARGET (solver) ===`);
console.log("employee".padEnd(26) + "target".padStart(8) + "solver".padStart(8) + "dev".padStart(6));
let totalAbsDev = 0;
for (const e of payload.employees) {
  const target = result.targets[e.id] ?? 0;
  const h = result.hoursPerEmployee[e.id] ?? 0;
  const dev = h - target;
  totalAbsDev += Math.abs(dev);
  console.log(
    empName.get(e.id)!.padEnd(26) +
      `${target}h`.padStart(8) +
      `${h}h`.padStart(8) +
      `${dev >= 0 ? "+" : ""}${dev}`.padStart(6),
  );
}
const totalTargetShifts = Object.values(result.targets).reduce((s, t) => s + Math.round(t / 8), 0);
const totalMin = payload.instances.reduce((s, i) => s + i.effMin, 0);
const floor = (totalMin - totalTargetShifts) * 8;
console.log(
  `Σ|deviation| = ${totalAbsDev}h  (Σ coverage-min ${totalMin} shifts vs Σ target ${totalTargetShifts} shifts → ` +
    (floor > 0
      ? `~${floor}h overtime is unavoidable, the rest is distribution`
      : `no forced overtime: targets absorb the whole coverage demand`) +
    `)`,
);

// ---- Soft outcomes (the point of step 2) ----
console.log(`\n=== SOFT OUTCOMES (solver) ===`);

// Preferred requests honoured (validator's own count is the arbiter).
const totalPref = payload.preferred.length;
console.log(
  `Preferred requests: ${totalPref - solverV.unmetPreferences.length}/${totalPref} met ` +
    `(LLM baseline met ${baseV ? totalPref - baseV.unmetPreferences.length : "n/a"}/${totalPref})`,
);
for (const u of solverV.unmetPreferences) console.log(`  unmet: ${u.message}`);

// Coverage slacks (understaffing the solver couldn't fill).
if (result.slacks.length === 0) console.log(`Coverage slacks: none (every shift fully staffed)`);
else for (const s of result.slacks) console.log(`  SLACK ${s.date} ${defName.get(s.shiftDefId)}: −${s.missing} osoba`);

// Worked-weekend distribution + morning/afternoon balance per person.
const morning = new Set(payload.shiftDefs.filter((d) => d.startMin < 540).map((d) => d.id));
const afternoon = new Set(payload.shiftDefs.filter((d) => d.startMin >= 780).map((d) => d.id));
const worked = new Map<string, Set<string>>();
const cntR = new Map<string, number>();
const cntP = new Map<string, number>();
for (const a of result.assignments) {
  (worked.get(a.employeeId) ?? worked.set(a.employeeId, new Set()).get(a.employeeId)!).add(a.date);
  if (morning.has(a.shiftDefId)) cntR.set(a.employeeId, (cntR.get(a.employeeId) ?? 0) + 1);
  if (afternoon.has(a.shiftDefId)) cntP.set(a.employeeId, (cntP.get(a.employeeId) ?? 0) + 1);
}
console.log(`\nweekends worked / morning(R) / afternoon(P) per person:`);
for (const e of payload.employees) {
  const w = worked.get(e.id) ?? new Set();
  const wk = payload.weekends.filter(([sa, su]) => w.has(sa) || w.has(su)).length;
  console.log(`  ${empName.get(e.id)!.padEnd(24)} wk ${wk}  R ${cntR.get(e.id) ?? 0}  P ${cntP.get(e.id) ?? 0}`);
}

// ---- Verdict ----
console.log(`\n=== VERDICT ===`);
console.log(`LLM baseline conflicts: ${baseV?.violations.length ?? "n/a"}`);
console.log(`CP-SAT solver conflicts: ${solverV.violations.length}`);
console.log(`Solve time: ${result.solveTimeMs}ms (< 10s budget: ${result.solveTimeMs < 10000 ? "YES" : "NO"})`);
if (solverV.violations.length > 0) {
  console.log(`\nRemaining solver violations:`);
  for (const vi of solverV.violations) console.log(`  [${vi.kind}] ${vi.message}`);
}
