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
  type Weekday,
} from "@vet/shared";
import { api } from "../api";
import { Banner, WEEKDAY_LABELS, groupLabel, useLoader } from "../common";

// Monday-first display order for weekday pickers (0 = Sunday … 6 = Saturday).
const WEEKDAY_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

function scopeGroups(scope: RuleScope): StaffGroupKey[] {
  return scope.type === "group" ? [scope.group] : scope.groups;
}

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
  const { data: shifts } = useLoader(() => api.shifts());
  const [form, setForm] = useState<RuleInput>(emptyRule());
  const [editingId, setEditingId] = useState<string | null>(null);

  // "Reguła z opisu (AI)" panel state.
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<RuleInput[] | null>(null);

  const loadIntoForm = (r: RuleInput) => {
    setForm(r);
    setEditingId(null);
  };

  // Wczytaj jedną propozycję do formularza i zdejmij ją z listy — reszta
  // zostaje, żeby można było zapisać i wczytać kolejne pojedynczo.
  const pickProposal = (i: number) => {
    if (!proposals) return;
    loadIntoForm(proposals[i]!);
    const rest = proposals.filter((_, idx) => idx !== i);
    setProposals(rest.length ? rest : null);
  };

  const runDraft = async () => {
    if (!aiText.trim()) return setAiError("Wpisz opis reguły lub wczytaj plik .txt");
    setAiBusy(true);
    setAiError(null);
    setProposals(null);
    try {
      const drafts = await api.draftRulesFromText(aiText);
      if (drafts.length === 1) loadIntoForm(drafts[0]!);
      else setProposals(drafts);
    } catch (e: any) {
      setAiError(e.message);
    } finally {
      setAiBusy(false);
    }
  };

  const readTxtFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setAiText(await file.text());
      setAiError(null);
    } catch {
      setAiError("Nie udało się odczytać pliku.");
    }
  };

  const setKind = (kind: RuleKind) => setForm({ ...form, kind, params: defaultParams(kind) });
  const setParams = (patch: Record<string, unknown>) =>
    setForm({ ...form, params: { ...form.params, ...patch } as RuleParams });
  // Toggle one value in an array-valued param; drop the key entirely when empty
  // so an unscoped (all-days / all-shifts) rule stays unscoped.
  const toggleInParam = <T,>(key: string, value: T) => {
    const cur = ((form.params as any)[key] as T[] | undefined) ?? [];
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    setParams({ [key]: next.length ? next : undefined });
  };

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
        <h3>Utwórz regułę z opisu (AI)</h3>
        <p className="muted">
          Opisz zasadę po ludzku lub wczytaj plik .txt. AI zaproponuje wersję roboczą — sprawdzisz ją i zapiszesz
          ręcznie w formularzu poniżej. Wymaga klucza API (Ustawienia).
        </p>
        {aiError && <Banner kind="error">{aiError}</Banner>}
        <div className="field">
          <textarea
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
            rows={3}
            style={{ width: "100%" }}
            placeholder="np. Daria zawsze musi pracować z kimś z recepcji; technicy maksymalnie 5 dni z rzędu."
          />
        </div>
        <div className="row" style={{ marginTop: 8, alignItems: "flex-end" }}>
          <button className="primary" onClick={runDraft} disabled={aiBusy}>
            {aiBusy ? "Generuję…" : "Zaproponuj regułę"}
          </button>
          <div className="field">
            <label>…lub wczytaj plik .txt</label>
            <input type="file" accept=".txt,text/plain" onChange={(e) => readTxtFile(e.target.files?.[0])} />
          </div>
        </div>

        {proposals && (
          <div style={{ marginTop: 12 }}>
            <p className="muted">
              AI zaproponowało {proposals.length} reguł(y). Wczytuj je pojedynczo: wczytaj do formularza, sprawdź,
              zapisz — wczytana znika z listy, a reszta czeka tu na kolejne.
            </p>
            {proposals.map((r, i) => (
              <div
                key={i}
                className="row"
                style={{ alignItems: "center", borderTop: "1px solid #eee", padding: "8px 0" }}
              >
                <div style={{ flex: 1 }}>
                  <strong>{r.name}</strong>
                  <div className="muted">
                    {KIND_LABELS[r.kind]} · {r.hard ? "twarda" : "miękka"} ·{" "}
                    {r.scope.type === "group" ? groupLabel(r.scope.group) : "między grupami"}
                  </div>
                  {r.description && <div className="muted">{r.description}</div>}
                </div>
                <button onClick={() => pickProposal(i)}>Wczytaj do formularza</button>
              </div>
            ))}
          </div>
        )}
      </div>

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
          <div style={{ marginTop: 8 }}>
            <div className="row">
              <div className="field"><label>Min</label>
                <input type="number" value={p.min ?? ""} onChange={(e) => setParams({ min: e.target.value ? Number(e.target.value) : undefined })} style={{ width: 70 }} /></div>
              <div className="field"><label>Max</label>
                <input type="number" value={p.max ?? ""} onChange={(e) => setParams({ max: e.target.value ? Number(e.target.value) : undefined })} style={{ width: 70 }} /></div>
              <span className="muted">Nadpisuje obsadę zdefiniowaną na zmianach (dla zasięgu reguły).</span>
            </div>
            <div className="field" style={{ marginTop: 8 }}>
              <label>Dni tygodnia (puste = wszystkie dni)</label>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                {WEEKDAY_ORDER.map((wd) => (
                  <label key={wd} className="row" style={{ gap: 4 }}>
                    <input
                      type="checkbox"
                      checked={(p.weekdays ?? []).includes(wd)}
                      onChange={() => toggleInParam<Weekday>("weekdays", wd)}
                    />
                    {WEEKDAY_LABELS[wd]}
                  </label>
                ))}
              </div>
            </div>
            <div className="field" style={{ marginTop: 8 }}>
              <label>Zmiany (puste = wszystkie zmiany grupy)</label>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                {(shifts ?? [])
                  .filter((s) => scopeGroups(form.scope).includes(s.staffGroup))
                  .map((s) => (
                    <label key={s.id} className="row" style={{ gap: 4 }}>
                      <input
                        type="checkbox"
                        checked={(p.shiftDefIds ?? []).includes(s.id)}
                        onChange={() => toggleInParam<string>("shiftDefIds", s.id)}
                      />
                      {s.name}
                    </label>
                  ))}
              </div>
            </div>
            <p className="muted" style={{ marginTop: 4 }}>
              Gdy obsada różni się między dniami (np. inna w weekend), utwórz osobną regułę
              na każdą wartość i zaznacz właściwe dni — inaczej reguły nadpisują się nawzajem.
            </p>
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
