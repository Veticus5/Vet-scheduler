import { useEffect, useMemo, useState } from "react";
import type { Assignment, Employee, ShiftInstance, ValidationResult } from "@vet/shared";
import { api } from "../api";
import { Banner, WEEKDAY_LABELS, currentMonth, groupLabel, useLoader } from "../common";

function weekdayOf(date: string) {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export function SchedulePage({ hasApiKey, goSettings }: { hasApiKey: boolean; goSettings: () => void }) {
  const [month, setMonth] = useState(currentMonth());
  const { data: employees } = useLoader(() => api.employees());
  const { data: shifts } = useLoader(() => api.shifts());
  const { data: instances } = useLoader(() => fetchInstances(month), [month]);

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Load any saved schedule for the month.
  useEffect(() => {
    setError(null);
    setInfo(null);
    setDirty(false);
    api
      .schedule(month)
      .then((s) => {
        setAssignments(s.assignments);
        setValidation({ valid: s.status === "valid", violations: s.violations, unmetPreferences: [] });
      })
      .catch(() => {
        setAssignments([]);
        setValidation(null);
      });
  }, [month]);

  const empById = useMemo(() => new Map((employees ?? []).map((e) => [e.id, e])), [employees]);
  const defById = useMemo(() => new Map((shifts ?? []).map((s) => [s.id, s])), [shifts]);

  const conflictInstances = useMemo(() => {
    const set = new Set<string>();
    for (const v of validation?.violations ?? []) {
      if (v.date && v.shiftDefId) set.add(`${v.date}|${v.shiftDefId}`);
    }
    return set;
  }, [validation]);

  const conflictEmployees = useMemo(() => {
    const set = new Set<string>();
    for (const v of validation?.violations ?? []) if (v.employeeId && !v.shiftDefId) set.add(v.employeeId);
    return set;
  }, [validation]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await api.generate(month);
      setAssignments(res.schedule.assignments);
      setValidation(res.validation);
      setDirty(false);
      setInfo(
        res.validation.valid
          ? `Wygenerowano poprawny grafik (próby AI: ${res.attempts}).`
          : `Grafik wygenerowany, ale pozostały konflikty po ${res.attempts} próbach — popraw ręcznie.`,
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const revalidate = async (next: Assignment[]) => {
    try {
      setValidation(await api.validateSchedule(month, next));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const toggleAssign = (inst: ShiftInstance, employeeId: string) => {
    const exists = assignments.some(
      (a) => a.date === inst.date && a.shiftDefId === inst.shiftDefId && a.employeeId === employeeId,
    );
    const next = exists
      ? assignments.filter(
          (a) => !(a.date === inst.date && a.shiftDefId === inst.shiftDefId && a.employeeId === employeeId),
        )
      : [...assignments, { date: inst.date, shiftDefId: inst.shiftDefId, employeeId }];
    setAssignments(next);
    setDirty(true);
    revalidate(next);
  };

  const save = async () => {
    setBusy(true);
    try {
      const res = await api.saveSchedule(month, assignments);
      setValidation(res.validation);
      setDirty(false);
      setInfo("Grafik zapisany.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Header stats
  const workedDays = new Set(assignments.map((a) => a.date)).size;
  const insts = instances ?? [];

  return (
    <div>
      <h2>Grafik — {month}</h2>
      <div className="row">
        <div className="field">
          <label>Miesiąc</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <button className="primary" disabled={busy} onClick={generate}>
          {busy ? <span className="spinner">⏳</span> : "🤖 Wygeneruj grafik (AI)"}
        </button>
        <button disabled={busy || !dirty} onClick={save}>Zapisz zmiany</button>
        <a className="right" href={api.exportCsvUrl(month)}>
          <button>⬇ Eksport CSV</button>
        </a>
      </div>

      {!hasApiKey && (
        <Banner kind="warn">
          Brak klucza API — generowanie jest zablokowane.{" "}
          <button onClick={goSettings}>Przejdź do Ustawień</button>
        </Banner>
      )}
      {error && <Banner kind="error">{error}</Banner>}
      {info && <Banner kind={validation?.valid === false ? "warn" : "ok"}>{info}</Banner>}

      <div className="panel">
        <div className="row">
          <span className="badge muted">Obsadzone dni: {workedDays}</span>
          <span className="badge muted">Pozycje grafiku: {assignments.length}</span>
          {validation && (
            <span className={`badge ${validation.valid ? "ok" : "hard"}`}>
              {validation.valid ? "Brak konfliktów" : `Konflikty: ${validation.violations.length}`}
            </span>
          )}
        </div>
      </div>

      {validation && validation.violations.length > 0 && (
        <div className="panel">
          <h3 style={{ color: "var(--danger)" }}>Konflikty (twarde reguły)</h3>
          <ul>
            {validation.violations.map((v, i) => (
              <li key={i}>
                <strong>{v.ruleName}:</strong> {v.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {validation && validation.unmetPreferences.length > 0 && (
        <div className="panel">
          <h3 style={{ color: "var(--warn)" }}>Niespełnione preferencje (miękkie)</h3>
          <ul>{validation.unmetPreferences.map((u, i) => <li key={i}>{u.message}</li>)}</ul>
        </div>
      )}

      <div className="panel">
        {insts.length === 0 ? (
          <p className="muted">Brak instancji zmian. Zdefiniuj zmiany dla wybranych dni tygodnia.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Dzień</th>
                <th>Grupa</th>
                <th>Zmiana</th>
                <th>Przydzieleni / edycja</th>
              </tr>
            </thead>
            <tbody>
              {insts.map((inst) => {
                const def = defById.get(inst.shiftDefId);
                const isConflict = conflictInstances.has(`${inst.date}|${inst.shiftDefId}`);
                const groupEmployees = (employees ?? []).filter((e) => e.staffGroup === inst.staffGroup && e.active);
                return (
                  <tr key={`${inst.date}|${inst.shiftDefId}`} style={isConflict ? { background: "#fff1f2" } : undefined}>
                    <td>{inst.date}{isConflict ? " ⚠️" : ""}</td>
                    <td>{WEEKDAY_LABELS[weekdayOf(inst.date)]}</td>
                    <td>{groupLabel(inst.staffGroup)}</td>
                    <td>{def?.name ?? inst.shiftDefId}<div className="muted">{def ? `${def.startTime}–${def.endTime} (${def.requiredMin}–${def.requiredMax})` : ""}</div></td>
                    <td>
                      <CellEditor
                        inst={inst}
                        groupEmployees={groupEmployees}
                        assignments={assignments}
                        conflictEmployees={conflictEmployees}
                        onToggle={toggleAssign}
                        empById={empById}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function CellEditor({
  inst,
  groupEmployees,
  assignments,
  conflictEmployees,
  onToggle,
  empById,
}: {
  inst: ShiftInstance;
  groupEmployees: Employee[];
  assignments: Assignment[];
  conflictEmployees: Set<string>;
  onToggle: (inst: ShiftInstance, employeeId: string) => void;
  empById: Map<string, Employee>;
}) {
  const [open, setOpen] = useState(false);
  const assigned = assignments.filter((a) => a.date === inst.date && a.shiftDefId === inst.shiftDefId);

  return (
    <div>
      <div className="row" style={{ gap: 6 }}>
        {assigned.map((a) => (
          <span key={a.employeeId} className={`badge ${conflictEmployees.has(a.employeeId) ? "hard" : "muted"}`}>
            {empById.get(a.employeeId)?.name ?? a.employeeId}
          </span>
        ))}
        <button onClick={() => setOpen((v) => !v)}>{open ? "Zwiń" : "+ / −"}</button>
      </div>
      {open && (
        <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: "wrap" }}>
          {groupEmployees.map((e) => {
            const on = assigned.some((a) => a.employeeId === e.id);
            return (
              <label key={e.id} className="row" style={{ gap: 4 }}>
                <input type="checkbox" checked={on} onChange={() => onToggle(inst, e.id)} />
                {e.name}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

async function fetchInstances(month: string): Promise<ShiftInstance[]> {
  const res = await fetch(`/api/shifts/instances/${month}`);
  if (!res.ok) return [];
  return (await res.json()) as ShiftInstance[];
}
