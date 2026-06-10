import { useState } from "react";
import { STAFF_GROUPS, type ShiftDefinition, type ShiftDefinitionInput, type Weekday } from "@vet/shared";
import { api } from "../api";
import { Banner, WEEKDAY_LABELS, groupLabel, useLoader } from "../common";

const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

const EMPTY: ShiftDefinitionInput = {
  staffGroup: "reception",
  name: "",
  startTime: "07:30",
  endTime: "15:30",
  weekdays: [1, 2, 3, 4, 5],
  requiredMin: 1,
  requiredMax: 1,
  staffsReception: true,
};

export function ShiftsPage() {
  const { data: shifts, error, reload, setError } = useLoader(() => api.shifts());
  const [form, setForm] = useState<ShiftDefinitionInput>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);

  const toggleDay = (d: Weekday) => {
    const has = form.weekdays.includes(d);
    setForm({ ...form, weekdays: has ? form.weekdays.filter((x) => x !== d) : [...form.weekdays, d] });
  };

  const submit = async () => {
    if (!form.name.trim()) return;
    try {
      if (editingId) await api.updateShift(editingId, form);
      else await api.createShift(form);
      setForm(EMPTY);
      setEditingId(null);
      reload();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const edit = (s: ShiftDefinition) => {
    setEditingId(s.id);
    setForm({ ...s });
  };

  const remove = async (id: string) => {
    if (!confirm("Usunąć definicję zmiany?")) return;
    await api.deleteShift(id);
    reload();
  };

  return (
    <div>
      <h2>Definicje zmian</h2>
      <p className="muted">Zmiany są przypisane do grupy — każda grupa może mieć inną strukturę.</p>
      {error && <Banner kind="error">{error}</Banner>}

      <div className="panel">
        <h3>{editingId ? "Edytuj zmianę" : "Dodaj zmianę"}</h3>
        <div className="row">
          <div className="field">
            <label>Grupa</label>
            <select
              value={form.staffGroup}
              onChange={(e) => setForm({ ...form, staffGroup: e.target.value as ShiftDefinitionInput["staffGroup"] })}
            >
              {STAFF_GROUPS.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Nazwa</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Poranna" />
          </div>
          <div className="field">
            <label>Typ</label>
            <select
              value={form.staffsReception === false ? "office" : "reception"}
              onChange={(e) => setForm({ ...form, staffsReception: e.target.value === "reception" })}
            >
              <option value="reception">Obsada recepcji</option>
              <option value="office">Dyżur biurowy</option>
            </select>
          </div>
          <div className="field">
            <label>Od</label>
            <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
          </div>
          <div className="field">
            <label>Do</label>
            <input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
          </div>
          <div className="field">
            <label>Min</label>
            <input
              type="number"
              min={0}
              value={form.requiredMin}
              onChange={(e) => setForm({ ...form, requiredMin: Number(e.target.value) })}
              style={{ width: 60 }}
            />
          </div>
          <div className="field">
            <label>Max</label>
            <input
              type="number"
              min={1}
              value={form.requiredMax}
              onChange={(e) => setForm({ ...form, requiredMax: Number(e.target.value) })}
              style={{ width: 60 }}
            />
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <span className="muted">Dni:</span>
          {WEEKDAYS.map((d) => (
            <label key={d} className="row" style={{ gap: 4 }}>
              <input type="checkbox" checked={form.weekdays.includes(d)} onChange={() => toggleDay(d)} />
              {WEEKDAY_LABELS[d]}
            </label>
          ))}
          <button className="primary" onClick={submit}>
            {editingId ? "Zapisz" : "Dodaj"}
          </button>
          {editingId && (
            <button onClick={() => { setEditingId(null); setForm(EMPTY); }}>Anuluj</button>
          )}
        </div>
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Grupa</th>
              <th>Nazwa</th>
              <th>Typ</th>
              <th>Godziny</th>
              <th>Dni</th>
              <th>Obsada</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(shifts ?? []).map((s) => (
              <tr key={s.id}>
                <td>{groupLabel(s.staffGroup)}</td>
                <td>{s.name}</td>
                <td>
                  <span className={`badge ${s.staffsReception === false ? "soft" : "muted"}`}>
                    {s.staffsReception === false ? "Dyżur biurowy" : "Recepcja"}
                  </span>
                </td>
                <td>{s.startTime}–{s.endTime}</td>
                <td>{s.weekdays.map((d) => WEEKDAY_LABELS[d]).join(" ")}</td>
                <td>{s.requiredMin}–{s.requiredMax}</td>
                <td className="right">
                  <button onClick={() => edit(s)}>Edytuj</button>{" "}
                  <button className="danger" onClick={() => remove(s.id)}>Usuń</button>
                </td>
              </tr>
            ))}
            {shifts?.length === 0 && (
              <tr><td colSpan={7} className="muted">Brak definicji zmian.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
