import { STAFF_GROUPS, tierRank, type EmployeeInput } from "@vet/shared";
import { HttpError, json, readJson } from "../http";
import {
  createEmployee,
  deleteEmployee,
  getEmployee,
  listEmployees,
  updateEmployee,
} from "../repos/employees";
import { listTiers } from "../repos/qualifications";
import type { Route } from "./index";

const VALID_GROUPS = new Set(STAFF_GROUPS.map((g) => g.key));

function validate(body: any): EmployeeInput {
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    throw new HttpError(400, "Imię i nazwisko są wymagane");
  }
  if (!VALID_GROUPS.has(body.staffGroup)) {
    throw new HttpError(400, "Nieprawidłowa grupa pracownicza");
  }
  const tier = String(body.qualificationTier ?? "");
  if (tierRank(body.staffGroup, tier) === undefined) {
    throw new HttpError(400, "Wybrana kwalifikacja nie należy do grupy pracownika");
  }
  return {
    name: body.name.trim(),
    staffGroup: body.staffGroup,
    qualificationTier: tier,
    contractHours: Number(body.contractHours ?? 0),
    defaultAvailability: body.defaultAvailability ?? {},
    active: body.active ?? true,
  };
}

export const employeeRoutes: Route[] = [
  { method: "GET", path: "/staff-groups", handler: () => json(STAFF_GROUPS) },
  { method: "GET", path: "/qualifications", handler: () => json(listTiers()) },

  { method: "GET", path: "/employees", handler: () => json(listEmployees()) },
  {
    method: "POST",
    path: "/employees",
    handler: async (req) => json(createEmployee(validate(await readJson(req))), 201),
  },
  {
    method: "GET",
    path: "/employees/:id",
    handler: (_req, p) => {
      const e = getEmployee(p.id!);
      if (!e) throw new HttpError(404, "Nie znaleziono pracownika");
      return json(e);
    },
  },
  {
    method: "PUT",
    path: "/employees/:id",
    handler: async (req, p) => {
      const updated = updateEmployee(p.id!, validate(await readJson(req)));
      if (!updated) throw new HttpError(404, "Nie znaleziono pracownika");
      return json(updated);
    },
  },
  {
    method: "DELETE",
    path: "/employees/:id",
    handler: (_req, p) => {
      if (!deleteEmployee(p.id!)) throw new HttpError(404, "Nie znaleziono pracownika");
      return json({ ok: true });
    },
  },
];
