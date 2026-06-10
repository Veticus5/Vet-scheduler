import Anthropic from "@anthropic-ai/sdk";
import type {
  Employee,
  RequestType,
  ScheduleRequestInput,
  ShiftDefinition,
  Weekday,
} from "@vet/shared";
import { HttpError } from "../http";
import { getApiKey, getSettings } from "../repos/settings";
import { listEmployees } from "../repos/employees";
import { listShifts } from "../repos/shifts";

/**
 * Minimal catalog the AI maps a free-form description against. Kept as a plain
 * object (no DB access) so the normalizer below is a pure, testable function —
 * names are resolved against this context, never trusted raw.
 */
export interface DraftContext {
  employees: Pick<Employee, "id" | "name" | "staffGroup">[];
  shiftDefs: Pick<ShiftDefinition, "id" | "name" | "staffGroup" | "startTime" | "endTime" | "weekdays">[];
}

const VALID_TYPES: RequestType[] = ["time-off", "unavailable", "preferred", "freeform"];

const TYPE_LABELS: Record<RequestType, string> = {
  "time-off": "Wolne (twarde)",
  unavailable: "Niedostępność (twarde)",
  preferred: "Preferencja (miękkie)",
  freeform: "Dowolny tekst (AI)",
};

// ---------------------------------------------------------------------------
// Tool definition — the AI returns a flat shape; the server normalizes it.
// ---------------------------------------------------------------------------

const PROPOSE_TOOL: Anthropic.Tool = {
  name: "propose_requests",
  description:
    "Return one or more draft scheduling requests parsed from the user's free-form description. " +
    "One description may contain several distinct requests (different people, dates or types).",
  input_schema: {
    type: "object",
    properties: {
      requests: {
        type: "array",
        description: "One entry per distinct request found in the text.",
        items: {
          type: "object",
          properties: {
            employeeId: {
              type: "string",
              description: "Employee id the request concerns (use ids from context — never invent).",
            },
            type: {
              type: "string",
              enum: VALID_TYPES,
              description:
                "Request type: 'time-off' (HARD day off), 'unavailable' (HARD cannot work), " +
                "'preferred' (soft preference), 'freeform' (free text guidance only).",
            },
            dates: {
              type: "array",
              items: { type: "string" },
              description:
                "Concrete dates YYYY-MM-DD within the given month. Use for one-off requests. " +
                "Omit when the request is recurring (use weekdays instead).",
            },
            weekdays: {
              type: "array",
              items: { type: "number" },
              description:
                "Recurring pattern: weekday numbers (0=Sunday … 6=Saturday) the request repeats on, " +
                "e.g. [3] for 'every Wednesday'. Use INSTEAD of dates for recurring requests.",
            },
            shiftDefIds: {
              type: "array",
              items: { type: "string" },
              description:
                "Shift-definition ids the request is limited to (use ids from context). Map a time of day " +
                "like 'rano'/'morning' to the matching morning shift(s); leave empty for the whole day.",
            },
            text: {
              type: "string",
              description: "Natural-language intent in Polish. REQUIRED for type 'freeform'.",
            },
          },
          required: ["employeeId", "type"],
        },
      },
    },
    required: ["requests"],
  },
};

const SYSTEM_PROMPT = `You convert a clinic manager's free-form description into typed draft
scheduling requests for a veterinary clinic, scoped to a single month. You are given the
active employees (id, name, group), the shift definitions (id, name, group, start/end time,
weekdays) and the target month (YYYY-MM) as context.

Rules:
- Map any person mentioned by name to their employee id. Use ids from the context — never invent ids.
- Choose the request type: 'time-off' / 'unavailable' are HARD; 'preferred' is a soft wish;
  'freeform' is free guidance (then 'text' is required).
- For one-off requests, set 'dates' to concrete YYYY-MM-DD dates within the given month.
- For recurring requests (e.g. "każda środa", "co poniedziałek"), set 'weekdays' (0=Sunday … 6=Saturday)
  INSTEAD of dates — do not enumerate the dates yourself.
- For a time of day ("na rano", "popołudniami"), map it to the matching shift-definition id(s) in
  'shiftDefIds' using their start/end times; leave empty if it concerns the whole day.
- Write 'text' in Polish.
- A single description may yield several requests — return one entry per distinct request.

Return the requests ONLY by calling the propose_requests tool. Do not write prose.`;

// ---------------------------------------------------------------------------
// Normalization — defensive: never trust the AI's structure.
// ---------------------------------------------------------------------------

function sanitizeIds(value: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((x): x is string => typeof x === "string" && allowed.has(x)))];
}

function sanitizeWeekdays(value: unknown): Weekday[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (d): d is Weekday => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6,
      ),
    ),
  ];
}

function sanitizeDates(value: unknown, month: string): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (d): d is string => typeof d === "string" && d.startsWith(`${month}-`),
      ),
    ),
  ];
}

/**
 * Turn one raw request from the AI into a clean ScheduleRequestInput, or null if
 * it cannot be salvaged (unknown employee, or freeform without text). Pure
 * function over the supplied context — directly unit-testable.
 */
export function normalizeDraftRequest(
  raw: any,
  ctx: DraftContext,
  month: string,
): ScheduleRequestInput | null {
  if (!raw || typeof raw !== "object") return null;

  const empIds = new Set(ctx.employees.map((e) => e.id));
  if (typeof raw.employeeId !== "string" || !empIds.has(raw.employeeId)) return null;

  const type: RequestType = VALID_TYPES.includes(raw.type) ? raw.type : "preferred";
  const text = typeof raw.text === "string" && raw.text.trim() ? raw.text.trim() : undefined;

  // freeform carries no structured target — it must have guidance text.
  if (type === "freeform" && !text) return null;

  const shiftIds = new Set(ctx.shiftDefs.map((s) => s.id));
  const shiftDefIds = sanitizeIds(raw.shiftDefIds, shiftIds);
  const weekdays = sanitizeWeekdays(raw.weekdays);
  const dates = sanitizeDates(raw.dates, month);

  const input: ScheduleRequestInput = {
    month,
    employeeId: raw.employeeId,
    type,
  };
  // Recurrence takes precedence over enumerated dates (dates get re-derived on save).
  if (weekdays.length) input.recurrence = { weekdays };
  else if (dates.length) input.dates = dates;
  if (shiftDefIds.length) input.shiftDefIds = shiftDefIds;
  if (text) input.text = text;
  return input;
}

// ---------------------------------------------------------------------------
// AI call
// ---------------------------------------------------------------------------

function getClient(): Anthropic {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new HttpError(400, "Brak klucza API Anthropic. Dodaj go w Ustawieniach, aby tworzyć prośby z opisu.");
  }
  return new Anthropic({ apiKey });
}

function buildContext(): DraftContext {
  return {
    employees: listEmployees()
      .filter((e) => e.active)
      .map((e) => ({ id: e.id, name: e.name, staffGroup: e.staffGroup })),
    shiftDefs: listShifts().map((s) => ({
      id: s.id,
      name: s.name,
      staffGroup: s.staffGroup,
      startTime: s.startTime,
      endTime: s.endTime,
      weekdays: s.weekdays,
    })),
  };
}

/**
 * Ask Claude to turn a free-form description into draft requests for `month`.
 * Returns one or more ScheduleRequestInput for the user to review — never
 * writes to the database.
 */
export async function draftRequestsFromText(
  text: string,
  month: string,
): Promise<ScheduleRequestInput[]> {
  if (!text || !text.trim()) {
    throw new HttpError(400, "Podaj opis prośby do przekształcenia.");
  }

  const client = getClient();
  const settings = getSettings();
  const ctx = buildContext();

  let msg: Anthropic.Message;
  try {
    msg = await client.messages.create({
      model: settings.aiModel,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [PROPOSE_TOOL],
      tool_choice: { type: "tool", name: "propose_requests" },
      messages: [
        {
          role: "user",
          content:
            `Przekształć poniższy opis na prośby grafikowe dla miesiąca ${month}. ` +
            `Typy próśb: ${JSON.stringify(TYPE_LABELS)}.\n\n` +
            `Kontekst (pracownicy, zmiany):\n${JSON.stringify(ctx, null, 2)}\n\n` +
            `Opis do przekształcenia:\n${text}`,
        },
      ],
    });
  } catch (e: any) {
    // Network / provider error — surface clearly, change nothing.
    throw new HttpError(502, `Błąd połączenia z AI: ${e?.message ?? "nieznany błąd"}`);
  }

  const tool = msg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "propose_requests",
  );
  if (!tool) throw new HttpError(502, "Model nie zwrócił próśb w oczekiwanym formacie.");

  const rawRequests = (tool.input as { requests?: unknown }).requests;
  if (!Array.isArray(rawRequests)) throw new HttpError(502, "Model zwrócił nieprawidłową strukturę próśb.");

  const requests = rawRequests
    .map((r) => normalizeDraftRequest(r, ctx, month))
    .filter((r): r is ScheduleRequestInput => r !== null);

  if (requests.length === 0) {
    throw new HttpError(502, "Nie udało się utworzyć żadnej prośby z podanego opisu.");
  }
  return requests;
}
