import Anthropic from "@anthropic-ai/sdk";
import type {
  Assignment,
  Employee,
  Rule,
  ScheduleRequest,
  ShiftDefinition,
  ValidationResult,
} from "@vet/shared";
import { isMachineValidated, QUALIFICATION_TIERS } from "@vet/shared";
import { HttpError } from "../http";
import { getApiKey, getSettings } from "../repos/settings";
import { rankMap } from "../repos/qualifications";
import { expandInstances } from "../domain/calendar";
import { validate, type ValidationContext } from "../domain/validator";

export interface GenerateInput {
  month: string;
  employees: Employee[];
  shiftDefs: ShiftDefinition[];
  rules: Rule[];
  requests: ScheduleRequest[];
  prevMonthWorkedDates?: string[];
}

export interface GenerateResult {
  assignments: Assignment[];
  validation: ValidationResult;
  attempts: number;
}

// Upper bound on the model's response. A whole-month schedule can run to many
// thousands of tokens; 32k comfortably covers it for the supported models.
const MAX_OUTPUT_TOKENS = 32000;

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
  const tierLabel = (group: Employee["staffGroup"], key: string) =>
    QUALIFICATION_TIERS[group].find((t) => t.key === key)?.label ?? key;
  return {
    month: input.month,
    // Named qualification tiers per group; higher rank = more qualified.
    qualificationTiers: QUALIFICATION_TIERS,
    employees: input.employees
      .filter((e) => e.active)
      .map((e) => ({
        id: e.id,
        name: e.name,
        staffGroup: e.staffGroup,
        qualificationTier: tierLabel(e.staffGroup, e.qualificationTier),
        contractHours: e.contractHours,
        defaultAvailability: e.defaultAvailability,
      })),
    shiftDefinitions: input.shiftDefs.map((d) => ({
      id: d.id,
      staffGroup: d.staffGroup,
      name: d.name,
      startTime: d.startTime,
      endTime: d.endTime,
      requiredMin: d.requiredMin,
      requiredMax: d.requiredMax,
      // true = staffs the reception desk; false = office duty (admin work).
      staffsReception: d.staffsReception,
    })),
    shiftInstances: instances,
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
- Respect each shift's requiredMin/requiredMax coverage.
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
    prevMonthWorkedDates: input.prevMonthWorkedDates,
  };
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

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
      return { assignments, validation, attempts: attempt };
    }
    if (attempt === maxAttempts) break;

    // Feed violations back for repair via a proper tool_result block.
    messages.push({ role: "assistant", content: msg.content });
    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content:
            `The schedule has ${validation.violations.length} HARD violation(s). ` +
            `Fix ALL of them and resubmit via submit_schedule.\n\nViolations:\n` +
            validation.violations.map((v, i) => `${i + 1}. [${v.kind}] ${v.message}`).join("\n"),
        },
      ],
    });
  }

  return { assignments: best!.assignments, validation: best!.validation, attempts: maxAttempts };
}
