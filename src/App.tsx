import { useState, type ReactNode } from "react";
import Today from "./pages/Today";
import Goals from "./pages/Goals";
import SettingsPage from "./pages/Settings";

type Tab = "today" | "goals" | "settings";

// 단색 선 아이콘 (currentColor)
const icon = (d: ReactNode) => (
  <svg className="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);
const TABS: { key: Tab; label: string; icon: ReactNode }[] = [
  { key: "today", label: "식단", icon: icon(<><circle cx="12" cy="13" r="7" /><circle cx="12" cy="13" r="3.5" /><path d="M3 4v5M3 9v11M21 4v16" /></>) },
  { key: "goals", label: "목표·체중", icon: icon(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.8" fill="currentColor" /></>) },
  { key: "settings", label: "설정", icon: icon(<><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" /></>) },
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
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
