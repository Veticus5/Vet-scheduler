import { STAFF_GROUPS, type ShiftDefinitionInput } from "@vet/shared";
import { HttpError, json, readJson } from "../http";
import {
  createShift,
  deleteShift,
  listShifts,
  shiftInstancesForMonth,
  updateShift,
} from "../repos/shifts";
import type { Route } from "./index";

const VALID_GROUPS = new Set(STAFF_GROUPS.map((g) => g.key));
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validate(body: any): ShiftDefinitionInput {
  if (!VALID_GROUPS.has(body?.staffGroup)) throw new HttpError(400, "Nieprawidłowa grupa pracownicza");
  if (typeof body.name !== "string" || !body.name.trim()) throw new HttpError(400, "Nazwa zmiany jest wymagana");
  if (!TIME_RE.test(body.startTime) || !TIME_RE.test(body.endTime)) {
    throw new HttpError(400, "Godziny muszą być w formacie HH:MM");
  }
  const weekdays = Array.isArray(body.weekdays) ? body.weekdays.map(Number) : [];
  const min = Number(body.requiredMin ?? 1);
  const max = Number(body.requiredMax ?? min);
  if (max < min) throw new HttpError(400, "Maksymalna obsada nie może być mniejsza niż minimalna");
  return {
    staffGroup: body.staffGroup,
    name: body.name.trim(),
    startTime: body.startTime,
    endTime: body.endTime,
    weekdays,
    requiredMin: min,
    requiredMax: max,
    // Office duty when explicitly false; defaults to staffing the reception desk.
    staffsReception: body.staffsReception !== false,
  };
}

export const shiftRoutes: Route[] = [
  { method: "GET", path: "/shifts", handler: () => json(listShifts()) },
  {
    method: "POST",
    path: "/shifts",
    handler: async (req) => json(createShift(validate(await readJson(req))), 201),
  },
  {
    method: "PUT",
    path: "/shifts/:id",
    handler: async (req, p) => {
      const updated = updateShift(p.id!, validate(await readJson(req)));
      if (!updated) throw new HttpError(404, "Nie znaleziono definicji zmiany");
      return json(updated);
    },
  },
  {
    method: "DELETE",
    path: "/shifts/:id",
    handler: (_req, p) => {
      if (!deleteShift(p.id!)) throw new HttpError(404, "Nie znaleziono definicji zmiany");
      return json({ ok: true });
    },
  },
  {
    method: "GET",
    path: "/shifts/instances/:month",
    handler: (req, p) => {
      const group = new URL(req.url).searchParams.get("group") ?? undefined;
      return json(shiftInstancesForMonth(p.month!, group));
    },
  },
];
