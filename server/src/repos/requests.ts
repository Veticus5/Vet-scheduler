import type { ScheduleRequest, ScheduleRequestInput } from "@vet/shared";
import { getDb } from "../db";
import { newId } from "../http";
import { expandRecurrence } from "../domain/calendar";

/**
 * Effective concrete dates for a request. When a weekday recurrence is present
 * it is the single source of truth: `dates` is (re)generated from it within the
 * month, so the validator/generation read consistent dates regardless of how
 * the request was authored.
 */
function resolveDates(input: ScheduleRequestInput): string[] | undefined {
  if (input.recurrence && input.recurrence.weekdays.length) {
    return expandRecurrence(input.month, input.recurrence.weekdays);
  }
  return input.dates;
}

interface Row {
  id: string;
  month: string;
  employee_id: string;
  type: string;
  dates: string | null;
  recurrence: string | null;
  shift_def_ids: string | null;
  text: string | null;
}

function toRequest(r: Row): ScheduleRequest {
  return {
    id: r.id,
    month: r.month,
    employeeId: r.employee_id,
    type: r.type as ScheduleRequest["type"],
    dates: r.dates ? JSON.parse(r.dates) : undefined,
    recurrence: r.recurrence ? JSON.parse(r.recurrence) : undefined,
    shiftDefIds: r.shift_def_ids ? JSON.parse(r.shift_def_ids) : undefined,
    text: r.text ?? undefined,
  };
}

export function listRequests(month: string): ScheduleRequest[] {
  return getDb()
    .query<Row, [string]>("SELECT * FROM requests WHERE month = ? ORDER BY employee_id")
    .all(month)
    .map(toRequest);
}

export function getRequest(id: string): ScheduleRequest | null {
  const r = getDb().query<Row, [string]>("SELECT * FROM requests WHERE id = ?").get(id);
  return r ? toRequest(r) : null;
}

export function createRequest(input: ScheduleRequestInput): ScheduleRequest {
  const id = newId();
  const dates = resolveDates(input);
  getDb()
    .query(
      `INSERT INTO requests (id, month, employee_id, type, dates, recurrence, shift_def_ids, text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.month,
      input.employeeId,
      input.type,
      dates ? JSON.stringify(dates) : null,
      input.recurrence ? JSON.stringify(input.recurrence) : null,
      input.shiftDefIds ? JSON.stringify(input.shiftDefIds) : null,
      input.text ?? null,
    );
  return getRequest(id)!;
}

export function updateRequest(id: string, input: ScheduleRequestInput): ScheduleRequest | null {
  if (!getRequest(id)) return null;
  const dates = resolveDates(input);
  getDb()
    .query(
      `UPDATE requests SET month = ?, employee_id = ?, type = ?, dates = ?, recurrence = ?, shift_def_ids = ?, text = ?
       WHERE id = ?`,
    )
    .run(
      input.month,
      input.employeeId,
      input.type,
      dates ? JSON.stringify(dates) : null,
      input.recurrence ? JSON.stringify(input.recurrence) : null,
      input.shiftDefIds ? JSON.stringify(input.shiftDefIds) : null,
      input.text ?? null,
      id,
    );
  return getRequest(id);
}

export function deleteRequest(id: string): boolean {
  return getDb().query("DELETE FROM requests WHERE id = ?").run(id).changes > 0;
}
