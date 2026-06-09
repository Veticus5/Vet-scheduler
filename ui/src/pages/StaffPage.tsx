import { useState } from "react";
import { STAFF_GROUPS, type Employee, type EmployeeInput } from "@vet/shared";
import { api } from "../api";
import { Banner, groupLabel, useLoader } from "../common";

const EMPTY: EmployeeInput = {
  name: "",
  staffGroup: "reception",
  qualificationLevel: 1,
  contractHours: 160,
  defaultAvailability: {},
  active: true,
};

export function StaffPage() {
  const { data: employees, error, reload, setError } = useLoader(() => api.employees());
  const [form, setForm] = useState<EmployeeInput>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);

  const submit = async () => {
    if (!form.name.trim()) return;
    try {
      if (editingId) await api.updateEmployee(editingId, form);
      else await api.createEmployee(form);
      setForm(EMPTY);
      setEditingId(null);
      reload();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const edit = (e: Employee) => {
    setEditingId(e.id);
    setForm({
      name: e.name,
      staffGroup: e.staffGroup,
      qualificationLevel: e.qualificationLevel,
      contractHours: e.contractHours,
      defaultAvailability: e.defaultAvailability,
      active: e.active,
    });
  };

  const remove = async (id: string) => {
    if (!confirm("Usunąć pracownika?")) return;
    await api.deleteEmployee(id);
    reload();
  };

  return (
    <div>
      <h2>Pracownicy</h2>
      {error && <Banner kind="error">{error}</Banner>}

      <div className="panel">
        <h3>{editingId ? "Edytuj pracownika" : "Dodaj pracownika"}</h3>
        <div className="row">
          <div className="field">
            <label>Imię i nazwisko</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Grupa</label>
            <select
              value={form.staffGroup}
              onChange={(e) => setForm({ ...form, staffGroup: e.target.value as EmployeeInput["staffGroup"] })}
            >
              {STAFF_GROUPS.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Poziom kwalifikacji</label>
            <input
              type="number"
              min={1}
              max={5}
              value={form.qualificationLevel}
              onChange={(e) => setForm({ ...form, qualificationLevel: Number(e.target.value) })}
              style={{ width: 70 }}
            />
          </div>
          <div className="field">
            <label>Godziny / mies.</label>
            <input
              type="number"
              min={0}
              value={form.contractHours}
              onChange={(e) => setForm({ ...form, contractHours: Number(e.target.value) })}
              style={{ width: 90 }}
            />
          </div>
          <button className="primary" onClick={submit}>
            {editingId ? "Zapisz" : "Dodaj"}
          </button>
          {editingId && (
            <button
              onClick={() => {
                setEditingId(null);
                setForm(EMPTY);
              }}
            >
              Anuluj
            </button>
          )}
        </div>
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Nazwisko / imię</th>
              <th>Grupa</th>
              <th>Kwalifikacje</th>
              <th>Godziny</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(employees ?? []).map((e) => (
              <tr key={e.id}>
                <td>{e.name}</td>
                <td>{groupLabel(e.staffGroup)}</td>
                <td>{e.qualificationLevel}</td>
                <td>{e.contractHours} h</td>
                <td className="right">
                  <button onClick={() => edit(e)}>Edytuj</button>{" "}
                  <button className="danger" onClick={() => remove(e.id)}>
                    Usuń
                  </button>
                </td>
              </tr>
            ))}
            {employees?.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Brak pracowników — dodaj pierwszego powyżej.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
