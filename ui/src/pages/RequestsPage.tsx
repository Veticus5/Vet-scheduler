import { useState } from "react";
import type { RequestType, ScheduleRequest, ScheduleRequestInput } from "@vet/shared";
import { api } from "../api";
import { Banner, currentMonth, useLoader } from "../common";

const TYPE_LABELS: Record<RequestType, string> = {
  "time-off": "Wolne (twarde)",
  unavailable: "Niedostępność (twarde)",
  preferred: "Preferencja (miękkie)",
  freeform: "Dowolny tekst (AI)",
};

export function RequestsPage() {
  const [month, setMonth] = useState(currentMonth());
  const { data: employees } = useLoader(() => api.employees());
  const { data: requests, error, reload, setError } = useLoader(() => api.requests(month), [month]);

  const [employeeId, setEmployeeId] = useState("");
  const [type, setType] = useState<RequestType>("time-off");
  const [datesText, setDatesText] = useState("");
  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const reset = () => {
    setEmployeeId("");
    setType("time-off");
    setDatesText("");
    setText("");
    setEditingId(null);
  };

  const submit = async () => {
    const emp = employeeId || employees?.[0]?.id;
    if (!emp) return setError("Najpierw dodaj pracowników");
    const dates = datesText
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    const input: ScheduleRequestInput = {
      month,
      employeeId: emp,
      type,
      dates: dates.length ? dates : undefined,
      text: text.trim() || undefined,
    };
    try {
      if (editingId) await api.updateRequest(editingId, input);
      else await api.createRequest(input);
      reset();
      reload();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const edit = (r: ScheduleRequest) => {
    setEditingId(r.id);
    setEmployeeId(r.employeeId);
    setType(r.type);
    setDatesText((r.dates ?? []).join(", "));
    setText(r.text ?? "");
  };

  const remove = async (id: string) => {
    await api.deleteRequest(id);
    reload();
  };

  const nameOf = (id: string) => employees?.find((e) => e.id === id)?.name ?? id;

  return (
    <div>
      <h2>Prośby grafikowe</h2>
      <div className="row">
        <div className="field">
          <label>Miesiąc</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
      </div>
      <p className="muted">Prośby dotyczą tylko wybranego miesiąca.</p>
      {error && <Banner kind="error">{error}</Banner>}

      <div className="panel">
        <h3>{editingId ? "Edytuj prośbę" : "Dodaj prośbę"}</h3>
        <div className="row">
          <div className="field">
            <label>Pracownik</label>
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">— wybierz —</option>
              {(employees ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Typ</label>
            <select value={type} onChange={(e) => setType(e.target.value as RequestType)}>
              {Object.entries(TYPE_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>
          {type !== "freeform" && (
            <div className="field" style={{ flex: 1 }}>
              <label>Daty (RRRR-MM-DD, po przecinku)</label>
              <input value={datesText} onChange={(e) => setDatesText(e.target.value)} placeholder={`${month}-05, ${month}-06`} />
            </div>
          )}
        </div>
        <div className="field" style={{ marginTop: 8 }}>
          <label>Tekst {type === "freeform" ? "(wymagany)" : "(opcjonalny)"}</label>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} style={{ width: "100%" }} />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="primary" onClick={submit}>{editingId ? "Zapisz" : "Dodaj"}</button>
          {editingId && <button onClick={reset}>Anuluj</button>}
        </div>
      </div>

      <div className="panel">
        <table>
          <thead><tr><th>Pracownik</th><th>Typ</th><th>Daty / tekst</th><th></th></tr></thead>
          <tbody>
            {(requests ?? []).map((r) => (
              <tr key={r.id}>
                <td>{nameOf(r.employeeId)}</td>
                <td>{TYPE_LABELS[r.type]}</td>
                <td>{[r.dates?.join(", "), r.text].filter(Boolean).join(" — ")}</td>
                <td className="right">
                  <button onClick={() => edit(r)}>Edytuj</button>{" "}
                  <button className="danger" onClick={() => remove(r.id)}>Usuń</button>
                </td>
              </tr>
            ))}
            {requests?.length === 0 && <tr><td colSpan={4} className="muted">Brak próśb na ten miesiąc.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
