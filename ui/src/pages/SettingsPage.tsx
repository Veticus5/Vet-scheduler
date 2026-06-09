import { useState } from "react";
import { AI_MODELS, type Settings } from "@vet/shared";
import { api } from "../api";
import { Banner, useLoader } from "../common";

export function SettingsPage({ onChange }: { onChange: (s: Settings) => void }) {
  const { data: settings, error, reload, setError } = useLoader(() => api.getSettings());
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  if (!settings) return <p>Ładowanie…</p>;

  const saveKey = async () => {
    try {
      const s = await api.setApiKey(apiKey);
      setApiKey("");
      setSaved("Klucz API zapisany.");
      onChange(s);
      reload();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const saveModel = async (aiModel: string) => {
    const s = await api.updateSettings({ aiModel });
    onChange(s);
    reload();
  };

  const saveAttempts = async (maxRepairAttempts: number) => {
    const s = await api.updateSettings({ maxRepairAttempts });
    onChange(s);
    reload();
  };

  return (
    <div>
      <h2>Ustawienia</h2>
      {error && <Banner kind="error">{error}</Banner>}
      {saved && <Banner kind="ok">{saved}</Banner>}

      <div className="panel">
        <h3>Klucz API Anthropic</h3>
        <p className="muted">
          {settings.hasApiKey
            ? "Klucz jest zapisany lokalnie. Możesz go podmienić poniżej."
            : "Brak klucza. Wpisz produkcyjny klucz API kliniki, aby generować grafiki."}
        </p>
        <div className="row">
          <input
            type="password"
            placeholder="sk-ant-…"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            style={{ width: 320 }}
          />
          <button className="primary" disabled={!apiKey.trim()} onClick={saveKey}>
            Zapisz klucz
          </button>
          {settings.hasApiKey && <span className="badge ok">skonfigurowany</span>}
        </div>
      </div>

      <div className="panel">
        <h3>Model AI</h3>
        <select value={settings.aiModel} onChange={(e) => saveModel(e.target.value)}>
          {AI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
          {!AI_MODELS.some((m) => m.id === settings.aiModel) && (
            <option value={settings.aiModel}>{settings.aiModel}</option>
          )}
        </select>
      </div>

      <div className="panel">
        <h3>Maksymalna liczba prób naprawy</h3>
        <p className="muted">
          Ile razy AI ma poprawiać grafik, gdy walidator wykryje złamanie twardych reguł.
        </p>
        <input
          type="number"
          min={0}
          max={10}
          value={settings.maxRepairAttempts}
          onChange={(e) => saveAttempts(Number(e.target.value))}
          style={{ width: 80 }}
        />
      </div>
    </div>
  );
}
