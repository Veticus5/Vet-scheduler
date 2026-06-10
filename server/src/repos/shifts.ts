import type { ShiftDefinition, ShiftDefinitionInput, ShiftInstance } from "@vet/shared";
import { getDb } from "../db";
import { newId } from "../http";
import { expandInstances } from "../domain/calendar";

interface Row {
  id: string;
  staff_group: string;
  name: string;
  start_time: string;
  end_time: string;
  weekdays: string;
  required_min: number;
  required_max: number;
  staffs_reception: number;
}

function toShift(r: Row): ShiftDefinition {
  return {
    id: r.id,
    staffGroup: r.staff_group as ShiftDefinition["staffGroup"],
    name: r.name,
    startTime: r.start_time,
    endTime: r.end_time,
    weekdays: JSON.parse(r.weekdays),
    requiredMin: r.required_min,
    requiredMax: r.required_max,
    staffsReception: r.staffs_reception !== 0,
  };
}

export function listShifts(): ShiftDefinition[] {
  return getDb()
    .query<Row, []>("SELECT * FROM shift_definitions ORDER BY staff_group, start_time")
    .all()
    .map(toShift);
}

export function getShift(id: string): ShiftDefinition | null {
  const r = getDb().query<Row, [string]>("SELECT * FROM shift_definitions WHERE id = ?").get(id);
  return r ? toShift(r) : null;
}

export function createShift(input: ShiftDefinitionInput): ShiftDefinition {
  const id = newId();
  getDb()
    .query(
      `INSERT INTO shift_definitions (id, staff_group, name, start_time, end_time, weekdays, required_min, required_max, staffs_reception)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.staffGroup,
      input.name,
      input.startTime,
      input.endTime,
      JSON.stringify(input.weekdays ?? []),
      input.requiredMin,
      input.requiredMax,
      input.staffsReception === false ? 0 : 1,
    );
  return getShift(id)!;
}

export function updateShift(id: string, input: ShiftDefinitionInput): ShiftDefinition | null {
  if (!getShift(id)) return null;
  getDb()
    .query(
      `UPDATE shift_definitions SET staff_group = ?, name = ?, start_time = ?, end_time = ?, weekdays = ?, required_min = ?, required_max = ?, staffs_reception = ?
       WHERE id = ?`,
    )
    .run(
      input.staffGroup,
      input.name,
      input.startTime,
      input.endTime,
      JSON.stringify(input.weekdays ?? []),
      input.requiredMin,
      input.requiredMax,
      input.staffsReception === false ? 0 : 1,
      id,
    );
  return getShift(id);
}

export function deleteShift(id: string): boolean {
  return getDb().query("DELETE FROM shift_definitions WHERE id = ?").run(id).changes > 0;
}

/**
 * Expand shift definitions into concrete instances for a month (YYYY-MM),
 * optionally limited to a staff group. A definition produces one instance per
 * matching weekday in the month.
 */
export function shiftInstancesForMonth(month: string, group?: string): ShiftInstance[] {
  return expandInstances(listShifts(), month, group);
}
