import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { addDays, db, getKV, todayStr } from "./db";
import Today from "./pages/Today";
import Activity from "./pages/Activity";
import Goals from "./pages/Goals";
import SettingsPage from "./pages/Settings";
// 그룹 탭은 Firebase 코드가 커서 열 때만 불러옴
const Groups = lazy(() => import("./pages/Groups"));

type Tab = "today" | "activity" | "groups" | "goals" | "settings";

// 단색 선 아이콘 (currentColor)
const icon = (d: ReactNode) => (
  <svg className="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);
const TABS: { key: Tab; label: string; icon: ReactNode }[] = [
  { key: "today", label: "식단", icon: icon(<><circle cx="12" cy="13" r="7" /><circle cx="12" cy="13" r="3.5" /><path d="M3 4v5M3 9v11M21 4v16" /></>) },
  { key: "activity", label: "활동", icon: icon(<path d="M3 12h4l3-8 4 16 3-8h4" />) },
  { key: "groups", label: "그룹", icon: icon(<><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c0-3 2.5-5.2 5.5-5.2s5.5 2.2 5.5 5.2" /><circle cx="17" cy="9" r="2.4" /><path d="M16 13.9c2.6 0 4.5 1.9 4.5 4.6" /></>) },
  { key: "goals", label: "목표·체중", icon: icon(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.8" fill="currentColor" /></>) },
  { key: "settings", label: "설정", icon: icon(<><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" /></>) },
];

/** 그룹에 들어가 있으면, 최근 식단·주간 한줄평·코멘트가 바뀔 때마다 잠시 뒤 그룹에 반영 */
function useShareSync() {
  const from = addDays(todayStr(), -20);
  const sig = useLiveQuery(async () => {
    if (!(await getKV("shareOn", false))) return "";
    const entries = await db.entries.where("date").aboveOrEqual(from).toArray();
    const notes = await db.kv.where("key").startsWithAnyOf(["weekAi:", "weekMemo:"]).toArray();
    return JSON.stringify([entries.map((e) => [e.id, e.date, e.meal, e.title, e.place, e.total.kcal, e.total.protein]), notes]);
  }, [from], "");
  useEffect(() => {
    if (!sig) return;
    const t = setTimeout(() => import("./share").then((m) => m.syncShares()).catch(() => {}), 3000);
    return () => clearTimeout(t);
  }, [sig]);
}

export default function App() {
  const [tab, setTab] = useState<Tab>("today");
  useShareSync();
  return (
    <div className="app">
      <main className="content">
        {tab === "today" && <Today onGoToGoals={() => setTab("goals")} />}
        {tab === "activity" && <Activity />}
        {tab === "groups" && <Suspense fallback={<p className="muted small center-pad">불러오는 중...</p>}><Groups /></Suspense>}
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
