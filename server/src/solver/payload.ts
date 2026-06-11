/**
 * CP-SAT solver payload builder — STEP 1 of the LLM→solver migration.
 *
 * Produces the enriched JSON the Python sidecar (`solver/solve.py`) needs to
 * build the CP-SAT model. It is derived from the SAME data the LLM generator
 * sees (employees, effective coverage, hard requests, previous month), so the
 * model and the existing validator look at identical effective numbers — the
 * "iron rule" from HANDOFF_scheduler.md §1.
 *
 * Nothing here mutates state; it only reads via the repos. Office-duty shifts
 * (`staffsReception === false`) don't exist in the current data and are out of
 * scope for step 1, so only reception-desk instances are modelled.
 */
import type { Assignment, Employee, Rule, ScheduleRequest, ShiftDefinition } from "@vet/shared";
import { datesOfMonth, weekdayOf } from "../domain/calendar";
import { effectiveCoverage } from "../domain/validator";
import { proposeOfficeDays, type OfficeProposal } from "./office";

export interface SolverEmployee {
  id: string;
  name: string;
  /** Seniority rank within reception (1 niedoswiadczony … 4 kierownik). */
  rank: number;
  /** Full-time equivalent (1.0 = full-time). Derived from contractHours / 160;
   *  all current staff are full-time. A dedicated FTE/etat field would be cleaner
   *  the day a part-timer joins. */
  fte: number;
  /** VACATION (time-off) dates that fall on a working day (Mon–Fri). The monthly
   *  norm (art. 130 KP) is reduced 8h per such day; weekend vacation deducts
   *  nothing. The norm itself is computed in the sidecar (Python `holidays`),
   *  so the per-employee target = norm × fte − 8 × workdayVacationDays. */
  workdayVacationDays: number;
}

export interface SolverInstance {
  date: string;
  shiftDefId: string;
  effMin: number;
  effMax: number;
  /** True for reception-desk shifts (coverage + qualification apply); false for
   *  office duty (counts as worked hours, but no desk coverage/qualification). */
  desk: boolean;
  /** Ids of employees who may legally be assigned here (availability + not
   *  blocked by a hard time-off/unavailable request). Mirrors feasibility.ts.
   *  Office-duty instances are restricted to the manager/deputy (rank ≥ 3). */
  eligible: string[];
}

export interface SolverPayload {
  month: string;
  days: string[];
  shiftDefs: { id: string; name: string; startMin: number; durationH: number }[];
  employees: SolverEmployee[];
  instances: SolverInstance[];
  /** Ordered shift pairs (s1 today → s2 tomorrow) that break the rest period,
   *  i.e. start(s2) < start(s1). */
  forbiddenPairs: [string, string][];
  /** Previous month's last calendar day: per-employee earliest start minutes,
   *  for the rest period across the month boundary. */
  boundary: { date: string; perEmployeeStartMin: Record<string, number> };
  consecutive: { maxDays: number; exemptEmployeeIds: string[]; carryIn: Record<string, number> };
  /** [saturday, sunday] pairs, both days in-month. */
  weekends: [string, string][];
  /** Tuesdays in the month (for the manager+deputy-same-shift soft rule). */
  tuesdays: string[];
  /** The qualification-coverage rule, if one is enabled (rank≥minLevel, ≥minCount). */
  qualification: { minLevel: number; minCount: number } | null;
  /** `preferred` requests (soft): satisfied if the employee works one of `dates`
   *  (on one of `shiftDefIds` when given). Each unmet request is penalised W_pref. */
  preferred: { employeeId: string; dates: string[]; shiftDefIds: string[] }[];
  /** Proposed office-duty days (manager/deputy) from the §5 heuristic. The solver
   *  rewards placing the office shift on these (employee, date) pairs (W_office). */
  officeProposals: OfficeProposal[];
  /** Objective weights. W_hours dominates; W_slack is a huge penalty so coverage
   *  slack is used only when a month is genuinely understaffed. `balance` is an
   *  optional max-over-target hours-fairness term (0 = off). */
  weights: {
    hours: number;
    pref: number;
    weekend: number;
    shiftBalance: number;
    mid: number;
    tue: number;
    slack: number;
    balance: number;
  };
}

export const DEFAULT_WEIGHTS = {
  hours: 10,
  pref: 8,
  office: 6,
  weekend: 4,
  shiftBalance: 2,
  mid: 1,
  tue: 1,
  slack: 10000,
  balance: 0,
};

export interface SolverBuildInput {
  month: string;
  employees: Employee[];
  shiftDefs: ShiftDefinition[];
  rules: Rule[];
  requests: ScheduleRequest[];
  prevMonthAssignments: Assignment[];
}

/** Monthly hours of a notional full-time post, used only to derive FTE from the
 *  stored contractHours. The actual monthly norm is computed per-month (art. 130)
 *  in the sidecar — this is NOT a target. */
const FULL_TIME_BASE = 160;

function startMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function durationHours(def: ShiftDefinition): number {
  let mins = startMinutes(def.endTime) - startMinutes(def.startTime);
  if (mins <= 0) mins += 24 * 60;
  return mins / 60;
}

function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function buildSolverPayload(
  input: SolverBuildInput,
  tierRanks: Map<string, Map<string, number>>,
  weightOverrides: Partial<typeof DEFAULT_WEIGHTS> = {},
): SolverPayload {
  const { month } = input;
  const days = datesOfMonth(month);
  const active = input.employees.filter((e) => e.active && e.staffGroup === "reception");
  const receptionDefs = input.shiftDefs.filter((d) => d.staffGroup === "reception");
  const defById = new Map(receptionDefs.map((d) => [d.id, d]));
  const coverageRules = input.rules.filter((r) => r.enabled && r.kind === "coverage");
  const rankOf = (e: Employee) => tierRanks.get(e.staffGroup)?.get(e.qualificationTier) ?? 0;

  // ---- Hard time-off / unavailable → blocked sets (whole-day or per-shift) ----
  const blockedDate = new Set<string>(); // `${employeeId}|${date}`
  const blockedShift = new Set<string>(); // `${employeeId}|${date}|${shiftDefId}`
  const timeOffDays = new Map<string, Set<string>>();
  for (const req of input.requests) {
    if (req.type !== "time-off" && req.type !== "unavailable") continue;
    for (const date of req.dates ?? []) {
      if (req.shiftDefIds?.length) {
        for (const sid of req.shiftDefIds) blockedShift.add(`${req.employeeId}|${date}|${sid}`);
      } else {
        blockedDate.add(`${req.employeeId}|${date}`);
      }
      if (req.type === "time-off") {
        let s = timeOffDays.get(req.employeeId);
        if (!s) timeOffDays.set(req.employeeId, (s = new Set()));
        s.add(date);
      }
    }
  }

  // ---- Employees with FTE + working-day vacation count (norm computed in
  //      the sidecar per art. 130). Only Mon–Fri vacation days reduce the norm. ----
  const employees: SolverEmployee[] = active.map((e) => {
    let workdayVacationDays = 0;
    for (const d of timeOffDays.get(e.id) ?? []) {
      const wd = weekdayOf(d);
      if (wd >= 1 && wd <= 5) workdayVacationDays++;
    }
    return {
      id: e.id,
      name: e.name,
      rank: rankOf(e),
      fte: e.contractHours / FULL_TIME_BASE,
      workdayVacationDays,
    };
  });

  // ---- Shift defs (start minutes + duration) ----
  const shiftDefs = receptionDefs.map((d) => ({
    id: d.id,
    name: d.name,
    startMin: startMinutes(d.startTime),
    durationH: durationHours(d),
  }));

  // ---- Instances with effective min/max + eligible employees ----
  const instances: SolverInstance[] = [];
  for (const date of days) {
    const wd = weekdayOf(date);
    for (const def of receptionDefs) {
      if (!def.weekdays.includes(wd)) continue;
      const desk = def.staffsReception !== false;
      const inst = { date, shiftDefId: def.id, staffGroup: def.staffGroup };
      const { min, max } = effectiveCoverage(inst, def, coverageRules);
      const eligible: string[] = [];
      for (const e of active) {
        // Office duty (B) is for the manager/deputy only (rank ≥ 3); §5 allows
        // exceptions, but the default proposal keeps it to those two roles.
        if (!desk && rankOf(e) < 3) continue;
        const avail = e.defaultAvailability[wd];
        if (avail !== undefined && !avail.includes(def.id)) continue;
        if (blockedDate.has(`${e.id}|${date}`)) continue;
        if (blockedShift.has(`${e.id}|${date}|${def.id}`)) continue;
        eligible.push(e.id);
      }
      instances.push({ date, shiftDefId: def.id, effMin: min, effMax: max, desk, eligible });
    }
  }

  // ---- Rest-period forbidden ordered pairs: start(s2) < start(s1) ----
  const forbiddenPairs: [string, string][] = [];
  for (const a of shiftDefs) {
    for (const b of shiftDefs) {
      if (b.startMin < a.startMin) forbiddenPairs.push([a.id, b.id]);
    }
  }

  // ---- Boundary: previous month's last day, earliest start minutes per emp ----
  const prevLastDay = addDays(`${month}-01`, -1);
  const perEmployeeStartMin: Record<string, number> = {};
  for (const a of input.prevMonthAssignments) {
    if (a.date !== prevLastDay) continue;
    const def = defById.get(a.shiftDefId);
    if (!def) continue;
    const s = startMinutes(def.startTime);
    const cur = perEmployeeStartMin[a.employeeId];
    if (cur === undefined || s < cur) perEmployeeStartMin[a.employeeId] = s;
  }

  // ---- Consecutive-days carry-in: days THIS employee worked ending the day
  //      before the 1st (per-employee, matching the validator). ----
  const prevByEmp = new Map<string, Set<string>>();
  for (const a of input.prevMonthAssignments) {
    let s = prevByEmp.get(a.employeeId);
    if (!s) prevByEmp.set(a.employeeId, (s = new Set()));
    s.add(a.date);
  }
  const maxConsecutiveRule = input.rules.find(
    (r) => r.enabled && r.kind === "max-consecutive-days",
  );
  const carryIn: Record<string, number> = {};
  for (const e of active) {
    const prev = prevByEmp.get(e.id) ?? new Set<string>();
    let count = 0;
    let probe = addDays(`${month}-01`, -1);
    while (prev.has(probe)) {
      count++;
      probe = addDays(probe, -1);
    }
    if (count > 0) carryIn[e.id] = count;
  }
  const consecutive = maxConsecutiveRule
    ? {
        maxDays: (maxConsecutiveRule.params as { maxDays: number }).maxDays,
        exemptEmployeeIds:
          (maxConsecutiveRule.params as { exemptEmployeeIds?: string[] }).exemptEmployeeIds ?? [],
        carryIn,
      }
    : { maxDays: 9999, exemptEmployeeIds: [], carryIn };

  // ---- Whole weekends in-month (Saturday + following Sunday) ----
  const weekends: [string, string][] = [];
  for (const date of days) {
    if (weekdayOf(date) !== 6) continue;
    const sunday = addDays(date, 1);
    if (sunday <= days[days.length - 1]!) weekends.push([date, sunday]);
  }
  const tuesdays = days.filter((d) => weekdayOf(d) === 2);

  // ---- Preferred requests (soft) ----
  const preferred = input.requests
    .filter((r) => r.type === "preferred" && (r.dates?.length ?? 0) > 0)
    .map((r) => ({ employeeId: r.employeeId, dates: r.dates ?? [], shiftDefIds: r.shiftDefIds ?? [] }));

  // ---- Office-day proposals (phase 1, §5 heuristic): manager = rank 4, deputy
  //      = rank 3. Skip days the person is on whole-day time-off/unavailable. ----
  const manager = active.find((e) => rankOf(e) >= 4)?.id ?? null;
  const deputy = active.find((e) => rankOf(e) === 3)?.id ?? null;
  const officeProposals = proposeOfficeDays(month, manager, deputy, (emp, date) =>
    blockedDate.has(`${emp}|${date}`),
  );

  // ---- Qualification-coverage rule (rank≥minLevel, ≥minCount) ----
  const qualRule = input.rules.find((r) => r.enabled && r.kind === "qualification-coverage");
  const qualification = qualRule
    ? {
        minLevel: (qualRule.params as { minQualificationLevel: number }).minQualificationLevel,
        minCount: (qualRule.params as { minCount: number }).minCount,
      }
    : null;

  return {
    month,
    days,
    shiftDefs,
    employees,
    instances,
    forbiddenPairs,
    boundary: { date: prevLastDay, perEmployeeStartMin },
    consecutive,
    weekends,
    tuesdays,
    qualification,
    preferred,
    officeProposals,
    weights: { ...DEFAULT_WEIGHTS, ...weightOverrides },
  };
}
