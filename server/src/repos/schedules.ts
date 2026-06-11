import type { Assignment, Schedule, ScheduleStatus, Violation } from "@vet/shared";
import { getDb } from "../db";
import { newId } from "../http";

interface ScheduleRow {
  id: string;
  month: string;
  status: string;
  violations: string;
  created_at: string;
  updated_at: string;
}

function loadAssignments(scheduleId: string): Assignment[] {
  return getDb()
    .query<{ date: string; shift_def_id: string; employee_id: string }, [string]>(
      "SELECT date, shift_def_id, employee_id FROM assignments WHERE schedule_id = ? ORDER BY date",
    )
    .all(scheduleId)
    .map((r) => ({ date: r.date, shiftDefId: r.shift_def_id, employeeId: r.employee_id }));
}

function toSchedule(r: ScheduleRow): Schedule {
  return {
    id: r.id,
    month: r.month,
    status: r.status as ScheduleStatus,
    assignments: loadAssignments(r.id),
    violations: JSON.parse(r.violations),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function getSchedule(month: string): Schedule | null {
  const r = getDb().query<ScheduleRow, [string]>("SELECT * FROM schedules WHERE month = ?").get(month);
  return r ? toSchedule(r) : null;
}

export function listScheduleMonths(): string[] {
  return getDb()
    .query<{ month: string }, []>("SELECT month FROM schedules ORDER BY month DESC")
    .all()
    .map((r) => r.month);
}

/** Upsert the schedule for a month, replacing its assignments atomically. */
export function saveSchedule(
  month: string,
  assignments: Assignment[],
  status: ScheduleStatus,
  violations: Violation[],
): Schedule {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.query<ScheduleRow, [string]>("SELECT * FROM schedules WHERE month = ?").get(month);
  const id = existing?.id ?? newId();

  const tx = db.transaction(() => {
    if (existing) {
      db.query("UPDATE schedules SET status = ?, violations = ?, updated_at = ? WHERE id = ?").run(
        status,
        JSON.stringify(violations),
        now,
        id,
      );
    } else {
      db.query(
        "INSERT INTO schedules (id, month, status, violations, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(id, month, status, JSON.stringify(violations), now, now);
    }
    db.query("DELETE FROM assignments WHERE schedule_id = ?").run(id);
    const ins = db.query(
      "INSERT OR IGNORE INTO assignments (schedule_id, date, shift_def_id, employee_id) VALUES (?, ?, ?, ?)",
    );
    for (const a of assignments) ins.run(id, a.date, a.shiftDefId, a.employeeId);
  });
  tx();

  return getSchedule(month)!;
}

/** Saved assignments of a month (for cross-month carryover: consecutive-days
 *  and rest-period across the boundary). Empty if the month has no schedule. */
export function assignmentsOf(month: string): Assignment[] {
  return getSchedule(month)?.assignments ?? [];
}
