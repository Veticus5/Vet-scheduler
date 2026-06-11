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

// How the request's days are entered. All but "recurrence" resolve to an
// explicit `dates` list at submit, so the stored data model is unchanged.
type DateMode = "dates" | "range" | "except" | "recurrence";

const DATE_MODE_LABELS: Record<DateMode, string> = {
  dates: "Konkretne daty",
  range: "Zakres (od–do)",
  except: "Cały miesiąc oprócz…",
  recurrence: "Powtarzalnie (dni tygodnia)",
};

// Monday-first display order for the weekday toggles.
const WEEKDAY_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

const orderWeekdays = (wd: Weekday[]): Weekday[] => WEEKDAY_ORDER.filter((d) => wd.includes(d));
const weekdaysText = (wd: Weekday[]): string => orderWeekdays(wd).map((d) => WEEKDAY_LABELS[d]).join(", ");

/** All YYYY-MM-DD dates of a YYYY-MM month, in order. */
function datesInMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const n = new Date(y, m, 0).getDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** Inclusive date range within the month; tolerates reversed bounds. */
function expandRange(month: string, from: string, to: string): string[] {
  if (!from || !to) return [];
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  return datesInMonth(month).filter((d) => d >= lo && d <= hi);
}

/** Parse a comma/space separated day list into in-month YYYY-MM-DD dates.
 *  Accepts bare day numbers ("11, 12") or full dates ("2026-07-11"). */
function parseDayList(month: string, raw: string): string[] {
  const out = new Set<string>();
  for (const tok of raw.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(tok)) out.add(tok);
    else if (/^\d{1,2}$/.test(tok)) out.add(`${month}-${tok.padStart(2, "0")}`);
  }
  return datesInMonth(month).filter((d) => out.has(d)); // keep in-month + ordered
}

export function RequestsPage() {
  const [month, setMonth] = useState(currentMonth());
  const { data: employees } = useLoader(() => api.employees());
  const { data: shifts } = useLoader(() => api.shifts());
  const { data: requests, error, reload, setError } = useLoader(() => api.requests(month), [month]);

  const [employeeId, setEmployeeId] = useState("");
  const [type, setType] = useState<RequestType>("time-off");
  const [dateMode, setDateMode] = useState<DateMode>("dates");
  const [datesText, setDatesText] = useState("");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
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
    setRangeFrom("");
    setRangeTo("");
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
    setRangeFrom("");
    setRangeTo("");
    setShiftDefIds(r.shiftDefIds ?? []);
    setText(r.text ?? "");
  };

  const toggleWeekday = (d: Weekday) =>
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  const toggleShift = (id: string) =>
    setShiftDefIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // Resolve the chosen date mode to the concrete day list stored on the request.
  const resolveDates = (): string[] => {
    if (type === "freeform") return [];
    if (dateMode === "range") return expandRange(month, rangeFrom, rangeTo);
    if (dateMode === "except") {
      const keep = new Set(parseDayList(month, datesText));
      return datesInMonth(month).filter((d) => !keep.has(d)); // whole month except listed
    }
    return parseDayList(month, datesText); // "dates"
  };

  const submit = async () => {
    const emp = employeeId || employees?.[0]?.id;
    if (!emp) return setError("Najpierw dodaj pracowników");
    const recurring = type !== "freeform" && dateMode === "recurrence";
    const dates = resolveDates();
    const input: ScheduleRequestInput = {
      month,
      employeeId: emp,
      type,
      ...(recurring
        ? { recurrence: weekdays.length ? { weekdays } : undefined }
        : { dates: dates.length ? dates : undefined }),
      shiftDefIds: type !== "freeform" && shiftDefIds.length ? shiftDefIds : undefined,
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
    else if (r.dates?.length) {
      // Long lists (e.g. "whole month except…") collapse to a count + range.
      parts.push(
        r.dates.length > 6
          ? `${r.dates.length} dni (${r.dates[0]!.slice(-2)}–${r.dates[r.dates.length - 1]!.slice(-2)})`
          : r.dates.map((d) => d.slice(-2)).join(", "),
      );
    }
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
                {(Object.keys(DATE_MODE_LABELS) as DateMode[]).map((m) => (
                  <option key={m} value={m}>{DATE_MODE_LABELS[m]}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {type !== "freeform" && dateMode === "dates" && (
          <div className="field" style={{ marginTop: 8 }}>
            <label>Daty (numery dni „11, 12" lub pełne „{month}-11", po przecinku)</label>
            <input value={datesText} onChange={(e) => setDatesText(e.target.value)} placeholder={`5, 6  lub  ${month}-05`} />
          </div>
        )}

        {type !== "freeform" && dateMode === "range" && (
          <div className="row" style={{ marginTop: 8 }}>
            <div className="field">
              <label>Od</label>
              <input type="date" min={`${month}-01`} value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} />
            </div>
            <div className="field">
              <label>Do</label>
              <input type="date" min={`${month}-01`} value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} />
            </div>
            {rangeFrom && rangeTo && (
              <p className="muted" style={{ alignSelf: "flex-end" }}>
                {expandRange(month, rangeFrom, rangeTo).length} dni
              </p>
            )}
          </div>
        )}

        {type !== "freeform" && dateMode === "except" && (
          <div className="field" style={{ marginTop: 8 }}>
            <label>Dni-wyjątki (prośba obejmie CAŁY miesiąc OPRÓCZ tych dni)</label>
            <input value={datesText} onChange={(e) => setDatesText(e.target.value)} placeholder="11, 12" />
            <p className="muted" style={{ marginTop: 4 }}>
              Np. niedostępność „cały lipiec oprócz 11, 12" = pracuje tylko 11 i 12.
              {datesText.trim() && ` → ${resolveDates().length} dni objętych prośbą.`}
            </p>
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
          </div>
        )}

        {type !== "freeform" && (
          <div className="field" style={{ marginTop: 8 }}>
            <label>Ogranicz do zmian (opcjonalnie — puste = wszystkie zmiany)</label>
            <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
              {(shifts ?? []).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={shiftDefIds.includes(s.id) ? "primary" : ""}
                  onClick={() => toggleShift(s.id)}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <p className="muted" style={{ marginTop: 4 }}>
              {type === "preferred"
                ? "Np. „preferuje na poranną” — zaznacz Porannę."
                : "Np. „w tygodniu tylko popołudnia” — typ Niedostępność, dni tygodnia pon–pt, zaznacz Poranną i Międzyzmianę."}
            </p>
          </div>
        )}

        <div className="field" style={{ marginTop: 8 }}>
          <label>Tekst {type === "freeform" ? "(wymagany)" : "(opcjonalny — notatka)"}</label>
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
