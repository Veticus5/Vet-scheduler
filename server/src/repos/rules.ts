import type { Rule, RuleInput } from "@vet/shared";
import { getDb } from "../db";
import { newId } from "../http";

interface Row {
  id: string;
  name: string;
  kind: string;
  hard: number;
  scope: string;
  params: string;
  description: string;
  enabled: number;
}

function toRule(r: Row): Rule {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as Rule["kind"],
    hard: !!r.hard,
    scope: JSON.parse(r.scope),
    params: JSON.parse(r.params),
    description: r.description,
    enabled: !!r.enabled,
  };
}

export function listRules(): Rule[] {
  return getDb().query<Row, []>("SELECT * FROM rules ORDER BY name").all().map(toRule);
}

/** Only enabled rules — what generation and validation operate on. */
export function listEnabledRules(): Rule[] {
  return listRules().filter((r) => r.enabled);
}

export function getRule(id: string): Rule | null {
  const r = getDb().query<Row, [string]>("SELECT * FROM rules WHERE id = ?").get(id);
  return r ? toRule(r) : null;
}

export function createRule(input: RuleInput): Rule {
  const id = newId();
  getDb()
    .query(
      `INSERT INTO rules (id, name, kind, hard, scope, params, description, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.kind,
      input.hard ? 1 : 0,
      JSON.stringify(input.scope),
      JSON.stringify(input.params),
      input.description ?? "",
      input.enabled ? 1 : 0,
    );
  return getRule(id)!;
}

export function updateRule(id: string, input: RuleInput): Rule | null {
  if (!getRule(id)) return null;
  getDb()
    .query(
      `UPDATE rules SET name = ?, kind = ?, hard = ?, scope = ?, params = ?, description = ?, enabled = ?
       WHERE id = ?`,
    )
    .run(
      input.name,
      input.kind,
      input.hard ? 1 : 0,
      JSON.stringify(input.scope),
      JSON.stringify(input.params),
      input.description ?? "",
      input.enabled ? 1 : 0,
      id,
    );
  return getRule(id);
}

export function setRuleEnabled(id: string, enabled: boolean): Rule | null {
  if (!getRule(id)) return null;
  getDb().query("UPDATE rules SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
  return getRule(id);
}

export function deleteRule(id: string): boolean {
  return getDb().query("DELETE FROM rules WHERE id = ?").run(id).changes > 0;
}
