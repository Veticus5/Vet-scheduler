import { error, HttpError, json, readJson } from "../http";
import { getSettings, setApiKey, updateSettings } from "../repos/settings";
import { employeeRoutes } from "./employees";
import { shiftRoutes } from "./shifts";
import { ruleRoutes } from "./rules";
import { requestRoutes } from "./requests";
import { scheduleRoutes } from "./schedules";

export type Handler = (
  req: Request,
  params: Record<string, string>,
) => Response | Promise<Response>;

export interface Route {
  method: string;
  /** Path under /api, e.g. "/employees/:id". */
  path: string;
  handler: Handler;
}

const routes: Route[] = [
  { method: "GET", path: "/health", handler: () => json({ ok: true }) },

  { method: "GET", path: "/settings", handler: () => json(getSettings()) },
  {
    method: "PUT",
    path: "/settings",
    handler: async (req) => {
      const body = await readJson<{ aiModel?: string; maxRepairAttempts?: number }>(req);
      updateSettings(body);
      return json(getSettings());
    },
  },
  {
    method: "PUT",
    path: "/settings/api-key",
    handler: async (req) => {
      const body = await readJson<{ apiKey?: string }>(req);
      if (!body.apiKey || !body.apiKey.trim()) throw new HttpError(400, "Klucz API jest wymagany");
      setApiKey(body.apiKey);
      return json(getSettings());
    },
  },

  ...employeeRoutes,
  ...shiftRoutes,
  ...ruleRoutes,
  ...requestRoutes,
  ...scheduleRoutes,
];

function match(routePath: string, actual: string): Record<string, string> | null {
  const rp = routePath.split("/").filter(Boolean);
  const ap = actual.split("/").filter(Boolean);
  if (rp.length !== ap.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < rp.length; i++) {
    const seg = rp[i]!;
    if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(ap[i]!);
    else if (seg !== ap[i]) return null;
  }
  return params;
}

/** Handle an /api/* request. Returns null if the path is not an API route. */
export async function handleApi(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/api/")) return null;
  const subPath = url.pathname.slice(4); // strip "/api"

  let pathMatched = false;
  for (const route of routes) {
    const params = match(route.path, subPath);
    if (!params) continue;
    pathMatched = true;
    if (route.method !== req.method) continue;
    try {
      return await route.handler(req, params);
    } catch (e) {
      if (e instanceof HttpError) return error(e.message, e.status);
      console.error("API error:", e);
      return error(e instanceof Error ? e.message : "Błąd serwera", 500);
    }
  }
  return error(pathMatched ? "Metoda niedozwolona" : "Nie znaleziono", pathMatched ? 405 : 404);
}
