import type { RequestType, ScheduleRequestInput } from "@vet/shared";
import { HttpError, json, readJson } from "../http";
import {
  createRequest,
  deleteRequest,
  listRequests,
  updateRequest,
} from "../repos/requests";
import type { Route } from "./index";

const VALID_TYPES: RequestType[] = ["time-off", "unavailable", "preferred", "freeform"];
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function validate(body: any): ScheduleRequestInput {
  if (!MONTH_RE.test(body?.month)) throw new HttpError(400, "Miesiąc musi być w formacie RRRR-MM");
  if (typeof body.employeeId !== "string" || !body.employeeId) throw new HttpError(400, "Pracownik jest wymagany");
  if (!VALID_TYPES.includes(body.type)) throw new HttpError(400, "Nieprawidłowy typ prośby");
  return {
    month: body.month,
    employeeId: body.employeeId,
    type: body.type,
    dates: Array.isArray(body.dates) ? body.dates : undefined,
    shiftDefIds: Array.isArray(body.shiftDefIds) ? body.shiftDefIds : undefined,
    text: typeof body.text === "string" ? body.text : undefined,
  };
}

export const requestRoutes: Route[] = [
  {
    method: "GET",
    path: "/requests/:month",
    handler: (_req, p) => json(listRequests(p.month!)),
  },
  {
    method: "POST",
    path: "/requests",
    handler: async (req) => json(createRequest(validate(await readJson(req))), 201),
  },
  {
    method: "PUT",
    path: "/requests/:id",
    handler: async (req, p) => {
      const updated = updateRequest(p.id!, validate(await readJson(req)));
      if (!updated) throw new HttpError(404, "Nie znaleziono prośby");
      return json(updated);
    },
  },
  {
    method: "DELETE",
    path: "/requests/:id",
    handler: (_req, p) => {
      if (!deleteRequest(p.id!)) throw new HttpError(404, "Nie znaleziono prośby");
      return json({ ok: true });
    },
  },
];
