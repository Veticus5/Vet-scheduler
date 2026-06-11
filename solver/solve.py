"""
CP-SAT schedule solver — STEP 1 of the LLM -> solver migration.

A sidecar that replaces the LLM as the schedule GENERATOR. It receives the same
effective data the LLM saw (built by server/src/solver/payload.ts) and returns
assignments in the exact `submit_schedule` format, which the existing TypeScript
validator then judges independently.

Scope of step 1 (per input_dla_claude_code_cpsat.md):
  - hard constraints C1-C6, NO slack,
  - objective = ONLY hours deviation from target (W_hours),
  - no soft preferences, no `preferred` requests, no office days.

Two entry points, same model:
  - FastAPI:  POST /solve   (the sidecar architecture the plan calls for)
  - CLI:      python solve.py < payload.json > result.json   (used by the
              comparison runner — no port/server lifecycle to manage)

Constraint -> validator mapping:
  C1 coverage              -> validateCoverage (effective min/max)
  C2 one shift per day     -> validateDoubleBooking
  C3 rest period (doba)    -> validateRestPeriod (forbidden start-order pairs)
  C4 max consecutive days  -> checkMaxConsecutive (with prev-month carry-in)
  C5 free weekend          -> validateFreeWeekend
  C6 qualification         -> checkQualificationCoverage (rank>=lvl, >=count)
"""

import sys
import json
import time
from typing import Any

from ortools.sat.python import cp_model

from norm import target_hours, monthly_norm_hours

SHIFT_HOURS = 8


def solve(payload: dict[str, Any]) -> dict[str, Any]:
    t0 = time.perf_counter()
    m = cp_model.CpModel()

    days: list[str] = payload["days"]
    day_index = {d: i for i, d in enumerate(days)}
    employees = payload["employees"]
    emp_ids = [e["id"] for e in employees]
    rank_of = {e["id"]: e["rank"] for e in employees}

    # Per-employee monthly target from the art. 130 norm (NOT a hardcoded 160):
    # norm(year, month) x fte − 8h x Mon–Fri vacation days. All shifts are 8h, so
    # the objective works on whole-shift counts.
    year, month = (int(p) for p in payload["month"].split("-"))
    target_h = {
        e["id"]: target_hours(year, month, e["fte"], e["workdayVacationDays"])
        for e in employees
    }
    target_shifts = {eid: round(th / SHIFT_HOURS) for eid, th in target_h.items()}
    instances = payload["instances"]
    shift_ids = [d["id"] for d in payload["shiftDefs"]]

    # ---- Decision variables: x[e, date, shift] only where legal ----
    # An instance's `eligible` list already encodes availability + hard
    # time-off/unavailable, so an illegal (e, d, s) simply has no variable —
    # the whole class of "assigned despite time-off" violations is impossible.
    x: dict[tuple[str, str, str], cp_model.IntVar] = {}
    inst_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for inst in instances:
        d, s = inst["date"], inst["shiftDefId"]
        inst_by_key[(d, s)] = inst
        for e in inst["eligible"]:
            x[(e, d, s)] = m.NewBoolVar(f"x_{e}_{d}_{s}")

    # shifts present on a given date (from instances), for per-day work vars
    shifts_on_date: dict[str, list[str]] = {}
    for inst in instances:
        shifts_on_date.setdefault(inst["date"], []).append(inst["shiftDefId"])

    # work[e, date] = 1 iff e works any shift that day. Defining it as a bool
    # equal to the sum also enforces C2 (no double-booking): a bool can't be >1.
    work: dict[tuple[str, str], cp_model.IntVar] = {}
    for e in emp_ids:
        for d in days:
            same_day = [x[(e, d, s)] for s in shifts_on_date.get(d, []) if (e, d, s) in x]
            if not same_day:
                continue
            w = m.NewBoolVar(f"work_{e}_{d}")
            m.Add(w == sum(same_day))  # C2: sum <= 1 (w is boolean)
            work[(e, d)] = w

    def work_var(e: str, d: str):
        """work[e,d] as a 0/1 term (literal int 0 when the person has no var that day)."""
        return work.get((e, d), 0)

    # ---- C1: coverage (hard, no slack) ----
    for inst in instances:
        d, s = inst["date"], inst["shiftDefId"]
        present = [x[(e, d, s)] for e in inst["eligible"] if (e, d, s) in x]
        total = sum(present) if present else 0
        if inst["effMin"] > 0:
            m.Add(total >= inst["effMin"])
        if present:
            m.Add(total <= inst["effMax"])

    # ---- C6: qualification coverage (rank >= minLevel, >= minCount) ----
    # An empty OPTIONAL instance has nothing to qualify (matches the validator's
    # skip): used=0 when nobody is assigned, so the floor only applies once the
    # shift is actually staffed.
    qual = payload.get("qualification")
    if qual:
        min_level, min_count = qual["minLevel"], qual["minCount"]
        for inst in instances:
            d, s = inst["date"], inst["shiftDefId"]
            present = [x[(e, d, s)] for e in inst["eligible"] if (e, d, s) in x]
            if not present:
                continue
            qualified = [
                x[(e, d, s)] for e in inst["eligible"]
                if (e, d, s) in x and rank_of.get(e, 0) >= min_level
            ]
            used = m.NewBoolVar(f"used_{d}_{s}")
            m.Add(sum(present) <= inst["effMax"] * used)  # staffed => used=1
            m.Add(sum(present) >= used)                   # used=1 => staffed
            m.Add((sum(qualified) if qualified else 0) >= min_count * used)

    # ---- C3: rest period (doba) — forbidden start-order across adjacent days ----
    forbidden = payload["forbiddenPairs"]  # [s1, s2] with start(s2) < start(s1)
    for e in emp_ids:
        for i in range(len(days) - 1):
            d, dn = days[i], days[i + 1]
            for s1, s2 in forbidden:
                a, b = x.get((e, d, s1)), x.get((e, dn, s2))
                if a is not None and b is not None:
                    m.Add(a + b <= 1)
    # Boundary: previous month's last day fixes a start; the 1st cannot start
    # earlier than that (e.g. afternoon on the 30th -> no morning on the 1st).
    boundary = payload["boundary"]
    first = days[0]
    sdef_start = {d["id"]: d["startMin"] for d in payload["shiftDefs"]}
    for e, prev_start in boundary["perEmployeeStartMin"].items():
        for s in shift_ids:
            if sdef_start[s] < prev_start and (e, first, s) in x:
                m.Add(x[(e, first, s)] == 0)

    # ---- C4: max consecutive days (with per-employee prev-month carry-in) ----
    cons = payload["consecutive"]
    max_days = cons["maxDays"]
    exempt = set(cons["exemptEmployeeIds"])
    carry_in = cons["carryIn"]
    for e in emp_ids:
        if e in exempt:
            continue
        # Timeline = carry-in days (constant 1) ++ this month's work vars. A
        # sliding window of (max_days + 1) days may sum to at most max_days.
        ci = carry_in.get(e, 0)
        timeline = [1] * ci + [work_var(e, d) for d in days]
        win = max_days + 1
        for i in range(0, len(timeline) - win + 1):
            window = timeline[i:i + win]
            if all(isinstance(t, int) for t in window):
                continue  # entirely in the previous month — nothing to decide
            m.Add(sum(window) <= max_days)

    # ---- C5: free weekend — each employee needs >=1 whole free weekend ----
    for e in emp_ids:
        free_flags = []
        for sat, sun in payload["weekends"]:
            f = m.NewBoolVar(f"free_{e}_{sat}")
            m.Add(f + work_var(e, sat) <= 1)
            m.Add(f + work_var(e, sun) <= 1)
            free_flags.append(f)
        if free_flags:
            m.Add(sum(free_flags) >= 1)

    # ---- Objective: hours deviation from target (W_hours) + optional fairness ----
    # All reception shifts are 8h, so |hours - target| == 8*|shifts - target_shifts|;
    # we minimise the shift-count deviation (8*W_hours is a constant scale).
    #
    # W_hours alone (an L1 sum) is INDIFFERENT to how unavoidable over-target work
    # is spread: piling +27 shifts on one person scores the same as +2-3 each. When
    # `weights.balance` > 0 we also minimise the WORST single over-target deviation
    # (max_over), which forces the overflow to spread evenly — the fairness a human
    # planner applies by hand. This is the step-2 balance term, exposed early to
    # answer "does anyone really have to carry the overtime?".
    w_hours = payload["weights"]["hours"]
    w_balance = payload["weights"].get("balance", 0)
    dev_terms = []
    over_terms = []
    for e in emp_ids:
        e_vars = [v for (ee, _, _), v in x.items() if ee == e]
        count = sum(e_vars) if e_vars else 0
        tgt = target_shifts[e]
        pos = m.NewIntVar(0, len(days), f"devpos_{e}")
        neg = m.NewIntVar(0, len(days), f"devneg_{e}")
        m.Add(count - tgt == pos - neg)
        dev_terms.append(pos + neg)
        over_terms.append(pos)
    obj = w_hours * sum(dev_terms)
    if w_balance:
        max_over = m.NewIntVar(0, len(days), "max_over")
        for p in over_terms:
            m.Add(max_over >= p)
        obj = obj + w_balance * max_over
    m.Minimize(obj)

    # ---- Solve ----
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 10.0
    solver.parameters.random_seed = 42
    solver.parameters.num_search_workers = 8
    status = solver.Solve(m)
    elapsed_ms = round((time.perf_counter() - t0) * 1000)

    status_name = solver.StatusName(status)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {
            "status": status_name,
            "assignments": [],
            "solveTimeMs": elapsed_ms,
            "objective": None,
            "hoursPerEmployee": {},
            "targets": target_h,
            "normHours": monthly_norm_hours(year, month),
        }

    assignments = [
        {"date": d, "shiftDefId": s, "employeeId": e}
        for (e, d, s), v in x.items()
        if solver.Value(v) == 1
    ]
    hours_per_emp = {}
    for e in emp_ids:
        cnt = sum(1 for a in assignments if a["employeeId"] == e)
        hours_per_emp[e] = cnt * SHIFT_HOURS

    return {
        "status": status_name,
        "assignments": assignments,
        "solveTimeMs": elapsed_ms,
        "objective": solver.ObjectiveValue(),
        "hoursPerEmployee": hours_per_emp,
        "targets": target_h,
        "normHours": monthly_norm_hours(year, month),
    }


# --------------------------------------------------------------------------
# FastAPI sidecar (the architecture the migration plan specifies)
# --------------------------------------------------------------------------
try:
    from fastapi import FastAPI
    from pydantic import BaseModel

    app = FastAPI(title="vet-scheduler CP-SAT solver", version="0.1.0")

    class SolveRequest(BaseModel):
        payload: dict

    @app.post("/solve")
    def solve_endpoint(req: SolveRequest):
        return solve(req.payload)

    @app.get("/health")
    def health():
        return {"ok": True}
except ImportError:
    # FastAPI not installed — CLI mode still works.
    app = None


if __name__ == "__main__":
    data = json.load(sys.stdin)
    # Accept either the raw payload or {"payload": ...}.
    payload = data["payload"] if "payload" in data else data
    json.dump(solve(payload), sys.stdout)
