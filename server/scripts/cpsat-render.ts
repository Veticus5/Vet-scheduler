/**
 * Run the CP-SAT solver for a month and render the resulting schedule as a
 * human-readable grid (employee × day), like the printed schedule. Read-only —
 * does NOT save anything. For eyeballing what the solver actually produced.
 *
 *   VET_DB_PATH=solver/.work/work.db PYTHON=solver/.venv/Scripts/python.exe \
 *   bun run server/scripts/cpsat-render.ts 2026-07
 */
import { listEmployees } from "../src/repos/employees";
import { listShifts } from "../src/repos/shifts";
import { listEnabledRules } from "../src/repos/rules";
import { listRequests } from "../src/repos/requests";
import { rankMap } from "../src/repos/qualifications";
import { assignmentsOf } from "../src/repos/schedules";
import { validate } from "../src/domain/validator";
import { buildSolverPayload } from "../src/solver/payload";
import { datesOfMonth, weekdayOf } from "../src/domain/calendar";
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

const payload = buildSolverPayload(
  { month, employees, shiftDefs, rules, requests, prevMonthAssignments },
  tierRanks,
);
(payload.weights as { balance?: number }).balance = 100;

const proc = Bun.spawn([process.env.PYTHON ?? "python", "solver/solve.py"], {
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
});
proc.stdin.write(JSON.stringify({ payload }));
proc.stdin.end();
const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
await proc.exited;
if (err.trim()) console.error("[solver stderr]", err.trim());
const result = JSON.parse(out) as { assignments: Assignment[]; normHours: number };

// Map each shift def to a 1-char code by start time: R=morning, M=midshift, P=afternoon.
const startMin = (t: string) => {
  const [h, mm] = t.split(":").map(Number);
  return (h || 0) * 60 + (mm || 0);
};
const codeOf = new Map<string, string>();
for (const d of shiftDefs) {
  const s = startMin(d.startTime);
  codeOf.set(d.id, s < 540 ? "R" : s < 780 ? "M" : "P");
}

const days = datesOfMonth(month);
const WD = ["N", "P", "W", "Ś", "C", "P", "S"]; // Sun..Sat single letters
const empById = new Map(employees.map((e) => [e.id, e]));

// cell[empId][date] = code
const cell = new Map<string, Map<string, string>>();
for (const a of result.assignments) {
  let row = cell.get(a.employeeId);
  if (!row) cell.set(a.employeeId, (row = new Map()));
  row.set(a.date, codeOf.get(a.shiftDefId) ?? "?");
}

// Time-off dates per employee (to show "U" on vacation days).
const offByEmp = new Map<string, Set<string>>();
for (const r of requests) {
  if (r.type !== "time-off" && r.type !== "unavailable") continue;
  let s = offByEmp.get(r.employeeId);
  if (!s) offByEmp.set(r.employeeId, (s = new Set()));
  for (const d of r.dates ?? []) s.add(d);
}

const NAME_W = 24;
const activeRecep = employees.filter((e) => e.active && e.staffGroup === "reception");

// Header rows: day number + weekday letter.
const hdr1 = " ".repeat(NAME_W) + days.map((d) => String(Number(d.slice(-2))).padStart(2, " ")).join(" ");
const hdr2 = " ".repeat(NAME_W) + days.map((d) => WD[weekdayOf(d)]!.padStart(2, " ")).join(" ");
console.log(`\nGRAFIK RECEPCJI — ${month}   (norma art.130: ${result.normHours}h)`);
console.log(`R=Poranna 7:30  M=Między 10:00  P=Popołudniowa 14:30  ·=wolne  U=urlop/niedost.\n`);
console.log(hdr1);
console.log(hdr2);

for (const e of activeRecep) {
  const row = cell.get(e.id) ?? new Map();
  const off = offByEmp.get(e.id) ?? new Set();
  let worked = 0;
  const cells = days.map((d) => {
    const c = row.get(d);
    if (c) {
      worked++;
      return c.padStart(2, " ");
    }
    return (off.has(d) ? "U" : "·").padStart(2, " ");
  });
  console.log(e.name.slice(0, NAME_W - 1).padEnd(NAME_W) + cells.join(" ") + `  | ${worked * 8}h`);
}

// Daily coverage counts (morning / afternoon) to eyeball the staffing.
const countRow = (pred: (c: string) => boolean) =>
  " ".repeat(NAME_W) +
  days
    .map((d) => {
      let n = 0;
      for (const e of activeRecep) {
        const c = cell.get(e.id)?.get(d);
        if (c && pred(c)) n++;
      }
      return String(n).padStart(2, " ");
    })
    .join(" ");
console.log("\n" + "obsada Poranna (R)".padEnd(NAME_W) + countRow((c) => c === "R").slice(NAME_W));
console.log("obsada Popołud. (P)".padEnd(NAME_W) + countRow((c) => c === "P").slice(NAME_W));

const v = validate({ month, employees, shiftDefs, rules, requests, assignments: result.assignments, tierRanks, prevMonthAssignments });
console.log(`\nWalidator: ${v.violations.length} konfliktów twardych. Przypisań: ${result.assignments.length}.`);
