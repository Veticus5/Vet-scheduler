import { useState } from "react";
import type {
  RequestType,
  ScheduleRequest,
  ScheduleRequestInput,
  Weekday,
} from "@vet/shared";
import { api } from "../api";
import { Banner, currentMonth, useLoader, WEEKDAY_LABELS } from "../common";

const TYPE_LABELS: Record<RequestType, string> = {
  "time-off": "Wolne (twarde)",
  unavailable: "Niedostępność (twarde)",
  preferred: "Preferencja (miękkie)",
  freeform: "Dowolny tekst (AI)",
};

type DateMode = "dates" | "recurrence";

// Monday-first display order for the weekday toggles.
const WEEKDAY_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

const orderWeekdays = (wd: Weekday[]): Weekday[] => WEEKDAY_ORDER.filter((d) => wd.includes(d));
const weekdaysText = (wd: Weekday[]): string => orderWeekdays(wd).map((d) => WEEKDAY_LABELS[d]).join(", ");

export function RequestsPage() {
  const [month, setMonth] = useState(currentMonth());
  const { data: employees } = useLoader(() => api.employees());
  const { data: shifts } = useLoader(() => api.shifts());
  const { data: requests, error, reload, setError } = useLoader(() => api.requests(month), [month]);

  const [employeeId, setEmployeeId] = useState("");
  const [type, setType] = useState<RequestType>("time-off");
  const [dateMode, setDateMode] = useState<DateMode>("dates");
  const [datesText, setDatesText] = useState("");
  const [weekdays, setWeekdays] = useState<Weekday[]>([]);
  const [shiftDefIds, setShiftDefIds] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  // AI "request from text" panel.
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ScheduleRequestInput[] | null>(null);

  const reset = () => {
    setEmployeeId("");
    setType("time-off");
    setDateMode("dates");
    setDatesText("");
    setWeekdays([]);
    setShiftDefIds([]);
    setText("");
    setEditingId(null);
  };

  // Load a (proposed or saved) request into the form for review/edit.
  const applyInput = (r: ScheduleRequestInput) => {
    setEmployeeId(r.employeeId);
    setType(r.type);
    if (r.recurrence?.weekdays?.length) {
      setDateMode("recurrence");
      setWeekdays(r.recurrence.weekdays);
      setDatesText("");
    } else {
      setDateMode("dates");
      setDatesText((r.dates ?? []).join(", "));
      setWeekdays([]);
    }
    setShiftDefIds(r.shiftDefIds ?? []);
    setText(r.text ?? "");
  };

  const toggleWeekday = (d: Weekday) =>
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const submit = async () => {
    const emp = employeeId || employees?.[0]?.id;
    if (!emp) return setError("Najpierw dodaj pracowników");
    const recurring = type !== "freeform" && dateMode === "recurrence";
    const dates = datesText
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    const input: ScheduleRequestInput = {
      month,
      employeeId: emp,
      type,
      ...(recurring
        ? { recurrence: weekdays.length ? { weekdays } : undefined }
        : { dates: type !== "freeform" && dates.length ? dates : undefined }),
      shiftDefIds: shiftDefIds.length ? shiftDefIds : undefined,
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
    applyInput(r);
  };

  const remove = async (id: string) => {
    await api.deleteRequest(id);
    reload();
  };

  const runDraft = async () => {
    if (!aiText.trim()) return setAiError("Wpisz opis prośby lub wczytaj plik .txt");
    setAiBusy(true);
    setAiError(null);
    setProposals(null);
    try {
      const drafts = await api.draftRequestsFromText(aiText, month);
      if (drafts.length === 1) {
        applyInput(drafts[0]!);
        setEditingId(null);
      } else {
        setProposals(drafts);
      }
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

  // Load one proposal into the form; it leaves the list, the rest stay so each
  // can be reviewed and saved individually.
  const pickProposal = (i: number) => {
    if (!proposals) return;
    applyInput(proposals[i]!);
    setEditingId(null);
    const rest = proposals.filter((_, idx) => idx !== i);
    setProposals(rest.length ? rest : null);
  };

  // Drop one proposal without saving; the rest stay.
  const rejectProposal = (i: number) => {
    if (!proposals) return;
    const rest = proposals.filter((_, idx) => idx !== i);
    setProposals(rest.length ? rest : null);
  };

  const nameOf = (id: string) => employees?.find((e) => e.id === id)?.name ?? id;
  const shiftName = (id: string) => shifts?.find((s) => s.id === id)?.name ?? id;

  // Human summary of a request's timing for the proposals list and the table.
  const whenText = (r: { dates?: string[]; recurrence?: { weekdays: Weekday[] }; shiftDefIds?: string[] }): string => {
    const parts: string[] = [];
    if (r.recurrence?.weekdays?.length) parts.push(`Powtarza się: ${weekdaysText(r.recurrence.weekdays)}`);
    else if (r.dates?.length) parts.push(r.dates.join(", "));
    if (r.shiftDefIds?.length) parts.push(`zmiany: ${r.shiftDefIds.map(shiftName).join(", ")}`);
    return parts.join(" · ");
  };

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
        <h3>Utwórz prośbę z opisu (AI)</h3>
        <p className="muted">
          Opisz prośby po ludzku lub wczytaj plik .txt (np. „Daria — każda środa na rano; Beata wolne 5–6 lipca").
          AI zaproponuje wersje robocze — sprawdzisz je i zapiszesz ręcznie poniżej. Wymaga klucza API (Ustawienia).
        </p>
        {aiError && <Banner kind="error">{aiError}</Banner>}
        <div className="field">
          <textarea
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
            rows={3}
            style={{ width: "100%" }}
            placeholder="np. Daria prosi o każdą środę na rano; Marek niedostępny 12 i 13 lipca."
          />
        </div>
        <div className="row" style={{ marginTop: 8, alignItems: "flex-end" }}>
          <button className="primary" onClick={runDraft} disabled={aiBusy}>
            {aiBusy ? "Generuję…" : "Zaproponuj prośby"}
          </button>
          <div className="field">
            <label>…lub wczytaj plik .txt</label>
            <input type="file" accept=".txt,text/plain" onChange={(e) => readTxtFile(e.target.files?.[0])} />
          </div>
        </div>

        {proposals && (
          <div style={{ marginTop: 12 }}>
            <p className="muted">
              AI zaproponowało {proposals.length} prośb(y). Każdą przejrzyj osobno: „Wczytaj do formularza" → sprawdź →
              zapisz, albo „Odrzuć". Obsłużona pozycja znika z listy, reszta czeka.
            </p>
            {proposals.map((r, i) => (
              <div
                key={i}
                className="row"
                style={{ alignItems: "center", borderTop: "1px solid #eee", padding: "8px 0" }}
              >
                <div style={{ flex: 1 }}>
                  <strong>{nameOf(r.employeeId)}</strong>
                  <div className="muted">
                    {TYPE_LABELS[r.type]}
                    {whenText(r) ? ` · ${whenText(r)}` : ""}
                  </div>
                  {r.text && <div className="muted">{r.text}</div>}
                </div>
                <button onClick={() => pickProposal(i)}>Wczytaj do formularza</button>{" "}
                <button className="danger" onClick={() => rejectProposal(i)}>Odrzuć</button>
              </div>
            ))}
          </div>
        )}
      </div>

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
            <div className="field">
              <label>Kiedy</label>
              <select value={dateMode} onChange={(e) => setDateMode(e.target.value as DateMode)}>
                <option value="dates">Konkretne daty</option>
                <option value="recurrence">Powtarzalnie (dni tygodnia)</option>
              </select>
            </div>
          )}
        </div>

        {type !== "freeform" && dateMode === "dates" && (
          <div className="field" style={{ marginTop: 8 }}>
            <label>Daty (RRRR-MM-DD, po przecinku)</label>
            <input value={datesText} onChange={(e) => setDatesText(e.target.value)} placeholder={`${month}-05, ${month}-06`} />
          </div>
        )}

        {type !== "freeform" && dateMode === "recurrence" && (
          <div className="field" style={{ marginTop: 8 }}>
            <label>Dni tygodnia (powtarza się co tydzień w wybranym miesiącu)</label>
            <div className="row" style={{ gap: 4 }}>
              {WEEKDAY_ORDER.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={weekdays.includes(d) ? "primary" : ""}
                  onClick={() => toggleWeekday(d)}
                >
                  {WEEKDAY_LABELS[d]}
                </button>
              ))}
            </div>
            {shiftDefIds.length > 0 && (
              <p className="muted" style={{ marginTop: 4 }}>Zmiany: {shiftDefIds.map(shiftName).join(", ")}</p>
            )}
          </div>
        )}

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
          <thead><tr><th>Pracownik</th><th>Typ</th><th>Kiedy / tekst</th><th></th></tr></thead>
          <tbody>
            {(requests ?? []).map((r) => (
              <tr key={r.id}>
                <td>{nameOf(r.employeeId)}</td>
                <td>{TYPE_LABELS[r.type]}</td>
                <td>{[whenText(r), r.text].filter(Boolean).join(" — ")}</td>
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
