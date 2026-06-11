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
  /** The previous month's saved assignments. Feeds the cross-month checks:
   *  consecutive-days carry-in and the rest period across the month boundary
   *  (the last day's start time is needed, not just the date). */
  prevMonthAssignments?: Assignment[];
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

  // ---- Built-in, always-on safety checks (not configurable rules) ----
  // Double-booking is always invalid; rest-period and free-weekend are labour
  // law / policy. None may be left to the model, so they live in code.
  validateDoubleBooking(ctx, empById, violations);
  validateRestPeriod(ctx, empById, defById, violations);
  validateFreeWeekend(ctx, violations);

  // ---- Built-in coverage from shift definitions, with coverage-rule overrides ----
  validateCoverage(ctx, instances, assignedAt, violations);

  // Effective required minimum per instance (coverage-rule overrides folded
  // in) — used to tell a genuinely-required shift from an empty optional one.
  const coverageRules = ctx.rules.filter((r) => r.enabled && r.kind === "coverage");
  const effMin = (inst: ShiftInstance): number => {
    const def = defById.get(inst.shiftDefId);
    return def ? effectiveCoverage(inst, def, coverageRules).min : 0;
  };

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
        checkQualificationCoverage(rule, deskInstances, inScope, assignedAt, rankOf, effMin, fail);
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

export /**
 * Double-booking: an employee assigned to more than one shift on the same day.
 * Always invalid — the cheapest possible model error at 300+ assignments/month.
 * (Half-day office duty `B/2` is not modelled as a separate shift today; if it
 * ever is, this needs an overlap-aware variant.)
 */
function validateDoubleBooking(
  ctx: ValidationContext,
  empById: Map<string, Employee>,
  violations: Violation[],
): void {
  const perDay = new Map<string, number>(); // `${employeeId}|${date}` → count
  for (const a of ctx.assignments) {
    const key = `${a.employeeId}|${a.date}`;
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  for (const [key, count] of perDay) {
    if (count <= 1) continue;
    const [employeeId, date] = key.split("|") as [string, string];
    violations.push({
      kind: "double-booking",
      ruleName: "Podwójne przydzielenie",
      message: `${empById.get(employeeId)?.name ?? employeeId}: ${count} zmiany tego samego dnia (${date}).`,
      date,
      employeeId,
    });
  }
}

/** Parse "HH:MM" to minutes since midnight (0 if malformed). */
function startMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Rest period — "doba pracownicza" (labour law). A new working day may not
 * START earlier in the day than the previous worked day did: after a late
 * shift you cannot open the next morning (P→R, P→M, M→R are forbidden; R→R,
 * R→P, R→M, M→M, M→P, P→P are fine). Equivalent to "start-to-start ≥ 24h" for
 * adjacent days. Applies to ALL employees with no exemptions, and to office
 * duty too (it starts at 07:30 — P→B is a violation just like P→R).
 *
 * The month boundary IS checked: the previous month's last worked day is folded
 * in, so an afternoon on the 31st followed by a morning on the 1st is caught.
 */
function validateRestPeriod(
  ctx: ValidationContext,
  empById: Map<string, Employee>,
  defById: Map<string, ShiftDefinition>,
  violations: Violation[],
): void {
  // Per employee: date → earliest start minutes worked that day (the doba opens
  // at the first shift, so the earliest start governs).
  const byEmpDate = new Map<string, Map<string, number>>();
  const record = (employeeId: string, date: string, start: number) => {
    let dates = byEmpDate.get(employeeId);
    if (!dates) byEmpDate.set(employeeId, (dates = new Map()));
    const prev = dates.get(date);
    if (prev === undefined || start < prev) dates.set(date, start);
  };
  for (const a of ctx.assignments) {
    const def = defById.get(a.shiftDefId);
    if (def) record(a.employeeId, a.date, startMinutes(def.startTime));
  }
  // Fold in ONLY the previous month's last calendar day, so the boundary pair
  // is checked without re-flagging violations internal to the previous month.
  const prevLastDay = addDays(firstDayOf(ctx.month), -1);
  for (const a of ctx.prevMonthAssignments ?? []) {
    if (a.date !== prevLastDay) continue;
    const def = defById.get(a.shiftDefId);
    if (def) record(a.employeeId, a.date, startMinutes(def.startTime));
  }

  for (const [employeeId, dates] of byEmpDate) {
    const sorted = [...dates.keys()].sort();
    for (let i = 1; i < sorted.length; i++) {
      const prevDate = sorted[i - 1]!;
      const date = sorted[i]!;
      if (addDays(prevDate, 1) !== date) continue; // only adjacent days
      const prevStart = dates.get(prevDate)!;
      const start = dates.get(date)!;
      if (start < prevStart) {
        violations.push({
          kind: "rest-period",
          ruleName: "Doba pracownicza",
          message:
            `${empById.get(employeeId)?.name ?? employeeId}: za krótki odpoczynek ${prevDate}→${date} ` +
            `(start ${fmtTime(start)} po zmianie zaczynającej się ${fmtTime(prevStart)} dnia poprzedniego).`,
          date,
          employeeId,
        });
      }
    }
  }
}

function fmtTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * Free weekend (H7): every active employee must have at least one WHOLE free
 * weekend in the month — a Saturday AND the following Sunday both off, as a
 * pair. A free Saturday on one weekend plus a free Sunday on another does NOT
 * count. Only weekends whose both days fall inside the month are considered
 * (a weekend split across the month boundary can't be guaranteed here).
 *
 * Built-in and universal (all groups). If per-group policy or "N free weekends"
 * is ever needed, this should graduate into a configurable rule kind.
 */
function validateFreeWeekend(ctx: ValidationContext, violations: Violation[]): void {
  const last = lastDayOf(ctx.month);
  const weekends: [string, string][] = []; // [saturday, sunday], both in-month
  for (let d = firstDayOf(ctx.month); d <= last; d = addDays(d, 1)) {
    if (weekdayOfDate(d) !== 6) continue; // Saturday
    const sunday = addDays(d, 1);
    if (sunday <= last) weekends.push([d, sunday]);
  }
  if (weekends.length === 0) return; // nothing to require

  const workedByEmp = new Map<string, Set<string>>();
  for (const a of ctx.assignments) {
    let s = workedByEmp.get(a.employeeId);
    if (!s) workedByEmp.set(a.employeeId, (s = new Set()));
    s.add(a.date);
  }

  for (const emp of ctx.employees) {
    if (!emp.active) continue;
    const worked = workedByEmp.get(emp.id) ?? new Set<string>();
    const hasFree = weekends.some(([sat, sun]) => !worked.has(sat) && !worked.has(sun));
    if (!hasFree) {
      violations.push({
        kind: "free-weekend",
        ruleName: "Wolny weekend",
        message: `${emp.name}: brak całego wolnego weekendu (sobota+niedziela) w miesiącu.`,
        employeeId: emp.id,
      });
    }
  }
}

/** Weekday of an ISO date in local time (0=Sun … 6=Sat). */
function weekdayOfDate(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).getDay();
}

export function effectiveCoverage(
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
  effMin: (i: ShiftInstance) => number,
  fail: (v: Omit<Violation, "ruleId" | "ruleName" | "kind">) => void,
): void {
  const p = rule.params as RuleParamsQualificationCoverage;
  for (const inst of instances) {
    if (!inScope(inst)) continue;
    const present = assignedAt(inst);
    // An empty OPTIONAL shift (min 0, nobody assigned) has nothing to qualify —
    // skip it. A staffed shift, or one that is genuinely required, still checks.
    if (present.length === 0 && effMin(inst) === 0) continue;
    const qualified = present.filter((e) => rankOf(e) >= p.minQualificationLevel);
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

  // Previous-month worked dates PER EMPLOYEE — must be per person, not "any day
  // someone worked", or the carry-in counts the whole previous month for everyone.
  const prevByEmp = new Map<string, Set<string>>();
  for (const a of ctx.prevMonthAssignments ?? []) {
    let s = prevByEmp.get(a.employeeId);
    if (!s) prevByEmp.set(a.employeeId, (s = new Set()));
    s.add(a.date);
  }

  const first = firstDayOf(ctx.month);
  const last = lastDayOf(ctx.month);

  for (const emp of ctx.employees) {
    if (!groups.has(emp.staffGroup) || exempt.has(emp.id)) continue;
    const workedDates = new Set(
      ctx.assignments.filter((a) => a.employeeId === emp.id).map((a) => a.date),
    );
    if (workedDates.size === 0) continue;

    // Carry-in: consecutive days THIS employee worked ending the day before the 1st.
    const prevWorked = prevByEmp.get(emp.id) ?? new Set<string>();
    let carryIn = 0;
    let probe = addDays(first, -1);
    while (prevWorked.has(probe)) {
      carryIn++;
      probe = addDays(probe, -1);
    }

    // Walk the month day by day; a gap resets the run. maxRun starts at 0 so a
    // run that lives entirely in the previous month (this month off) isn't
    // re-flagged here — only runs reaching into this month count.
    let run = carryIn;
    let maxRun = 0;
    for (let d = first; d <= last; d = addDays(d, 1)) {
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
