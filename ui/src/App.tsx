import { useEffect, useState } from "react";
import { api } from "./api";
import type { Settings } from "@vet/shared";
import { StaffPage } from "./pages/StaffPage";
import { ShiftsPage } from "./pages/ShiftsPage";
import { RulesPage } from "./pages/RulesPage";
import { RequestsPage } from "./pages/RequestsPage";
import { SchedulePage } from "./pages/SchedulePage";
import { SettingsPage } from "./pages/SettingsPage";

type Tab = "schedule" | "staff" | "shifts" | "rules" | "requests" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "schedule", label: "Grafik" },
  { id: "staff", label: "Pracownicy" },
  { id: "shifts", label: "Zmiany" },
  { id: "rules", label: "Reguły stałe" },
  { id: "requests", label: "Prośby (miesiąc)" },
  { id: "settings", label: "Ustawienia" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("schedule");
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => setSettings(null));
  }, [tab]);

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>🐾 Grafik kliniki</h1>
        <nav className="nav">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === "settings" && settings && !settings.hasApiKey ? " ⚠️" : ""}
            </button>
          ))}
        </nav>
      </aside>
      <main className="content">
        {tab === "schedule" && <SchedulePage hasApiKey={!!settings?.hasApiKey} goSettings={() => setTab("settings")} />}
        {tab === "staff" && <StaffPage />}
        {tab === "shifts" && <ShiftsPage />}
        {tab === "rules" && <RulesPage />}
        {tab === "requests" && <RequestsPage />}
        {tab === "settings" && <SettingsPage onChange={setSettings} />}
      </main>
    </div>
  );
}
