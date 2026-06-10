import { useState } from "react";
import { STAFF_GROUPS, type Employee, type EmployeeInput } from "@vet/shared";
import { api } from "../api";
import { Banner, groupLabel, useLoader } from "../common";

const EMPTY: EmployeeInput = {
  name: "",
  staffGroup: "reception",
  qualificationTier: "",
  contractHours: 160,
  defaultAvailability: {},
  active: true,
};

export function StaffPage() {
  const { data: employees, error, reload, setError } = useLoader(() => api.employees());
  const { data: tiers } = useLoader(() => api.qualifications());
  const [form, setForm] = useState<EmployeeInput>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);

  const tiersFor = (group: EmployeeInput["staffGroup"]) => tiers?.[group] ?? [];
  const tierLabel = (e: Employee) =>
    tiersFor(e.staffGroup).find((t) => t.key === e.qualificationTier)?.label ?? e.qualificationTier;

  // The tier actually shown/submitted: the form value if valid for the group,
  // otherwise the group's first tier. Keeps the <select> and the payload in sync
  // regardless of async load timing (the dropdown always shows a real option).
  const groupTiers = tiersFor(form.staffGroup);
  const effectiveTier = groupTiers.some((t) => t.key === form.qualificationTier)
    ? form.qualificationTier
    : (groupTiers[0]?.key ?? "");

  const submit = async () => {
    if (!form.name.trim()) return;
    if (!effectiveTier) return; // tiers not loaded yet — nothing valid to assign
    const payload: EmployeeInput = { ...form, qualificationTier: effectiveTier };
    try {
      if (editingId) await api.updateEmployee(editingId, payload);
      else await api.createEmployee(payload);
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
      qualificationTier: e.qualificationTier,
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
            <label>Kwalifikacje</label>
            <select
              value={effectiveTier}
              onChange={(e) => setForm({ ...form, qualificationTier: e.target.value })}
            >
              {groupTiers.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
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
                <td>{tierLabel(e)}</td>
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
