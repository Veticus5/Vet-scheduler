import type { Employee, EmployeeInput } from "@vet/shared";
import { getDb } from "../db";
import { newId } from "../http";

interface Row {
  id: string;
  name: string;
  staff_group: string;
  qualification_tier: string;
  contract_hours: number;
  default_availability: string;
  active: number;
}

function toEmployee(r: Row): Employee {
  return {
    id: r.id,
    name: r.name,
    staffGroup: r.staff_group as Employee["staffGroup"],
    qualificationTier: r.qualification_tier,
    contractHours: r.contract_hours,
    defaultAvailability: JSON.parse(r.default_availability),
    active: !!r.active,
  };
}

export function listEmployees(): Employee[] {
  return getDb()
    .query<Row, []>("SELECT * FROM employees ORDER BY name")
    .all()
    .map(toEmployee);
}

export function getEmployee(id: string): Employee | null {
  const r = getDb().query<Row, [string]>("SELECT * FROM employees WHERE id = ?").get(id);
  return r ? toEmployee(r) : null;
}

export function createEmployee(input: EmployeeInput): Employee {
  const id = newId();
  getDb()
    .query(
      `INSERT INTO employees (id, name, staff_group, qualification_tier, contract_hours, default_availability, active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.staffGroup,
      input.qualificationTier,
      input.contractHours,
      JSON.stringify(input.defaultAvailability ?? {}),
      input.active ? 1 : 0,
    );
  return getEmployee(id)!;
}

export function updateEmployee(id: string, input: EmployeeInput): Employee | null {
  const existing = getEmployee(id);
  if (!existing) return null;
  getDb()
    .query(
      `UPDATE employees SET name = ?, staff_group = ?, qualification_tier = ?, contract_hours = ?, default_availability = ?, active = ?
       WHERE id = ?`,
    )
    .run(
      input.name,
      input.staffGroup,
      input.qualificationTier,
      input.contractHours,
      JSON.stringify(input.defaultAvailability ?? {}),
      input.active ? 1 : 0,
      id,
    );
  return getEmployee(id);
}

export function deleteEmployee(id: string): boolean {
  const res = getDb().query("DELETE FROM employees WHERE id = ?").run(id);
  return res.changes > 0;
}
