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

export const api = {
  // settings
  getSettings: () => req<Settings>("GET", "/settings"),
  updateSettings: (p: { aiModel?: string; maxRepairAttempts?: number }) =>
    req<Settings>("PUT", "/settings", p),
  setApiKey: (apiKey: string) => req<Settings>("PUT", "/settings/api-key", { apiKey }),

  // staff groups + employees
  staffGroups: () => req<StaffGroup[]>("GET", "/staff-groups"),
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
  createRule: (r: RuleInput) => req<Rule>("POST", "/rules", r),
  updateRule: (id: string, r: RuleInput) => req<Rule>("PUT", `/rules/${id}`, r),
  setRuleEnabled: (id: string, enabled: boolean) => req<Rule>("POST", `/rules/${id}/enabled`, { enabled }),
  deleteRule: (id: string) => req<{ ok: true }>("DELETE", `/rules/${id}`),

  // monthly requests
  requests: (month: string) => req<ScheduleRequest[]>("GET", `/requests/${month}`),
  createRequest: (r: ScheduleRequestInput) => req<ScheduleRequest>("POST", "/requests", r),
  updateRequest: (id: string, r: ScheduleRequestInput) => req<ScheduleRequest>("PUT", `/requests/${id}`, r),
  deleteRequest: (id: string) => req<{ ok: true }>("DELETE", `/requests/${id}`),

  // schedules
  scheduleMonths: () => req<string[]>("GET", "/schedules"),
  schedule: (month: string) => req<Schedule>("GET", `/schedules/${month}`),
  generate: (month: string) =>
    req<{ schedule: Schedule; validation: ValidationResult; attempts: number }>(
      "POST",
      `/schedules/${month}/generate`,
    ),
  saveSchedule: (month: string, assignments: Assignment[]) =>
    req<{ schedule: Schedule; validation: ValidationResult }>("PUT", `/schedules/${month}`, { assignments }),
  validateSchedule: (month: string, assignments: Assignment[]) =>
    req<ValidationResult>("POST", `/schedules/${month}/validate`, { assignments }),
  exportCsvUrl: (month: string) => `/api/schedules/${month}/export.csv`,
};
