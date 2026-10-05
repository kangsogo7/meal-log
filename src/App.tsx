import { useState } from "react";
import Today from "./pages/Today";
import Goals from "./pages/Goals";
import SettingsPage from "./pages/Settings";

type Tab = "today" | "goals" | "settings";
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "today", label: "식단", icon: "🍽️" },
  { key: "goals", label: "목표·체중", icon: "🎯" },
  { key: "settings", label: "설정", icon: "⚙️" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("today");
  return (
    <div className="app">
      <main className="content">
        {tab === "today" && <Today onGoToGoals={() => setTab("goals")} />}
        {tab === "goals" && <Goals />}
        {tab === "settings" && <SettingsPage />}
      </main>
      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
            <span className="tab-icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
