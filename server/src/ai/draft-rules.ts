import Anthropic from "@anthropic-ai/sdk";
import type {
  Employee,
  RuleInput,
  RuleKind,
  RuleParams,
  RuleParamsPairing,
  RuleScope,
  ShiftDefinition,
  StaffGroupKey,
  Weekday,
} from "@vet/shared";
import { QUALIFICATION_TIERS, STAFF_GROUPS } from "@vet/shared";
import { HttpError } from "../http";
import { getApiKey, getSettings } from "../repos/settings";
import { listEmployees } from "../repos/employees";
import { listShifts } from "../repos/shifts";

/**
 * Minimal catalog the AI maps natural-language descriptions against. Kept as a
 * plain object (no DB access) so the normalizer below is a pure, testable
 * function — names/ids are resolved against this context, never trusted raw.
 */
export interface DraftContext {
  employees: Pick<Employee, "id" | "name" | "staffGroup" | "qualificationTier">[];
  shiftDefs: Pick<ShiftDefinition, "id" | "name" | "staffGroup">[];
}

const VALID_KINDS: RuleKind[] = [
  "pairing",
  "qualification-coverage",
  "max-consecutive-days",
  "coverage",
  "freeform",
];

const GROUP_KEYS: StaffGroupKey[] = STAFF_GROUPS.map((g) => g.key);

const KIND_LABELS: Record<RuleKind, string> = {
  pairing: "Parowanie",
  "qualification-coverage": "Pokrycie kwalifikacjami",
  "max-consecutive-days": "Max dni z rzędu",
  coverage: "Obsada (nadpisanie)",
  freeform: "Dowolny tekst (dla AI)",
};

// ---------------------------------------------------------------------------
// Tool definition — the AI returns a flat shape; the server normalizes it.
// ---------------------------------------------------------------------------

const PROPOSE_TOOL: Anthropic.Tool = {
  name: "propose_rules",
  description:
    "Return one or more draft scheduling rules parsed from the user's free-form description. " +
    "One description may contain several distinct rules.",
  input_schema: {
    type: "object",
    properties: {
      rules: {
        type: "array",
        description: "One entry per distinct rule found in the text.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Short, human-readable rule name in Polish." },
            kind: {
              type: "string",
              enum: VALID_KINDS,
              description:
                "Rule type: 'pairing' (someone must share each shift with a group), " +
                "'qualification-coverage' (min N people at/above a qualification level per shift), " +
                "'max-consecutive-days' (cap on consecutive worked days), " +
                "'coverage' (override required staff min/max for shifts), " +
                "'freeform' (no machine check — guidance text only).",
            },
            hard: {
              type: "boolean",
              description: "true = HARD (validator-enforced); false = soft preference.",
            },
            groups: {
              type: "array",
              items: { type: "string", enum: GROUP_KEYS },
              description: "Staff groups in scope. Exactly one = single-group; two or more = cross-group.",
            },
            description: { type: "string", description: "Natural-language intent in Polish." },
            // --- flat, kind-specific params (include only those that apply) ---
            employeeId: {
              type: "string",
              description: "pairing: the employee id that must be paired (use ids from context).",
            },
            minQualificationLevel: {
              type: "number",
              description:
                "pairing or qualification-coverage: minimum qualification tier RANK within the group " +
                "(use the rank from the qualificationTiers context, not a tier name).",
            },
            minCount: {
              type: "number",
              description: "qualification-coverage: minimum qualifying people per shift.",
            },
            withGroup: {
              type: "array",
              items: { type: "string", enum: GROUP_KEYS },
              description: "pairing: must share each shift with at least one person from these groups.",
            },
            maxDays: { type: "number", description: "max-consecutive-days: the cap." },
            exemptEmployeeIds: {
              type: "array",
              items: { type: "string" },
              description: "max-consecutive-days: employee ids exempt from the cap (use ids from context).",
            },
            min: { type: "number", description: "coverage: minimum staff override." },
            max: { type: "number", description: "coverage: maximum staff override." },
            shiftDefIds: {
              type: "array",
              items: { type: "string" },
              description:
                "coverage: shift-definition ids this applies to (use ids from context). " +
                "Omit only when the headcount truly applies to every shift of the group.",
            },
            weekdays: {
              type: "array",
              items: { type: "number", enum: [0, 1, 2, 3, 4, 5, 6] },
              description:
                "coverage: weekdays this applies to (0=Sunday, 1=Monday, … 6=Saturday). " +
                "REQUIRED whenever the headcount differs by day — e.g. weekdays vs weekends, " +
                "or specific days like 'Mondays and Thursdays'. Omit only for an all-week rule.",
            },
          },
          required: ["name", "kind", "hard", "groups"],
        },
      },
    },
    required: ["rules"],
  },
};

const SYSTEM_PROMPT = `You convert a clinic manager's free-form description into typed draft
scheduling rules for a veterinary clinic. You are given the staff groups, the per-group
qualification tiers (name + rank, higher = more qualified), the active employees
(id, name, group, qualification tier) and the shift definitions (id, name, group) as context.

Rules:
- Map any person mentioned by name to their employee id; map any named shift to its
  shift-definition id. Use ids from the context — never invent ids.
- For qualification thresholds (pairing / qualification-coverage), set minQualificationLevel
  to the RANK of the tier the text refers to (e.g. "doświadczeni" → that tier's rank).
- Choose the most specific rule kind that fits. Use 'freeform' only when no structured
  kind applies.
- For 'coverage' rules, ALWAYS scope them. If the required headcount differs by day
  (weekdays vs weekends, or specific days like "Mondays and Thursdays"), emit a SEPARATE
  coverage rule per distinct headcount and set its 'weekdays'. If it applies only to
  certain shifts (e.g. only the morning shift), set 'shiftDefIds'. Never emit one
  day-agnostic coverage rule when the text describes different counts on different days —
  that produces an impossible, self-overriding requirement.
- Set 'groups' to the staff group(s) the rule concerns. Default a rule to HARD unless the
  text clearly expresses a preference ("preferably", "if possible") — then mark it soft.
- Write 'name' and 'description' in Polish.
- A single description may yield several rules — return one entry per distinct rule.

Return the rules ONLY by calling the propose_rules tool. Do not write prose.`;

// ---------------------------------------------------------------------------
// Normalization — defensive: never trust the AI's structure.
// ---------------------------------------------------------------------------

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sanitizeIds(value: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((x): x is string => typeof x === "string" && allowed.has(x)))];
}

function sanitizeWeekdays(value: unknown): Weekday[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((d): d is Weekday => Number.isInteger(d) && d >= 0 && d <= 6))];
}

function sanitizeGroups(value: unknown): StaffGroupKey[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((g): g is StaffGroupKey => GROUP_KEYS.includes(g)))];
}

function normalizeScope(groups: unknown): RuleScope {
  const unique = sanitizeGroups(groups);
  if (unique.length === 0) return { type: "group", group: GROUP_KEYS[0]! };
  if (unique.length === 1) return { type: "group", group: unique[0]! };
  return { type: "cross-group", groups: unique };
}

function normalizeParams(
  kind: RuleKind,
  raw: any,
  empIds: Set<string>,
  shiftIds: Set<string>,
): RuleParams {
  switch (kind) {
    case "pairing": {
      const params: { kind: "pairing" } & RuleParamsPairing = {
        kind,
        withGroup: sanitizeGroups(raw.withGroup),
      };
      if (typeof raw.employeeId === "string" && empIds.has(raw.employeeId)) {
        params.employeeId = raw.employeeId;
      }
      if (typeof raw.minQualificationLevel === "number") {
        params.minQualificationLevel = raw.minQualificationLevel;
      }
      return params;
    }
    case "qualification-coverage":
      return {
        kind,
        minQualificationLevel: num(raw.minQualificationLevel, 3),
        minCount: num(raw.minCount, 1),
      };
    case "max-consecutive-days": {
      const exempt = sanitizeIds(raw.exemptEmployeeIds, empIds);
      return {
        kind,
        maxDays: num(raw.maxDays, 7),
        ...(exempt.length ? { exemptEmployeeIds: exempt } : {}),
      };
    }
    case "coverage": {
      const ids = sanitizeIds(raw.shiftDefIds, shiftIds);
      const weekdays = sanitizeWeekdays(raw.weekdays);
      return {
        kind,
        ...(typeof raw.min === "number" ? { min: raw.min } : {}),
        ...(typeof raw.max === "number" ? { max: raw.max } : {}),
        ...(ids.length ? { shiftDefIds: ids } : {}),
        ...(weekdays.length ? { weekdays } : {}),
      };
    }
    case "freeform":
      return { kind };
  }
}

/**
 * Turn one raw rule from the AI into a clean RuleInput, or null if the kind is
 * unknown. Pure function over the supplied context — directly unit-testable.
 */
export function normalizeDraftRule(raw: any, ctx: DraftContext): RuleInput | null {
  if (!raw || typeof raw !== "object") return null;
  const kind = raw.kind as RuleKind;
  if (!VALID_KINDS.includes(kind)) return null;

  const empIds = new Set(ctx.employees.map((e) => e.id));
  const shiftIds = new Set(ctx.shiftDefs.map((s) => s.id));

  const name =
    typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : KIND_LABELS[kind];

  return {
    name,
    kind,
    hard: typeof raw.hard === "boolean" ? raw.hard : true,
    scope: normalizeScope(raw.groups),
    params: normalizeParams(kind, raw, empIds, shiftIds),
    description: typeof raw.description === "string" ? raw.description : "",
    enabled: true,
  };
}

// ---------------------------------------------------------------------------
// AI call
// ---------------------------------------------------------------------------

function getClient(): Anthropic {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new HttpError(400, "Brak klucza API Anthropic. Dodaj go w Ustawieniach, aby tworzyć reguły z opisu.");
  }
  return new Anthropic({ apiKey });
}

function buildContext(): DraftContext {
  return {
    employees: listEmployees()
      .filter((e) => e.active)
      .map((e) => ({
        id: e.id,
        name: e.name,
        staffGroup: e.staffGroup,
        qualificationTier: e.qualificationTier,
      })),
    shiftDefs: listShifts().map((s) => ({ id: s.id, name: s.name, staffGroup: s.staffGroup })),
  };
}

/**
 * Ask Claude to turn a free-form description into draft rules. Returns one or
 * more RuleInput for the user to review — never writes to the database.
 */
export async function draftRulesFromText(text: string): Promise<RuleInput[]> {
  if (!text || !text.trim()) {
    throw new HttpError(400, "Podaj opis reguły do przekształcenia.");
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
      tool_choice: { type: "tool", name: "propose_rules" },
      messages: [
        {
          role: "user",
          content:
            `Przekształć poniższy opis na reguły. Kontekst (grupy, tiery kwalifikacji, pracownicy, zmiany):\n\n` +
            `${JSON.stringify({ staffGroups: STAFF_GROUPS, qualificationTiers: QUALIFICATION_TIERS, ...ctx }, null, 2)}\n\n` +
            `Opis do przekształcenia:\n${text}`,
        },
      ],
    });
  } catch (e: any) {
    // Network / provider error — surface clearly, change nothing.
    throw new HttpError(502, `Błąd połączenia z AI: ${e?.message ?? "nieznany błąd"}`);
  }

  const tool = msg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "propose_rules",
  );
  if (!tool) throw new HttpError(502, "Model nie zwrócił reguł w oczekiwanym formacie.");

  const rawRules = (tool.input as { rules?: unknown }).rules;
  if (!Array.isArray(rawRules)) throw new HttpError(502, "Model zwrócił nieprawidłową strukturę reguł.");

  const rules = rawRules
    .map((r) => normalizeDraftRule(r, ctx))
    .filter((r): r is RuleInput => r !== null);

  if (rules.length === 0) {
    throw new HttpError(502, "Nie udało się utworzyć żadnej reguły z podanego opisu.");
  }
  return rules;
}
