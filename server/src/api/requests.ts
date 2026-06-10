import type { RequestType, ScheduleRequestInput, Weekday } from "@vet/shared";
import { HttpError, json, readJson } from "../http";
import {
  createRequest,
  deleteRequest,
  listRequests,
  updateRequest,
} from "../repos/requests";
import { draftRequestsFromText } from "../ai/draft-requests";
import type { Route } from "./index";

const VALID_TYPES: RequestType[] = ["time-off", "unavailable", "preferred", "freeform"];
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Parse a weekday recurrence, keeping only unique integers in 0..6. */
function parseRecurrence(raw: any): ScheduleRequestInput["recurrence"] {
  if (!raw || !Array.isArray(raw.weekdays)) return undefined;
  const weekdays = [
    ...new Set(
      raw.weekdays.filter(
        (d: unknown): d is number => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6,
      ),
    ),
  ];
  return weekdays.length ? { weekdays: weekdays as Weekday[] } : undefined;
}

function validate(body: any): ScheduleRequestInput {
  if (!MONTH_RE.test(body?.month)) throw new HttpError(400, "Miesiąc musi być w formacie RRRR-MM");
  if (typeof body.employeeId !== "string" || !body.employeeId) throw new HttpError(400, "Pracownik jest wymagany");
  if (!VALID_TYPES.includes(body.type)) throw new HttpError(400, "Nieprawidłowy typ prośby");
  return {
    month: body.month,
    employeeId: body.employeeId,
    type: body.type,
    dates: Array.isArray(body.dates) ? body.dates : undefined,
    recurrence: parseRecurrence(body.recurrence),
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
    // Draft requests from a free-form description via AI. Returns
    // ScheduleRequestInput[] for the user to review — never writes to the database.
    method: "POST",
    path: "/requests/draft-from-text",
    handler: async (req) => {
      const body = await readJson<{ text?: string; month?: string }>(req);
      if (!MONTH_RE.test(body?.month ?? "")) throw new HttpError(400, "Miesiąc musi być w formacie RRRR-MM");
      if (typeof body?.text !== "string" || !body.text.trim()) {
        throw new HttpError(400, "Podaj opis prośby do przekształcenia.");
      }
      return json(await draftRequestsFromText(body.text, body.month!));
    },
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
