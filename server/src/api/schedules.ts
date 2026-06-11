import type { Assignment, ScheduleStatus } from "@vet/shared";
import { HttpError, json, readJson, streamJob } from "../http";
import { listEmployees } from "../repos/employees";
import { listShifts } from "../repos/shifts";
import { listEnabledRules } from "../repos/rules";
import { listRequests } from "../repos/requests";
import { rankMap } from "../repos/qualifications";
import {
  assignmentsOf,
  getSchedule,
  listScheduleMonths,
  saveSchedule,
} from "../repos/schedules";
import { validate, type ValidationContext } from "../domain/validator";
import { generateSchedule } from "../ai/generate";
import { generateScheduleViaSolver } from "../solver/run";
import { getSettings } from "../repos/settings";
import type { Route } from "./index";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function buildContext(month: string, assignments: Assignment[]): ValidationContext {
  return {
    month,
    employees: listEmployees(),
    shiftDefs: listShifts(),
    rules: listEnabledRules(),
    requests: listRequests(month),
    assignments,
    tierRanks: rankMap(),
    prevMonthAssignments: assignmentsOf(previousMonth(month)),
  };
}

function statusFor(validation: { valid: boolean }): ScheduleStatus {
  return validation.valid ? "valid" : "has-conflicts";
}

function requireMonth(month: string): void {
  if (!MONTH_RE.test(month)) throw new HttpError(400, "Miesiąc musi być w formacie RRRR-MM");
}

function toCsv(month: string): string {
  const schedule = getSchedule(month);
  if (!schedule) throw new HttpError(404, "Brak grafiku dla tego miesiąca");
  const employees = new Map(listEmployees().map((e) => [e.id, e.name]));
  const shifts = new Map(listShifts().map((s) => [s.id, s.name]));
  const rows = [["Data", "Zmiana", "Pracownik"]];
  for (const a of [...schedule.assignments].sort((x, y) => x.date.localeCompare(y.date))) {
    rows.push([a.date, shifts.get(a.shiftDefId) ?? a.shiftDefId, employees.get(a.employeeId) ?? a.employeeId]);
  }
  return rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\r\n");
}

export const scheduleRoutes: Route[] = [
  { method: "GET", path: "/schedules", handler: () => json(listScheduleMonths()) },
  {
    method: "GET",
    path: "/schedules/:month",
    handler: (_req, p) => {
      requireMonth(p.month!);
      const s = getSchedule(p.month!);
      if (!s) throw new HttpError(404, "Brak grafiku dla tego miesiąca");
      return json(s);
    },
  },
  {
    method: "POST",
    path: "/schedules/:month/generate",
    handler: (_req, p) => {
      requireMonth(p.month!);
      const month = p.month!;
      // Streamed with heartbeats: generation can run for several minutes
      // (slow model + repair attempts) and a plain response would be killed
      // by the connection idle timeout.
      return streamJob(async () => {
        const generateInput = {
          month,
          employees: listEmployees(),
          shiftDefs: listShifts(),
          rules: listEnabledRules(),
          requests: listRequests(month),
          prevMonthAssignments: assignmentsOf(previousMonth(month)),
        };
        // Engine flag: CP-SAT solver (default) or the legacy LLM path.
        const result =
          getSettings().generatorEngine === "llm"
            ? await generateSchedule(generateInput)
            : await generateScheduleViaSolver(generateInput);
        const schedule = saveSchedule(
          month,
          result.assignments,
          statusFor(result.validation),
          result.validation.violations,
        );
        return {
          schedule,
          validation: result.validation,
          attempts: result.attempts,
          feasibility: result.feasibility,
          systemic: result.systemic,
        };
      });
    },
  },
  {
    method: "POST",
    path: "/schedules/:month/validate",
    handler: async (req, p) => {
      requireMonth(p.month!);
      const body = await readJson<{ assignments: Assignment[] }>(req);
      const validation = validate(buildContext(p.month!, body.assignments ?? []));
      return json(validation);
    },
  },
  {
    method: "PUT",
    path: "/schedules/:month",
    handler: async (req, p) => {
      requireMonth(p.month!);
      const body = await readJson<{ assignments: Assignment[] }>(req);
      const assignments = body.assignments ?? [];
      const validation = validate(buildContext(p.month!, assignments));
      const schedule = saveSchedule(p.month!, assignments, statusFor(validation), validation.violations);
      return json({ schedule, validation });
    },
  },
  {
    method: "GET",
    path: "/schedules/:month/export.csv",
    handler: (_req, p) => {
      requireMonth(p.month!);
      const csv = "﻿" + toCsv(p.month!); // BOM for Excel
      return new Response(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="grafik-${p.month}.csv"`,
        },
      });
    },
  },
];
