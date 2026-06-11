import Anthropic from "@anthropic-ai/sdk";
import type {
  Assignment,
  Employee,
  FeasibilityReport,
  Rule,
  ScheduleRequest,
  ShiftDefinition,
  ValidationResult,
  Violation,
} from "@vet/shared";
import { isMachineValidated, QUALIFICATION_TIERS } from "@vet/shared";
import { HttpError } from "../http";
import { getApiKey, getSettings } from "../repos/settings";
import { rankMap } from "../repos/qualifications";
import { daysInMonth, expandInstances } from "../domain/calendar";
import { computeFeasibility } from "../domain/feasibility";
import { effectiveCoverage, validate, type ValidationContext } from "../domain/validator";

export interface GenerateInput {
  month: string;
  employees: Employee[];
  shiftDefs: ShiftDefinition[];
  rules: Rule[];
  requests: ScheduleRequest[];
  prevMonthAssignments?: Assignment[];
}

export interface GenerateResult {
  assignments: Assignment[];
  validation: ValidationResult;
  attempts: number;
  /** Capacity check computed once up front — flags shifts that no schedule
   *  can fill because too few eligible staff are available. */
  feasibility: FeasibilityReport;
  /** True when repair was skipped because the conflicts look systemic (one rule
   *  firing across most of the month) rather than a few fixable spots. */
  systemic: boolean;
}

// Upper bound on the model's response. A whole-month schedule can run to many
// thousands of tokens; 32k comfortably covers it for the supported models.
const MAX_OUTPUT_TOKENS = 32000;

// Absolute backstop: beyond this many violations even diverse repair is hopeless.
const REPAIR_HARD_CEILING = 80;

/**
 * Decide whether an attempt's conflicts look SYSTEMIC (a config/context problem)
 * versus a diverse set the repair loop can actually chew through. The signal is
 * the PATTERN, not the count: one rule/kind firing on a large fraction of the
 * month's days (e.g. a coverage min that no day can meet) is config; conflicts
 * scattered across types and people are normal model mistakes — repair those
 * even at 25. This keeps the safety valve from firing exactly when the loop
 * would be most useful.
 */
function looksSystemic(violations: Violation[], month: string): boolean {
  const total = violations.length;
  if (total === 0) return false;
  if (total > REPAIR_HARD_CEILING) return true;
  const byGroup = new Map<string, number>();
  for (const v of violations) {
    const key = v.ruleId ?? v.kind;
    byGroup.set(key, (byGroup.get(key) ?? 0) + 1);
  }
  const largest = Math.max(...byGroup.values());
  const days = daysInMonth(month);
  // One rule dominating (>half the conflicts) AND recurring across most of the
  // month = a configuration smell, not spot fixes.
  return largest >= total * 0.5 && largest >= Math.ceil(days * 0.5);
}

const SUBMIT_TOOL: Anthropic.Tool = {
  name: "submit_schedule",
  description: "Return the complete monthly schedule as a list of assignments.",
  input_schema: {
    type: "object",
    properties: {
      assignments: {
        type: "array",
        description: "One entry per (date, shift, employee) the person is scheduled to work.",
        items: {
          type: "object",
          properties: {
            date: { type: "string", description: "YYYY-MM-DD" },
            shiftDefId: { type: "string", description: "Shift definition id" },
            employeeId: { type: "string", description: "Employee id" },
          },
          required: ["date", "shiftDefId", "employeeId"],
        },
      },
    },
    required: ["assignments"],
  },
};

function buildContextPayload(input: GenerateInput) {
  const instances = expandInstances(input.shiftDefs, input.month);
  const defById = new Map(input.shiftDefs.map((d) => [d.id, d]));
  const coverageRules = input.rules.filter((r) => r.enabled && r.kind === "coverage");
  const tierLabel = (group: Employee["staffGroup"], key: string) =>
    QUALIFICATION_TIERS[group].find((t) => t.key === key)?.label ?? key;

  // Time-off days per employee → reduce each person's monthly target.
  const timeOffDays = new Map<string, number>();
  for (const r of input.requests) {
    if (r.type !== "time-off") continue;
    timeOffDays.set(r.employeeId, (timeOffDays.get(r.employeeId) ?? 0) + new Set(r.dates ?? []).size);
  }
  const SHIFT_HOURS = 8; // reception shift length, for the hours→shifts target

  return {
    month: input.month,
    // Named qualification tiers per group; higher rank = more qualified.
    qualificationTiers: QUALIFICATION_TIERS,
    employees: input.employees
      .filter((e) => e.active)
      .map((e) => {
        const targetHours = Math.max(0, e.contractHours - SHIFT_HOURS * (timeOffDays.get(e.id) ?? 0));
        return {
          id: e.id,
          name: e.name,
          staffGroup: e.staffGroup,
          qualificationTier: tierLabel(e.staffGroup, e.qualificationTier),
          contractHours: e.contractHours,
          // Explicit monthly target after subtracting time-off — a concrete
          // number to hit per person beats a vague "balance hours" instruction.
          targetHours,
          targetShifts: Math.round(targetHours / SHIFT_HOURS),
          defaultAvailability: e.defaultAvailability,
        };
      }),
    shiftDefinitions: input.shiftDefs.map((d) => ({
      id: d.id,
      staffGroup: d.staffGroup,
      name: d.name,
      startTime: d.startTime,
      endTime: d.endTime,
      // true = staffs the reception desk; false = office duty (admin work).
      // NOTE: coverage numbers live per-instance below (they vary by date via
      // coverage rules), NOT here — the definition's own min/max are omitted on
      // purpose so the model has a single, unambiguous source for staffing.
      staffsReception: d.staffsReception,
    })),
    // Each instance carries the EFFECTIVE required min/max for that specific
    // date — coverage-rule overrides already folded in, exactly what the
    // validator enforces. The model must not merge rules itself. Office-duty
    // instances have no enforced floor (min 0); they staff admin work, not the desk.
    shiftInstances: instances.map((i) => {
      const def = defById.get(i.shiftDefId)!;
      const { min, max } =
        def.staffsReception === false
          ? { min: 0, max: def.requiredMax }
          : effectiveCoverage(i, def, coverageRules);
      return {
        date: i.date,
        shiftDefId: i.shiftDefId,
        staffGroup: i.staffGroup,
        requiredMin: min,
        requiredMax: max,
      };
    }),
    rules: input.rules
      .filter((r) => r.enabled)
      .map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        severity: r.hard ? "HARD (must never be violated)" : "soft (preference)",
        scope: r.scope,
        params: r.params,
        description: r.description,
        machineValidated: isMachineValidated(r),
      })),
    requests: input.requests,
  };
}

const SYSTEM_PROMPT = `You build monthly staff schedules for a veterinary clinic.
You receive employees, shift definitions, the concrete shift instances to fill,
permanent rules (HARD or soft), and this month's requests.

Rules:
- HARD rules and time-off/unavailable requests MUST NEVER be violated.
- Assign employees only to shift instances that exist in the input.
- Never assign the same employee to more than one shift on the same day (no double-booking).
- Respect the daily rest period (labour law): an employee's next worked day must
  not START earlier in the day than their previous worked day did. After a late
  (afternoon) shift, do NOT give that person an early (morning) shift the next day.
- PLAN IN BLOCKS to satisfy the rest period at the source: keep a person on the
  SAME shift type for several days in a row, and only ever change their type in
  the "earlier → later" direction (e.g. morning → afternoon), or after a day off.
  Never follow an afternoon shift with a next-day morning shift.
- Every employee must have at least one WHOLE free weekend (Saturday AND the
  following Sunday both off) within the month.
- Each shift INSTANCE carries its own requiredMin/requiredMax — these are
  AUTHORITATIVE (coverage-rule overrides are already folded in) and vary by date.
  Staff every instance with between requiredMin and requiredMax employees inclusive.
- A shift instance is filled by MULTIPLE assignment entries — one per employee.
  To put N people on a shift, emit N entries with the SAME date and shiftDefId
  and different employeeId. Do NOT stop at one entry per shift.
- BALANCE WORKLOAD — this is a primary goal, second only to the HARD rules, and
  the most common failure is ignoring it. Each employee carries targetShifts for
  this month (their norm minus time-off). No employee may exceed their targetShifts
  by more than 2, nor fall more than 2 below it, unless time-off forces otherwise.
  Distribute shifts across ALL employees — never run a handful of people all month
  while others get one or two shifts. Check every person's count against their
  target before submitting.
- Soft rules and "preferred" requests are preferences — satisfy them when possible.
- Free-form rules/requests are guidance expressed in natural language.
- Only assign an employee to their own staff group's shifts.
- Shifts with "staffsReception": false are OFFICE DUTY (administrative work), NOT
  reception-desk coverage. They count as worked hours but do NOT satisfy a shift's
  required reception coverage — never use an office-duty shift to fill desk coverage.

Return the schedule ONLY by calling the submit_schedule tool. Do not write prose.`;

function getClient(): Anthropic {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new HttpError(400, "Brak klucza API Anthropic. Dodaj go w Ustawieniach, aby generować grafik.");
  }
  return new Anthropic({ apiKey });
}

function parseAssignments(msg: Anthropic.Message): { assignments: Assignment[]; toolUseId: string } {
  const tool = msg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "submit_schedule",
  );
  if (!tool) throw new HttpError(502, "Model nie zwrócił grafiku w oczekiwanym formacie.");
  const raw = (tool.input as { assignments?: unknown }).assignments;
  if (!Array.isArray(raw)) throw new HttpError(502, "Model zwrócił nieprawidłową strukturę grafiku.");
  const assignments = raw
    .filter((a: any) => a && a.date && a.shiftDefId && a.employeeId)
    .map((a: any) => ({ date: String(a.date), shiftDefId: String(a.shiftDefId), employeeId: String(a.employeeId) }));
  return { assignments, toolUseId: tool.id };
}

function validationContext(input: GenerateInput, assignments: Assignment[]): ValidationContext {
  return {
    month: input.month,
    employees: input.employees,
    shiftDefs: input.shiftDefs,
    rules: input.rules,
    requests: input.requests,
    assignments,
    tierRanks: rankMap(),
    prevMonthAssignments: input.prevMonthAssignments,
  };
}

/**
 * Build the repair tool_result fed back to the model. It (a) annotates each
 * coverage violation that is structurally impossible so the model stops trying
 * to over-fill it, and (b) passes soft preference misses so they get addressed
 * too — but never by breaking a HARD rule.
 */
function buildRepairMessage(
  validation: ValidationResult,
  gapByInstance: Map<string, { required: number; available: number }>,
  hoursLines: string[],
): string {
  const hardLines = validation.violations.map((v, i) => {
    const gap = v.date && v.shiftDefId ? gapByInstance.get(`${v.date}|${v.shiftDefId}`) : undefined;
    const note = gap
      ? ` (NOTE: only ${gap.available} eligible/available staff exist for this shift, below the required ${gap.required}. ` +
        `Assign all ${gap.available}; this minimum is unreachable — do NOT break other HARD rules chasing it.)`
      : "";
    return `${i + 1}. [${v.kind}] ${v.message}${note}`;
  });

  let content =
    `The schedule has ${validation.violations.length} HARD violation(s). ` +
    `Fix every fixable one and resubmit via submit_schedule.\n\nHARD violations:\n` +
    hardLines.join("\n");

  // Directional fix strategies, only for the violation kinds actually present.
  // A concrete menu of 2–3 legal moves converges far better than a bare error.
  const STRATEGIES: Partial<Record<Violation["kind"], string>> = {
    "rest-period":
      "rest-period (doba): on the LATER day, replace that person's early shift with a later-starting " +
      "one, OR give the early shift to someone who did NOT work a late shift the day before, OR drop " +
      "them from the later day if coverage still holds. Then recheck adjacent days for a new violation.",
    "time-off":
      "time-off/unavailable: remove that person from the shift and staff it with someone available — " +
      "never pick someone it would push over the rest period or the consecutive-days limit.",
    coverage:
      "coverage: add an eligible, available employee to the understaffed shift (or remove one if over max), " +
      "preferring people currently below their hours target.",
    "free-weekend":
      "free-weekend: clear both days of one whole weekend for that person and move their shifts elsewhere.",
    "double-booking": "double-booking: keep one shift that day for the person and reassign the other.",
    "qualification-coverage":
      "qualification-coverage: add an employee of the required rank to that shift.",
    pairing: "pairing: add the required partner to that shift, or remove the unpaired subject.",
  };
  const present = [...new Set(validation.violations.map((v) => v.kind))]
    .map((k) => STRATEGIES[k])
    .filter(Boolean);
  if (present.length > 0) {
    content += `\n\nHow to fix each kind (pick a legal move; do NOT introduce a new HARD violation):\n- ${present.join("\n- ")}`;
  }

  if (validation.unmetPreferences.length > 0) {
    content +=
      `\n\nAlso satisfy these soft preferences where possible, WITHOUT breaking any HARD rule ` +
      `(e.g. respect max-consecutive-days — do not let anyone work long unbroken runs):\n` +
      validation.unmetPreferences.map((u, i) => `${i + 1}. ${u.message}`).join("\n");
  }

  if (hoursLines.length > 0) {
    content +=
      `\n\nHours vs monthly target (informational — balance toward these WITHOUT breaking any HARD ` +
      `rule; do not leave anyone far below target):\n` +
      hoursLines.join("\n");
  }

  return content;
}

/** Hours of a single shift (handles an overnight definition defensively). */
function shiftHours(def: ShiftDefinition): number {
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  let mins = toMin(def.endTime) - toMin(def.startTime);
  if (mins <= 0) mins += 24 * 60;
  return mins / 60;
}

/**
 * Per-employee deviation from the monthly target, for the repair feedback.
 * The target is contractHours minus 8h per time-off day (worked hours toward a
 * reduced norm). Only notable deviations (> 8h) are surfaced.
 */
function hoursDeviationLines(input: GenerateInput, assignments: Assignment[]): string[] {
  const defById = new Map(input.shiftDefs.map((d) => [d.id, d]));
  const timeOffDays = new Map<string, Set<string>>();
  for (const r of input.requests) {
    if (r.type !== "time-off") continue;
    for (const d of r.dates ?? []) {
      let s = timeOffDays.get(r.employeeId);
      if (!s) timeOffDays.set(r.employeeId, (s = new Set()));
      s.add(d);
    }
  }
  const worked = new Map<string, number>();
  for (const a of assignments) {
    const def = defById.get(a.shiftDefId);
    if (def) worked.set(a.employeeId, (worked.get(a.employeeId) ?? 0) + shiftHours(def));
  }
  const lines: string[] = [];
  for (const e of input.employees) {
    if (!e.active) continue;
    const target = Math.max(0, e.contractHours - 8 * (timeOffDays.get(e.id)?.size ?? 0));
    const diff = Math.round((worked.get(e.id) ?? 0) - target);
    if (Math.abs(diff) > 8) lines.push(`${e.name}: ${diff > 0 ? "+" : ""}${diff}h (cel ${Math.round(target)}h)`);
  }
  return lines;
}

/**
 * Generate a schedule with Claude, then validate and repair it deterministically.
 * Loops up to `maxRepairAttempts`; if still invalid, returns the best attempt
 * with its remaining violations (never labelled valid).
 */
export async function generateSchedule(input: GenerateInput): Promise<GenerateResult> {
  const client = getClient();
  const settings = getSettings();
  const maxAttempts = Math.max(1, settings.maxRepairAttempts + 1);

  // Deterministic capacity check up front. Structurally impossible shifts are
  // surfaced as-is and the repair loop is told to stop chasing them.
  const feasibility = computeFeasibility(input);
  const gapByInstance = new Map(feasibility.gaps.map((g) => [`${g.date}|${g.shiftDefId}`, g]));

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Build the schedule for ${input.month}. Context:\n\n${JSON.stringify(
        buildContextPayload(input),
        null,
        2,
      )}`,
    },
  ];

  let best: { assignments: Assignment[]; validation: ValidationResult } | null = null;
  let attemptsUsed = 0;
  let systemic = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attemptsUsed = attempt;
    let msg: Anthropic.Message;
    try {
      // Stream and collect the final message. With max_tokens this high the
      // SDK rejects a non-streaming create() ("Streaming is strongly
      // recommended for operations that may take longer than 10 minutes").
      // .finalMessage() yields the same Anthropic.Message, so parsing below
      // is unchanged.
      msg = await client.messages
        .stream({
          model: settings.aiModel,
          // A full month's assignments (UUIDs per date/shift/employee) is large;
          // too low a limit truncates the tool call mid-JSON → unparseable output.
          max_tokens: MAX_OUTPUT_TOKENS,
          system: SYSTEM_PROMPT,
          tools: [SUBMIT_TOOL],
          tool_choice: { type: "tool", name: "submit_schedule" },
          messages,
        })
        .finalMessage();
    } catch (e: any) {
      // Network / provider error — do not mutate stored data; surface clearly.
      throw new HttpError(502, `Błąd połączenia z AI: ${e?.message ?? "nieznany błąd"}`);
    }

    if (msg.stop_reason === "max_tokens") {
      throw new HttpError(
        502,
        "Odpowiedź modelu została ucięta przez limit długości (grafik zbyt duży). " +
          "Zmniejsz liczbę pracowników/zmian dla tego miesiąca lub spróbuj ponownie.",
      );
    }

    const { assignments, toolUseId } = parseAssignments(msg);
    const validation = validate(validationContext(input, assignments));

    if (!best || validation.violations.length < best.validation.violations.length) {
      best = { assignments, validation };
    }
    if (validation.valid) {
      return { assignments, validation, attempts: attempt, feasibility, systemic: false };
    }
    if (attempt === maxAttempts) break;
    // Skip repair only when the conflicts look systemic (a config problem), not
    // merely numerous — diverse per-person/per-type conflicts are exactly what
    // the loop fixes, so let it run even at a couple dozen.
    if (looksSystemic(validation.violations, input.month)) {
      systemic = true;
      break;
    }

    // Feed violations back for repair via a proper tool_result block.
    messages.push({ role: "assistant", content: msg.content });
    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content: buildRepairMessage(validation, gapByInstance, hoursDeviationLines(input, assignments)),
        },
      ],
    });
  }

  return { assignments: best!.assignments, validation: best!.validation, attempts: attemptsUsed, feasibility, systemic };
}
