import { useEffect, useMemo, useState } from "react";
import type { Assignment, Employee, FeasibilityReport, ShiftInstance, ValidationResult } from "@vet/shared";
import { api } from "../api";
import { Banner, WEEKDAY_LABELS, currentMonth, groupLabel, useLoader } from "../common";

function weekdayOf(date: string) {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

function toMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Hours-vs-norm warning threshold (H8 is advisory, not enforced). */
const HOURS_TOLERANCE = 8;

export function SchedulePage({ hasApiKey, goSettings }: { hasApiKey: boolean; goSettings: () => void }) {
  const [month, setMonth] = useState(currentMonth());
  const { data: employees } = useLoader(() => api.employees());
  const { data: shifts } = useLoader(() => api.shifts());
  const { data: instances } = useLoader(() => fetchInstances(month), [month]);
  const { data: requests } = useLoader(() => api.requests(month), [month]);

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [feasibility, setFeasibility] = useState<FeasibilityReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Load any saved schedule for the month.
  useEffect(() => {
    setError(null);
    setInfo(null);
    setDirty(false);
    setFeasibility(null); // recomputed on next generate; not stored with a saved schedule
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

  // H8 — hours worked vs contract norm (advisory). Norm is reduced by 8h per
  // time-off (urlop) day; "unavailable" is not deducted (it isn't paid leave).
  const hoursRows = useMemo(() => {
    const duration = (shiftDefId: string) => {
      const d = defById.get(shiftDefId);
      if (!d) return 0;
      let mins = toMinutes(d.endTime) - toMinutes(d.startTime);
      if (mins <= 0) mins += 24 * 60; // overnight guard
      return mins / 60;
    };
    const timeOffDays = new Map<string, Set<string>>();
    for (const r of requests ?? []) {
      if (r.type !== "time-off") continue;
      for (const day of r.dates ?? []) {
        let s = timeOffDays.get(r.employeeId);
        if (!s) timeOffDays.set(r.employeeId, (s = new Set()));
        s.add(day);
      }
    }
    const worked = new Map<string, number>();
    for (const a of assignments) worked.set(a.employeeId, (worked.get(a.employeeId) ?? 0) + duration(a.shiftDefId));
    return (employees ?? [])
      .filter((e) => e.active)
      .map((e) => ({
        id: e.id,
        name: e.name,
        worked: worked.get(e.id) ?? 0,
        norm: Math.max(0, e.contractHours - 8 * (timeOffDays.get(e.id)?.size ?? 0)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [assignments, employees, defById, requests]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await api.generate(month);
      setAssignments(res.schedule.assignments);
      setValidation(res.validation);
      setFeasibility(res.feasibility);
      setDirty(false);
      const gapCount = res.feasibility.gaps.length;
      const conflicts = res.validation.violations.length;
      setInfo(
        res.validation.valid
          ? `Wygenerowano poprawny grafik (próby AI: ${res.attempts}).`
          : gapCount > 0
            ? `Grafik wygenerowany, ale ${gapCount} zmian nie da się obsadzić — za mało dostępnych osób (patrz „Luki kadrowe”). Pozostałe konflikty popraw ręcznie.`
            : res.systemic
              ? `Konflikty (${conflicts}) wyglądają na problem konfiguracji — jedna reguła odpala się niemal co dzień. Naprawy nie uruchomiono. Sprawdź definicje zmian i reguły, potem wygeneruj ponownie.`
              : `Grafik wygenerowany, ale pozostały konflikty po ${res.attempts} próbach — popraw ręcznie lub wygeneruj ponownie.`,
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
        {validation?.valid && (
          <p className="muted" style={{ marginBottom: 0 }}>
            Sprawdzane są reguły walidowane maszynowo (obsada, doba pracownicza, podwójne
            przydzielenia, dni z rzędu, wolny weekend, prośby o wolne). Reguły opisowe oraz
            norma godzin nie są egzekwowane — zweryfikuj je ręcznie (patrz tabela godzin).
          </p>
        )}
      </div>

      {feasibility && feasibility.gaps.length > 0 && (
        <div className="panel">
          <h3 style={{ color: "var(--danger)" }}>Luki kadrowe (za mało dostępnych osób)</h3>
          <p className="muted">
            Tych zmian nie da się obsadzić żadnym grafikiem — brakuje uprawnionych, dostępnych osób.
            To nie błąd AI: dodaj obsadę, obniż wymagane minimum albo przesuń wolne/niedostępności.
          </p>
          <ul>
            {feasibility.gaps.map((g, i) => (
              <li key={i}>
                <strong>{g.date} {g.shiftName}:</strong> dostępnych {g.available} z wymaganych {g.required}.
              </li>
            ))}
          </ul>
        </div>
      )}

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

      {assignments.length > 0 && hoursRows.length > 0 && (
        <div className="panel">
          <h3>Godziny vs norma (informacyjnie)</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Norma godzin nie jest twardo egzekwowana — to podgląd. Norma uwzględnia urlopy (wolne):
            −8 h za dzień; niedostępność nie jest odejmowana. Żółto oznaczone odchylenie powyżej {HOURS_TOLERANCE} h.
          </p>
          <table>
            <thead>
              <tr>
                <th>Pracownik</th>
                <th>Godziny</th>
                <th>Norma</th>
                <th>Różnica</th>
              </tr>
            </thead>
            <tbody>
              {hoursRows.map((r) => {
                const diff = r.worked - r.norm;
                const warn = Math.abs(diff) > HOURS_TOLERANCE;
                return (
                  <tr key={r.id} style={warn ? { background: "#fffbeb" } : undefined}>
                    <td>{r.name}</td>
                    <td>{r.worked}</td>
                    <td>{r.norm}</td>
                    <td>
                      <span className={`badge ${warn ? "soft" : "muted"}`}>
                        {diff > 0 ? `+${diff}` : diff}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
                    <td>
                      {def?.name ?? inst.shiftDefId}
                      {def?.staffsReception === false && (
                        <span className="badge soft" style={{ marginLeft: 6 }}>Biuro</span>
                      )}
                      <div className="muted">{def ? `${def.startTime}–${def.endTime} (${def.requiredMin}–${def.requiredMax})` : ""}</div>
                    </td>
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
