import type {
  Assignment,
  Employee,
  PreferenceReport,
  Rule,
  RuleParamsCoverage,
  RuleParamsMaxConsecutiveDays,
  RuleParamsPairing,
  RuleParamsQualificationCoverage,
  RuleScope,
  ScheduleRequest,
  ShiftDefinition,
  ShiftInstance,
  StaffGroupKey,
  ValidationResult,
  Violation,
} from "@vet/shared";
import { expandInstances } from "./calendar";

export interface ValidationContext {
  month: string;
  employees: Employee[];
  shiftDefs: ShiftDefinition[];
  rules: Rule[];
  requests: ScheduleRequest[];
  assignments: Assignment[];
  /** group → (tier key → rank), used to resolve qualification thresholds.
   *  Absent map / unknown tier resolves to rank 0. */
  tierRanks?: Map<StaffGroupKey, Map<string, number>>;
  /** Worked dates (YYYY-MM-DD) at the tail of the previous month, for the
   *  cross-month consecutive-days check. */
  prevMonthWorkedDates?: string[];
}

interface InstanceKey {
  date: string;
  shiftDefId: string;
}

function instanceId(k: InstanceKey): string {
  return `${k.date}|${k.shiftDefId}`;
}

function scopeGroups(scope: RuleScope): StaffGroupKey[] {
  return scope.type === "group" ? [scope.group] : scope.groups;
}

/**
 * Deterministic source of truth for schedule correctness. Hard rules and
 * hard requests (time-off / unavailable) produce violations; soft rules and
 * preferred requests produce informational unmet-preferences.
 */
export function validate(ctx: ValidationContext): ValidationResult {
  const violations: Violation[] = [];
  const unmet: PreferenceReport[] = [];

  const empById = new Map(ctx.employees.map((e) => [e.id, e]));
  const instances = expandInstances(ctx.shiftDefs, ctx.month);

  // Reception-desk coverage (built-in, pairing, qualification) counts only
  // shifts that staff the desk; office-duty shifts are worked time but not
  // desk presence. `max-consecutive-days` and hours still include office duty.
  const defById = new Map(ctx.shiftDefs.map((d) => [d.id, d]));
  const deskInstances = instances.filter(
    (i) => defById.get(i.shiftDefId)?.staffsReception !== false,
  );

  // assignments grouped per shift instance
  const byInstance = new Map<string, Assignment[]>();
  for (const a of ctx.assignments) {
    const key = instanceId(a);
    (byInstance.get(key) ?? byInstance.set(key, []).get(key)!).push(a);
  }
  const assignedAt = (inst: ShiftInstance): Employee[] =>
    (byInstance.get(instanceId(inst)) ?? [])
      .map((a) => empById.get(a.employeeId))
      .filter((e): e is Employee => !!e);

  // Resolve an employee's tier to its rank within their group (0 if unknown).
  const rankOf = (e: Employee): number =>
    ctx.tierRanks?.get(e.staffGroup)?.get(e.qualificationTier) ?? 0;

  // ---- Hard requests: time-off / unavailable ----
  validateRequests(ctx, violations, unmet);

  // ---- Built-in coverage from shift definitions, with coverage-rule overrides ----
  validateCoverage(ctx, instances, assignedAt, violations);

  // ---- Per-rule checks ----
  for (const rule of ctx.rules) {
    if (!rule.enabled || rule.kind === "freeform") continue;
    const groups = new Set(scopeGroups(rule.scope));
    const inScope = (inst: ShiftInstance) => groups.has(inst.staffGroup);
    const sink = rule.hard ? violations : null;
    const fail = (v: Omit<Violation, "ruleId" | "ruleName" | "kind">) => {
      if (sink) sink.push({ ...v, ruleId: rule.id, ruleName: rule.name, kind: rule.kind });
      else unmet.push({ ruleId: rule.id, ruleName: rule.name, message: v.message });
    };

    switch (rule.kind) {
      case "pairing":
        checkPairing(rule, deskInstances, inScope, assignedAt, rankOf, fail);
        break;
      case "qualification-coverage":
        checkQualificationCoverage(rule, deskInstances, inScope, assignedAt, rankOf, fail);
        break;
      case "max-consecutive-days":
        checkMaxConsecutive(rule, ctx, groups, fail);
        break;
      // `coverage` overrides are handled in validateCoverage above.
      case "coverage":
        break;
    }
  }

  return { valid: violations.length === 0, violations, unmetPreferences: unmet };
}

function validateRequests(
  ctx: ValidationContext,
  violations: Violation[],
  unmet: PreferenceReport[],
): void {
  const empById = new Map(ctx.employees.map((e) => [e.id, e]));
  const worked = new Set(ctx.assignments.map((a) => `${a.employeeId}|${a.date}`));
  const workedShift = new Set(ctx.assignments.map((a) => `${a.employeeId}|${a.date}|${a.shiftDefId}`));

  for (const req of ctx.requests) {
    const emp = empById.get(req.employeeId);
    const who = emp?.name ?? req.employeeId;
    if (req.type === "time-off" || req.type === "unavailable") {
      for (const date of req.dates ?? []) {
        const hit = req.shiftDefIds?.length
          ? req.shiftDefIds.some((sid) => workedShift.has(`${req.employeeId}|${date}|${sid}`))
          : worked.has(`${req.employeeId}|${date}`);
        if (hit) {
          violations.push({
            kind: "time-off",
            ruleName: req.type === "time-off" ? "Wolne (prośba)" : "Niedostępność (prośba)",
            message: `${who} jest przydzielony(a) ${date}, mimo prośby o wolne/niedostępność.`,
            date,
            employeeId: req.employeeId,
          });
        }
      }
    } else if (req.type === "preferred") {
      const got = (req.dates ?? []).some((d) => worked.has(`${req.employeeId}|${d}`));
      if ((req.dates?.length ?? 0) > 0 && !got) {
        unmet.push({
          ruleName: "Preferencja (prośba)",
          message: `${who}: nie spełniono preferowanych dni (${(req.dates ?? []).join(", ")}).`,
        });
      }
    }
  }
}

function effectiveCoverage(
  inst: ShiftInstance,
  def: ShiftDefinition,
  coverageRules: Rule[],
): { min: number; max: number } {
  let min = def.requiredMin;
  let max = def.requiredMax;
  for (const r of coverageRules) {
    if (!scopeGroups(r.scope).includes(inst.staffGroup)) continue;
    const p = r.params as RuleParamsCoverage;
    const wd = new Date(inst.date + "T00:00:00").getDay();
    if (p.weekdays?.length && !p.weekdays.includes(wd as any)) continue;
    if (p.shiftDefIds?.length && !p.shiftDefIds.includes(inst.shiftDefId)) continue;
    if (p.min !== undefined) min = p.min;
    if (p.max !== undefined) max = p.max;
  }
  return { min, max };
}

function validateCoverage(
  ctx: ValidationContext,
  instances: ShiftInstance[],
  assignedAt: (i: ShiftInstance) => Employee[],
  violations: Violation[],
): void {
  const defById = new Map(ctx.shiftDefs.map((d) => [d.id, d]));
  const coverageRules = ctx.rules.filter((r) => r.enabled && r.kind === "coverage");
  for (const inst of instances) {
    const def = defById.get(inst.shiftDefId);
    if (!def) continue;
    // Office-duty shifts do not staff the reception desk → not counted here.
    if (def.staffsReception === false) continue;
    const { min, max } = effectiveCoverage(inst, def, coverageRules);
    const count = assignedAt(inst).length;
    if (count < min) {
      violations.push({
        kind: "coverage",
        ruleName: "Obsada zmiany",
        message: `${inst.date} ${def.name}: ${count} os. (wymagane min. ${min}).`,
        date: inst.date,
        shiftDefId: inst.shiftDefId,
      });
    } else if (count > max) {
      violations.push({
        kind: "coverage",
        ruleName: "Obsada zmiany",
        message: `${inst.date} ${def.name}: ${count} os. (dozwolone max. ${max}).`,
        date: inst.date,
        shiftDefId: inst.shiftDefId,
      });
    }
  }
}

function checkPairing(
  rule: Rule,
  instances: ShiftInstance[],
  inScope: (i: ShiftInstance) => boolean,
  assignedAt: (i: ShiftInstance) => Employee[],
  rankOf: (e: Employee) => number,
  fail: (v: Omit<Violation, "ruleId" | "ruleName" | "kind">) => void,
): void {
  const p = rule.params as RuleParamsPairing;
  const withGroups = new Set(p.withGroup);
  for (const inst of instances) {
    if (!inScope(inst)) continue;
    const present = assignedAt(inst);
    const subjects = present.filter(
      (e) =>
        (p.employeeId && e.id === p.employeeId) ||
        (p.minQualificationLevel !== undefined && rankOf(e) >= p.minQualificationLevel),
    );
    if (subjects.length === 0) continue;
    const hasPartner = present.some((e) => withGroups.has(e.staffGroup) && !subjects.includes(e));
    if (!hasPartner) {
      fail({
        message: `${inst.date}: ${subjects.map((s) => s.name).join(", ")} bez wymaganej pary (${[...withGroups].join(", ")}).`,
        date: inst.date,
        shiftDefId: inst.shiftDefId,
      });
    }
  }
}

function checkQualificationCoverage(
  rule: Rule,
  instances: ShiftInstance[],
  inScope: (i: ShiftInstance) => boolean,
  assignedAt: (i: ShiftInstance) => Employee[],
  rankOf: (e: Employee) => number,
  fail: (v: Omit<Violation, "ruleId" | "ruleName" | "kind">) => void,
): void {
  const p = rule.params as RuleParamsQualificationCoverage;
  for (const inst of instances) {
    if (!inScope(inst)) continue;
    const qualified = assignedAt(inst).filter((e) => rankOf(e) >= p.minQualificationLevel);
    if (qualified.length < p.minCount) {
      fail({
        message: `${inst.date}: ${qualified.length} os. o kwalifikacji ≥ ${p.minQualificationLevel} (wymagane ${p.minCount}).`,
        date: inst.date,
        shiftDefId: inst.shiftDefId,
      });
    }
  }
}

function checkMaxConsecutive(
  rule: Rule,
  ctx: ValidationContext,
  groups: Set<StaffGroupKey>,
  fail: (v: Omit<Violation, "ruleId" | "ruleName" | "kind">) => void,
): void {
  const p = rule.params as RuleParamsMaxConsecutiveDays;
  const exempt = new Set(p.exemptEmployeeIds ?? []);
  const prevWorked = new Set(ctx.prevMonthWorkedDates ?? []);

  for (const emp of ctx.employees) {
    if (!groups.has(emp.staffGroup) || exempt.has(emp.id)) continue;
    const workedDates = new Set(
      ctx.assignments.filter((a) => a.employeeId === emp.id).map((a) => a.date),
    );
    if (workedDates.size === 0) continue;

    // Seed carry-in run from the tail of the previous month.
    let carryIn = 0;
    let cursor = firstDayOf(ctx.month);
    let probe = addDays(cursor, -1);
    while (prevWorked.has(probe)) {
      carryIn++;
      probe = addDays(probe, -1);
    }

    let run = carryIn;
    let maxRun = carryIn;
    const last = lastDayOf(ctx.month);
    for (let d = cursor; d <= last; d = addDays(d, 1)) {
      run = workedDates.has(d) ? run + 1 : 0;
      if (run > maxRun) maxRun = run;
    }
    if (maxRun > p.maxDays) {
      fail({
        message: `${emp.name}: ${maxRun} dni pracy z rzędu (limit ${p.maxDays}).`,
        employeeId: emp.id,
      });
    }
  }
}

function firstDayOf(month: string): string {
  return `${month}-01`;
}
function lastDayOf(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
}
function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
