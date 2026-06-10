import type {
  Employee,
  EmployeeInput,
  Rule,
  RuleInput,
  Schedule,
  ScheduleRequest,
  ScheduleRequestInput,
  Settings,
  ShiftDefinition,
  ShiftDefinitionInput,
  StaffGroup,
  StaffGroupKey,
  QualificationTier,
  ValidationResult,
  Assignment,
} from "@vet/shared";

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let message = `Błąd ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * POST that returns an NDJSON heartbeat stream (see server `streamJob`).
 * Ignores `{"t":"ping"}` keep-alives, returns the `result`, throws on `error`.
 */
async function reqStream<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { method: "POST" });
  if (!res.ok || !res.body) {
    // Error happened before streaming began (e.g. validation 4xx) — plain JSON.
    let message = `Błąd ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let result: T | undefined;
  let hasResult = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as { t: string; result?: T; error?: string };
      if (msg.t === "ping") continue;
      if (msg.t === "error") throw new Error(msg.error ?? "Błąd serwera");
      if (msg.t === "result") {
        result = msg.result;
        hasResult = true;
      }
    }
    if (done) break;
  }
  if (!hasResult) throw new Error("Połączenie z serwerem przerwane przed zakończeniem generowania.");
  return result as T;
}

export const api = {
  // settings
  getSettings: () => req<Settings>("GET", "/settings"),
  updateSettings: (p: { aiModel?: string; maxRepairAttempts?: number }) =>
    req<Settings>("PUT", "/settings", p),
  setApiKey: (apiKey: string) => req<Settings>("PUT", "/settings/api-key", { apiKey }),

  // staff groups + employees
  staffGroups: () => req<StaffGroup[]>("GET", "/staff-groups"),
  qualifications: () => req<Record<StaffGroupKey, QualificationTier[]>>("GET", "/qualifications"),
  employees: () => req<Employee[]>("GET", "/employees"),
  createEmployee: (e: EmployeeInput) => req<Employee>("POST", "/employees", e),
  updateEmployee: (id: string, e: EmployeeInput) => req<Employee>("PUT", `/employees/${id}`, e),
  deleteEmployee: (id: string) => req<{ ok: true }>("DELETE", `/employees/${id}`),

  // shift definitions
  shifts: () => req<ShiftDefinition[]>("GET", "/shifts"),
  createShift: (s: ShiftDefinitionInput) => req<ShiftDefinition>("POST", "/shifts", s),
  updateShift: (id: string, s: ShiftDefinitionInput) => req<ShiftDefinition>("PUT", `/shifts/${id}`, s),
  deleteShift: (id: string) => req<{ ok: true }>("DELETE", `/shifts/${id}`),

  // rules
  rules: () => req<Rule[]>("GET", "/rules"),
  draftRulesFromText: (text: string) => req<RuleInput[]>("POST", "/rules/draft-from-text", { text }),
  createRule: (r: RuleInput) => req<Rule>("POST", "/rules", r),
  updateRule: (id: string, r: RuleInput) => req<Rule>("PUT", `/rules/${id}`, r),
  setRuleEnabled: (id: string, enabled: boolean) => req<Rule>("POST", `/rules/${id}/enabled`, { enabled }),
  deleteRule: (id: string) => req<{ ok: true }>("DELETE", `/rules/${id}`),

  // monthly requests
  requests: (month: string) => req<ScheduleRequest[]>("GET", `/requests/${month}`),
  draftRequestsFromText: (text: string, month: string) =>
    req<ScheduleRequestInput[]>("POST", "/requests/draft-from-text", { text, month }),
  createRequest: (r: ScheduleRequestInput) => req<ScheduleRequest>("POST", "/requests", r),
  updateRequest: (id: string, r: ScheduleRequestInput) => req<ScheduleRequest>("PUT", `/requests/${id}`, r),
  deleteRequest: (id: string) => req<{ ok: true }>("DELETE", `/requests/${id}`),

  // schedules
  scheduleMonths: () => req<string[]>("GET", "/schedules"),
  schedule: (month: string) => req<Schedule>("GET", `/schedules/${month}`),
  generate: (month: string) =>
    reqStream<{ schedule: Schedule; validation: ValidationResult; attempts: number }>(
      `/schedules/${month}/generate`,
    ),
  saveSchedule: (month: string, assignments: Assignment[]) =>
    req<{ schedule: Schedule; validation: ValidationResult }>("PUT", `/schedules/${month}`, { assignments }),
  validateSchedule: (month: string, assignments: Assignment[]) =>
    req<ValidationResult>("POST", `/schedules/${month}/validate`, { assignments }),
  exportCsvUrl: (month: string) => `/api/schedules/${month}/export.csv`,
};
