/**
 * Server-side bridge to the CP-SAT solver (step 4). Spawns the solver as a child
 * process — `solve.py` under a Python interpreter in dev, the bundled
 * `solver(.exe)` next to the app in a compiled build — feeds it the payload on
 * stdin and reads `{assignments, slacks, …}` on stdout. The result is then judged
 * by the SAME validator as the LLM path, so the engine swap is invisible to the
 * rest of the app.
 */
import { dirname, join } from "node:path";
import type { Assignment, FeasibilityReport } from "@vet/shared";
import { HttpError } from "../http";
import { isCompiled } from "../config";
import { rankMap } from "../repos/qualifications";
import { computeFeasibility } from "../domain/feasibility";
import { validate, type ValidationContext } from "../domain/validator";
import { buildSolverPayload } from "./payload";
import type { GenerateInput, GenerateResult } from "../ai/generate";

interface SolverOutput {
  status: string;
  assignments: Assignment[];
  solveTimeMs: number;
  objective: number | null;
  slacks: { date: string; shiftDefId: string; missing: number }[];
}

/**
 * How to invoke the solver:
 *  - compiled app: the bundled `dist/solver/solver(.exe)` next to the executable;
 *  - dev: `solve.py` under a Python interpreter. Bun cannot spawn the Windows
 *    Store `python` alias, so VET_SOLVER_PYTHON should point at a real interpreter
 *    (e.g. the venv). VET_SOLVER_CMD overrides everything (JSON array of argv).
 */
function solverCommand(): string[] {
  const override = process.env.VET_SOLVER_CMD;
  if (override) return JSON.parse(override) as string[];
  if (isCompiled) {
    const exe = process.platform === "win32" ? "solver.exe" : "solver";
    return [join(dirname(process.execPath), "solver", exe)];
  }
  const py = process.env.VET_SOLVER_PYTHON ?? "python";
  return [py, join(import.meta.dir, "..", "..", "..", "solver", "solve.py")];
}

function validationContext(input: GenerateInput, assignments: Assignment[]): ValidationContext {
  return {
    month: input.month,
    employees: input.employees,
    shiftDefs: input.shiftDefs,
    rules: input.rules,
    requests: input.requests,
    assignments,
    tierRanks: rankMap(),
    prevMonthAssignments: input.prevMonthAssignments,
  };
}

export async function generateScheduleViaSolver(input: GenerateInput): Promise<GenerateResult> {
  const feasibility: FeasibilityReport = computeFeasibility(input);
  const payload = buildSolverPayload(
    {
      month: input.month,
      employees: input.employees,
      shiftDefs: input.shiftDefs,
      rules: input.rules,
      requests: input.requests,
      prevMonthAssignments: input.prevMonthAssignments ?? [],
    },
    rankMap(),
  );

  const cmd = solverCommand();
  const proc = (() => {
    try {
      return Bun.spawn(cmd, { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    } catch (e: any) {
      throw new HttpError(
        502,
        `Nie udało się uruchomić solvera (${cmd[0]}). Sprawdź, czy jest zainstalowany. Szczegóły: ${e?.message ?? e}`,
      );
    }
  })();
  proc.stdin.write(JSON.stringify({ payload }));
  proc.stdin.end();

  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0 || !out.trim()) {
    throw new HttpError(502, `Solver zakończył się błędem (kod ${code}). ${err.trim().slice(0, 500)}`);
  }

  let result: SolverOutput;
  try {
    result = JSON.parse(out) as SolverOutput;
  } catch {
    throw new HttpError(502, `Solver zwrócił nieprawidłowy wynik. ${err.trim().slice(0, 300)}`);
  }
  if (result.status !== "OPTIMAL" && result.status !== "FEASIBLE") {
    throw new HttpError(502, `Solver nie znalazł rozwiązania (status ${result.status}).`);
  }

  const validation = validate(validationContext(input, result.assignments));
  return { assignments: result.assignments, validation, attempts: 1, feasibility, systemic: false };
}
