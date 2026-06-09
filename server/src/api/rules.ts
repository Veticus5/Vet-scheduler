import type { RuleInput, RuleKind } from "@vet/shared";
import { HttpError, json, readJson } from "../http";
import {
  createRule,
  deleteRule,
  listRules,
  setRuleEnabled,
  updateRule,
} from "../repos/rules";
import type { Route } from "./index";

const VALID_KINDS: RuleKind[] = [
  "pairing",
  "qualification-coverage",
  "max-consecutive-days",
  "coverage",
  "freeform",
];

function validate(body: any): RuleInput {
  if (typeof body?.name !== "string" || !body.name.trim()) throw new HttpError(400, "Nazwa reguły jest wymagana");
  if (!VALID_KINDS.includes(body.kind)) throw new HttpError(400, "Nieprawidłowy typ reguły");
  if (!body.scope || (body.scope.type !== "group" && body.scope.type !== "cross-group")) {
    throw new HttpError(400, "Nieprawidłowy zasięg reguły");
  }
  return {
    name: body.name.trim(),
    kind: body.kind,
    hard: body.hard ?? true,
    scope: body.scope,
    params: body.params ?? { kind: body.kind },
    description: body.description ?? "",
    enabled: body.enabled ?? true,
  };
}

export const ruleRoutes: Route[] = [
  { method: "GET", path: "/rules", handler: () => json(listRules()) },
  {
    method: "POST",
    path: "/rules",
    handler: async (req) => json(createRule(validate(await readJson(req))), 201),
  },
  {
    method: "PUT",
    path: "/rules/:id",
    handler: async (req, p) => {
      const updated = updateRule(p.id!, validate(await readJson(req)));
      if (!updated) throw new HttpError(404, "Nie znaleziono reguły");
      return json(updated);
    },
  },
  {
    method: "POST",
    path: "/rules/:id/enabled",
    handler: async (req, p) => {
      const body = await readJson<{ enabled: boolean }>(req);
      const updated = setRuleEnabled(p.id!, !!body.enabled);
      if (!updated) throw new HttpError(404, "Nie znaleziono reguły");
      return json(updated);
    },
  },
  {
    method: "DELETE",
    path: "/rules/:id",
    handler: (_req, p) => {
      if (!deleteRule(p.id!)) throw new HttpError(404, "Nie znaleziono reguły");
      return json({ ok: true });
    },
  },
];
