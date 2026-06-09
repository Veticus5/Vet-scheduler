import { useState } from "react";
import {
  STAFF_GROUPS,
  isMachineValidated,
  type Rule,
  type RuleInput,
  type RuleKind,
  type RuleParams,
  type RuleScope,
  type StaffGroupKey,
} from "@vet/shared";
import { api } from "../api";
import { Banner, groupLabel, useLoader } from "../common";

const KIND_LABELS: Record<RuleKind, string> = {
  pairing: "Parowanie",
  "qualification-coverage": "Pokrycie kwalifikacjami",
  "max-consecutive-days": "Max dni z rzędu",
  coverage: "Obsada (nadpisanie)",
  freeform: "Dowolny tekst (dla AI)",
};

function defaultParams(kind: RuleKind): RuleParams {
  switch (kind) {
    case "pairing":
      return { kind, withGroup: [] };
    case "qualification-coverage":
      return { kind, minQualificationLevel: 3, minCount: 1 };
    case "max-consecutive-days":
      return { kind, maxDays: 7 };
    case "coverage":
      return { kind };
    case "freeform":
      return { kind };
  }
}

function emptyRule(): RuleInput {
  return {
    name: "",
    kind: "qualification-coverage",
    hard: true,
    scope: { type: "group", group: "reception" },
    params: defaultParams("qualification-coverage"),
    description: "",
    enabled: true,
  };
}

export function RulesPage() {
  const { data: rules, error, reload, setError } = useLoader(() => api.rules());
  const { data: employees } = useLoader(() => api.employees());
  const [form, setForm] = useState<RuleInput>(emptyRule());
  const [editingId, setEditingId] = useState<string | null>(null);

  const setKind = (kind: RuleKind) => setForm({ ...form, kind, params: defaultParams(kind) });
  const setParams = (patch: Record<string, unknown>) =>
    setForm({ ...form, params: { ...form.params, ...patch } as RuleParams });

  const submit = async () => {
    if (!form.name.trim()) return setError("Podaj nazwę reguły");
    try {
      if (editingId) await api.updateRule(editingId, form);
      else await api.createRule(form);
      setForm(emptyRule());
      setEditingId(null);
      reload();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const edit = (r: Rule) => {
    setEditingId(r.id);
    setForm({ name: r.name, kind: r.kind, hard: r.hard, scope: r.scope, params: r.params, description: r.description, enabled: r.enabled });
  };

  const remove = async (id: string) => {
    if (!confirm("Usunąć regułę?")) return;
    await api.deleteRule(id);
    reload();
  };

  const p = form.params as any;

  return (
    <div>
      <h2>Reguły stałe</h2>
      <p className="muted">Obowiązują w każdym miesiącu, dopóki ich nie zmienisz. Twarde = walidator pilnuje; miękkie = preferencja.</p>
      {error && <Banner kind="error">{error}</Banner>}

      <div className="panel">
        <h3>{editingId ? "Edytuj regułę" : "Dodaj regułę"}</h3>
        <div className="row">
          <div className="field">
            <label>Nazwa</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: 240 }} />
          </div>
          <div className="field">
            <label>Typ</label>
            <select value={form.kind} onChange={(e) => setKind(e.target.value as RuleKind)}>
              {Object.entries(KIND_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Rygor</label>
            <select value={form.hard ? "hard" : "soft"} onChange={(e) => setForm({ ...form, hard: e.target.value === "hard" })}>
              <option value="hard">Twarda</option>
              <option value="soft">Miękka</option>
            </select>
          </div>
        </div>

        <ScopeEditor scope={form.scope} onChange={(scope) => setForm({ ...form, scope })} />

        {form.kind === "qualification-coverage" && (
          <div className="row" style={{ marginTop: 8 }}>
            <div className="field"><label>Min. poziom kwalifikacji</label>
              <input type="number" value={p.minQualificationLevel ?? 3} onChange={(e) => setParams({ minQualificationLevel: Number(e.target.value) })} style={{ width: 80 }} /></div>
            <div className="field"><label>Min. liczba osób</label>
              <input type="number" value={p.minCount ?? 1} onChange={(e) => setParams({ minCount: Number(e.target.value) })} style={{ width: 80 }} /></div>
          </div>
        )}

        {form.kind === "max-consecutive-days" && (
          <div className="row" style={{ marginTop: 8 }}>
            <div className="field"><label>Maks. dni z rzędu</label>
              <input type="number" value={p.maxDays ?? 7} onChange={(e) => setParams({ maxDays: Number(e.target.value) })} style={{ width: 80 }} /></div>
            <div className="field" style={{ flex: 1 }}><label>Wyjątki (osoby, które mogą więcej)</label>
              <EmployeeMultiSelect employees={employees ?? []} value={p.exemptEmployeeIds ?? []} onChange={(ids) => setParams({ exemptEmployeeIds: ids })} /></div>
          </div>
        )}

        {form.kind === "pairing" && (
          <div className="row" style={{ marginTop: 8 }}>
            <div className="field"><label>Osoba (opcjonalnie)</label>
              <select value={p.employeeId ?? ""} onChange={(e) => setParams({ employeeId: e.target.value || undefined })}>
                <option value="">— dowolna o kwalifikacji —</option>
                {(employees ?? []).map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
              </select></div>
            <div className="field"><label>…lub min. kwalifikacja</label>
              <input type="number" value={p.minQualificationLevel ?? ""} onChange={(e) => setParams({ minQualificationLevel: e.target.value ? Number(e.target.value) : undefined })} style={{ width: 80 }} /></div>
            <div className="field" style={{ flex: 1 }}><label>Musi być z grupą</label>
              <GroupMultiSelect value={p.withGroup ?? []} onChange={(g) => setParams({ withGroup: g })} /></div>
          </div>
        )}

        {form.kind === "coverage" && (
          <div className="row" style={{ marginTop: 8 }}>
            <div className="field"><label>Min</label>
              <input type="number" value={p.min ?? ""} onChange={(e) => setParams({ min: e.target.value ? Number(e.target.value) : undefined })} style={{ width: 70 }} /></div>
            <div className="field"><label>Max</label>
              <input type="number" value={p.max ?? ""} onChange={(e) => setParams({ max: e.target.value ? Number(e.target.value) : undefined })} style={{ width: 70 }} /></div>
            <span className="muted">Nadpisuje obsadę zdefiniowaną na zmianach (dla zasięgu reguły).</span>
          </div>
        )}

        <div className="field" style={{ marginTop: 8 }}>
          <label>Opis {form.kind === "freeform" ? "(wskazówka dla AI)" : "(intencja — też trafia do AI)"}</label>
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} style={{ width: "100%" }} />
        </div>

        <div className="row" style={{ marginTop: 8 }}>
          <button className="primary" onClick={submit}>{editingId ? "Zapisz" : "Dodaj regułę"}</button>
          {editingId && <button onClick={() => { setEditingId(null); setForm(emptyRule()); }}>Anuluj</button>}
        </div>
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr><th>Nazwa</th><th>Typ</th><th>Rygor</th><th>Zasięg</th><th>Aktywna</th><th></th></tr>
          </thead>
          <tbody>
            {(rules ?? []).map((r) => (
              <tr key={r.id}>
                <td>
                  {r.name}
                  {!isMachineValidated(r) && <div><span className="badge muted">AI-guided, niewalidowane maszynowo</span></div>}
                </td>
                <td>{KIND_LABELS[r.kind]}</td>
                <td><span className={`badge ${r.hard ? "hard" : "soft"}`}>{r.hard ? "twarda" : "miękka"}</span></td>
                <td>{r.scope.type === "group" ? groupLabel(r.scope.group) : "między grupami"}</td>
                <td><input type="checkbox" checked={r.enabled} onChange={(e) => api.setRuleEnabled(r.id, e.target.checked).then(reload)} /></td>
                <td className="right">
                  <button onClick={() => edit(r)}>Edytuj</button>{" "}
                  <button className="danger" onClick={() => remove(r.id)}>Usuń</button>
                </td>
              </tr>
            ))}
            {rules?.length === 0 && <tr><td colSpan={6} className="muted">Brak reguł.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScopeEditor({ scope, onChange }: { scope: RuleScope; onChange: (s: RuleScope) => void }) {
  return (
    <div className="row" style={{ marginTop: 8 }}>
      <div className="field">
        <label>Zasięg</label>
        <select
          value={scope.type}
          onChange={(e) =>
            onChange(e.target.value === "group" ? { type: "group", group: "reception" } : { type: "cross-group", groups: [] })
          }
        >
          <option value="group">Jedna grupa</option>
          <option value="cross-group">Między grupami</option>
        </select>
      </div>
      {scope.type === "group" ? (
        <div className="field">
          <label>Grupa</label>
          <select value={scope.group} onChange={(e) => onChange({ type: "group", group: e.target.value as StaffGroupKey })}>
            {STAFF_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
        </div>
      ) : (
        <div className="field" style={{ flex: 1 }}>
          <label>Grupy</label>
          <GroupMultiSelect value={scope.groups} onChange={(groups) => onChange({ type: "cross-group", groups })} />
        </div>
      )}
    </div>
  );
}

function GroupMultiSelect({ value, onChange }: { value: StaffGroupKey[]; onChange: (g: StaffGroupKey[]) => void }) {
  const toggle = (k: StaffGroupKey) =>
    onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);
  return (
    <div className="row">
      {STAFF_GROUPS.map((g) => (
        <label key={g.key} className="row" style={{ gap: 4 }}>
          <input type="checkbox" checked={value.includes(g.key)} onChange={() => toggle(g.key)} />
          {g.label}
        </label>
      ))}
    </div>
  );
}

function EmployeeMultiSelect({
  employees,
  value,
  onChange,
}: {
  employees: { id: string; name: string }[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      {employees.map((e) => (
        <label key={e.id} className="row" style={{ gap: 4 }}>
          <input type="checkbox" checked={value.includes(e.id)} onChange={() => toggle(e.id)} />
          {e.name}
        </label>
      ))}
      {employees.length === 0 && <span className="muted">Brak pracowników</span>}
    </div>
  );
}
